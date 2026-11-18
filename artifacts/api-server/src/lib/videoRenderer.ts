import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
};

const STYLE_PALETTES: Record<string, { paper: string; ink: string; accent: string; field: string }> = {
  A1: { paper: "#f4efe4", ink: "#263239", accent: "#df7655", field: "#dfe8df" },
  A2: { paper: "#fbf0db", ink: "#253240", accent: "#e26949", field: "#d7e8dd" },
  A3: { paper: "#e7d4b4", ink: "#3d342a", accent: "#b96740", field: "#c6b28e" },
  A4: { paper: "#f4eadb", ink: "#35423e", accent: "#cc7d56", field: "#e3dfc8" },
  A5: { paper: "#f3e8d0", ink: "#34363a", accent: "#c36546", field: "#d7ddc9" },
  A6: { paper: "#26323b", ink: "#f3e9d3", accent: "#e1a35b", field: "#45515a" },
  A7: { paper: "#f3e4c8", ink: "#313641", accent: "#d6674c", field: "#e0c99f" },
  B1: { paper: "#f1eee6", ink: "#263239", accent: "#d97151", field: "#d9e4dd" },
  B2: { paper: "#f8ebd3", ink: "#283238", accent: "#e26745", field: "#cfe4d8" },
  B3: { paper: "#d9e0d0", ink: "#29333a", accent: "#b85c47", field: "#b8c4b4" },
  B4: { paper: "#d5ded8", ink: "#263039", accent: "#db674c", field: "#b8c5bd" },
  B5: { paper: "#eee9db", ink: "#27353b", accent: "#c96d4c", field: "#d1e0d4" },
  B6: { paper: "#333447", ink: "#fff0d1", accent: "#ff9b5f", field: "#5f5365" },
  B7: { paper: "#263747", ink: "#e7f4d5", accent: "#f38b59", field: "#3e6470" },
};
const FPS = 24;
const POSE_FRAMES = 24;

type SceneContext = "nature" | "finance" | "technology" | "science" | "health" | "learning" | "food" | "city" | "studio";
type StickmanAction = "walk" | "run" | "wave" | "think" | "celebrate" | "lift" | "present";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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

function contextForScene(scene: RenderScene, topic: string): SceneContext {
  const classify = (text: string): SceneContext | null => {
    const value = text.toLowerCase();
    const has = (terms: string[]) => terms.some((term) => value.includes(term));
    if (/\b(technology|phone|app|computer|code|digital|internet|battery|ai|software|robot|data)\b/.test(value) || has(["ስልክ", "ቴክኖሎጂ", "ኮምፒውተር", "ኮድ", "ዲጂታል", "ኢንተርኔት", "ባትሪ", "ሶፍትዌር", "ሮቦት", "መረጃ", "هاتف", "تقنية", "تكنولوجيا", "حاسوب", "برمجة", "رقمي", "إنترنت", "بطارية", "ذكاء اصطناعي", "برنامج", "روبوت", "بيانات"])) return "technology";
    if (/\b(tree|forest|plant|garden|climate|nature|ocean|river|earth|weather|solar|renewable|wind|energy)\b/.test(value) || has(["ዛፍ", "ደን", "ተክል", "አትክልት", "የአየር ንብረት", "ተፈጥሮ", "ውቅያኖስ", "ወንዝ", "ምድር", "የአየር ሁኔታ", "ፀሐይ", "ንፋስ", "ኃይል", "شجرة", "غابة", "نبات", "حديقة", "مناخ", "طبيعة", "محيط", "نهر", "أرض", "طقس", "طاقة", "رياح"])) return "nature";
    if (/\b(money|budget|bank|finance|price|cost|invest|saving|debt|profit|market|econom)\b/.test(value) || has(["ገንዘብ", "በጀት", "ባንክ", "ፋይናንስ", "ዋጋ", "ወጪ", "ኢንቨስት", "ቁጠባ", "ዕዳ", "ትርፍ", "ገበያ", "ኢኮኖሚ", "مال", "ميزانية", "بنك", "تمويل", "سعر", "تكلفة", "استثمار", "ادخار", "دين", "ربح", "سوق", "اقتصاد"])) return "finance";
    if (/\b(science|atom|physics|experiment|space|planet|molecule|research|gravity|chemistry)\b/.test(value) || has(["ሳይንስ", "አቶም", "ፊዚክስ", "ሙከራ", "ጠፈር", "ፕላኔት", "ሞለኪውል", "ምርምር", "ስበት", "ኬሚስትሪ", "علوم", "ذرة", "فيزياء", "تجربة", "فضاء", "كوكب", "جزيء", "بحث", "جاذبية", "كيمياء"])) return "science";
    if (/\b(health|heart|doctor|medical|exercise|fitness|sleep|brain|body|wellness)\b/.test(value) || has(["ጤና", "ልብ", "ሐኪም", "ሕክምና", "እንቅስቃሴ", "የአካል ብቃት", "እንቅልፍ", "አንጎል", "ሰውነት", "ደህንነት", "صحة", "قلب", "طبيب", "طبي", "تمرين", "لياقة", "نوم", "دماغ", "جسم", "عافية"])) return "health";
    if (/\b(learn|learning|school|student|teacher|study|education|book|class|memory|skill)\b/.test(value) || has(["መማር", "ትምህርት ቤት", "ተማሪ", "መምህር", "ጥናት", "ትምህርት", "መጽሐፍ", "ክፍል", "ትውስታ", "ክህሎት", "تعلم", "مدرسة", "طالب", "معلم", "دراسة", "تعليم", "كتاب", "صف", "ذاكرة", "مهارة"])) return "learning";
    if (/\b(food|cook|recipe|kitchen|meal|bread|fruit|nutrition|restaurant)\b/.test(value) || has(["ምግብ", "ማብሰል", "የምግብ አሰራር", "ወጥ ቤት", "ምሳ", "ዳቦ", "ፍራፍሬ", "አመጋገብ", "ምግብ ቤት", "طعام", "طبخ", "وصفة", "مطبخ", "وجبة", "خبز", "فاكهة", "تغذية", "مطعم"])) return "food";
    if (/\b(city|travel|journey|road|transport|train|bus|street|building|community)\b/.test(value) || has(["ከተማ", "ጉዞ", "መንገድ", "ትራንስፖርት", "ባቡር", "አውቶቡስ", "ጎዳና", "ሕንፃ", "ማኅበረሰብ", "مدينة", "سفر", "رحلة", "طريق", "نقل", "قطار", "حافلة", "شارع", "مبنى", "مجتمع"])) return "city";
    return null;
  };
  const sceneText = `${scene.title} ${scene.narration} ${scene.visualDirection} ${scene.visualMetaphor ?? ""}`;
  return classify(sceneText) ?? classify(topic) ?? "studio";
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
): string {
  const ink = palette.ink;
  const accent = palette.accent;
  const paper = palette.paper;
  const horizon = Math.round(height * 0.58);
  const shift = (index % 3) * 30;
  const line = `fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity=".19"`;

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
    default:
      return `<g ${line}><rect x="${width * .09}" y="${horizon - 145}" width="${width * .3}" height="166" rx="12" fill="${paper}" stroke="${accent}" stroke-width="8"/><path d="M${width * .16} ${horizon - 95} h${width * .16} M${width * .16} ${horizon - 56} h${width * .13} M${width * .16} ${horizon - 17} h${width * .17} M${width * .55} ${horizon + 12} v-89 q74 -80 148 0 v89" /></g>`;
  }
}

function languageFont(language: RenderInput["contentLanguage"]): string {
  if (language === "am") return "Noto Sans Ethiopic";
  if (language === "ar") return "Noto Naskh Arabic";
  return "DejaVu Sans";
}

function textRows(lines: string[], x: number, y: number, fontSize: number, fill: string, weight: number, input: RenderInput, anchor = "start"): string {
  const gap = Math.round(fontSize * 1.24);
  const direction = input.contentLanguage === "ar" ? 'direction="rtl" unicode-bidi="plaintext"' : "";
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * gap}" text-anchor="${anchor}" ${direction} fill="${fill}" font-family="${languageFont(input.contentLanguage)}, sans-serif" font-size="${fontSize}" font-weight="${weight}">${escapeXml(line)}</text>`,
    )
    .join("");
}

function createSceneSvg(scene: RenderScene, index: number, input: RenderInput, phase = 0): string {
  const portrait = input.aspectRatio === "9:16";
  const width = portrait ? 720 : 1280;
  const height = portrait ? 1280 : 720;
  const palette = STYLE_PALETTES[input.styleId] ?? STYLE_PALETTES.A2!;
  const scale = portrait ? 1 : 0.72;
  const sceneWord = input.contentLanguage === "am" ? "ትዕይንት" : input.contentLanguage === "ar" ? "مشهد" : "Scene";
  const titleLines = wrapText(scene.title || `${sceneWord} ${index + 1}`, portrait ? 21 : 34, 2);
  const calloutLines = wrapText(scene.onScreenText || scene.visualMetaphor || "", portrait ? 29 : 54, 1);
  const titleY = portrait ? 175 : 138;
  const titleSize = portrait ? 48 : 47;
  const calloutY = portrait ? 425 : 258;
  const stickX = portrait ? 355 : 855;
  const stickY = portrait ? 800 : 372;
  const propX = portrait ? 585 : 1005;
  const frameWord = input.contentLanguage === "am" ? "ትዕይንት" : input.contentLanguage === "ar" ? "مشهد" : "FRAME";
  const frameLabel = `${frameWord} ${String(index + 1).padStart(2, "0")} · ${String(scene.seconds).padStart(2, "0")}s`;
  const textX = input.contentLanguage === "ar" ? width - (portrait ? 50 : 82) : portrait ? 50 : 82;
  const textAnchor = input.contentLanguage === "ar" ? "end" : "start";
  const context = contextForScene(scene, input.topic);
  const action = actionForScene(scene);
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
  const callout = calloutLines[0]
    ? `<rect x="${portrait ? 54 : 85}" y="${calloutY - 44}" width="${width - (portrait ? 108 : 170)}" height="64" rx="20" fill="${palette.paper}" opacity=".83"/><text x="${Math.round(width / 2)}" y="${calloutY}" text-anchor="middle" ${input.contentLanguage === "ar" ? 'direction="rtl" unicode-bidi="plaintext"' : ""} fill="${palette.ink}" font-family="${languageFont(input.contentLanguage)}, sans-serif" font-size="${portrait ? 23 : 25}" font-weight="600">${escapeXml(calloutLines[0])}</text>`
    : "";
  const environment = sceneEnvironment(context, palette, index, width, height);
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.paper}"/><stop offset="1" stop-color="${palette.field}"/></linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#paper)"/>
  <circle cx="${portrait ? 588 : 1110}" cy="${portrait ? 255 : 170}" r="${sunRadius}" fill="${palette.accent}" opacity=".16"/>
  <path d="M0 ${portrait ? 940 : 510} Q${width * 0.35} ${portrait ? 870 : 455} ${width} ${portrait ? 965 : 545} V${height} H0Z" fill="${palette.field}" opacity=".78"/>
  ${environment}
  <text x="${textX}" y="${portrait ? 83 : 76}" text-anchor="${textAnchor}" ${input.contentLanguage === "ar" ? 'direction="rtl" unicode-bidi="plaintext"' : ""} fill="${palette.ink}" opacity=".68" font-family="${languageFont(input.contentLanguage)}, sans-serif" font-size="${portrait ? 17 : 16}" font-weight="700" letter-spacing="3">${escapeXml(frameLabel)}</text>
  ${textRows(titleLines, textX, titleY, titleSize, palette.ink, 700, input, textAnchor)}
  ${callout}
  <g transform="translate(${stickX} ${stickY + bodyBob}) scale(${scale})">
    <ellipse cx="0" cy="190" rx="120" ry="22" fill="${palette.ink}" opacity=".12"/>
    <circle cx="0" cy="-95" r="49" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="9"/>
    <path d="M0 -45 L0 83 M0 -5 L${leftArm.elbowX * orbit} ${leftArm.elbowY} L${leftArm.handX * orbit} ${leftArm.handY} M0 -5 L${rightArm.elbowX * orbit} ${rightArm.elbowY} L${rightArm.handX * orbit} ${rightArm.handY} M0 82 L${leftLeg.kneeX * orbit} ${leftLeg.kneeY} L${leftLeg.footX * orbit} ${leftLeg.footY} M0 82 L${rightLeg.kneeX * orbit} ${rightLeg.kneeY} L${rightLeg.footX * orbit} ${rightLeg.footY}" fill="none" stroke="${palette.ink}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${leftArm.elbowX * orbit}" cy="${leftArm.elbowY}" r="6" fill="${palette.ink}"/>
    <circle cx="${rightArm.elbowX * orbit}" cy="${rightArm.elbowY}" r="6" fill="${palette.ink}"/>
    <circle cx="${18 * orbit}" cy="-105" r="5" fill="${palette.ink}"/>
    <path d="M${6 * orbit} -78 Q${23 * orbit} -65 ${35 * orbit} -82" fill="none" stroke="${palette.accent}" stroke-width="5" stroke-linecap="round"/>
  </g>
  <g transform="translate(${propX} ${portrait ? 795 : 344}) rotate(${propRotation})">
    ${sceneProp}
  </g>
  <text x="${textX}" y="${portrait ? 1220 : 690}" text-anchor="${textAnchor}" ${input.contentLanguage === "ar" ? 'direction="rtl" unicode-bidi="plaintext"' : ""} fill="${palette.ink}" opacity=".55" font-family="${languageFont(input.contentLanguage)}, sans-serif" font-size="${portrait ? 14 : 13}" font-weight="600" letter-spacing="2">${escapeXml(input.title.slice(0, 42).toLocaleUpperCase(input.contentLanguage === "am" ? "am-ET" : input.contentLanguage))}</text>
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
    child.once("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} failed with exit code ${code}: ${stderr.slice(-700)}`));
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

    const scenePatterns: string[] = [];
    for (const [index, scene] of input.scenes.entries()) {
      const svgPaths: string[] = [];
      for (let frame = 0; frame < POSE_FRAMES; frame += 1) {
        const svgPath = join(directory, `scene-${index}-${String(frame).padStart(2, "0")}.svg`);
        await writeFile(svgPath, createSceneSvg(scene, index, input, frame / POSE_FRAMES), "utf8");
        svgPaths.push(svgPath);
      }
      const framePattern = join(directory, `scene-${index}-%02d.png`);
      await run("convert", [...svgPaths, "-resize", `${width}x${height}!`, framePattern]);
      scenePatterns.push(framePattern);
    }

    const ffmpegArgs = ["-hide_banner", "-loglevel", "error", "-y"];
    for (const framePattern of scenePatterns) {
      ffmpegArgs.push(
        "-stream_loop",
        "-1",
        "-framerate",
        String(FPS),
        "-i",
        framePattern,
      );
    }

    const sceneFrameCounts = input.scenes.map((scene) => Math.max(1, Math.round(scene.seconds * FPS)));
    const totalFrames = sceneFrameCounts.reduce((total, frames) => total + frames, 0);
    const filters = input.scenes.map((scene, index) => {
      const frames = sceneFrameCounts[index]!;
      const cameraMove = (scene.cameraMove ?? "").toLowerCase();
      const zoomOut = /pull|back|zoom out|reveal/.test(cameraMove)
        || (!/push|zoom in/.test(cameraMove) && index % 2 === 1);
      const zoom = zoomOut
        ? `1.12-0.12*on/${frames}`
        : `1+0.12*on/${frames}`;
      const x = /pan left|move left/.test(cameraMove)
        ? `(iw-iw/zoom)*(1-on/${frames})`
        : /pan right|move right/.test(cameraMove)
          ? `(iw-iw/zoom)*on/${frames}`
          : "iw/2-(iw/zoom/2)";
      return `[${index}:v]zoompan=z='${zoom}':x='${x}':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${FPS},trim=end_frame=${frames},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v${index}]`;
    });
    const concatInputs = input.scenes.map((_scene, index) => `[v${index}]`).join("");
    filters.push(`${concatInputs}concat=n=${input.scenes.length}:v=1:a=0[outv]`);
    if (subtitlesPath) {
      filters.push(`[outv]ass=filename='${escapeFilterPath(subtitlesPath)}'[captioned]`);
    }
    ffmpegArgs.push(
      "-filter_complex",
      filters.join(";"),
      "-map",
      subtitlesPath ? "[captioned]" : "[outv]",
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
