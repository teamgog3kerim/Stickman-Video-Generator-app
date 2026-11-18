import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { textToSpeech } from "@workspace/integrations-openai-ai-server/audio";

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
  aspectRatio: "16:9" | "9:16";
  styleId: string;
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
const POSE_FRAMES = 12;

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

function textRows(lines: string[], x: number, y: number, fontSize: number, fill: string, weight: number): string {
  const gap = Math.round(fontSize * 1.24);
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * gap}" fill="${fill}" font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" font-weight="${weight}">${escapeXml(line)}</text>`,
    )
    .join("");
}

function createSceneSvg(scene: RenderScene, index: number, input: RenderInput, phase = 0): string {
  const portrait = input.aspectRatio === "9:16";
  const width = portrait ? 720 : 1280;
  const height = portrait ? 1280 : 720;
  const palette = STYLE_PALETTES[input.styleId] ?? STYLE_PALETTES.A2!;
  const scale = portrait ? 1 : 0.72;
  const titleLines = wrapText(scene.title || `Scene ${index + 1}`, portrait ? 21 : 34, 2);
  const visualLines = wrapText(
    scene.visualMetaphor || scene.visualDirection,
    portrait ? 29 : 54,
    portrait ? 5 : 3,
  );
  const captionLines = input.subtitles
    ? wrapText(scene.onScreenText || scene.narration, portrait ? 28 : 68, portrait ? 3 : 2)
    : [];
  const titleY = portrait ? 175 : 138;
  const titleSize = portrait ? 48 : 47;
  const visualY = portrait ? 585 : 398;
  const visualSize = portrait ? 25 : 26;
  const captionY = portrait ? 1070 : 610;
  const captionSize = portrait ? 24 : 26;
  const stickX = portrait ? 355 : 855;
  const stickY = portrait ? 800 : 372;
  const propX = portrait ? 360 : 1005;
  const frameLabel = `FRAME ${String(index + 1).padStart(2, "0")} · ${String(scene.seconds).padStart(2, "0")}s`;
  const orbit = index % 2 === 0 ? -1 : 1;
  const motion = Math.sin(phase * Math.PI * 2);
  const bodyBob = motion * 5;
  const armSwing = motion * 18;
  const legSwing = motion * 16;
  const propRotation = motion * 8;
  const sunRadius = (portrait ? 80 : 62) + motion * 4;
  const captionBlock = captionLines.length
    ? `<rect x="${portrait ? 48 : 80}" y="${portrait ? 1010 : 568}" width="${width - (portrait ? 96 : 160)}" height="${portrait ? 128 : 94}" rx="17" fill="${palette.ink}" opacity=".92"/>${textRows(captionLines, portrait ? 76 : 112, captionY, captionSize, palette.paper, 600)}`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.paper}"/><stop offset="1" stop-color="${palette.field}"/></linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#paper)"/>
  <circle cx="${portrait ? 588 : 1110}" cy="${portrait ? 255 : 170}" r="${sunRadius}" fill="${palette.accent}" opacity=".16"/>
  <path d="M0 ${portrait ? 940 : 510} Q${width * 0.35} ${portrait ? 870 : 455} ${width} ${portrait ? 965 : 545} V${height} H0Z" fill="${palette.field}" opacity=".78"/>
  <text x="${portrait ? 50 : 82}" y="${portrait ? 83 : 76}" fill="${palette.ink}" opacity=".68" font-family="DejaVu Sans, sans-serif" font-size="${portrait ? 17 : 16}" font-weight="700" letter-spacing="3">${escapeXml(frameLabel)}</text>
  ${textRows(titleLines, portrait ? 50 : 82, titleY, titleSize, palette.ink, 700)}
  <rect x="${portrait ? 46 : 78}" y="${portrait ? 495 : 350}" width="${portrait ? 628 : 536}" height="${portrait ? 292 : 156}" rx="22" fill="${palette.paper}" opacity=".72"/>
  ${textRows(visualLines, portrait ? 72 : 105, visualY, visualSize, palette.ink, 500)}
  <g transform="translate(${stickX} ${stickY + bodyBob}) scale(${scale})">
    <ellipse cx="0" cy="190" rx="120" ry="22" fill="${palette.ink}" opacity=".12"/>
    <circle cx="0" cy="-95" r="49" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="9"/>
    <path d="M0 -45 L0 83 M0 -5 L${70 * orbit} ${-48 + armSwing} M0 -2 L${-64 * orbit} ${-54 - armSwing} M0 82 L${(56 + legSwing) * orbit} ${168 - Math.abs(motion) * 8} M0 82 L${(-53 - legSwing) * orbit} ${165 - Math.abs(motion) * 8}" fill="none" stroke="${palette.ink}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${18 * orbit}" cy="-105" r="5" fill="${palette.ink}"/>
    <path d="M${6 * orbit} -78 Q${23 * orbit} -65 ${35 * orbit} -82" fill="none" stroke="${palette.accent}" stroke-width="5" stroke-linecap="round"/>
    <path d="M${72 * orbit} -48 Q${105 * orbit} -78 ${122 * orbit} -64" fill="none" stroke="${palette.accent}" stroke-width="7" stroke-linecap="round"/>
  </g>
  <g transform="translate(${propX} ${portrait ? 795 : 344}) rotate(${propRotation})">
    <rect x="-46" y="-46" width="92" height="92" rx="18" fill="${palette.accent}" opacity=".84"/>
    <path d="M-20 0 H20 M0 -20 V20" stroke="${palette.paper}" stroke-width="8" stroke-linecap="round"/>
  </g>
  <text x="${portrait ? 50 : 82}" y="${portrait ? 1220 : 690}" fill="${palette.ink}" opacity=".55" font-family="DejaVu Sans, sans-serif" font-size="${portrait ? 14 : 13}" font-weight="600" letter-spacing="2">${escapeXml(input.title.slice(0, 42).toUpperCase())}</text>
  ${captionBlock}
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

export async function renderStoryboardVideo(input: RenderInput): Promise<{ buffer: Buffer; filename: string }> {
  if (input.scenes.length === 0) throw new Error("Add at least one scene before rendering.");
  const directory = await mkdtemp(join(tmpdir(), "stickman-video-"));
  const width = input.aspectRatio === "9:16" ? 720 : 1280;
  const height = input.aspectRatio === "9:16" ? 1280 : 720;
  const basePath = join(directory, "silent.mp4");
  const outputPath = join(directory, "final.mp4");

  try {
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
    ffmpegArgs.push(
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[outv]",
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

    const narration = input.scenes
      .map((scene) => scene.narration.trim())
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 6000);
    if (!narration) throw new Error("Voiceover is enabled but the storyboard has no narration.");

    const audio = await textToSpeech(narration, "alloy", "mp3");
    if (!audio.length) throw new Error("Text-to-speech returned an empty audio file.");
    const audioPath = join(directory, `voice-${randomUUID()}.mp3`);
    await writeFile(audioPath, audio);
    await run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      basePath,
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-af",
      "apad",
      "-shortest",
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
