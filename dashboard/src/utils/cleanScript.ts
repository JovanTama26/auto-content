/**
 * Utility to clean voiceover scripts from director annotations,
 * part/scene headers, visual/audio cues, timestamps, and stage directions.
 *
 * Produces pure, natural narration text ready for Text-To-Speech (ElevenLabs)
 * or human voice actors.
 */

export function cleanVoiceoverScript(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';

  const lines = raw.split(/\r?\n/);
  const cleanedLines: string[] = [];

  // Match: "PART 1: ...", "### PART 1 - ...", "**PART 1 (0-60 detik):**", "Bagian 2:", "Adegan 3:", "Part 1 dari 5", "Part 1/5"
  const PART_HEADER_REGEX =
    /^\s*(?:#+\s*)?(?:\*{1,3})?\s*(?:PART|BAGIAN|BAB|SCENE|EPISODE|ACT|SEGMENT|CHUNK|ADEGAN)\s*\d+(?:\s*(?:\/|dari)\s*\d+)?(?:[^\n:]*)?(?::[^\n]*)?(?:\*{1,3})?\s*$/i;

  // Match: "HOOK (0-3 DETIK):", "INTRO:", "CLIFFHANGER:", "ENDING:", "CLIMAX:"
  const SECTION_HEADER_REGEX =
    /^\s*(?:#+\s*)?(?:\*{1,3})?\s*(?:HOOK|INTRO|OUTRO|CLIMAX|CLIFFHANGER|ENDING|PENUTUP|PEMBUKA|REKAP|KESIMPULAN)\s*(?:\([^)]*\))?\s*:\s*(?:\*{1,3})?\s*$/i;

  // Match: "Visual: ...", "Visual 1: ...", "Footage: ...", "SFX: ...", "Audio: ...", "Prompt Visual: ..."
  const CUE_LINE_REGEX =
    /^\s*(?:#+\s*)?(?:\*{1,3})?\s*(?:Visual(?:\s*\d+)?|Footage|B-roll|SFX|Sound\s*FX|Audio|Musik|Music|Backsound|Teks\s*Overlay|Teks\s*Layar|Teks|Text|Catatan|Notes|Prompt\s*Visual|Prompt|Kamera|Camera|Shot|Transisi|Transition|Durasi|Duration)\s*:[^\n]*$/i;

  // Match: "---", "===", "***"
  const DIVIDER_REGEX = /^\s*[-=_*~]{3,}\s*$/;

  // Match timestamps or standalone duration: "[00:00 - 01:00]", "(Durasi: 60 detik)", "(60s)"
  const DURATION_ONLY_REGEX =
    /^(?:\[|\()(?:\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?|durasi[^\)]*|\d+\s*(?:detik|menit|s|sec|min))\s*(?:\]|\))$/i;

  for (const line of lines) {
    let trimmed = line.trim();

    // Preserve clean paragraph break
    if (!trimmed) {
      if (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1] !== '') {
        cleanedLines.push('');
      }
      continue;
    }

    // Skip dividers, headers, cue lines, and standalone metadata
    if (DIVIDER_REGEX.test(trimmed)) continue;
    if (PART_HEADER_REGEX.test(trimmed)) continue;
    if (SECTION_HEADER_REGEX.test(trimmed)) continue;
    if (CUE_LINE_REGEX.test(trimmed)) continue;
    if (DURATION_ONLY_REGEX.test(trimmed)) continue;

    // Skip lines entirely enclosed in square brackets (e.g. "[Visual: CCTV sepi]")
    if (/^\s*\[[^\]]+\]\s*$/.test(trimmed)) continue;

    // Skip lines entirely enclosed in parentheses containing cue keywords
    if (
      /^\s*\((?:visual|footage|b-roll|sfx|audio|sound|musik|music|backsound|teks|text|overlay|kamera|camera|shot|scene|suara|ambience|durasi)[^)]*\)\s*$/i.test(
        trimmed
      )
    ) {
      continue;
    }

    // Remove inline bracketed cues: [Visual: ...], [SFX: ...], [pause], etc.
    let cleaned = trimmed.replace(/\[[^\]]*\]/g, '');

    // Remove inline parenthetical cues with keywords (preserves normal explanatory parentheses)
    cleaned = cleaned.replace(
      /\((?:visual|footage|b-roll|sfx|audio|sound|musik|music|backsound|teks|text|overlay|kamera|camera|shot|scene|suara|ambience|durasi)[^)]*\)/gi,
      ''
    );

    // Remove speaker prefixes at start of line: "Narator: ...", "Voiceover: ...", "VO: ..."
    cleaned = cleaned.replace(
      /^(?:#+\s*)?(?:\*{1,3})?\s*(?:Narator|Narasi|Voiceover|VO|Host|Speaker)\s*:\s*(?:\*{1,3})?\s*/i,
      ''
    );

    // Remove leftover markdown heading prefixes: "### Some text"
    cleaned = cleaned.replace(/^#+\s*/, '');

    // Clean markdown bold/italic tags if wrapping whole line
    cleaned = cleaned.replace(/^\*\*(.*?)\*\*$/, '$1').replace(/^_(.*?)_$/, '$1');

    // Clean outer quotes if wrapping whole line: "Semua orang panik..." -> Semua orang panik...
    if (
      (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith('“') && cleaned.endsWith('”'))
    ) {
      cleaned = cleaned.slice(1, -1).trim();
    }

    // Normalize spacing within line
    cleaned = cleaned.replace(/[ \t]+/g, ' ').trim();

    if (cleaned) {
      cleanedLines.push(cleaned);
    }
  }

  // Join lines and normalize multiple consecutive empty lines to a single paragraph break
  return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
