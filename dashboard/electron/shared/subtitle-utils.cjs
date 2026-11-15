// dashboard/electron/shared/subtitle-utils.cjs
// Canonical ASS & SRT subtitle utility functions shared between Electron backend
// and TypeScript frontend.

/**
 * Convert Hex color string (#RRGGBB) to ASS color format (&H00BBGGRR&).
 * @param {string} hexStr - e.g. "#FDE047"
 * @param {string} [alphaHex="00"] - alpha byte in hex
 * @returns {string} ASS color string
 */
function hexToAssColor(hexStr, alphaHex = '00') {
  let clean = hexStr.replace('#', '').trim();
  if (clean.length === 3) clean = clean.split('').map((c) => c + c).join('');
  if (clean.length !== 6) clean = 'FFFFFF';
  const rr = clean.substring(0, 2);
  const gg = clean.substring(2, 4);
  const bb = clean.substring(4, 6);
  return `&H${alphaHex}${bb}${gg}${rr}&`;
}

/**
 * Format seconds to ASS timecode format (H:MM:SS.cs).
 * @param {number} sec
 * @returns {string}
 */
function assTime(sec) {
  const safeSec = Math.max(0, sec);
  const totalMs = Math.floor(safeSec * 1000);
  const hrs = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const cs = Math.floor((totalMs % 1000) / 10); // centiseconds
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${hrs}:${pad(mins)}:${pad(secs)}.${pad(cs)}`;
}

/**
 * Clean all punctuation marks from a word string for subtitle display.
 * @param {string} word
 * @returns {string}
 */
function cleanPunct(word) {
  if (!word) return '';
  return word.replace(/[.,:;!?\-"“”'’`()[\]{}]/g, '').trim();
}

/**
 * Parse an SRT timestamp string (e.g. "00:01:23,456" or "01:23.456") to seconds float.
 * @param {string} tsStr
 * @returns {number}
 */
function parseSrtTimestampToSeconds(tsStr) {
  if (!tsStr) return 0;
  const tsClean = String(tsStr).replace(/\[.*?\]/g, '').trim();
  const clean = tsClean.replace(',', '.').trim();
  const parts = clean.split(':');
  if (parts.length === 3) {
    const hrs = parseFloat(parts[0]) || 0;
    const mins = parseFloat(parts[1]) || 0;
    const secs = parseFloat(parts[2]) || 0;
    return hrs * 3600 + mins * 60 + secs;
  }
  if (parts.length === 2) {
    const mins = parseFloat(parts[0]) || 0;
    const secs = parseFloat(parts[1]) || 0;
    return mins * 60 + secs;
  }
  return parseFloat(clean) || 0;
}

/**
 * Format seconds as MM:SS - MM:SS range string.
 * @param {number} startSec
 * @param {number} endSec
 * @returns {string}
 */
function formatMinuteRangeStr(startSec, endSec) {
  const pad = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
  const m1 = Math.floor(startSec / 60);
  const s1 = Math.floor(startSec % 60);
  const m2 = Math.floor(endSec / 60);
  const s2 = Math.floor(endSec % 60);
  return `${pad(m1)}:${pad(s1)} - ${pad(m2)}:${pad(s2)}`;
}

/**
 * Strip markdown code fences and normalize line endings.
 * @param {string} raw
 * @returns {string}
 */
function normalizeTranscriptRawText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/^```(?:[a-z0-9_-]+)?\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

/**
 * Parse a single SRT cue block (lines array with one '-->' line) into an entry.
 * @param {string[]} lines
 * @param {number} nextId
 */
function parseSingleSrtCueLines(lines, nextId) {
  if (!lines || lines.length < 2) return null;
  const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
  if (timeLineIdx === -1) return null;

  const timeLine = lines[timeLineIdx];
  const parts = timeLine.split('-->');
  if (parts.length < 2) return null;

  let speaker = 'Narator';
  const speakerMatch = timeLine.match(/\[([^\]]+)\]/);
  if (speakerMatch) {
    speaker = speakerMatch[1].trim();
  }

  const startSec = parseSrtTimestampToSeconds(parts[0]);
  const endSec = parseSrtTimestampToSeconds(parts[1]);

  const textLines = lines.slice(timeLineIdx + 1);
  const text = textLines.join(' ').trim();
  if (!text) return null;

  return {
    id: nextId,
    start_seconds: Number(startSec.toFixed(3)),
    end_seconds: Number(endSec.toFixed(3)),
    timestamp_minute: formatMinuteRangeStr(startSec, endSec),
    text,
    speaker,
  };
}

/**
 * Parse inline/bracketed or line-leading timecoded transcript text:
 * e.g. "(0:00) Cerita berawal... (0:03) tiba-tiba..." or "[0:00] ..." or YouTube "0:00\ntext".
 * @param {string} normalized
 * @returns {{ entries: Array<object>, lastEntryHasInferredEnd: boolean }}
 */
function parseInlineTimecodedEntries(normalized) {
  if (!normalized) return { entries: [], lastEntryHasInferredEnd: false };

  // Protect [VISUAL_ONLY ...] tags so internal time ranges are never split as segment timestamps
  const visualSpans = [];
  const visRegex = /\[VISUAL_ONLY[^\]]*\]/gi;
  let vm;
  while ((vm = visRegex.exec(normalized)) !== null) {
    visualSpans.push({ start: vm.index, end: vm.index + vm[0].length });
  }
  const isInsideVisualSpan = (idx) => visualSpans.some((s) => idx >= s.start && idx < s.end);

  // 1. Match parenthesized or bracketed timestamps: (0:00), (0:03), (1:02:03), [0:00], (0:00 - 0:03)
  const inlineRegex =
    /(?:\(\s*(\d{1,2}:[0-5]\d(?::[0-5]\d)?(?:[.,]\d{1,3})?)(?:\s*[-–—]\s*(\d{1,2}:[0-5]\d(?::[0-5]\d)?(?:[.,]\d{1,3})?))?\s*\)|\[\s*(\d{1,2}:[0-5]\d(?::[0-5]\d)?(?:[.,]\d{1,3})?)(?:\s*[-–—]\s*(\d{1,2}:[0-5]\d(?::[0-5]\d)?(?:[.,]\d{1,3})?))?\s*\])/g;

  let matches = [];
  let m;
  while ((m = inlineRegex.exec(normalized)) !== null) {
    if (isInsideVisualSpan(m.index)) continue;
    matches.push({
      startIndex: m.index,
      endIndex: m.index + m[0].length,
      startStr: m[1] || m[3],
      endStr: m[2] || m[4] || null,
    });
  }

  // Require >= 2 inline timestamps, or 1 right at the start of the text
  const hasLeadingSingleMatch =
    matches.length === 1 && normalized.slice(0, matches[0].startIndex).trim() === '';
  if (matches.length < 2 && !hasLeadingSingleMatch) {
    matches = [];
  }

  // 2. Fallback: line-leading bare timestamps (e.g. YouTube transcript copy-paste: "0:00\nText" or "0:00 Text")
  if (matches.length === 0) {
    const lineTsRegex =
      /^[ \t]*(\d{1,2}:[0-5]\d(?::[0-5]\d)?(?:[.,]\d{1,3})?)(?:[ \t]*[-–—][ \t]*(\d{1,2}:[0-5]\d(?::[0-5]\d)?(?:[.,]\d{1,3})?))?(?=[ \t]*$|[ \t]+\S)/gm;
    const bareMatches = [];
    while ((m = lineTsRegex.exec(normalized)) !== null) {
      if (isInsideVisualSpan(m.index)) continue;
      bareMatches.push({
        startIndex: m.index,
        endIndex: m.index + m[0].length,
        startStr: m[1],
        endStr: m[2] || null,
      });
    }
    if (bareMatches.length >= 2) {
      matches = bareMatches;
    }
  }

  if (matches.length === 0) {
    return { entries: [], lastEntryHasInferredEnd: false };
  }

  // Extract raw segments keeping next timestamp boundary before filtering empty markers
  const rawSegments = [];
  for (let i = 0; i < matches.length; i++) {
    const curr = matches[i];
    const nextMatch = i + 1 < matches.length ? matches[i + 1] : null;
    const sliceEnd = nextMatch ? nextMatch.startIndex : normalized.length;
    let rawSlice = normalized.slice(curr.endIndex, sliceEnd).trim();

    let speaker = 'Narator';
    const spkMatch = rawSlice.match(/^\[((?:Speaker|Pembicara|Narator)[^\]]*)\]\s*/i);
    if (spkMatch) {
      speaker = spkMatch[1].trim();
      rawSlice = rawSlice.slice(spkMatch[0].length).trim();
    }

    const text = rawSlice
      .replace(/^[-–—:]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();

    const startSec = parseSrtTimestampToSeconds(curr.startStr);
    const explicitEndSec = curr.endStr ? parseSrtTimestampToSeconds(curr.endStr) : null;
    const nextStartSec = nextMatch ? parseSrtTimestampToSeconds(nextMatch.startStr) : null;
    const endSec = explicitEndSec !== null ? explicitEndSec : nextStartSec;
    const hasExplicitEnd = explicitEndSec !== null || nextStartSec !== null;

    if (!text) continue;

    rawSegments.push({
      startSec,
      endSec,
      hasExplicitEnd,
      text,
      speaker,
    });
  }

  if (rawSegments.length === 0) {
    return { entries: [], lastEntryHasInferredEnd: false };
  }

  // Resolve zero/negative duration runs (e.g. duplicate consecutive timestamps) proportionally
  let i = 0;
  while (i < rawSegments.length) {
    const seg = rawSegments[i];
    if (seg.endSec !== null && seg.endSec <= seg.startSec) {
      const runStart = seg.startSec;
      let j = i;
      while (j + 1 < rawSegments.length && rawSegments[j + 1].startSec <= runStart) {
        j++;
      }
      const tailSeg = rawSegments[j];
      let runEnd = tailSeg.endSec;
      if (runEnd === null || runEnd <= runStart) {
        const totalWords = rawSegments
          .slice(i, j + 1)
          .reduce((acc, s) => acc + Math.max(1, s.text.split(/\s+/).filter(Boolean).length), 0);
        runEnd = runStart + Math.max(2.0 * (j - i + 1), Number((totalWords / 2.8).toFixed(3)));
        for (let k = i; k <= j; k++) rawSegments[k].hasExplicitEnd = false;
      }
      const totalChars = rawSegments
        .slice(i, j + 1)
        .reduce((acc, s) => acc + Math.max(1, s.text.length), 0);
      let cursor = runStart;
      for (let k = i; k <= j; k++) {
        const share = Math.max(1, rawSegments[k].text.length) / totalChars;
        const segEnd = k === j ? runEnd : Number((cursor + (runEnd - runStart) * share).toFixed(3));
        rawSegments[k].startSec = cursor;
        rawSegments[k].endSec = Math.max(cursor + 0.1, segEnd);
        cursor = rawSegments[k].endSec;
      }
      i = j + 1;
    } else {
      i++;
    }
  }

  // Estimate duration for open-ended final segment
  const lastSeg = rawSegments[rawSegments.length - 1];
  let lastEntryHasInferredEnd = false;
  if (lastSeg.endSec === null || lastSeg.endSec <= lastSeg.startSec) {
    const wordCount = lastSeg.text.split(/\s+/).filter(Boolean).length;
    const estDur = Math.max(2.0, Number((wordCount / 2.8).toFixed(3)));
    lastSeg.endSec = lastSeg.startSec + estDur;
    lastEntryHasInferredEnd = true;
  } else if (!lastSeg.hasExplicitEnd) {
    lastEntryHasInferredEnd = true;
  }

  const entries = rawSegments.map((seg, idx) => ({
    id: idx + 1,
    start_seconds: Number(seg.startSec.toFixed(3)),
    end_seconds: Number(seg.endSec.toFixed(3)),
    timestamp_minute: formatMinuteRangeStr(seg.startSec, seg.endSec),
    text: seg.text,
    speaker: seg.speaker,
  }));

  return { entries, lastEntryHasInferredEnd };
}

/**
 * Parse transcript text (SRT, inline timestamps like (0:00), or YouTube timestamps)
 * into standardized entries plus format metadata.
 * @param {string} rawContent
 * @returns {{ entries: Array<{ id: number, start_seconds: number, end_seconds: number, timestamp_minute: string, text: string, speaker: string }>, format: 'srt' | 'inline' | 'none', lastEntryHasInferredEnd: boolean }}
 */
function parseTranscriptToEntriesWithMeta(rawContent) {
  const normalized = normalizeTranscriptRawText(rawContent);
  if (!normalized) {
    return { entries: [], format: 'none', lastEntryHasInferredEnd: false };
  }

  if (normalized.includes('-->')) {
    const blocks = normalized.split(/\n\s*\n/);
    const entries = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i].trim();
      if (!block) continue;
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const arrowIndices = [];
      lines.forEach((l, idx) => {
        if (l.includes('-->')) arrowIndices.push(idx);
      });

      if (arrowIndices.length <= 1) {
        const entry = parseSingleSrtCueLines(lines, entries.length + 1);
        if (entry) entries.push(entry);
      } else {
        // Handle SRT cues pasted without blank line separators
        for (let a = 0; a < arrowIndices.length; a++) {
          const startLineIdx = arrowIndices[a];
          let endLineIdx = a + 1 < arrowIndices.length ? arrowIndices[a + 1] : lines.length;
          if (a + 1 < arrowIndices.length && endLineIdx - 1 > startLineIdx && /^\d+$/.test(lines[endLineIdx - 1])) {
            endLineIdx -= 1;
          }
          const subLines = lines.slice(startLineIdx, endLineIdx);
          const entry = parseSingleSrtCueLines(subLines, entries.length + 1);
          if (entry) entries.push(entry);
        }
      }
    }

    if (entries.length > 0) {
      return { entries, format: 'srt', lastEntryHasInferredEnd: false };
    }
  }

  const inlineResult = parseInlineTimecodedEntries(normalized);
  if (inlineResult.entries.length > 0) {
    return {
      entries: inlineResult.entries,
      format: 'inline',
      lastEntryHasInferredEnd: inlineResult.lastEntryHasInferredEnd,
    };
  }

  return { entries: [], format: 'none', lastEntryHasInferredEnd: false };
}

/**
 * Parse SRT or inline-timecoded transcript text into standardized transcript entry objects array.
 * @param {string} srtContent
 * @returns {Array<{ id: number, start_seconds: number, end_seconds: number, timestamp_minute: string, text: string, speaker: string }>}
 */
function parseSrtToEntries(srtContent) {
  return parseTranscriptToEntriesWithMeta(srtContent).entries;
}

module.exports = {
  hexToAssColor,
  assTime,
  cleanPunct,
  parseSrtTimestampToSeconds,
  parseSrtToEntries,
  parseTranscriptToEntriesWithMeta,
};
