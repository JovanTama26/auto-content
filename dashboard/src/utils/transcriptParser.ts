// dashboard/src/utils/transcriptParser.ts

export interface TranscriptSegment {
  timecode: string;
  seconds: number;
  text: string;
}

export interface ParseTranscriptResult {
  formattedText: string;
  segments: TranscriptSegment[];
}

/**
 * Parses raw timecoded transcript text into clean line-by-line formatted text
 * and structured timecode segments.
 *
 * Example input:
 * "(0:00) Semua orang panik. (0:03) Sementara aku berhasil mengunci diri... (0:06) dua lantai..."
 *
 * Example output:
 * (0:00) Semua orang panik.
 * (0:03) Sementara aku berhasil mengunci diri...
 * (0:06) dua lantai...
 */
export function parseAndFormatTimecodedTranscript(input: string): ParseTranscriptResult {
  if (!input || typeof input !== 'string') {
    return { formattedText: '', segments: [] };
  }

  const trimmed = input.trim();

  // 1. Handle standard SRT subtitle format if detected
  if (/^\d+\r?\n\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->/m.test(trimmed)) {
    const blocks = trimmed.split(/\r?\n\r?\n/);
    const segments: TranscriptSegment[] = [];
    const lines: string[] = [];

    for (const block of blocks) {
      const bLines = block.trim().split(/\r?\n/);
      if (bLines.length >= 3) {
        const timeMatch = bLines[1].match(/(\d{2}:\d{2}:\d{2})/);
        const text = bLines.slice(2).join(' ').trim();
        if (timeMatch && text) {
          const partsArr = timeMatch[1].split(':').map(Number);
          const sec = partsArr[0] * 3600 + partsArr[1] * 60 + partsArr[2];
          const m = Math.floor(sec / 60);
          const s = sec % 60;
          const displayTc = `(${m}:${s.toString().padStart(2, '0')})`;
          segments.push({ timecode: displayTc, seconds: sec, text });
          lines.push(`${displayTc} ${text}`);
        }
      }
    }

    if (segments.length > 0) {
      return { formattedText: lines.join('\n'), segments };
    }
  }

  // 2. Find all timecode positions
  // Matches: "(0:00)", "[00:03]", "0:03)", "(0:06", "[0:11]" or "[00:00.000]"
  const regex =
    /(?:[\(\[]\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*[\)\]]?|(?:\b)(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*[\)\]])/g;

  const matches: Array<{ index: number; fullLength: number; timecode: string }> = [];
  let m: RegExpExecArray | null;

  while ((m = regex.exec(trimmed)) !== null) {
    matches.push({
      index: m.index,
      fullLength: m[0].length,
      timecode: m[1] || m[2],
    });
  }

  // If no bracketed matches found, try standalone timecodes
  if (matches.length === 0) {
    const standaloneRegex = /\b(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\b/g;
    while ((m = standaloneRegex.exec(trimmed)) !== null) {
      matches.push({
        index: m.index,
        fullLength: m[0].length,
        timecode: m[1],
      });
    }
  }

  // If still no timecodes found, return original lines wrapped with initial (0:00)
  if (matches.length === 0) {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    return {
      formattedText: lines.map((l, i) => (i === 0 ? `(0:00) ${l}` : l)).join('\n'),
      segments: [{ timecode: '(0:00)', seconds: 0, text: trimmed }],
    };
  }

  const segments: TranscriptSegment[] = [];
  const lines: string[] = [];

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const nextIndex = i + 1 < matches.length ? matches[i + 1].index : trimmed.length;
    const textStart = current.index + current.fullLength;
    const text = trimmed.slice(textStart, nextIndex).trim().replace(/^[-–—:]\s*/, '');

    const partsArr = current.timecode.split(':').map(Number);
    let sec = 0;
    if (partsArr.length === 3) {
      sec = partsArr[0] * 3600 + partsArr[1] * 60 + partsArr[2];
    } else if (partsArr.length === 2) {
      sec = partsArr[0] * 60 + partsArr[1];
    }

    const formattedTc = `(${current.timecode})`;
    if (text) {
      segments.push({
        timecode: formattedTc,
        seconds: sec,
        text,
      });
      lines.push(`${formattedTc} ${text}`);
    }
  }

  return {
    formattedText: lines.join('\n'),
    segments,
  };
}
