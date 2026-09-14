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

      const silenceDur = Number((current.duration || 5.0).toFixed(3));

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

module.exports = {
  parseVisualOnlyTag,
  parseScriptToElements,
  alignWhisperToElements,
  calculateAudioSplits,
  mapElementsToSplicedTimeline,
  executeFfmpegSplicing,
};
