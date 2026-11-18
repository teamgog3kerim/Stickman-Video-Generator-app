type CaptionScene = {
  narration: string;
  seconds: number;
};

function assTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const remaining = centiseconds % 6000;
  const wholeSeconds = Math.floor(remaining / 100);
  const fraction = remaining % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
}

function escapeAssText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("\n", " ");
}

function captionChunks(text: string, maxWords: number): string[][] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const word of words) {
    current.push(word);
    const sentenceEnds = /[.!?]["')\]]?$/.test(word);
    if (current.length >= maxWords || (sentenceEnds && current.length >= 3)) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function buildVoiceoverSubtitles(
  scenes: CaptionScene[],
  spokenDurations: number[],
  width: number,
  height: number,
): string {
  const portrait = height > width;
  const fontSize = portrait ? 40 : 44;
  const moveX = Math.round(width / 2);
  const captionY = Math.round(height * (portrait ? 0.87 : 0.86));
  const entryY = captionY + (portrait ? 24 : 18);
  const maxWords = portrait ? 5 : 7;
  const events: string[] = [];
  let sceneStart = 0;

  for (const [sceneIndex, scene] of scenes.entries()) {
    const duration = Math.max(0, scene.seconds);
    const spokenDuration = Math.min(duration, spokenDurations[sceneIndex] ?? duration);
    const phrases = captionChunks(scene.narration, maxWords);
    const totalWords = phrases.reduce((count, phrase) => count + phrase.length, 0);
    let wordOffset = 0;

    for (const phrase of phrases) {
      const phraseWeight = phrase.reduce((total, word) => total + Math.max(2, word.replace(/\W/g, "").length), 0);
      const remainingWeight = phraseWeight;
      const start = sceneStart + (wordOffset / totalWords) * spokenDuration;
      wordOffset += phrase.length;
      const end = sceneStart + (wordOffset / totalWords) * spokenDuration;
      let usedCentiseconds = 0;
      const phraseDuration = Math.max(0.2, end - start);
      const karaokeWords = phrase.map((word, wordIndex) => {
        const weight = Math.max(2, word.replace(/\W/g, "").length);
        const centiseconds = wordIndex === phrase.length - 1
          ? Math.max(1, Math.round(phraseDuration * 100) - usedCentiseconds)
          : Math.max(1, Math.round((phraseDuration * weight / remainingWeight) * 100));
        usedCentiseconds += centiseconds;
        return `{\\kf${centiseconds}}${escapeAssText(word)}`;
      }).join(" ");
      const effect = `{\\an2\\move(${moveX},${entryY},${moveX},${captionY},0,220)\\fad(120,180)}`;
      events.push(
        `Dialogue: 0,${assTime(start)},${assTime(Math.max(start + 0.2, end))},Voiceover,,0,0,0,,${effect}${karaokeWords}`,
      );
    }
    sceneStart += duration;
  }

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Voiceover,DejaVu Sans,${fontSize},&H00FFF8F0,&H00007CE2,&H0025303A,&H8025303A,-1,0,1,3,2,2,44,44,80,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}
