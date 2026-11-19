import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { textToSpeech } from "@workspace/integrations-openai-ai-server/audio";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { buildVoiceoverSubtitles } from "./videoSubtitles";

type RenderScene = {
  id: string;
  title: string;
  narration: string;
  visualDirection: string;
  seconds: number;
  onScreenText?: string;
  visualMetaphor?: string;
  shotType?: string;
  cameraMove?: string;
  entrance?: "already-on-stage" | "walk-in-left" | "walk-in-right" | "run-in-left" | "run-in-right" | "pop-in";
  groupAction?: "story-directed" | "talk-and-react" | "walk-together" | "point-together" | "celebrate-together";
  exit?: "hold" | "walk-off-left" | "walk-off-right" | "run-off-left" | "run-off-right" | "exit-together";
  transitionToNext?: "cut" | "dissolve" | "wipe-left" | "wipe-right" | "match-left" | "match-right";
};

type RenderCastMember = {
  id: string;
  name: string;
  role: string;
  personality?: string;
  shirtColor: string;
  skinTone: string;
  hairStyle: "short" | "curly" | "long";
  accessory: "none" | "cap" | "glasses" | "headband" | "backpack" | "bow";
};

type RenderInput = {
  title: string;
  topic: string;
  aspectRatio: "16:9" | "9:16";
  styleId: string;
  contentLanguage: "en" | "am" | "ar";
  voiceover: boolean;
  subtitles: boolean;
  scenes: RenderScene[];
  cartoonCast?: RenderCastMember[];
};

const STYLE_PALETTES: Record<string, { paper: string; ink: string; accent: string; field: string }> = {
  A1: { paper: "#f4efe4", ink: "#263239", accent: "#df7655", field: "#dfe8df" },
  A2: { paper: "#fbf0db", ink: "#253240", accent: "#e26949", field: "#d7e8dd" },
  A3: { paper: "#e7d4b4", ink: "#3d342a", accent: "#b96740", field: "#c6b28e" },
  A4: { paper: "#f4eadb", ink: "#35423e", accent: "#cc7d56", field: "#e3dfc8" },
  A5: { paper: "#f3e8d0", ink: "#34363a", accent: "#c36546", field: "#d7ddc9" },
  A6: { paper: "#26323b", ink: "#f3e9d3", accent: "#e1a35b", field: "#45515a" },
  A7: { paper: "#f3e4c8", ink: "#313641", accent: "#d6674c", field: "#e0c99f" },
  A8: { paper: "#f6e7b8", ink: "#403831", accent: "#e9784f", field: "#c6dfd1" },
  A9: { paper: "#f8edda", ink: "#39494a", accent: "#e97855", field: "#bdd5cb" },
  A10: { paper: "#f4e9fb", ink: "#2d3942", accent: "#e56c4d", field: "#c3ddce" },
  B1: { paper: "#f1eee6", ink: "#263239", accent: "#d97151", field: "#d9e4dd" },
  B2: { paper: "#f8ebd3", ink: "#283238", accent: "#e26745", field: "#cfe4d8" },
  B3: { paper: "#d9e0d0", ink: "#29333a", accent: "#b85c47", field: "#b8c4b4" },
  B4: { paper: "#d5ded8", ink: "#263039", accent: "#db674c", field: "#b8c5bd" },
  B5: { paper: "#eee9db", ink: "#27353b", accent: "#c96d4c", field: "#d1e0d4" },
  B6: { paper: "#333447", ink: "#fff0d1", accent: "#ff9b5f", field: "#5f5365" },
  B7: { paper: "#263747", ink: "#e7f4d5", accent: "#f38b59", field: "#3e6470" },
  B8: { paper: "#f8e8d2", ink: "#39463e", accent: "#d87858", field: "#9bbc8a" },
  B9: { paper: "#d8edf1", ink: "#3d4c4d", accent: "#e66f52", field: "#b5c9bd" },
  B10: { paper: "#fff0d4", ink: "#20292d", accent: "#ec994d", field: "#4e7477" },
};
const CARTOON_STYLE_IDS = new Set(["A8", "A9", "A10", "B8", "B9", "B10"]);
const FPS = 24;
const POSE_FRAMES = 24;
const MOVEMENT_FRAMES = 8;
const TRANSITION_FRAMES = 8;
const TRANSITION_SECONDS = TRANSITION_FRAMES / FPS;

type SceneContext = "nature" | "finance" | "technology" | "science" | "health" | "learning" | "food" | "city" | "cave" | "classroom" | "mall" | "home" | "office" | "park" | "studio";
type StickmanAction = "walk" | "run" | "wave" | "think" | "celebrate" | "lift" | "present";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeHex(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function adjustHex(value: string, amount: number): string {
  const hex = safeHex(value, "#808080").slice(1);
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const adjusted = channels
    .map((channel) => Math.round(amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount)))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("");
  return `#${adjusted}`;
}

function wrapText(value: string, maxChars: number, maxLines: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const consumed = lines.join(" ").length;
  if (consumed < value.trim().length && lines.length) {
    lines[lines.length - 1] = `${lines.at(-1)!.replace(/[.…]+$/, "")}…`;
  }
  return lines.length ? lines : [""];
}

function contextForScene(scene: RenderScene, topic: string, styleId: string): SceneContext {
  const classify = (text: string): SceneContext | null => {
    const value = text.toLowerCase();
    const has = (terms: string[]) => terms.some((term) => value.includes(term));
    if (/\b(cave|caves|cavern|underground|spelunk(?:ing)?|rock formation)\b/.test(value) || has(["ዋሻ", "ዋሻዎች", "የድንጋይ ዋሻ", "ከመሬት በታች", "كهف", "كهوف", "مغارة", "تحت الأرض"])) return "cave";
    if (/\b(classroom|teacher|student|school|chalkboard|lesson)\b/.test(value) || has(["ትምህርት ቤት", "ተማሪ", "መምህር", "ጥቁር ሰሌዳ", "ክፍል", "مدرسة", "معلم", "طالب", "سبورة", "درس"])) return "classroom";
    if (/\b(mall|shopping|shop|store|food court|marketplace)\b/.test(value) || has(["የገበያ ማዕከል", "ሱቅ", "ግብይት", "የምግብ ማዕከል", "مركز تجاري", "متجر", "تسوق", "سوق تجاري", "مطاعم"])) return "mall";
    if (/\b(home|house|family|living room|kitchen|bedroom)\b/.test(value) || has(["ቤት", "ቤተሰብ", "ሳሎን", "መኝታ ቤት", "منزل", "بيت", "عائلة", "أسرة", "غرفة المعيشة", "مطبخ"])) return "home";
    if (/\b(office|workplace|work meeting|interview studio|newsroom)\b/.test(value) || has(["ቢሮ", "የሥራ ቦታ", "ቃለ መጠይቅ", "مكتب", "مكان العمل", "مقابلة", "استوديو أخبار"])) return "office";
    if (/\b(park|playground|garden path)\b/.test(value) || has(["መናፈሻ", "የልጆች መጫወቻ", "حديقة عامة", "ملعب أطفال"])) return "park";
    if (/\b(technology|phone|app|computer|code|digital|internet|battery|ai|software|robot|data)\b/.test(value) || has(["ስልክ", "ቴክኖሎጂ", "ኮምፒውተር", "ኮድ", "ዲጂታል", "ኢንተርኔት", "ባትሪ", "ሶፍትዌር", "ሮቦት", "መረጃ", "هاتف", "تقنية", "تكنولوجيا", "حاسوب", "برمجة", "رقمي", "إنترنت", "بطارية", "ذكاء اصطناعي", "برنامج", "روبوت", "بيانات"])) return "technology";
    if (/\b(tree|forest|plant|garden|climate|nature|ocean|river|earth|weather|solar|renewable|wind|energy)\b/.test(value) || has(["ዛፍ", "ደን", "ተክል", "አትክልት", "የአየር ንብረት", "ተፈጥሮ", "ውቅያኖስ", "ወንዝ", "ምድር", "የአየር ሁኔታ", "ፀሐይ", "ንፋስ", "ኃይል", "شجرة", "غابة", "نبات", "حديقة", "مناخ", "طبيعة", "محيط", "نهر", "أرض", "طقس", "طاقة", "رياح"])) return "nature";
    if (/\b(money|budget|bank|finance|price|cost|invest|saving|debt|profit|market|econom)\b/.test(value) || has(["ገንዘብ", "በጀት", "ባንክ", "ፋይናንስ", "ዋጋ", "ወጪ", "ኢንቨስት", "ቁጠባ", "ዕዳ", "ትርፍ", "ገበያ", "ኢኮኖሚ", "مال", "ميزانية", "بنك", "تمويل", "سعر", "تكلفة", "استثمار", "ادخار", "دين", "ربح", "سوق", "اقتصاد"])) return "finance";
    if (/\b(science|atom|physics|experiment|space|planet|molecule|research|gravity|chemistry)\b/.test(value) || has(["ሳይንስ", "አቶም", "ፊዚክስ", "ሙከራ", "ጠፈር", "ፕላኔት", "ሞለኪውል", "ምርምር", "ስበት", "ኬሚስትሪ", "علوم", "ذرة", "فيزياء", "تجربة", "فضاء", "كوكب", "جزيء", "بحث", "جاذبية", "كيمياء"])) return "science";
    if (/\b(health|heart|doctor|medical|exercise|fitness|sleep|brain|body|wellness)\b/.test(value) || has(["ጤና", "ልብ", "ሐኪም", "ሕክምና", "እንቅስቃሴ", "የአካል ብቃት", "እንቅልፍ", "አንጎል", "ሰውነት", "ደህንነት", "صحة", "قلب", "طبيب", "طبي", "تمرين", "لياقة", "نوم", "دماغ", "جسم", "عافية"])) return "health";
    if (/\b(learn|learning|study|education|book|memory|skill)\b/.test(value) || has(["መማር", "ጥናት", "ትምህርት", "መጽሐፍ", "ትውስታ", "ክህሎት", "تعلم", "دراسة", "تعليم", "كتاب", "ذاكرة", "مهارة"])) return "learning";
    if (/\b(food|cook|recipe|kitchen|meal|bread|fruit|nutrition|restaurant)\b/.test(value) || has(["ምግብ", "ማብሰል", "የምግብ አሰራር", "ወጥ ቤት", "ምሳ", "ዳቦ", "ፍራፍሬ", "አመጋገብ", "ምግብ ቤት", "طعام", "طبخ", "وصفة", "مطبخ", "وجبة", "خبز", "فاكهة", "تغذية", "مطعم"])) return "food";
    if (/\b(city|travel|journey|road|transport|train|bus|street|building|community)\b/.test(value) || has(["ከተማ", "ጉዞ", "መንገድ", "ትራንስፖርት", "ባቡር", "አውቶቡስ", "ጎዳና", "ሕንፃ", "ማኅበረሰብ", "مدينة", "سفر", "رحلة", "طريق", "نقل", "قطار", "حافلة", "شارع", "مبنى", "مجتمع"])) return "city";
    return null;
  };
  const sceneText = `${scene.title} ${scene.narration} ${scene.visualDirection} ${scene.visualMetaphor ?? ""}`;
  if (styleId === "A8") return "classroom";
  if (styleId === "B9") return "city";
  return classify(sceneText) ?? classify(topic) ?? (styleId === "A9" ? "home" : styleId === "B8" ? "park" : styleId === "B10" ? "city" : "studio");
}

const CINEMATIC_BACKGROUND_FILES: Partial<Record<SceneContext, readonly string[]>> = {
  city: ["urban-aerial-01.jpg", "urban-aerial-02.jpg", "urban-aerial-03.jpg", "urban-aerial-04.jpg"],
  cave: ["cave-01.jpg", "cave-02.jpg", "cave-03.jpg", "cave-04.jpg", "cave-05.jpg", "cave-06.jpg"],
};

async function photoBackgroundForScene(scene: RenderScene, index: number, input: RenderInput): Promise<string | undefined> {
  if (input.styleId !== "B10") return undefined;
  const files = CINEMATIC_BACKGROUND_FILES[contextForScene(scene, input.topic, input.styleId)];
  if (!files?.length) return undefined;
  const filename = files[index % files.length]!;
  const assetPath = join(dirname(fileURLToPath(import.meta.url)), "assets", "cinematic", filename);
  try {
    const image = await readFile(assetPath);
    return `data:image/jpeg;base64,${image.toString("base64")}`;
  } catch (error) {
    throw new Error(`Cinematic background "${filename}" is unavailable: ${error instanceof Error ? error.message : "unknown file error"}`);
  }
}

function actionForScene(scene: RenderScene): StickmanAction {
  const text = `${scene.title} ${scene.narration} ${scene.visualDirection}`.toLowerCase();
  const has = (terms: string[]) => terms.some((term) => text.includes(term));
  if (/\b(run(?:ning)?|race|sprint|rush(?:ed|ing)?|chase(?:s|d|ing)?)\b/.test(text) || has(["ሮጥ", "መሮጥ", "እየሮጠ", "ተሯሯጠ", "يجري", "اركض", "ركض", "يركض", "مطاردة"])) return "run";
  if (/\b(walk(?:s|ed|ing)?|travel(?:s|ed|ing)?|move(?:s|d|ing)?|journey|step(?:s|ped|ping)?|progress)\b/.test(text) || has(["ይራመድ", "መሄድ", "እየተራመደ", "ደረጃ", "ጉዞ", "يمشي", "يسير", "خطوة", "رحلة"])) return "walk";
  if (/\b(wav(?:e|es|ed|ing)|welcome|greet(?:s|ed|ing)?|hello)\b/.test(text) || has(["ያውለበልባል", "እጅ ያውለበልባል", "ሰላም", "እንኳን ደህና", "يلوّح", "يلوح", "يرحب", "مرحبًا", "مرحبا"])) return "wave";
  if (/\b(think(?:s|ing)?|consider(?:s|ed|ing)?|reflect(?:s|ed|ing)?|wonder(?:s|ed|ing)?|plan(?:s|ned|ning)?|decide(?:s|d|ing)?)\b/.test(text) || has(["ያስባል", "ማሰብ", "ያቅዳል", "እቅድ", "ይወስናል", "ማሰላሰል", "يفكر", "تأمل", "يتأمل", "يخطط", "خطة", "يقرر", "يتساءل"])) return "think";
  if (/\b(celebrat(?:e|es|ed|ing)|success|win(?:s|ning)?|achiev(?:e|es|ed|ing)|breakthrough|milestone)\b/.test(text) || has(["ያከብራል", "በዓል", "ደስታ", "ስኬት", "ድል", "ተሳክቷል", "يحتفل", "احتفال", "نجاح", "فوز", "إنجاز", "انتصار"])) return "celebrate";
  if (/\b(lift(?:s|ed|ing)?|rais(?:e|es|ed|ing)|carr(?:y|ies|ied|ying)|build(?:s|ing)|grow(?:s|ing|th)?|reach(?:es|ed|ing)?)\b/.test(text) || has(["ያነሳል", "ማንሳት", "ይገነባል", "ያድጋል", "ማደግ", "ይደርሳል", "يرفع", "ارفع", "يبني", "ينمو", "نمو", "يصل"])) return "lift";
  return "present";
}

function sceneEnvironment(
  context: SceneContext,
  palette: (typeof STYLE_PALETTES)[string],
  index: number,
  width: number,
  height: number,
  language: RenderInput["contentLanguage"],
): string {
  const ink = palette.ink;
  const accent = palette.accent;
  const paper = palette.paper;
  const horizon = Math.round(height * 0.58);
  const shift = (index % 3) * 30;
  const line = `fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity=".19"`;
  const saleLabel = language === "am" ? "ሽያጭ" : language === "ar" ? "تخفيضات" : "SALE";

  switch (context) {
    case "nature":
      return `<path d="M0 ${horizon} Q${width * .25} ${horizon - 55} ${width * .55} ${horizon + 6} T${width} ${horizon - 16} V${height} H0Z" fill="${accent}" opacity=".10"/><path d="M${100 + shift} ${horizon - 5} v-126 m0 48 -43 -43 m43 60 42 -50" ${line}/><circle cx="${100 + shift}" cy="${horizon - 148}" r="39" fill="${palette.field}" opacity=".42"/><path d="M${width - 178 - shift} ${horizon} l58 -124 58 124 M0 ${horizon + 34} Q${width * .4} ${horizon - 8} ${width} ${horizon + 30}" ${line}/>`;
    case "finance":
      return `<g ${line}><path d="M${width * .1} ${horizon - 96} H${width * .52} M${width * .1} ${horizon - 42} H${width * .52} M${width * .1} ${horizon + 12} H${width * .52}"/><path d="M${width * .17} ${horizon + 5} V${horizon - 5 - shift / 3} M${width * .28} ${horizon + 5} V${horizon - 65} M${width * .39} ${horizon + 5} V${horizon - 117 + shift / 3}"/><path d="M${width * .15} ${horizon - 102} l92 -16 74 -34 90 -55" stroke="${accent}" stroke-width="10"/><circle cx="${width * .68}" cy="${horizon - 78}" r="43" fill="${paper}" stroke="${accent}" stroke-width="10"/><path d="M${width * .68} ${horizon - 103} v50 m-14 -38 h20 q17 0 7 14 l-21 11 q-14 10 4 16 h18" stroke="${ink}" stroke-width="7"/></g>`;
    case "technology":
      return `<g ${line}><rect x="${width * .08}" y="${horizon - 168}" width="${width * .34}" height="200" rx="20" fill="${paper}" stroke="${accent}" stroke-width="9"/><path d="M${width * .13} ${horizon - 116} h${width * .22} M${width * .13} ${horizon - 76} h${width * .16} M${width * .13} ${horizon - 36} h${width * .2} M${width * .42} ${horizon - 65} H${width * .54} V${horizon - 126} H${width * .7} M${width * .54} ${horizon - 65} V${horizon + 12} H${width * .76}"/><circle cx="${width * .78}" cy="${horizon - 126}" r="23" fill="${accent}" stroke="${paper}" stroke-width="5"/><circle cx="${width * .78}" cy="${horizon + 12}" r="23" fill="${palette.field}" stroke="${ink}" stroke-width="5"/></g>`;
    case "science":
      return `<g ${line}><circle cx="${width * .74}" cy="${horizon - 78}" r="80"/><ellipse cx="${width * .74}" cy="${horizon - 78}" rx="130" ry="44" transform="rotate(-28 ${width * .74} ${horizon - 78})"/><ellipse cx="${width * .74}" cy="${horizon - 78}" rx="130" ry="44" transform="rotate(28 ${width * .74} ${horizon - 78})"/><circle cx="${width * .74}" cy="${horizon - 78}" r="16" fill="${accent}" stroke="${accent}"/><circle cx="${width * .15 + shift}" cy="${horizon - 105}" r="10" fill="${accent}" stroke="${accent}"/></g>`;
    case "health":
      return `<g ${line}><path d="M${width * .08} ${horizon - 60} h${width * .1} l34 -50 39 101 40 -70 h${width * .12}"/><path d="M${width * .67} ${horizon - 126} v108 M${width * .61} ${horizon - 72} h108" stroke="${accent}" stroke-width="18"/><path d="M${width * .85} ${horizon - 30} c-52 -32 -59 -81 -27 -91 18 -6 31 5 37 20 8 -15 22 -24 39 -17 35 15 20 62 -49 88Z" fill="${palette.field}" stroke="${ink}" stroke-width="7"/></g>`;
    case "learning":
      return `<g ${line}><rect x="${width * .1}" y="${horizon - 156}" width="${width * .27}" height="182" rx="8" fill="${paper}" stroke="${accent}" stroke-width="8"/><path d="M${width * .15} ${horizon - 108} h${width * .17} M${width * .15} ${horizon - 70} h${width * .14} M${width * .15} ${horizon - 32} h${width * .18} M${width * .58} ${horizon - 20} v-119 q53 -31 106 0 v119 q-53 -31 -106 0Z" fill="${paper}" stroke="${ink}" stroke-width="7"/><path d="M${width * .58 + 106} ${horizon - 139} v119" stroke="${accent}" stroke-width="8"/></g>`;
    case "food":
      return `<g ${line}><ellipse cx="${width * .73}" cy="${horizon - 35}" rx="136" ry="53" fill="${paper}" stroke="${ink}" stroke-width="8"/><ellipse cx="${width * .73}" cy="${horizon - 41}" rx="92" ry="29" stroke="${accent}" stroke-width="7"/><circle cx="${width * .69}" cy="${horizon - 42}" r="15" fill="${accent}" stroke="${accent}"/><circle cx="${width * .78}" cy="${horizon - 46}" r="13" fill="${palette.field}" stroke="${ink}"/><path d="M${width * .22} ${horizon - 124} q-21 -34 0 -61 m42 61 q-21 -34 0 -61" ${line}/></g>`;
    case "city":
      return `<g ${line}><path d="M0 ${horizon + 6} V${horizon - 118} h${width * .13} v124 M${width * .16} ${horizon + 6} V${horizon - 197} h${width * .15} v203 M${width * .35} ${horizon + 6} V${horizon - 144} h${width * .13} v150 M${width * .53} ${horizon + 6} V${horizon - 172} h${width * .12} v178 M${width * .72} ${horizon + 6} V${horizon - 120} h${width * .13} v126 M${width * .9} ${horizon + 6} V${horizon - 188} h${width * .1} v194"/><path d="M0 ${horizon + 14} Q${width * .5} ${horizon - 30} ${width} ${horizon + 12}" stroke="${accent}" stroke-width="9"/></g>`;
    case "cave":
      return `<g fill="none" stroke="${ink}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" opacity=".42"><path d="M0 ${horizon + 46} Q${width * .08} ${horizon - 185} ${width * .34} ${horizon - 164} Q${width * .53} ${horizon - 260} ${width * .72} ${horizon - 151} Q${width * .96} ${horizon - 184} ${width} ${horizon + 35}"/><path d="M${width * .12} ${horizon - 88} l34 47 -18 42 M${width * .82} ${horizon - 108} l-29 52 18 43"/></g><path d="M${width * .3} ${height} Q${width * .5} ${horizon + 15} ${width * .72} ${height}" fill="${accent}" opacity=".12"/>`;
    case "classroom":
      return `<g fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><rect x="${width * .07}" y="${horizon - 165}" width="${width * .34}" height="145" rx="8" fill="${palette.field}"/><path d="M${width * .105} ${horizon - 126} h${width * .22} M${width * .105} ${horizon - 89} h${width * .15} M${width * .105} ${horizon - 52} h${width * .19}" stroke="${paper}" stroke-width="7"/><rect x="${width * .68}" y="${horizon - 173}" width="${width * .22}" height="126" rx="5" fill="${paper}"/><path d="M${width * .79} ${horizon - 170} v120 M${width * .68} ${horizon - 110} h${width * .22}" stroke="${palette.field}" stroke-width="6"/><path d="M${width * .43} ${horizon + 34} h${width * .18} m-${width * .15} 0 v52 m${width * .12} -52 v52 M${width * .7} ${horizon + 28} h${width * .17} m-${width * .14} 0 v56 m${width * .12} -56 v56" stroke="${accent}" stroke-width="9"/></g>`;
    case "mall":
      return `<g fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M0 ${horizon - 170} H${width} M${width * .08} ${horizon - 155} H${width * .92} V${horizon + 8} H${width * .08} Z" fill="${paper}"/><path d="M${width * .08} ${horizon - 105} H${width * .92}" stroke="${accent}" stroke-width="24"/><text x="${width * .5}" y="${horizon - 96}" text-anchor="middle" fill="${paper}" stroke="none" font-size="${language === "am" || language === "ar" ? 19 : 25}" font-weight="900" font-family="${languageFont(language)}, sans-serif">${escapeXml(saleLabel)}</text><path d="M${width * .15} ${horizon - 62} h${width * .2} v68 h-${width * .2}z M${width * .42} ${horizon - 62} h${width * .2} v68 h-${width * .2}z M${width * .69} ${horizon - 62} h${width * .16} v68 h-${width * .16}z" fill="${palette.field}" stroke="${ink}" stroke-width="6"/><path d="M${width * .24} ${horizon - 42} v37 m${width * .38} -37 v37 m${width * .17} -37 v37" stroke="${paper}" stroke-width="6"/></g>`;
    case "home":
      return `<g fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><rect x="${width * .1}" y="${horizon - 170}" width="${width * .24}" height="128" rx="4" fill="${paper}"/><path d="M${width * .22} ${horizon - 168} v124 M${width * .1} ${horizon - 106} h${width * .24}" stroke="${palette.field}" stroke-width="6"/><path d="M${width * .52} ${horizon - 36} q${width * .04} -55 ${width * .12} -55 h${width * .13} q${width * .06} 0 ${width * .08} 55 v43 H${width * .52}Z" fill="${palette.field}" stroke="${ink}" stroke-width="8"/><path d="M${width * .49} ${horizon + 4} h${width * .39} M${width * .56} ${horizon + 6} v47 M${width * .81} ${horizon + 6} v47" stroke="${accent}" stroke-width="8"/><circle cx="${width * .68}" cy="${horizon - 96}" r="28" fill="${accent}" opacity=".75"/></g>`;
    case "office":
      return `<g fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><rect x="${width * .64}" y="${horizon - 169}" width="${width * .26}" height="132" rx="5" fill="${paper}"/><path d="M${width * .77} ${horizon - 166} v126 M${width * .65} ${horizon - 104} h${width * .24}" stroke="${palette.field}" stroke-width="6"/><path d="M${width * .12} ${horizon - 14} h${width * .4} l${width * .05} 18 H${width * .08}Z M${width * .18} ${horizon + 4} v51 m${width * .31} -51 v51" fill="${paper}"/><rect x="${width * .23}" y="${horizon - 89}" width="${width * .17}" height="72" rx="6" fill="${palette.field}" stroke="${accent}" stroke-width="7"/><path d="M${width * .275} ${horizon - 46} h${width * .08} M${width * .315} ${horizon - 85} v38" stroke="${ink}" stroke-width="5"/></g>`;
    case "park":
      return `<g fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M0 ${horizon + 22} Q${width * .45} ${horizon - 60} ${width} ${horizon + 10} V${height} H0Z" fill="${palette.field}" stroke="none" opacity=".85"/><path d="M${width * .16} ${horizon + 14} v-105 m0 41 -45 -35 m45 60 43 -44 M${width * .82} ${horizon + 6} v-132 m0 48 -51 -37 m51 66 47 -49" stroke="${ink}" stroke-width="10"/><circle cx="${width * .16}" cy="${horizon - 106}" r="53" fill="${accent}" stroke="${ink}" stroke-width="5" opacity=".9"/><circle cx="${width * .82}" cy="${horizon - 128}" r="61" fill="${accent}" stroke="${ink}" stroke-width="5" opacity=".85"/><path d="M${width * .37} ${horizon + 6} h${width * .25} m-${width * .21} 0 v30 m${width * .17} -30 v30" stroke="${ink}" stroke-width="8"/></g>`;
    default:
      return `<g ${line}><rect x="${width * .09}" y="${horizon - 145}" width="${width * .3}" height="166" rx="12" fill="${paper}" stroke="${accent}" stroke-width="8"/><path d="M${width * .16} ${horizon - 95} h${width * .16} M${width * .16} ${horizon - 56} h${width * .13} M${width * .16} ${horizon - 17} h${width * .17} M${width * .55} ${horizon + 12} v-89 q74 -80 148 0 v89" /></g>`;
  }
}

function languageFont(language: RenderInput["contentLanguage"]): string {
  if (language === "am") return "Noto Sans Ethiopic";
  if (language === "ar") return "Noto Naskh Arabic";
  return "DejaVu Sans";
}

type CartoonAction = StickmanAction | "react" | "talk" | "listen";

function cartoonCharacter(
  x: number,
  groundY: number,
  scale: number,
  palette: (typeof STYLE_PALETTES)[string],
  phase: number,
  action: CartoonAction,
  characterIndex: number,
  member: RenderCastMember,
  offsetX = 0,
  popScale = 1,
): string {
  const shirt = safeHex(member.shirtColor, ["#e9784f", "#4b84ae", "#6d9b78"][characterIndex % 3]!);
  const skin = safeHex(member.skinTone, ["#ffd65f", "#fff5e8", "#efbd91"][characterIndex % 3]!);
  const shirtLight = adjustHex(shirt, .28);
  const shirtShade = adjustHex(shirt, -.28);
  const skinLight = adjustHex(skin, .2);
  const skinShade = adjustHex(skin, -.18);
  const hairColor = adjustHex(shirt, -.62);
  const characterId = member.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || `cast-${characterIndex}`;
  const cycle = Math.sin(phase * Math.PI * 2 + characterIndex * 1.7);
  const bounce = action === "react" || action === "celebrate" ? Math.max(0, cycle) * 11 : action === "run" ? Math.abs(cycle) * 7 : cycle * 2;
  const swing = cycle * (action === "run" ? 30 : 19);
  const leftArm = action === "react" || action === "celebrate"
    ? { elbowX: -38, elbowY: -46 - Math.abs(cycle) * 8, handX: -51, handY: -83 - Math.abs(cycle) * 8 }
    : action === "think" || action === "listen"
      ? { elbowX: -31, elbowY: -5, handX: -9, handY: -38 }
      : action === "walk" || action === "run"
        ? { elbowX: -35 - swing * .3, elbowY: -8, handX: -21 - swing, handY: 20 }
        : { elbowX: -43, elbowY: -15, handX: -59, handY: -43 };
  const rightArm = action === "react" || action === "celebrate"
    ? { elbowX: 38, elbowY: -46 - Math.abs(cycle) * 8, handX: 51, handY: -83 - Math.abs(cycle) * 8 }
    : action === "wave"
      ? { elbowX: 42, elbowY: -50, handX: 58 + cycle * 9, handY: -94 + Math.abs(cycle) * 6 }
      : action === "walk" || action === "run"
        ? { elbowX: 35 + swing * .3, elbowY: -10, handX: 21 + swing, handY: 19 }
        : { elbowX: 42, elbowY: -34, handX: 63, handY: -64 + cycle * 7 };
  const walking = action === "walk" || action === "run";
  const stride = walking ? swing * .8 : 0;
  const blink = Math.sin(phase * Math.PI * 4 + characterIndex * 2.4) > .97;
  const mouthOpen = (action === "talk" || action === "present" || characterIndex === 0) && Math.sin(phase * Math.PI * 4 + characterIndex) > .15;
  const mouth = action === "react"
    ? `<ellipse cx="0" cy="-65" rx="7" ry="9" fill="${palette.ink}"/><ellipse cx="0" cy="-62" rx="3" ry="2" fill="${palette.accent}"/>`
    : mouthOpen
    ? `<ellipse cx="0" cy="-66" rx="7" ry="9" fill="${palette.ink}"/><ellipse cx="0" cy="-63" rx="3" ry="2" fill="${palette.accent}"/>`
    : `<path d="M-10 -68 Q0 -58 10 -68" fill="none" stroke="${palette.ink}" stroke-width="4" stroke-linecap="round"/>`;
  const brows = action === "react"
    ? "M-23 -101q8 -7 16 0 M7 -101q8 -7 16 0"
    : action === "think"
      ? "M-23 -97q8 -10 16 -5 M7 -102q8 -5 16 3"
      : "M-22 -99q8 -5 15 0 M8 -99q8 -5 15 0";
  const hair = member.hairStyle === "curly"
    ? `<path d="M-39 -91 Q-46 -120 -20 -124 Q-5 -142 11 -125 Q36 -130 41 -104 Q45 -91 32 -88Z" fill="${hairColor}"/><circle cx="-20" cy="-116" r="10" fill="${hairColor}"/><circle cx="0" cy="-124" r="10" fill="${hairColor}"/><circle cx="20" cy="-116" r="10" fill="${hairColor}"/>`
    : member.hairStyle === "long"
      ? `<path d="M-39 -91 Q-45 -126 -8 -127 Q30 -131 39 -98 L38 -48 Q23 -57 24 -91 Q8 -107 -5 -95 Q-22 -88 -39 -91Z" fill="${hairColor}"/>`
      : `<path d="M-35 -91 Q-42 -122 -12 -123 Q8 -137 30 -116 Q42 -104 34 -87 Q17 -99 5 -107 Q-9 -91 -35 -91Z" fill="${hairColor}"/>`;
  const backpack = member.accessory === "backpack"
    ? `<rect x="-42" y="-29" width="18" height="49" rx="7" fill="${palette.accent}" stroke="${palette.ink}" stroke-width="4"/><path d="M-40 -17h14" stroke="${palette.paper}" stroke-width="3"/>`
    : "";
  const headAccessory = member.accessory === "cap"
    ? `<path d="M-39 -112 Q0 -139 39 -112 L34 -102 H-35Z M-3 -127 Q24 -137 38 -116" fill="${shirt}" stroke="${palette.ink}" stroke-width="4" stroke-linejoin="round"/>`
    : member.accessory === "glasses"
      ? `<g fill="none" stroke="${palette.ink}" stroke-width="4"><circle cx="-13" cy="-86" r="12"/><circle cx="13" cy="-86" r="12"/><path d="M-1 -86h2 M-29 -88l-7 -3 M29 -88l7 -3"/></g>`
      : member.accessory === "headband"
        ? `<path d="M-37 -101 Q0 -123 37 -101" fill="none" stroke="${shirt}" stroke-width="9" stroke-linecap="round"/>`
        : member.accessory === "bow"
          ? `<path d="M21 -119 Q7 -135 19 -137 Q30 -136 27 -126 Q38 -139 44 -128 Q46 -116 30 -116Z" fill="${palette.accent}" stroke="${palette.ink}" stroke-width="3"/>`
          : "";
  const motionMarks = action === "run" || action === "react"
    ? `<path d="M-71 -31h-20 M-72 -13h-15 M70 -28h20" stroke="${palette.accent}" stroke-width="5" stroke-linecap="round" opacity=".82"/>`
    : "";
  const bodyLean = action === "run" ? -5 + cycle * 2 : action === "walk" ? cycle * 2 : action === "react" ? cycle * 1.5 : 0;

  return `<g transform="translate(${x + offsetX} ${groundY - bounce}) rotate(${bodyLean} 0 -8) scale(${scale * popScale})">
    <defs>
      <linearGradient id="shirt-${characterId}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${shirtLight}"/><stop offset=".58" stop-color="${shirt}"/><stop offset="1" stop-color="${shirtShade}"/></linearGradient>
      <radialGradient id="skin-${characterId}" cx=".28" cy=".22" r=".9"><stop stop-color="${skinLight}"/><stop offset=".72" stop-color="${skin}"/><stop offset="1" stop-color="${skinShade}"/></radialGradient>
    </defs>
    <ellipse cx="0" cy="8" rx="57" ry="12" fill="${palette.ink}" opacity=".14"/>
    ${motionMarks}
    <path d="M-13 31 L${-21 - stride * .35} 77 L${-35 - stride} 125 L-18 127 L0 80 L15 127 L35 125 L${21 + stride} 77 L13 31Z" fill="${palette.ink}" stroke="${palette.ink}" stroke-width="3" stroke-linejoin="round"/>
    ${backpack}
    <path d="M-24 -44 Q0 -57 24 -44 L20 30 Q0 42 -20 30Z" fill="url(#shirt-${characterId})" stroke="${palette.ink}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M-14 -39 Q0 -25 14 -39 M0 -24 V22 M-17 3h7 M10 3h7" fill="none" stroke="${shirtShade}" stroke-width="3" stroke-linecap="round" opacity=".58"/>
    <path d="M-12 -42 L0 -27 L12 -42" fill="none" stroke="${palette.paper}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity=".82"/>
    <path d="M-20 -33 L${leftArm.elbowX} ${leftArm.elbowY} L${leftArm.handX} ${leftArm.handY} M20 -33 L${rightArm.elbowX} ${rightArm.elbowY} L${rightArm.handX} ${rightArm.handY}" fill="none" stroke="${palette.ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M-20 -31 L${leftArm.elbowX} ${leftArm.elbowY} M20 -31 L${rightArm.elbowX} ${rightArm.elbowY}" fill="none" stroke="${shirt}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="${leftArm.handX}" cy="${leftArm.handY}" r="7" fill="url(#skin-${characterId})" stroke="${palette.ink}" stroke-width="3"/>
    <circle cx="${rightArm.handX}" cy="${rightArm.handY}" r="7" fill="url(#skin-${characterId})" stroke="${palette.ink}" stroke-width="3"/>
    <path d="M-35 125 q-5 9 15 10 h12 l-1 -8 M35 125 q6 9 -14 10 h-12 l1 -8" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M-33 132h21 M33 132H12" stroke="${palette.accent}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="0" cy="-83" r="39" fill="url(#skin-${characterId})" stroke="${palette.ink}" stroke-width="5"/>
    <ellipse cx="-12" cy="-104" rx="17" ry="8" fill="#fff" opacity=".19"/>
    ${hair}${headAccessory}
    <ellipse cx="-22" cy="-72" rx="7" ry="4" fill="${palette.accent}" opacity=".22"/>
    <ellipse cx="22" cy="-72" rx="7" ry="4" fill="${palette.accent}" opacity=".22"/>
    <ellipse cx="-13" cy="-86" rx="6" ry="${blink ? 1.5 : 8}" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="2.5"/>
    <ellipse cx="13" cy="-86" rx="6" ry="${blink ? 1.5 : 8}" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="2.5"/>
    ${blink ? "" : `<circle cx="-12" cy="-85" r="3.2" fill="${palette.ink}"/><circle cx="14" cy="-85" r="3.2" fill="${palette.ink}"/><circle cx="-13" cy="-86" r="1.1" fill="#fff"/><circle cx="13" cy="-86" r="1.1" fill="#fff"/>`}
    <path d="${brows}" fill="none" stroke="${palette.ink}" stroke-width="3" stroke-linecap="round"/>
    ${mouth}
    <path d="M-2 -77l3 5" stroke="${palette.ink}" stroke-width="2" stroke-linecap="round"/>
  </g>`;
}

function textRows(lines: string[], x: number, y: number, fontSize: number, fill: string, weight: number, input: RenderInput, anchor = "start", outline?: string): string {
  const gap = Math.round(fontSize * 1.24);
  const direction = input.contentLanguage === "ar" ? 'direction="rtl" unicode-bidi="plaintext"' : "";
  const outlineAttributes = outline ? `paint-order="stroke" stroke="${outline}" stroke-width="6" stroke-linejoin="round"` : "";
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * gap}" text-anchor="${anchor}" ${direction} ${outlineAttributes} fill="${fill}" font-family="${languageFont(input.contentLanguage)}, sans-serif" font-size="${fontSize}" font-weight="${weight}">${escapeXml(line)}</text>`,
    )
    .join("");
}

type StageMotion = { entranceProgress?: number; exitProgress?: number };

function fallbackCartoonCast(): RenderCastMember[] {
  return [
    { id: "cast-lead", name: "Mika", role: "Lead", shirtColor: "#e9784f", skinTone: "#ffd65f", hairStyle: "short", accessory: "cap" },
    { id: "cast-friend", name: "Lumi", role: "Friend", shirtColor: "#4b84ae", skinTone: "#fff5e8", hairStyle: "curly", accessory: "glasses" },
    { id: "cast-helper", name: "Tobi", role: "Helper", shirtColor: "#6d9b78", skinTone: "#efbd91", hairStyle: "long", accessory: "backpack" },
  ];
}

function castForRender(input: RenderInput): RenderCastMember[] {
  const cast = input.cartoonCast?.filter((member) => member && typeof member.id === "string" && typeof member.name === "string").slice(0, 5);
  return cast && cast.length >= 2 ? cast : fallbackCartoonCast();
}

function groupActionForCharacter(scene: RenderScene, primaryAction: StickmanAction, characterIndex: number): CartoonAction {
  switch (scene.groupAction ?? "story-directed") {
    case "walk-together":
      return "walk";
    case "point-together":
      return "present";
    case "celebrate-together":
      return "celebrate";
    case "talk-and-react":
      return characterIndex === 0 ? "talk" : characterIndex % 2 === 1 ? "listen" : "react";
    default:
      if (characterIndex === 0) return primaryAction;
      if (characterIndex === 1) return primaryAction === "celebrate" ? "react" : "listen";
      return primaryAction === "walk" || primaryAction === "run" ? "wave" : "react";
  }
}

function createSceneSvg(scene: RenderScene, index: number, input: RenderInput, phase = 0, stageMotion: StageMotion = {}, photoBackground?: string): string {
  const portrait = input.aspectRatio === "9:16";
  const width = portrait ? 720 : 1280;
  const height = portrait ? 1280 : 720;
  const palette = STYLE_PALETTES[input.styleId] ?? STYLE_PALETTES.A2!;
  const cartoonSeries = CARTOON_STYLE_IDS.has(input.styleId);
  const scale = portrait ? 1 : 0.72;
  const titleLines = wrapText(scene.title.trim() || input.title, portrait ? 21 : 34, 2);
  const calloutLines = wrapText(scene.onScreenText || scene.visualMetaphor || "", portrait ? 29 : 54, 1);
  const titleY = portrait ? 175 : 138;
  const titleSize = portrait ? 48 : 47;
  const calloutY = portrait ? 425 : 258;
  const stickX = portrait ? 355 : 855;
  const stickY = portrait ? 800 : 372;
  const propX = portrait ? 585 : 1005;
  const textX = input.contentLanguage === "ar" ? width - (portrait ? 50 : 82) : portrait ? 50 : 82;
  const textAnchor = "start";
  const context = contextForScene(scene, input.topic, input.styleId);
  const action = actionForScene(scene);
  const entrance = scene.entrance ?? (index === 0 ? "walk-in-left" : "already-on-stage");
  const exit = scene.exit ?? "hold";
  const entranceProgress = stageMotion.entranceProgress === undefined ? 1 : Math.max(0, Math.min(1, stageMotion.entranceProgress));
  const exitProgress = stageMotion.exitProgress === undefined ? 0 : Math.max(0, Math.min(1, stageMotion.exitProgress));
  const ease = (value: number) => value * value * (3 - 2 * value);
  const entryDirection = entrance.endsWith("right") ? 1 : -1;
  const exitDirection = exit.endsWith("left") ? -1 : 1;
  const stageOffset = stageMotion.entranceProgress !== undefined
    ? entryDirection * width * .42 * (1 - ease(entranceProgress))
    : stageMotion.exitProgress !== undefined
      ? exitDirection * width * .42 * ease(exitProgress)
      : 0;
  const entryPopScale = entrance === "pop-in" && stageMotion.entranceProgress !== undefined
    ? Math.max(.06, ease(entranceProgress))
    : 1;
  const stageMoveAction: CartoonAction | null = stageMotion.entranceProgress !== undefined
    ? entrance.startsWith("run") ? "run" : entrance.startsWith("walk") ? "walk" : null
    : stageMotion.exitProgress !== undefined
      ? exit.startsWith("run") ? "run" : exit.startsWith("walk") || exit === "exit-together" ? "walk" : null
      : null;
  const orbit = index % 2 === 0 ? -1 : 1;
  const motion = Math.sin(phase * Math.PI * 2);
  const walkingAction = action === "walk" || action === "run";
  const bodyBob = action === "run" ? Math.abs(motion) * 14 : walkingAction ? Math.abs(motion) * 7 : motion * 3;
  const armSwing = motion * (action === "run" ? 34 : 22);
  const legSwing = motion * (action === "run" ? 38 : 25);
  const propRotation = motion * 8;
  const sunRadius = (portrait ? 80 : 62) + motion * 4;
  const leftArm = action === "celebrate" || action === "lift"
    ? { elbowX: -52, elbowY: -48 - Math.abs(motion) * 8, handX: -42, handY: -112 - Math.abs(motion) * 8 }
    : action === "think"
      ? { elbowX: -55, elbowY: -42, handX: -22, handY: -87 }
      : action === "wave"
        ? { elbowX: -46, elbowY: 18, handX: -61, handY: 65 }
        : action === "run" || action === "walk"
          ? { elbowX: -38 - armSwing * .35, elbowY: -18, handX: -18 - armSwing, handY: 28 }
          : { elbowX: -61, elbowY: -24, handX: -109, handY: 7 };
  const rightArm = action === "celebrate" || action === "lift"
    ? { elbowX: 52, elbowY: -48 - Math.abs(motion) * 8, handX: 42, handY: -112 - Math.abs(motion) * 8 }
    : action === "think"
      ? { elbowX: 39, elbowY: -48, handX: 21, handY: -103 }
      : action === "wave"
        ? { elbowX: 50, elbowY: -48, handX: 59 + motion * 8, handY: -123 + Math.abs(motion) * 7 }
        : action === "run" || action === "walk"
          ? { elbowX: 38 + armSwing * .35, elbowY: -20, handX: 18 + armSwing, handY: 26 }
          : { elbowX: 62, elbowY: -22, handX: 112, handY: -4 };
  const leftLeg = walkingAction
    ? { kneeX: -18 - legSwing * .55, kneeY: 125 - Math.max(0, motion) * 15, footX: -31 - legSwing, footY: 168 - Math.max(0, motion) * 25 }
    : { kneeX: -23, kneeY: 124, footX: -53, footY: 168 };
  const rightLeg = walkingAction
    ? { kneeX: 18 + legSwing * .55, kneeY: 125 - Math.max(0, -motion) * 15, footX: 31 + legSwing, footY: 168 - Math.max(0, -motion) * 25 }
    : { kneeX: 23, kneeY: 124, footX: 53, footY: 168 };
  const calloutScale = cartoonSeries ? 1 + Math.sin(phase * Math.PI * 2) * 0.035 : 1;
  const callout = calloutLines[0]
    ? `<g transform="translate(${width / 2} ${calloutY - 10}) scale(${calloutScale}) translate(${-width / 2} ${-(calloutY - 10)})"><rect x="${portrait ? 54 : 85}" y="${calloutY - 44}" width="${width - (portrait ? 108 : 170)}" height="64" rx="${cartoonSeries ? 15 : 20}" fill="${palette.paper}" opacity=".94" ${cartoonSeries ? `stroke="${palette.ink}" stroke-width="4"` : ""}/><text x="${Math.round(width / 2)}" y="${calloutY}" text-anchor="middle" ${input.contentLanguage === "ar" ? 'direction="rtl" unicode-bidi="plaintext"' : ""} fill="${palette.ink}" font-family="${languageFont(input.contentLanguage)}, sans-serif" font-size="${portrait ? 23 : 25}" font-weight="${cartoonSeries ? 900 : 600}" paint-order="stroke" stroke="${palette.paper}" stroke-width="${cartoonSeries ? 2 : 0}">${escapeXml(calloutLines[0])}</text></g>`
    : "";
  const environment = photoBackground ? "" : sceneEnvironment(context, palette, index, width, height, input.contentLanguage);
  const sceneProp = context === "technology"
    ? `<rect x="-37" y="-48" width="74" height="96" rx="13" fill="${palette.accent}" opacity=".88"/><rect x="-27" y="-37" width="54" height="69" rx="5" fill="${palette.paper}"/><circle cx="0" cy="39" r="4" fill="${palette.paper}"/>`
    : context === "finance"
      ? `<circle cx="0" cy="0" r="42" fill="${palette.accent}" opacity=".9"/><path d="M0 -22 V22 M-13 -12 H7 Q22 -12 9 1 L-9 11 Q-20 18 -4 23 H14" fill="none" stroke="${palette.paper}" stroke-width="6" stroke-linecap="round"/>`
      : context === "health"
        ? `<path d="M0 -34 V34 M-34 0 H34" stroke="${palette.accent}" stroke-width="16" stroke-linecap="round"/>`
        : context === "learning"
          ? `<path d="M-42 -28 Q-20 -40 0 -27 V32 Q-21 18 -42 30Z M0 -27 Q21 -40 42 -28 V30 Q20 18 0 32Z" fill="${palette.paper}" stroke="${palette.accent}" stroke-width="5"/>`
          : context === "nature"
            ? `<path d="M0 35 C-47 3 -28 -38 0 -38 C28 -38 47 3 0 35Z" fill="${palette.field}" stroke="${palette.accent}" stroke-width="6"/><path d="M0 28 V-28 M0 -1 L-16 -14 M0 8 L17 -8" stroke="${palette.ink}" stroke-width="4"/>`
            : context === "science"
              ? `<circle cx="0" cy="0" r="30" fill="${palette.paper}" stroke="${palette.accent}" stroke-width="7"/><ellipse cx="0" cy="0" rx="48" ry="16" fill="none" stroke="${palette.ink}" stroke-width="4" transform="rotate(-28)"/><circle cx="31" cy="-21" r="7" fill="${palette.accent}"/>`
               : `<rect x="-38" y="-38" width="76" height="76" rx="21" fill="${palette.accent}" opacity=".88"/><path d="M-18 0 H18 M0 -18 V18" stroke="${palette.paper}" stroke-width="7" stroke-linecap="round"/>`;
  const cartoonCast = cartoonSeries ? castForRender(input) : [];
  const cartoonScale = input.styleId === "B10"
    ? (portrait ? .94 : .9) * (cartoonCast.length > 3 ? .82 : 1)
    : portrait ? .87 : .72;
  const cartoonCharacters = cartoonSeries
    ? cartoonCast.map((member, characterIndex) => {
        const margin = width * (portrait ? .17 : .18);
        const positions = cartoonCast.map((_entry, positionIndex) =>
          cartoonCast.length === 1
            ? width / 2
            : margin + ((width - margin * 2) / (cartoonCast.length - 1)) * positionIndex,
        );
        const positionIndex = input.contentLanguage === "ar" ? cartoonCast.length - 1 - characterIndex : characterIndex;
        const x = positions[positionIndex]!;
        const characterAction = stageMoveAction ?? groupActionForCharacter(scene, action, characterIndex);
        return cartoonCharacter(
          x,
          portrait ? 925 : 455,
          cartoonScale,
          palette,
          phase,
          characterAction,
          characterIndex,
          member,
          stageOffset,
          entryPopScale,
        );
      }).join("")
    : `<g transform="translate(${stickX} ${stickY + bodyBob}) scale(${scale})">
    <ellipse cx="0" cy="190" rx="120" ry="22" fill="${palette.ink}" opacity=".12"/>
    <circle cx="0" cy="-95" r="49" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="9"/>
    <path d="M0 -45 L0 83 M0 -5 L${leftArm.elbowX * orbit} ${leftArm.elbowY} L${leftArm.handX * orbit} ${leftArm.handY} M0 -5 L${rightArm.elbowX * orbit} ${rightArm.elbowY} L${rightArm.handX * orbit} ${rightArm.handY} M0 82 L${leftLeg.kneeX * orbit} ${leftLeg.kneeY} L${leftLeg.footX * orbit} ${leftLeg.footY} M0 82 L${rightLeg.kneeX * orbit} ${rightLeg.kneeY} L${rightLeg.footX * orbit} ${rightLeg.footY}" fill="none" stroke="${palette.ink}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${leftArm.elbowX * orbit}" cy="${leftArm.elbowY}" r="6" fill="${palette.ink}"/>
    <circle cx="${rightArm.elbowX * orbit}" cy="${rightArm.elbowY}" r="6" fill="${palette.ink}"/>
    <circle cx="${18 * orbit}" cy="-105" r="5" fill="${palette.ink}"/>
    <path d="M${6 * orbit} -78 Q${23 * orbit} -65 ${35 * orbit} -82" fill="none" stroke="${palette.accent}" stroke-width="5" stroke-linecap="round"/>
  </g>`;

  const photoLayer = photoBackground
    ? `<image href="${photoBackground}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/><rect width="${width}" height="${height}" fill="url(#photoTint)"/><rect width="${width}" height="${height}" fill="url(#photoVignette)"/>`
    : `<rect width="${width}" height="${height}" fill="url(#paper)"/><circle cx="${portrait ? 588 : 1110}" cy="${portrait ? 255 : 170}" r="${sunRadius}" fill="${palette.accent}" opacity=".16"/><path d="M0 ${portrait ? 940 : 510} Q${width * 0.35} ${portrait ? 870 : 455} ${width} ${portrait ? 965 : 545} V${height} H0Z" fill="${palette.field}" opacity=".78"/>`;
  const titleFill = photoBackground ? "#fff8e8" : palette.ink;
  const titleOutline = photoBackground ? "#172226" : undefined;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.paper}"/><stop offset="1" stop-color="${palette.field}"/></linearGradient>
    <linearGradient id="photoTint" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#172226" stop-opacity=".48"/><stop offset=".48" stop-color="#172226" stop-opacity=".1"/><stop offset="1" stop-color="#172226" stop-opacity=".45"/></linearGradient>
    <radialGradient id="photoVignette" cx=".5" cy=".48" r=".72"><stop offset=".5" stop-color="#101719" stop-opacity="0"/><stop offset="1" stop-color="#101719" stop-opacity=".43"/></radialGradient>
  </defs>
  ${photoLayer}
  ${environment}
  ${textRows(titleLines, textX, titleY, titleSize, titleFill, 800, input, textAnchor, titleOutline)}
  ${callout}
  ${cartoonCharacters}
  ${cartoonSeries ? "" : `<g transform="translate(${propX} ${portrait ? 795 : 344}) rotate(${propRotation})">
    ${sceneProp}
  </g>`}
  <text x="${textX}" y="${portrait ? 1220 : 690}" text-anchor="${textAnchor}" ${input.contentLanguage === "ar" ? 'direction="rtl" unicode-bidi="plaintext"' : ""} ${titleOutline ? `paint-order="stroke" stroke="${titleOutline}" stroke-width="5" stroke-linejoin="round"` : ""} fill="${titleFill}" opacity="${photoBackground ? ".86" : ".55"}" font-family="${languageFont(input.contentLanguage)}, sans-serif" font-size="${portrait ? 14 : 13}" font-weight="600" letter-spacing="2">${escapeXml(input.title.slice(0, 42).toLocaleUpperCase(input.contentLanguage === "am" ? "am-ET" : input.contentLanguage))}</text>
</svg>`;
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < 4000) stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} failed with exit code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}: ${stderr.slice(-700)}`));
    });
  });
}

function safeFilename(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .toLowerCase() || "stickman-video"
  );
}

function escapeFilterPath(path: string): string {
  return path.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'");
}

async function mediaDuration(path: string): Promise<number> {
  const raw = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  const duration = Number(raw);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("The generated voiceover has an invalid audio duration.");
  }
  return duration;
}

export async function renderStoryboardVideo(input: RenderInput): Promise<{ buffer: Buffer; filename: string }> {
  if (input.scenes.length === 0) throw new Error("Add at least one scene before rendering.");
  const directory = await mkdtemp(join(tmpdir(), "stickman-video-"));
  const width = input.aspectRatio === "9:16" ? 720 : 1280;
  const height = input.aspectRatio === "9:16" ? 1280 : 720;
  const basePath = join(directory, "silent.mp4");
  const outputPath = join(directory, "final.mp4");

  try {
    const totalDuration = input.scenes.reduce((total, scene) => total + scene.seconds, 0);
    const photoBackgrounds = await Promise.all(
      input.scenes.map((scene, index) => photoBackgroundForScene(scene, index, input)),
    );
    const voiceoverPaths: string[] = [];
    const voiceoverSpeeds: number[] = [];
    const spokenDurations: number[] = [];

    if (input.voiceover) {
      if (input.scenes.some((scene) => !scene.narration.trim())) {
        throw new Error("Add narration to every scene so the voiceover covers the full video.");
      }
      const audioBuffers = await batchProcess(
        input.scenes,
        (scene) => textToSpeech(scene.narration.trim(), "alloy", "mp3", input.contentLanguage),
        { concurrency: 2, retries: 3, minTimeout: 1000, maxTimeout: 12000 },
      );
      for (const [index, scene] of input.scenes.entries()) {
        const audio = audioBuffers[index]!;
        if (!audio.length) throw new Error(`Voiceover audio for scene ${index + 1} was empty.`);
        const audioPath = join(directory, `voice-${index}.mp3`);
        await writeFile(audioPath, audio);
        const sourceDuration = await mediaDuration(audioPath);
        const targetDuration = Math.max(1, scene.seconds);
        const rawTempo = sourceDuration / targetDuration;
        if (rawTempo < 0.55 || rawTempo > 1.8) {
          throw new Error(`Narration for scene ${index + 1} would need an unnatural playback speed for its ${targetDuration}-second duration.`);
        }
        const tempo = rawTempo;
        voiceoverPaths.push(audioPath);
        voiceoverSpeeds.push(tempo);
        spokenDurations.push(Math.min(targetDuration, sourceDuration / tempo));
      }
    }

    const subtitlesPath = input.subtitles ? join(directory, "captions.ass") : null;
    if (subtitlesPath) {
      await writeFile(
        subtitlesPath,
        buildVoiceoverSubtitles(
          input.scenes,
          input.voiceover ? spokenDurations : input.scenes.map((scene) => scene.seconds),
          width,
          height,
          input.contentLanguage,
        ),
        "utf8",
      );
    }

    const sceneFrameCounts = input.scenes.map((scene) => Math.max(1, Math.round(scene.seconds * FPS)));
    const totalFrames = sceneFrameCounts.reduce((total, frames) => total + frames, 0);
    type SegmentKind = "entrance" | "idle" | "exit" | "hold";
    type SegmentPlan = { pattern: string; frames: number; loop: boolean; inputIndex: number; kind: SegmentKind };
    type ScenePlan = { segments: SegmentPlan[]; frames: number; transition: string };
    const ffmpegArgs = ["-hide_banner", "-loglevel", "error", "-y"];
    const scenePlans: ScenePlan[] = [];
    let inputIndex = 0;

    const renderSegment = async (
      scene: RenderScene,
      sceneIndex: number,
      kind: SegmentKind,
      frameCount: number,
    ): Promise<SegmentPlan> => {
      const sampleCount = kind === "idle" ? POSE_FRAMES : frameCount;
      const svgPaths: string[] = [];
      for (let frame = 0; frame < sampleCount; frame += 1) {
        const path = join(directory, `scene-${sceneIndex}-${kind}-${String(frame).padStart(2, "0")}.svg`);
        const progress = sampleCount <= 1 ? 1 : frame / (sampleCount - 1);
        const stageMotion: StageMotion = kind === "entrance"
          ? { entranceProgress: progress }
          : kind === "exit"
            ? { exitProgress: progress }
            : kind === "hold" && scene.exit && scene.exit !== "hold"
              ? { exitProgress: 1 }
            : {};
        const phase = kind === "idle" ? frame / POSE_FRAMES : kind === "hold" ? 0 : frame / sampleCount;
        await writeFile(path, createSceneSvg(scene, sceneIndex, input, phase, stageMotion, photoBackgrounds[sceneIndex]), "utf8");
        svgPaths.push(path);
      }
      const pattern = join(directory, `scene-${sceneIndex}-${kind}-%02d.png`);
      await run("convert", [...svgPaths, "-resize", `${width}x${height}!`, pattern]);
      const segment: SegmentPlan = {
        pattern,
        frames: frameCount,
        loop: kind === "idle",
        inputIndex: inputIndex++,
        kind,
      };
      ffmpegArgs.push("-framerate", String(FPS), "-i", pattern);
      return segment;
    };

    for (const [index, scene] of input.scenes.entries()) {
      const frameCount = sceneFrameCounts[index]!;
      const cartoonSeries = CARTOON_STYLE_IDS.has(input.styleId);
      const entrance = scene.entrance ?? (index === 0 ? "walk-in-left" : "already-on-stage");
      const exit = scene.exit ?? "hold";
      const entranceFrames = cartoonSeries && entrance !== "already-on-stage"
        ? Math.min(MOVEMENT_FRAMES, Math.max(1, Math.floor(frameCount / 3)))
        : 0;
      const exitFrames = cartoonSeries && exit !== "hold"
        ? Math.min(MOVEMENT_FRAMES, Math.max(1, Math.floor(frameCount / 3)))
        : 0;
      const idleFrames = Math.max(0, frameCount - entranceFrames - exitFrames);
      const transition = index < input.scenes.length - 1
        ? scene.transitionToNext ?? (cartoonSeries ? "match-left" : "cut")
        : "cut";
      const segments: SegmentPlan[] = [];
      if (entranceFrames > 0) segments.push(await renderSegment(scene, index, "entrance", entranceFrames));
      if (idleFrames > 0) segments.push(await renderSegment(scene, index, "idle", idleFrames));
      if (exitFrames > 0) segments.push(await renderSegment(scene, index, "exit", exitFrames));
      if (transition !== "cut") segments.push(await renderSegment(scene, index, "hold", TRANSITION_FRAMES));
      scenePlans.push({ segments, frames: frameCount, transition });
    }

    const filters: string[] = [];
    const sceneLabels: string[] = [];
    for (const [sceneIndex, plan] of scenePlans.entries()) {
      const segmentLabels: string[] = [];
      for (const [segmentIndex, segment] of plan.segments.entries()) {
        const label = `segment_${sceneIndex}_${segmentIndex}`;
        const extraLoops = segment.loop ? Math.max(0, Math.ceil(segment.frames / POSE_FRAMES) - 1) : 0;
        const finiteLoop = extraLoops > 0 ? `loop=loop=${extraLoops}:size=${POSE_FRAMES}:start=0,` : "";
        filters.push(`[${segment.inputIndex}:v]${finiteLoop}trim=end_frame=${segment.frames},setpts=PTS-STARTPTS[${label}]`);
        segmentLabels.push(`[${label}]`);
      }
      const sourceLabel = `scene_source_${sceneIndex}`;
      if (segmentLabels.length === 1) {
        filters.push(`${segmentLabels[0]}null[${sourceLabel}]`);
      } else {
        filters.push(`${segmentLabels.join("")}concat=n=${segmentLabels.length}:v=1:a=0[${sourceLabel}]`);
      }
      const scene = input.scenes[sceneIndex]!;
      const frames = plan.frames + (plan.transition === "cut" ? 0 : TRANSITION_FRAMES);
      const cameraMove = (scene.cameraMove ?? "").toLowerCase();
      const zoomOut = /pull|back|zoom out|reveal/.test(cameraMove)
        || (!/push|zoom in/.test(cameraMove) && sceneIndex % 2 === 1);
      const zoom = zoomOut
        ? `1.12-0.12*on/${frames}`
        : `1+0.12*on/${frames}`;
      const x = /pan left|move left/.test(cameraMove)
        ? `(iw-iw/zoom)*(1-on/${frames})`
        : /pan right|move right/.test(cameraMove)
          ? `(iw-iw/zoom)*on/${frames}`
          : "iw/2-(iw/zoom/2)";
      const sceneLabel = `video_${sceneIndex}`;
      filters.push(`[${sourceLabel}]zoompan=z='${zoom}':x='${x}':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${FPS},trim=end_frame=${frames},setpts=N/(${FPS}*TB),fps=${FPS},format=yuv420p,setsar=1,settb=AVTB[${sceneLabel}]`);
      sceneLabels.push(`[${sceneLabel}]`);
    }

    let timelineLabel = sceneLabels[0]!;
    let timelineOffset = input.scenes[0]!.seconds;
    const xfadeNames: Record<string, string> = {
      dissolve: "dissolve",
      "wipe-left": "wipeleft",
      "wipe-right": "wiperight",
      "match-left": "smoothleft",
      "match-right": "smoothright",
    };
    for (let sceneIndex = 1; sceneIndex < sceneLabels.length; sceneIndex += 1) {
      const nextLabel = sceneLabels[sceneIndex]!;
      const transition = scenePlans[sceneIndex - 1]!.transition;
      const outputLabel = `[timeline_${sceneIndex}]`;
      if (transition === "cut") {
        filters.push(`${timelineLabel}${nextLabel}concat=n=2:v=1:a=0,fps=${FPS},format=yuv420p,setsar=1,settb=AVTB,setpts=PTS-STARTPTS${outputLabel}`);
      } else {
        const xfade = xfadeNames[transition] ?? "fade";
        filters.push(`${timelineLabel}${nextLabel}xfade=transition=${xfade}:duration=${TRANSITION_SECONDS.toFixed(5)}:offset=${timelineOffset.toFixed(5)}${outputLabel}`);
      }
      timelineLabel = outputLabel;
      timelineOffset += input.scenes[sceneIndex]!.seconds;
    }
    if (subtitlesPath) {
      filters.push(`${timelineLabel}ass=filename='${escapeFilterPath(subtitlesPath)}'[captioned]`);
    }
    ffmpegArgs.push(
      "-filter_complex_threads",
      "1",
      "-filter_complex",
      filters.join(";"),
      "-map",
      subtitlesPath ? "[captioned]" : timelineLabel,
      "-r",
      String(FPS),
      "-frames:v",
      String(totalFrames),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "24",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      basePath,
    );
    await run("ffmpeg", ffmpegArgs);

    if (!input.voiceover) {
      return { buffer: await readFile(basePath), filename: `${safeFilename(input.title)}.mp4` };
    }

    const audioFilters = input.scenes.map((scene, index) => {
      const inputNumber = index + 1;
      const targetDuration = Math.max(1, scene.seconds);
      return `[${inputNumber}:a]atempo=${voiceoverSpeeds[index]!.toFixed(4)},apad,atrim=duration=${targetDuration},asetpts=PTS-STARTPTS[voice${index}]`;
    });
    const audioInputs = input.scenes.map((_scene, index) => `[voice${index}]`).join("");
    audioFilters.push(`${audioInputs}concat=n=${input.scenes.length}:v=0:a=1[aout]`);
    await run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      basePath,
      ...voiceoverPaths.flatMap((path) => ["-i", path]),
      "-filter_complex",
      audioFilters.join(";"),
      "-map",
      "0:v:0",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-t",
      totalDuration.toFixed(3),
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    const audioStreams = await run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      outputPath,
    ]);
    if (!audioStreams.split(/\s+/).includes("audio")) {
      throw new Error("Rendered MP4 does not contain the requested voiceover audio track.");
    }
    return { buffer: await readFile(outputPath), filename: `${safeFilename(input.title)}.mp4` };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
