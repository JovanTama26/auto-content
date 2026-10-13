// dashboard/electron/services/alurfilmAudioSplicer.cjs
/**
 * AlurfilmAudioSplicer — High-Precision Decimal Audio Silence Splicer & Transcript Mapper
 * =====================================================================================
 * Accurately splices raw voiceover audio with exact decimal cut points (+40ms decay, -40ms attack),
 * replaces natural breath pauses with pure silence buffers (anullsrc) matching [VISUAL_ONLY] tags,
 * produces zero-codec-delay WAV PCM 44.1kHz stereo audio, and recalculates 1:1 millisecond-accurate
 * transcript and word timestamps.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseSrtToEntries } = require('../shared/subtitle-utils.cjs');

/**
 * Parses [VISUAL_ONLY...] tag string for duration, timecode range, and description.
 */
function parseVisualOnlyTag(tagStr) {
  const body = String(tagStr || '').replace(/^\[VISUAL_ONLY\s*/i, '').replace(/\]$/, '').trim();

  let sourceRange = '00:00 - 00:35';
  let sourceStartSeconds = 0;
  let sourceEndSeconds = 35;
  let outputDuration = 8.0;
  let description = 'Adegan Visual Murni Action';

  const rangeMatch = body.match(/Range:\s*([\d:\.]+)\s*-\s*([\d:\.]+)/i) || body.match(/([\d:\.]+)\s*-\s*([\d:\.]+)/);
  if (rangeMatch) {
    const sStr = rangeMatch[1];
    const eStr = rangeMatch[2];
    sourceRange = `${sStr} - ${eStr}`;
    const parseTs = (ts) => {
      const parts = ts.trim().replace(/s$/i, '').split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parseFloat(ts) || 0;
    };
    sourceStartSeconds = parseTs(sStr);
    sourceEndSeconds = parseTs(eStr);
  }

  const durMatch = body.match(/(?:Output|Duration):\s*([\d\.]+)\s*s?/i) || body.match(/\|\s*([\d\.]+)\s*s/i) || body.match(/^:?\s*([\d\.]+)\s*s\b/i);
  if (durMatch) {
    outputDuration = Math.max(1.0, Math.min(30.0, parseFloat(durMatch[1]) || 8.0));
  } else if (rangeMatch && sourceEndSeconds > sourceStartSeconds) {
    outputDuration = Math.min(10.0, Math.max(3.0, Math.round((sourceEndSeconds - sourceStartSeconds) * 0.25) || 8.0));
  }

  const parenCloseMatch = body.match(/\)\s*:\s*(.+)$/s);
  if (parenCloseMatch) {
    description = parenCloseMatch[1].trim();
  } else if (body.includes('|')) {
    const parts = body.split('|');
    description = parts[parts.length - 1].trim();
  } else if (body.includes(':')) {
    const parts = body.split(':');
    description = parts.slice(parts.length > 2 ? 2 : 1).join(':').trim();
  } else {
    description = body.replace(/Range:[^,)]*/gi, '').replace(/Duration:[^,)]*/gi, '').replace(/Output:[^,)]*/gi, '').trim() || description;
  }

  return {
    sourceRange,
    sourceStartSeconds,
    sourceEndSeconds,
    outputDuration,
    description,
  };
}

/**
 * Parses script text into an ordered sequence of narration sentences and visual_only elements.
 */
function parseScriptToElements(scriptText) {
  const tagRegex = /\[VISUAL_ONLY[^\]]*\]/gi;
  const scriptElements = [];
  let lastIndex = 0;
  let match;

  while ((match = tagRegex.exec(scriptText)) !== null) {
    const textBefore = scriptText.slice(lastIndex, match.index).trim();
    if (textBefore) {
      const sents = textBefore.split(/(?<=[.!?])\s+/).filter(Boolean);
      for (const st of sents) {
        scriptElements.push({ type: 'narration', text: st });
      }
    }

    const parsedVis = parseVisualOnlyTag(match[0]);
    scriptElements.push({
      type: 'visual_only',
      text: `[VISUAL_ONLY (Range: ${parsedVis.sourceRange}, Duration: ${parsedVis.outputDuration}s): ${parsedVis.description}]`,
      description: parsedVis.description,
      duration: parsedVis.outputDuration,
      sourceRange: parsedVis.sourceRange,
      sourceStartSeconds: parsedVis.sourceStartSeconds,
      sourceEndSeconds: parsedVis.sourceEndSeconds
    });

    lastIndex = tagRegex.lastIndex;
  }

  const textAfter = scriptText.slice(lastIndex).trim();
  if (textAfter) {
    const sents = textAfter.split(/(?<=[.!?])\s+/).filter(Boolean);
    for (const st of sents) {
      scriptElements.push({ type: 'narration', text: st });
    }
  }

  // Assign deterministic sectionIndex to separate pre-visual and post-visual narration groups
  let secCounter = 0;
  for (let idx = 0; idx < scriptElements.length; idx++) {
    if (scriptElements[idx].type === 'visual_only') {
      secCounter++;
    } else {
      scriptElements[idx].sectionIndex = secCounter;
    }
  }

  return scriptElements;
}

/**
 * Maps Faster-Whisper transcribed sentences into scriptElements.
 */
function alignWhisperToElements(scriptElements, whisperSentences, isFasterWhisperUsed) {
  let whisperIdx = 0;
  let simClock = 0;

  const alignedElements = [];

  for (let idx = 0; idx < scriptElements.length; idx++) {
    const el = scriptElements[idx];
    if (el.type === 'narration') {
      const nextEl = idx < scriptElements.length - 1 ? scriptElements[idx + 1] : null;
      const isFollowedByVisualOnly = nextEl && nextEl.type === 'visual_only';

      if (isFasterWhisperUsed && whisperIdx < whisperSentences.length) {
        const w = whisperSentences[whisperIdx++];
        const firstWordStart = w.first_word_start !== undefined ? w.first_word_start : (w.firstWordStart !== undefined ? w.firstWordStart : (w.speech_start !== undefined ? w.speech_start : w.start));
        const lastWordEnd = w.last_word_end !== undefined ? w.last_word_end : (w.lastWordEnd !== undefined ? w.lastWordEnd : (w.speech_end !== undefined ? w.speech_end : w.end));
        const actualEnd = isFollowedByVisualOnly ? (w.speech_end || lastWordEnd) : w.end;
        simClock = actualEnd;

        alignedElements.push({
          ...el,
          text: w.text || el.text,
          start: Number(w.start.toFixed(3)),
          end: Number(actualEnd.toFixed(3)),
          speech_start: Number((w.speech_start !== undefined ? w.speech_start : firstWordStart).toFixed(3)),
          speech_end: Number((w.speech_end !== undefined ? w.speech_end : actualEnd).toFixed(3)),
          firstWordStart: Number(firstWordStart.toFixed(3)),
          lastWordEnd: Number(lastWordEnd.toFixed(3)),
          words: Array.isArray(w.words) ? w.words : [],
        });
      } else {
        const words = (el.text || '').split(/\s+/).filter(Boolean);
        const dur = Math.max(2.5, Number((words.length / 3.0).toFixed(3)));
        const start = Number(simClock.toFixed(3));
        simClock += dur;
        const end = Number(simClock.toFixed(3));
        alignedElements.push({
          ...el,
          start,
          end,
          speech_start: start,
          speech_end: end,
          firstWordStart: start,
          lastWordEnd: end,
          words: []
        });
      }
    } else {
      alignedElements.push(el);
    }
  }

  return alignedElements;
}

/**
 * Calculates exact cut points with acoustic safety margins (+40ms / -40ms).
 */
function calculateAudioSplits(alignedElements, totalRawAudioDur) {
  const audioSplits = [];
  let lastCutTime = 0.0;
  let chunkSectionIdx = 0;

  for (let i = 0; i < alignedElements.length; i++) {
    const current = alignedElements[i];

    if (current.type === 'visual_only') {
      let prevNarr = null;
      for (let k = i - 1; k >= 0; k--) {
        if (alignedElements[k].type === 'narration') {
          prevNarr = alignedElements[k];
          break;
        }
      }

      let nextNarr = null;
      for (let k = i + 1; k < alignedElements.length; k++) {
        if (alignedElements[k].type === 'narration') {
          nextNarr = alignedElements[k];
          break;
        }
      }

      const silenceDur = Number((current.duration !== undefined ? current.duration : (current.outputDuration || 5.0)).toFixed(3));

      if (prevNarr && prevNarr.end !== undefined) {
        const prevEnd = prevNarr.lastWordEnd !== undefined ? prevNarr.lastWordEnd : (prevNarr.speech_end !== undefined ? prevNarr.speech_end : prevNarr.end);
        const nextStart = nextNarr
          ? (nextNarr.firstWordStart !== undefined ? nextNarr.firstWordStart : (nextNarr.speech_start !== undefined ? nextNarr.speech_start : nextNarr.start))
          : totalRawAudioDur;

        let cutEnd;
        let nextCutStart;

        if (nextNarr && nextStart > prevEnd) {
          // Safe decay for last word (+40ms), leaving at least 80ms silence before next sentence begins
          const maxSafeCutEnd = Math.max(prevEnd, nextStart - 0.080);
          cutEnd = Math.min(maxSafeCutEnd, prevEnd + 0.040);
          // Next slice starts 40ms before first word to capture onset without clipping
          nextCutStart = Math.max(cutEnd, Math.max(0.0, nextStart - 0.040));
        } else if (nextNarr) {
          const midPoint = (prevEnd + nextStart) / 2;
          cutEnd = midPoint;
          nextCutStart = midPoint;
        } else {
          // Outro visual only
          cutEnd = Math.min(totalRawAudioDur, prevEnd + 0.040);
          nextCutStart = cutEnd;
        }

        cutEnd = Math.min(totalRawAudioDur, Math.max(lastCutTime, Number(cutEnd.toFixed(3))));
        nextCutStart = Math.min(totalRawAudioDur, Math.max(cutEnd, Number(nextCutStart.toFixed(3))));

        if (cutEnd > lastCutTime + 0.020) {
          audioSplits.push({
            type: 'audio_chunk',
            sectionIndex: chunkSectionIdx,
            startSec: Number(lastCutTime.toFixed(3)),
            endSec: Number(cutEnd.toFixed(3))
          });
        }

        audioSplits.push({
          type: 'silence_buffer',
          durationSec: silenceDur,
          element: current
        });

        chunkSectionIdx++;
        lastCutTime = nextCutStart;
      } else {
        // Intro visual only (at very beginning before any narration)
        audioSplits.push({
          type: 'silence_buffer',
          durationSec: silenceDur,
          element: current
        });
        chunkSectionIdx++;
        if (nextNarr) {
          const nextStart = nextNarr.firstWordStart !== undefined ? nextNarr.firstWordStart : (nextNarr.speech_start !== undefined ? nextNarr.speech_start : nextNarr.start);
          lastCutTime = Math.max(0.0, Number((nextStart - 0.040).toFixed(3)));
        }
      }
    }
  }

  // Trailing narration after last visual_only
  if (totalRawAudioDur > lastCutTime + 0.050) {
    audioSplits.push({
      type: 'audio_chunk',
      sectionIndex: chunkSectionIdx,
      startSec: Number(lastCutTime.toFixed(3)),
      endSec: Number(totalRawAudioDur.toFixed(3))
    });
    lastCutTime = totalRawAudioDur;
  }

  // Calculate cumulative splicedStart & splicedEnd for precise timestamp mapping
  let currentSplicedClock = 0.0;
  for (let j = 0; j < audioSplits.length; j++) {
    const item = audioSplits[j];
    if (item.type === 'audio_chunk') {
      item.splicedStart = Number(currentSplicedClock.toFixed(3));
      item.splicedEnd = Number((currentSplicedClock + (item.endSec - item.startSec)).toFixed(3));
      currentSplicedClock = item.splicedEnd;
    } else {
      item.splicedStart = Number(currentSplicedClock.toFixed(3));
      item.splicedEnd = Number((currentSplicedClock + item.durationSec).toFixed(3));
      currentSplicedClock = item.splicedEnd;
    }
  }

  return { audioSplits, totalSplicedDuration: Number(currentSplicedClock.toFixed(3)) };
}

/**
 * Re-maps all elements and word timestamps onto the spliced audio timeline.
 */
function mapElementsToSplicedTimeline(alignedElements, audioSplits, audioSpliced, opts = {}) {
  const finalItems = [];
  let clockSec = 0.0;
  let sourceVideoClock = 15.0;

  for (let i = 0; i < alignedElements.length; i++) {
    const current = alignedElements[i];
    const sentenceIndex = i;
    const itemId = i + 1;

    if (current.type === 'visual_only') {
      const silenceItem = audioSplits.find(s => s.type === 'silence_buffer' && s.element === current);
      const start = (audioSpliced && silenceItem)
        ? silenceItem.splicedStart
        : Number(clockSec.toFixed(3));
      const duration = (audioSpliced && silenceItem)
        ? Number((silenceItem.splicedEnd - silenceItem.splicedStart).toFixed(3))
        : Number((current.duration || 5.0).toFixed(3));
      const end = (audioSpliced && silenceItem)
        ? silenceItem.splicedEnd
        : Number((start + duration).toFixed(3));

      clockSec = end;

      const m1 = Math.floor(start / 60); const s1 = Math.floor(start % 60);
      const m2 = Math.floor(end / 60); const s2 = Math.floor(end % 60);
      const tsMin = `${String(m1).padStart(2, '0')}:${String(s1).padStart(2, '0')} - ${String(m2).padStart(2, '0')}:${String(s2).padStart(2, '0')}`;

      const entry = {
        id: itemId,
        sentence_index: sentenceIndex,
        start_seconds: start,
        end_seconds: end,
        start,
        end,
        duration,
        timestamp_minute: tsMin,
        text: current.text,
        type: 'visual_only',
        speaker: 'Visual',
        description: current.description,
        sourceRange: current.sourceRange,
        sourceStartSeconds: current.sourceStartSeconds,
        sourceEndSeconds: current.sourceEndSeconds,
      };

      if (opts.generateTestVisuals || current.visuals) {
        if (current.visuals) {
          entry.visuals = current.visuals;
        } else {
          const clip1Dur = Number((duration * 0.5).toFixed(3));
          const clip2Dur = Number((duration - clip1Dur).toFixed(3));
          entry.visuals = [
            { type: 'video_cut', duration: clip1Dur, source_start_seconds: Number(sourceVideoClock.toFixed(1)), color_grading_shift: { contrast: 1.06, brightness: 0.005, saturation: 1.06 } },
            { type: 'video_cut', duration: clip2Dur, source_start_seconds: Number((sourceVideoClock + 25.0).toFixed(1)), color_grading_shift: { contrast: 1.05, brightness: 0.004, saturation: 1.05 } }
          ];
          sourceVideoClock += 35.0;
        }
      }

      finalItems.push(entry);
    } else {
      const origStart = current.start !== undefined ? current.start : 0;
      const origEnd = current.end !== undefined ? current.end : (origStart + 3.0);
      const rawDuration = Math.max(0.2, Number((origEnd - origStart).toFixed(3)));

      let start = 0.0;
      let end = 0.0;
      let mappedWords = [];

      if (audioSpliced && audioSplits.length > 0) {
        let matchingChunk = audioSplits.find(item => item.type === 'audio_chunk' && item.sectionIndex === current.sectionIndex);
        if (!matchingChunk) {
          matchingChunk = audioSplits.find(item => item.type === 'audio_chunk' && origStart >= item.startSec && origStart <= item.endSec)
            || audioSplits.filter(item => item.type === 'audio_chunk').find(item => origStart <= item.endSec)
            || audioSplits.filter(item => item.type === 'audio_chunk').pop();
        }

        if (matchingChunk) {
          const offset = Math.max(0, origStart - matchingChunk.startSec);
          start = Number((matchingChunk.splicedStart + offset).toFixed(3));
          end = Number((start + rawDuration).toFixed(3));

          // Offset words
          if (Array.isArray(current.words) && current.words.length > 0) {
            mappedWords = current.words.map(w => {
              const wOrigStart = typeof w.start === 'number' ? w.start : origStart;
              const wOrigEnd = typeof w.end === 'number' ? w.end : origEnd;
              const wOffset = Math.max(0, wOrigStart - matchingChunk.startSec);
              const wDur = Math.max(0.01, wOrigEnd - wOrigStart);
              const wStart = Number((matchingChunk.splicedStart + wOffset).toFixed(3));
              const wEnd = Number((wStart + wDur).toFixed(3));
              return {
                word: w.word || w.text || '',
                start: wStart,
                end: wEnd
              };
            });
          }
        } else {
          start = Number(clockSec.toFixed(3));
          end = Number((start + rawDuration).toFixed(3));
        }
      } else {
        start = Number((current.start !== undefined ? current.start : clockSec).toFixed(3));
        end = Number((current.end !== undefined ? current.end : (start + rawDuration)).toFixed(3));
        mappedWords = Array.isArray(current.words) ? current.words : [];
      }

      clockSec = Math.max(clockSec, end);

      const m1 = Math.floor(start / 60); const s1 = Math.floor(start % 60);
      const m2 = Math.floor(end / 60); const s2 = Math.floor(end % 60);
      const tsMin = `${String(m1).padStart(2, '0')}:${String(s1).padStart(2, '0')} - ${String(m2).padStart(2, '0')}:${String(s2).padStart(2, '0')}`;

      const entry = {
        id: itemId,
        sentence_index: sentenceIndex,
        start_seconds: start,
        end_seconds: end,
        start,
        end,
        duration: rawDuration,
        timestamp_minute: tsMin,
        text: current.text,
        type: 'narration',
        speaker: 'Narator',
        words: mappedWords
      };

      if (opts.generateTestVisuals || current.visuals) {
        if (current.visuals) {
          entry.visuals = current.visuals;
        } else {
          entry.visuals = [
            { type: 'video_cut', duration: rawDuration, source_start_seconds: Number(sourceVideoClock.toFixed(1)), color_grading_shift: { contrast: 1.04, brightness: 0.003, saturation: 1.04 } }
          ];
          sourceVideoClock += 12.0;
        }
      }

      finalItems.push(entry);
    }
  }

  return finalItems;
}

/**
 * Slices raw audio chunks and inserts silence buffers via FFmpeg, outputting a lossless WAV file.
 */
async function executeFfmpegSplicing({
  audioPath,
  audioSplits,
  outputPath,
  ffmpegPath,
  tempDir,
  sendProgress
}) {
  const timestamp = Date.now();
  const tempFiles = [];

  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  try {
    if (sendProgress) {
      sendProgress('splicing_audio', 85, `Memotong ${audioSplits.filter(s => s.type === 'audio_chunk').length} segmen suara & menyisipkan ${audioSplits.filter(s => s.type === 'silence_buffer').length} jeda hening...`);
    }

    for (let i = 0; i < audioSplits.length; i++) {
      const item = audioSplits[i];
      const tempChunkPath = path.join(tempDir, `temp_chunk_${timestamp}_${i}.wav`);
      tempFiles.push(tempChunkPath);

      if (item.type === 'audio_chunk') {
        const ss = Math.max(0, item.startSec);
        const to = Math.max(ss + 0.01, item.endSec);
        const dur = Number((to - ss).toFixed(3));

        await new Promise((resolve, reject) => {
          const args = [
            '-i', audioPath,
            '-ss', String(ss),
            '-t', String(dur),
            '-ar', '44100',
            '-ac', '2',
            '-c:a', 'pcm_s16le',
            '-y',
            tempChunkPath
          ];
          const proc = spawn(ffmpegPath, args);
          proc.on('close', (code) => code === 0 && fs.existsSync(tempChunkPath) ? resolve() : reject(new Error(`FFmpeg slice error ${code}`)));
          proc.on('error', reject);
        });
      } else {
        const silenceDur = Number((item.durationSec || 5.0).toFixed(3));
        await new Promise((resolve, reject) => {
          const args = [
            '-f', 'lavfi',
            '-i', 'anullsrc=r=44100:cl=stereo',
            '-t', String(silenceDur),
            '-ar', '44100',
            '-ac', '2',
            '-c:a', 'pcm_s16le',
            '-y',
            tempChunkPath
          ];
          const proc = spawn(ffmpegPath, args);
          proc.on('close', (code) => code === 0 && fs.existsSync(tempChunkPath) ? resolve() : reject(new Error(`FFmpeg silence error ${code}`)));
          proc.on('error', reject);
        });
      }
    }

    // Concatenate using FFmpeg concat demuxer (lossless PCM copy)
    const listFilePath = path.join(tempDir, `concat_list_${timestamp}.txt`);
    const listContent = tempFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listFilePath, listContent, 'utf-8');

    await new Promise((resolve, reject) => {
      const args = [
        '-f', 'concat',
        '-safe', '0',
        '-i', listFilePath,
        '-ar', '44100',
        '-ac', '2',
        '-c:a', 'pcm_s16le',
        '-y',
        outputPath
      ];
      const proc = spawn(ffmpegPath, args);
      proc.on('close', (code) => code === 0 && fs.existsSync(outputPath) ? resolve() : reject(new Error(`FFmpeg concat error ${code}`)));
      proc.on('error', reject);
    });

    try { fs.unlinkSync(listFilePath); } catch { }
  } finally {
    for (const f of tempFiles) {
      try { fs.unlinkSync(f); } catch { }
    }
  }
}

/**
 * Tokenize text into lowercase alphanumeric words for robust text matching.
 */
function cleanWords(txt) {
  return (txt || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Matches manual transcript entries with script visual only tags.
 * If transcriptEntries already contains visual only elements, maps them directly.
 */
/**
 * Matches manual transcript entries with script visual only tags dynamically based on
 * the sentences/words immediately before and after each tag in the script text.
 * No static stopwords or hardcoded word lengths are used.
 */
function matchTranscriptWithScriptVisualOnly(transcriptEntries, scriptText) {
  // Check if transcript entries already contain visual_only tags
  const hasExistingVisual = transcriptEntries.some(t =>
    t.type === 'visual_only' ||
    /\[VISUAL_ONLY/i.test(t.text || '') ||
    (t.speaker && /visual/i.test(t.speaker))
  );

  if (hasExistingVisual) {
    let secCounter = 0;
    return transcriptEntries.map((t) => {
      const isVis = t.type === 'visual_only' || /\[VISUAL_ONLY/i.test(t.text || '') || (t.speaker && /visual/i.test(t.speaker));
      if (isVis) {
        secCounter++;
        const parsedVis = parseVisualOnlyTag(t.text);
        const dur = parsedVis.outputDuration || t.duration || 5.0;
        return {
          type: 'visual_only',
          text: t.text || `[VISUAL_ONLY (Range: ${parsedVis.sourceRange}, Duration: ${dur}s): ${parsedVis.description}]`,
          description: parsedVis.description,
          duration: dur,
          outputDuration: dur,
          sourceRange: parsedVis.sourceRange,
          sourceStartSeconds: parsedVis.sourceStartSeconds,
          sourceEndSeconds: parsedVis.sourceEndSeconds,
          sectionIndex: secCounter
        };
      }
      return {
        type: 'narration',
        text: t.text,
        start: t.start_seconds !== undefined ? t.start_seconds : t.start,
        end: t.end_seconds !== undefined ? t.end_seconds : t.end,
        speech_start: t.start_seconds !== undefined ? t.start_seconds : t.start,
        speech_end: t.end_seconds !== undefined ? t.end_seconds : t.end,
        firstWordStart: t.start_seconds !== undefined ? t.start_seconds : t.start,
        lastWordEnd: t.end_seconds !== undefined ? t.end_seconds : t.end,
        speaker: t.speaker || 'Narator',
        sectionIndex: secCounter,
        words: t.words || []
      };
    });
  }

  // Extract all [VISUAL_ONLY...] tags and their surrounding text in scriptText
  const tagRegex = /\[VISUAL_ONLY[^\]]*\]/gi;
  let match;
  let lastIndex = 0;
  const visualOnlyTags = [];

  while ((match = tagRegex.exec(scriptText || '')) !== null) {
    const beforeText = (scriptText || '').slice(lastIndex, match.index).trim();
    const tagStr = match[0];
    const afterStart = tagRegex.lastIndex;
    const nextMatch = (scriptText || '').indexOf('[VISUAL_ONLY', afterStart);
    const afterText = (nextMatch !== -1 ? (scriptText || '').slice(afterStart, nextMatch) : (scriptText || '').slice(afterStart)).trim();

    const parsedVis = parseVisualOnlyTag(tagStr);

    visualOnlyTags.push({
      element: {
        type: 'visual_only',
        text: `[VISUAL_ONLY (Range: ${parsedVis.sourceRange}, Duration: ${parsedVis.outputDuration}s): ${parsedVis.description}]`,
        description: parsedVis.description,
        duration: parsedVis.outputDuration,
        outputDuration: parsedVis.outputDuration,
        sourceRange: parsedVis.sourceRange,
        sourceStartSeconds: parsedVis.sourceStartSeconds,
        sourceEndSeconds: parsedVis.sourceEndSeconds
      },
      beforeText,
      afterText,
      beforeWords: cleanWords(beforeText),
      afterWords: cleanWords(afterText)
    });

    lastIndex = tagRegex.lastIndex;
  }

  if (visualOnlyTags.length === 0) {
    return transcriptEntries.map(t => ({
      type: 'narration',
      text: t.text,
      start: t.start_seconds !== undefined ? t.start_seconds : t.start,
      end: t.end_seconds !== undefined ? t.end_seconds : t.end,
      speech_start: t.start_seconds !== undefined ? t.start_seconds : t.start,
      speech_end: t.end_seconds !== undefined ? t.end_seconds : t.end,
      firstWordStart: t.start_seconds !== undefined ? t.start_seconds : t.start,
      lastWordEnd: t.end_seconds !== undefined ? t.end_seconds : t.end,
      speaker: t.speaker || 'Narator',
      sectionIndex: 0,
      words: t.words || []
    }));
  }

  // Pre-split any transcript entry if both the boundary word before and word after occur in that single entry
  let workingEntries = [...transcriptEntries];
  for (const vt of visualOnlyTags) {
    const lastTailWord = vt.beforeWords.length > 0 ? vt.beforeWords[vt.beforeWords.length - 1] : null;
    const firstHeadWord = vt.afterWords.length > 0 ? vt.afterWords[0] : null;
    if (!lastTailWord || !firstHeadWord) continue;

    for (let i = 0; i < workingEntries.length; i++) {
      const entry = workingEntries[i];
      if (entry.type === 'visual_only') continue;
      const lower = (entry.text || '').toLowerCase();
      const regex = new RegExp(`\\b${lastTailWord}([.!?,;:]?\\s+)${firstHeadWord}\\b`, 'i');
      const m = lower.match(regex);
      if (m && m.index !== undefined) {
        const splitPos = m.index + lastTailWord.length + (m[1].startsWith('.') || m[1].startsWith('!') || m[1].startsWith('?') ? 1 : 0);
        if (splitPos > 5 && splitPos < entry.text.length - 5) {
          const textA = entry.text.slice(0, splitPos).trim();
          const textB = entry.text.slice(splitPos).trim();
          const totalDur = Math.max(0.1, (entry.end_seconds || 0) - (entry.start_seconds || 0));
          const ratio = Math.max(0.1, Math.min(0.9, textA.length / entry.text.length));
          const splitTime = Number(((entry.start_seconds || 0) + totalDur * ratio).toFixed(3));

          const entryA = { ...entry, text: textA, end_seconds: splitTime, end: splitTime };
          const entryB = { ...entry, text: textB, start_seconds: splitTime, start: splitTime };

          workingEntries.splice(i, 1, entryA, entryB);
          break;
        }
      }
    }
  }
  transcriptEntries = workingEntries;

  // Match each visual_only tag sequentially using dynamic sliding-window anchor matching
  const matchedBoundaries = [];
  let minBoundary = 0;

  for (let vIdx = 0; vIdx < visualOnlyTags.length; vIdx++) {
    const vt = visualOnlyTags[vIdx];
    let bestScore = -1;
    let bestK = minBoundary;

    const tailAnchor = vt.beforeWords.slice(-8);
    const headAnchor = vt.afterWords.slice(0, 8);

    for (let k = minBoundary; k < transcriptEntries.length; k++) {
      const windowBefore = cleanWords(transcriptEntries.slice(Math.max(0, k - 2), k + 1).map(e => e.text).join(' '));
      const windowAfter = cleanWords(transcriptEntries.slice(k + 1, Math.min(transcriptEntries.length, k + 4)).map(e => e.text).join(' '));

      let beforeScore = 0;
      const tailAnchorSlice = tailAnchor.slice(-4);
      const windowBeforeTail = windowBefore.slice(-6);
      for (const w of tailAnchorSlice) {
        if (windowBeforeTail.includes(w)) beforeScore++;
      }

      let afterScore = 0;
      const headAnchorSlice = headAnchor.slice(0, 4);
      const windowAfterHead = windowAfter.slice(0, 6);
      for (const w of headAnchorSlice) {
        if (windowAfterHead.includes(w)) afterScore++;
      }

      const totalScore = beforeScore + afterScore;
      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestK = k;
      }
    }

    matchedBoundaries.push({
      afterTranscriptIndex: bestK,
      visualElement: vt.element
    });
    minBoundary = bestK + 1;
  }

  const alignedElements = [];
  let secCounter = 0;

  for (let i = 0; i < transcriptEntries.length; i++) {
    const t = transcriptEntries[i];
    alignedElements.push({
      type: 'narration',
      text: t.text,
      start: t.start_seconds !== undefined ? t.start_seconds : t.start,
      end: t.end_seconds !== undefined ? t.end_seconds : t.end,
      speech_start: t.start_seconds !== undefined ? t.start_seconds : t.start,
      speech_end: t.end_seconds !== undefined ? t.end_seconds : t.end,
      firstWordStart: t.start_seconds !== undefined ? t.start_seconds : t.start,
      lastWordEnd: t.end_seconds !== undefined ? t.end_seconds : t.end,
      speaker: t.speaker || 'Narator',
      sectionIndex: secCounter,
      words: t.words || []
    });

    const scheduled = matchedBoundaries.filter(m => m.afterTranscriptIndex === i);
    for (const item of scheduled) {
      secCounter++;
      alignedElements.push({
        ...item.visualElement,
        sectionIndex: secCounter
      });
    }
  }

  return alignedElements;
}

/**
 * End-to-end workflow for processing manual transcript and splicing audio.
 */
async function processManualTranscriptWorkflow({
  contentId,
  part,
  rawTranscriptText,
  sendProgress,
  ffmpeg,
  paths: p,
  media
}) {
  const log = (stage, prog, msg) => {
    if (sendProgress) sendProgress(stage, prog, msg);
  };

  log('preparing', 10, `Parsing raw transcript untuk Part #${part}...`);

  let transcriptEntries = parseSrtToEntries(rawTranscriptText);
  if (!transcriptEntries || transcriptEntries.length === 0) {
    throw new Error('Gagal membaca format transkrip. Pastikan format timestamp valid (00:00:00,140 --> 00:00:33,260 [Speaker 0]).');
  }

  log('preparing', 25, `Berhasil membaca ${transcriptEntries.length} baris kalimat dari transkrip.`);

  // Load Step 2 script analysis
  const partStr = String(part).padStart(2, '0');
  let scriptText = '';
  const searchDirs = [p.ALURFILM_DIR, path.join(p.ALURFILM_DIR, 'analysis')].filter(Boolean);
  for (const d of searchDirs) {
    const p1 = path.join(d, `${contentId}_analysis_part_${partStr}.json`);
    const p2 = path.join(d, `${contentId}_analysis_part_${part}.json`);
    if (fs.existsSync(p1)) {
      try {
        const data = JSON.parse(fs.readFileSync(p1, 'utf-8'));
        scriptText = data.naskah_voiceover?.script_text || data.script_text || '';
        break;
      } catch { }
    } else if (fs.existsSync(p2)) {
      try {
        const data = JSON.parse(fs.readFileSync(p2, 'utf-8'));
        scriptText = data.naskah_voiceover?.script_text || data.script_text || '';
        break;
      } catch { }
    }
  }

  log('mapping', 40, `Mencocokkan posisi [VISUAL_ONLY] dengan naskah acuan Step 2...`);
  const alignedElements = matchTranscriptWithScriptVisualOnly(transcriptEntries, scriptText);
  const visualGaps = alignedElements.filter(el => el.type === 'visual_only');

  log('mapping', 50, `Terdeteksi ${visualGaps.length} adegan Visual-Only pada Part #${part}.`);

  // Resolve target raw audio
  let targetAudioPath = null;
  const mappingFile = path.join(p.ALURFILM_AUDIO_DIR, `${contentId}_audio_mappings.json`);
  let targetAudioEntry = null;

  if (fs.existsSync(mappingFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(mappingFile, 'utf-8'));
      targetAudioEntry = (data.audios || []).find(item => item.parts && item.parts.includes(part));
    } catch { }
  }

  if (targetAudioEntry) {
    const candidate = targetAudioEntry.rawFilePath || targetAudioEntry.originalFilePath;
    if (candidate && fs.existsSync(candidate)) {
      targetAudioPath = candidate;
    } else if (targetAudioEntry.filePath && fs.existsSync(targetAudioEntry.filePath)) {
      targetAudioPath = targetAudioEntry.filePath;
    }
  }

  let finalPartAudioPath = targetAudioPath;
  let audioSplits = [];
  let audioSpliced = false;
  const timestamp = Date.now();

  if (visualGaps.length > 0 && targetAudioPath && fs.existsSync(targetAudioPath)) {
    log('splicing_audio', 65, `Menghitung titik potong audio raw (${path.basename(targetAudioPath)})...`);
    const audioMeta = await ffmpeg.getVideoMetaHelper(targetAudioPath);
    const totalRawAudioDur = (audioMeta && audioMeta.duration) ? audioMeta.duration : (transcriptEntries[transcriptEntries.length - 1].end_seconds + 5.0);

    const splitResult = calculateAudioSplits(alignedElements, totalRawAudioDur);
    audioSplits = splitResult.audioSplits;

    if (audioSplits.length > 0) {
      const outputSplicedName = `${contentId}_audio_part_${partStr}_spliced_${timestamp}.wav`;
      const splicedOutPath = path.join(p.ALURFILM_AUDIO_DIR, outputSplicedName);

      log('splicing_audio', 75, `Memotong audio raw & menyisipkan ${visualGaps.length} jeda hening...`);
      await executeFfmpegSplicing({
        audioPath: targetAudioPath,
        audioSplits,
        outputPath: splicedOutPath,
        ffmpegPath: ffmpeg.ffmpegPath,
        tempDir: p.ALURFILM_AUDIO_DIR,
        sendProgress: (stage, prog, msg) => log(stage, prog, `Part #${part}: ${msg}`)
      });

      if (fs.existsSync(splicedOutPath)) {
        finalPartAudioPath = splicedOutPath;
        audioSpliced = true;

        if (fs.existsSync(mappingFile)) {
          try {
            const mapData = JSON.parse(fs.readFileSync(mappingFile, 'utf-8'));
            if (Array.isArray(mapData.audios)) {
              const audioItem = mapData.audios.find(item => item.parts && item.parts.includes(part));
              if (audioItem) {
                const splicedStat = fs.statSync(splicedOutPath);
                if (!audioItem.rawFilePath) {
                  audioItem.rawFilePath = targetAudioPath;
                }
                if (!audioItem.originalFilePath) {
                  audioItem.originalFilePath = targetAudioPath;
                }
                audioItem.filePath = splicedOutPath;
                audioItem.name = outputSplicedName;
                audioItem.url = media ? media.mediaUrl(splicedOutPath) : '';
                audioItem.size = splicedStat.size;
                audioItem.isSpliced = true;
                audioItem.splicedFilePath = splicedOutPath;
                audioItem.splicedAt = new Date().toISOString();
                fs.writeFileSync(mappingFile, JSON.stringify(mapData, null, 2), 'utf-8');
              }
            }
          } catch (mapErr) {
            console.warn(`Part #${part}: Failed to update audio mapping:`, mapErr.message);
          }
        }
      }
    }
  }

  log('mapping', 90, `Memetakan timeline akhir 1:1 sinkron...`);
  const finalEntries = mapElementsToSplicedTimeline(alignedElements, audioSplits, audioSpliced);

  // Save transcript JSON
  const targetDir = p.ALURFILM_TRANSCRIPTS_DIR || path.join(p.ALURFILM_DIR, 'transcripts');
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const outputName = `${contentId}_transcript_part_${partStr}.json`;
  const destPath = path.join(targetDir, outputName);
  fs.writeFileSync(destPath, JSON.stringify(finalEntries, null, 2), 'utf-8');

  // Also clean any legacy file in ALURFILM_DIR root
  const rootLegacyPath = path.join(p.ALURFILM_DIR, outputName);
  if (fs.existsSync(rootLegacyPath)) {
    try { fs.unlinkSync(rootLegacyPath); } catch { }
  }

  log('done', 100, `Selesai! Part #${part} berhasil diproses (${finalEntries.length} baris, ${visualGaps.length} Visual Only).`);

  return {
    success: true,
    part,
    name: outputName,
    filePath: destPath,
    data: finalEntries,
    entries: finalEntries,
    audioSpliced,
    splicedAudioPath: finalPartAudioPath
  };
}

module.exports = {
  parseVisualOnlyTag,
  parseScriptToElements,
  alignWhisperToElements,
  calculateAudioSplits,
  mapElementsToSplicedTimeline,
  executeFfmpegSplicing,
  cleanWords,
  matchTranscriptWithScriptVisualOnly,
  processManualTranscriptWorkflow,
};
