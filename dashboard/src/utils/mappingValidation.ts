export const VALID_VISUAL_TYPES = [
  'video_cut',
  'slow_motion',
  'freeze_frame',
  'freeze_zoom_outro',
  'freeze_frame_with_zoom',
  'mirror_cut',
];

export interface VisualClipSpec {
  type: 'video_cut' | 'slow_motion' | 'freeze_frame' | 'freeze_zoom_outro' | 'freeze_frame_with_zoom' | 'mirror_cut' | string;
  duration: number;
  source_start_seconds?: number;
  source_timestamp_seconds?: number;
  slow_mo_factor?: number;
  mirror_mode?: string;
  zoom_speed?: number;
  pan_direction?: string;
  color_grading_shift?: {
    mode?: string;
    contrast?: number;
    brightness?: number;
    saturation?: number;
    gamma?: number;
  };
}

export interface CharacterOverlaySpec {
  name: string;
  role?: string;
  position?: 'left' | 'center' | 'right';
}

export interface SentenceMapping {
  sentence_index: number;
  text: string;
  start: number;
  end: number;
  duration: number;
  scene_transition?: string | { type?: string; duration?: number } | null;
  character_overlay?: CharacterOverlaySpec | null;
  visuals: VisualClipSpec[];
}

export interface AlurfilmMappingData {
  scene_id?: string;
  mappings: SentenceMapping[];
  status?: string;
}

export type MappingIssueType =
  | 'DURATION_MISMATCH'
  | 'MISSING_VISUALS'
  | 'INVALID_CLIP_DURATION'
  | 'INVALID_SOURCE_TIME'
  | 'TRANSCRIPT_SYNC_ERROR'
  | 'FAIR_USE_VARIETY_WARNING'
  | 'SAMPLING_GAP_WARNING'
  | 'EMPTY_MAPPING';

export interface MappingValidationIssue {
  id: string;
  type: MappingIssueType;
  severity: 'error' | 'warning';
  sentenceIndex: number | null; // 0-indexed or 1-indexed sentence number
  clipIndex?: number | null;
  message: string;
  details?: string;
  fixable: boolean;
}

export interface MappingValidationReport {
  isValid: boolean;
  status: 'SUCCESS' | 'WARNING' | 'ERROR';
  sentenceCount: number;
  totalVisualClips: number;
  totalMappingDuration: number;
  issues: MappingValidationIssue[];
  errorCount: number;
  warningCount: number;
  summaryText: string;
}

/**
 * Validates Alur Film Video Mapping JSON data against sentence VO durations & transcript metadata
 */
export function validateAlurfilmMapping(
  data: AlurfilmMappingData | null | undefined,
  transcriptEntries: Array<{ start_seconds: number; end_seconds: number; text: string }> | null | undefined = null
): MappingValidationReport {
  const issues: MappingValidationIssue[] = [];

  if (!data || !data.mappings || !Array.isArray(data.mappings) || data.mappings.length === 0) {
    issues.push({
      id: 'empty-mapping',
      type: 'EMPTY_MAPPING',
      severity: 'error',
      sentenceIndex: null,
      message: 'Belum ada data Video Mapping (JSON mappings kosong)',
      fixable: false,
    });

    return {
      isValid: false,
      status: 'ERROR',
      sentenceCount: 0,
      totalVisualClips: 0,
      totalMappingDuration: 0,
      issues,
      errorCount: 1,
      warningCount: 0,
      summaryText: 'Belum ada data mapping',
    };
  }

  const mappings = data.mappings;
  const sentenceCount = mappings.length;
  let totalVisualClips = 0;
  let totalMappingDuration = 0;

  const effectTypeCounts: Record<string, number> = {};
  const allClipsFlat: Array<{
    sentenceIndex: number;
    clipIndex: number;
    type: string;
    sourceStart: number;
    rawDur: number;
    isMirrored: boolean;
    isSlowMo: boolean;
    slowMoFactor?: number;
  }> = [];

  mappings.forEach((sentence, idx) => {
    const sNum = sentence.sentence_index ?? idx;
    const voDuration = typeof sentence.duration === 'number'
      ? sentence.duration
      : (typeof sentence.end === 'number' && typeof sentence.start === 'number' ? sentence.end - sentence.start : 0);

    totalMappingDuration += voDuration;

    // 1. Check if visuals array exists and non-empty
    if (!sentence.visuals || !Array.isArray(sentence.visuals) || sentence.visuals.length === 0) {
      issues.push({
        id: `missing-visuals-${sNum}`,
        type: 'MISSING_VISUALS',
        severity: 'error',
        sentenceIndex: sNum,
        message: `Kalimat #${sNum}: Belum memiliki klip visual di array "visuals".`,
        fixable: true,
      });
      return;
    }

    totalVisualClips += sentence.visuals.length;

    // 2. Calculate visual clips total duration
    let sumVisualsDuration = 0;
    sentence.visuals.forEach((clip, clipIdx) => {
      const cDur = typeof clip.duration === 'number' ? clip.duration : 0;
      sumVisualsDuration += cDur;

      if (clip.type) {
        effectTypeCounts[clip.type] = (effectTypeCounts[clip.type] || 0) + 1;
      }

      if (!clip.type || !VALID_VISUAL_TYPES.includes(clip.type)) {
        issues.push({
          id: `invalid-clip-type-${sNum}-${clipIdx}`,
          type: 'INVALID_CLIP_DURATION',
          severity: 'error',
          sentenceIndex: sNum,
          clipIndex: clipIdx,
          message: `Kalimat #${sNum} klip #${clipIdx + 1}: Tipe visual "${clip.type}" tidak didukung FFmpeg rendering schema.`,
          details: `Gunakan salah satu dari: ${VALID_VISUAL_TYPES.join(', ')}`,
          fixable: true,
        });
      }

      if (cDur <= 0 || isNaN(cDur)) {
        issues.push({
          id: `invalid-clip-dur-${sNum}-${clipIdx}`,
          type: 'INVALID_CLIP_DURATION',
          severity: 'error',
          sentenceIndex: sNum,
          clipIndex: clipIdx,
          message: `Kalimat #${sNum} klip #${clipIdx + 1}: Durasi klip tidak valid (${cDur}s).`,
          fixable: true,
        });
      } else if (clip.type === 'slow_motion' && cDur > 9.0) {
        issues.push({
          id: `long-slowmo-dur-${sNum}-${clipIdx}`,
          type: 'INVALID_CLIP_DURATION',
          severity: 'warning',
          sentenceIndex: sNum,
          clipIndex: clipIdx,
          message: `Kalimat #${sNum} klip #${clipIdx + 1}: Durasi slow motion sangat panjang (${cDur.toFixed(1)}s > 9.0s).`,
          details: 'Disarankan membagi menjadi 2 klip dengan sudut berbeda agar penonton tetap antusias.',
          fixable: false,
        });
      } else if ((clip.type === 'video_cut' || clip.type === 'mirror_cut') && cDur > 2.05) {
        issues.push({
          id: `long-raw-cut-dur-${sNum}-${clipIdx}`,
          type: 'INVALID_CLIP_DURATION',
          severity: 'warning',
          sentenceIndex: sNum,
          clipIndex: clipIdx,
          message: `Kalimat #${sNum} klip #${clipIdx + 1}: Durasi potongan raw melebihi batas aman maksimal 2.0 detik (${cDur.toFixed(1)}s > 2.0s).`,
          details: 'Gunakan slow_motion atau batasi video_cut/mirror_cut maksimal 2.0 detik agar kebal deteksi Content ID.',
          fixable: false,
        });
      } else if (clip.type === 'slow_motion') {
        const factor = typeof clip.slow_mo_factor === 'number' && clip.slow_mo_factor > 0 ? clip.slow_mo_factor : 0.35;
        const rawDur = cDur * factor;
        if (rawDur > 2.05) {
          issues.push({
            id: `long-slowmo-raw-dur-${sNum}-${clipIdx}`,
            type: 'INVALID_CLIP_DURATION',
            severity: 'warning',
            sentenceIndex: sNum,
            clipIndex: clipIdx,
            message: `Kalimat #${sNum} klip #${clipIdx + 1}: Konsumsi raw slow motion melebihi batas aman 2.0 detik (${rawDur.toFixed(1)}s raw > 2.0s).`,
            details: 'Perkecil faktor slow_mo atau perpendek durasi timeline agar raw footage tetap <= 2.0 detik.',
            fixable: false,
          });
        }
        if (factor > 0.35) {
          issues.push({
            id: `slowmo-factor-too-fast-${sNum}-${clipIdx}`,
            type: 'FAIR_USE_VARIETY_WARNING',
            severity: 'warning',
            sentenceIndex: sNum,
            clipIndex: clipIdx,
            message: `Kalimat #${sNum} klip #${clipIdx + 1}: Faktor slow-mo (${factor}) kurang lambat untuk membongkar motion vector asli.`,
            details: 'Disarankan menggunakan faktor 0.18 - 0.28 (ultra slow-motion) agar video kebal dari deteksi YouTube Content ID.',
            fixable: false,
          });
        }
      } else if (cDur > 4.5 && clip.type !== 'slow_motion' && clip.type !== 'freeze_frame' && clip.type !== 'freeze_frame_with_zoom' && clip.type !== 'freeze_zoom_outro') {
        issues.push({
          id: `long-clip-dur-${sNum}-${clipIdx}`,
          type: 'INVALID_CLIP_DURATION',
          severity: 'warning',
          sentenceIndex: sNum,
          clipIndex: clipIdx,
          message: `Kalimat #${sNum} klip #${clipIdx + 1}: Durasi klip bergerak sangat panjang (${cDur.toFixed(1)}s > 4.5s).`,
          details: 'Disarankan menggunakan freeze_zoom_outro atau slow_motion agar alur visual bergerak dinamis & raw footage <= 2.0s.',
          fixable: false,
        });
      }

      // Check source timestamp / start seconds
      const sourceStart = clip.source_start_seconds ?? clip.source_timestamp_seconds;
      if (typeof sourceStart !== 'number' || isNaN(sourceStart) || sourceStart < 0) {
        if (clip.type !== 'freeze_frame' && clip.type !== 'freeze_frame_with_zoom' && clip.type !== 'freeze_zoom_outro') {
          issues.push({
            id: `invalid-source-time-${sNum}-${clipIdx}`,
            type: 'INVALID_SOURCE_TIME',
            severity: 'warning',
            sentenceIndex: sNum,
            clipIndex: clipIdx,
            message: `Kalimat #${sNum} klip #${clipIdx + 1}: source_start_seconds tidak valid.`,
            fixable: true,
          });
        }
      } else {
        const isMirrored = clip.mirror_mode === 'horizontal' || clip.type === 'mirror_cut';
        let rawDur = cDur;
        if (clip.type === 'slow_motion') {
          const f = typeof clip.slow_mo_factor === 'number' && clip.slow_mo_factor > 0 ? clip.slow_mo_factor : 0.25;
          rawDur = cDur * f;
        }
        allClipsFlat.push({
          sentenceIndex: sNum,
          clipIndex: clipIdx,
          type: clip.type,
          sourceStart,
          rawDur,
          isMirrored,
          isSlowMo: clip.type === 'slow_motion',
          slowMoFactor: clip.slow_mo_factor,
        });
      }
    });


    // 3. Compare visual duration sum vs sentence VO duration
    const diff = Math.abs(sumVisualsDuration - voDuration);
    if (diff > 0.15) {
      issues.push({
        id: `dur-mismatch-${sNum}`,
        type: 'DURATION_MISMATCH',
        severity: 'error',
        sentenceIndex: sNum,
        message: `Kalimat #${sNum}: Total durasi visual (${sumVisualsDuration.toFixed(2)}s) tidak cocok dengan durasi VO (${voDuration.toFixed(2)}s). Selisih ${Math.abs(sumVisualsDuration - voDuration).toFixed(2)}s.`,
        details: `Teks: "${(sentence.text || '').slice(0, 30)}..."`,
        fixable: true,
      });
    }

    // 4. Compare sentence duration with Transcript Step 3 if provided
    if (transcriptEntries && transcriptEntries[idx]) {
      const tsItem = transcriptEntries[idx];
      const tsDuration = tsItem.end_seconds - tsItem.start_seconds;
      if (Math.abs(voDuration - tsDuration) > 0.2) {
        issues.push({
          id: `ts-sync-mismatch-${sNum}`,
          type: 'TRANSCRIPT_SYNC_ERROR',
          severity: 'warning',
          sentenceIndex: sNum,
          message: `Kalimat #${sNum}: Durasi VO mapping (${voDuration.toFixed(1)}s) beda dengan Transkrip Step 3 (${tsDuration.toFixed(1)}s).`,
          fixable: true,
        });
      }
    }
  });

  // 4b. Check sampling gap across consecutive clips (Fix minimum: 5.0 seconds)
  for (let i = 1; i < allClipsFlat.length; i++) {
    const prev = allClipsFlat[i - 1];
    const curr = allClipsFlat[i];
    const step = curr.sourceStart - prev.sourceStart;
    const absStep = Math.abs(step);

    // Hard minimum 5.0s gap violation
    if (absStep < 5.0) {
      issues.push({
        id: `hard-min-gap-violation-${curr.sentenceIndex}-${curr.clipIndex}`,
        type: 'SAMPLING_GAP_WARNING',
        severity: 'warning',
        sentenceIndex: curr.sentenceIndex,
        clipIndex: curr.clipIndex,
        message: `Kalimat #${curr.sentenceIndex} klip #${curr.clipIndex + 1}: Jarak antar-klip terlalu dekat (${absStep.toFixed(1)}s < 5.0s). Jarak antar-klip mutlak minimal 5.0 detik fix!`,
        details: 'Jarak 5.0 detik adalah batas paling minimum absolut (lebih jauh seperti 10s-35s jauh lebih bagus). Dilarang selisih < 5.0 detik.',
        fixable: false,
      });
    } else if (step > 0 && (step < 5.0 || step > 8.0)) {
      issues.push({
        id: `sampling-gap-warning-${curr.sentenceIndex}-${curr.clipIndex}`,
        type: 'SAMPLING_GAP_WARNING',
        severity: 'warning',
        sentenceIndex: curr.sentenceIndex,
        clipIndex: curr.clipIndex,
        message: `Kalimat #${curr.sentenceIndex} klip #${curr.clipIndex + 1}: Sampling gap (${step.toFixed(1)}s) di luar formula ideal (5.0s - 7.0s).`,
        details: 'Gunakan formula lompatan gap 5.0 sampai 7.0 detik antar-klip agar alur video dinamis dan aman dari deteksi sekuens continuous YouTube Content ID.',
        fixable: false,
      });
    }
  }

  // 4c. Check for strictly monotonic linear forward runs (e.g. 1 -> 2 -> 3 -> 4)
  let linearRun = 1;
  for (let i = 1; i < allClipsFlat.length; i++) {
    const prev = allClipsFlat[i - 1];
    const curr = allClipsFlat[i];
    if (curr.sourceStart > prev.sourceStart && (curr.sourceStart - prev.sourceStart) < 45) {
      linearRun++;
      if (linearRun >= 4) {
        issues.push({
          id: `linear-run-${curr.sentenceIndex}-${curr.clipIndex}`,
          type: 'FAIR_USE_VARIETY_WARNING',
          severity: 'warning',
          sentenceIndex: curr.sentenceIndex,
          clipIndex: curr.clipIndex,
          message: `Terdeteksi 4+ klip maju linier berurutan (1 ➔ 2 ➔ 3 ➔ 4).`,
          details: 'Disarankan menyambung klip secara kreatif dan dinamis (misal klip 3 ➔ klip 1 ➔ klip 2) dengan retrograde jump mundur agar urutan sekuensial film hancur dari Content ID.',
          fixable: false,
        });
        linearRun = 1;
      }
    } else {
      linearRun = 1;
    }
  }

  // 5. Fair-use variety check (if total clips >= 4)
  if (totalVisualClips >= 4) {
    const usedTypes = Object.keys(effectTypeCounts);
    if (usedTypes.length === 1 && usedTypes[0] !== 'video_cut' && usedTypes[0] !== 'slow_motion') {
      issues.push({
        id: 'fair-use-single-type',
        type: 'FAIR_USE_VARIETY_WARNING',
        severity: 'warning',
        sentenceIndex: null,
        message: `Peringatan Fair-Use: Seluruh ${totalVisualClips} klip hanya menggunakan 1 tipe visual (${usedTypes[0]}). Disarankan memvariasikan tipe efek untuk bypass Content ID.`,
        fixable: false,
      });
    }

    const freezeCount = effectTypeCounts['freeze_frame_with_zoom'] || 0;
    if (freezeCount > 0) {
      issues.push({
        id: 'fair-use-freeze-frame-detected',
        type: 'FAIR_USE_VARIETY_WARNING',
        severity: 'warning',
        sentenceIndex: null,
        message: `Terdeteksi ${freezeCount} klip freeze frame (foto diam). Sesuai konfigurasi baru, disarankan 100% video bergerak (pure slow motion & dynamic cut) agar alur tidak kaku.`,
        fixable: false,
      });
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  let status: 'SUCCESS' | 'WARNING' | 'ERROR' = 'SUCCESS';
  if (errorCount > 0) {
    status = 'ERROR';
  } else if (warningCount > 0) {
    status = 'WARNING';
  }

  let summaryText = '✅ Video Mapping valid & 100% presisi sinkron';
  if (status === 'ERROR') {
    summaryText = `🔴 Terdeteksi ${errorCount} Error & ${warningCount} Warning Mapping`;
  } else if (status === 'WARNING') {
    summaryText = `⚠️ Terdeteksi ${warningCount} Peringatan Validasi Mapping`;
  }

  return {
    isValid: status === 'SUCCESS',
    status,
    sentenceCount,
    totalVisualClips,
    totalMappingDuration: Number(totalMappingDuration.toFixed(1)),
    issues,
    errorCount,
    warningCount,
    summaryText,
  };
}

/**
 * Auto-fixes Alur Film Video Mapping data (adjusts visual clip durations to match VO duration, creates default clips, re-syncs with transcript)
 */
export function autoFixAlurfilmMapping(
  data: AlurfilmMappingData | null | undefined,
  transcriptEntries: Array<{ start_seconds: number; end_seconds: number; text: string }> | null | undefined = null
): AlurfilmMappingData {
  if (!data || !data.mappings || !Array.isArray(data.mappings) || data.mappings.length === 0) {
    return data || { mappings: [] };
  }

  const fixed: AlurfilmMappingData = JSON.parse(JSON.stringify(data));

  fixed.mappings.forEach((sentence, idx) => {
    sentence.sentence_index = idx;

    // Step 1: Re-sync sentence start, end, and duration with transcript if available
    if (transcriptEntries && transcriptEntries[idx]) {
      const ts = transcriptEntries[idx];
      sentence.start = Number(ts.start_seconds.toFixed(2));
      sentence.end = Number(ts.end_seconds.toFixed(2));
      sentence.duration = Number((ts.end_seconds - ts.start_seconds).toFixed(2));
      if (!sentence.text) sentence.text = ts.text;
    } else {
      if (typeof sentence.start === 'number' && typeof sentence.end === 'number' && sentence.end > sentence.start) {
        sentence.duration = Number((sentence.end - sentence.start).toFixed(2));
      } else if (typeof sentence.duration !== 'number' || sentence.duration <= 0) {
        sentence.duration = 3.0;
        sentence.start = 0.0;
        sentence.end = 3.0;
      }
    }

    const targetVoDur = sentence.duration;

    // Step 2: Ensure visuals array exists
    if (!sentence.visuals || !Array.isArray(sentence.visuals) || sentence.visuals.length === 0) {
      sentence.visuals = [
        {
          type: 'slow_motion',
          duration: targetVoDur,
          source_start_seconds: Number((idx * 20.0).toFixed(1)),
          slow_mo_factor: 0.25,
          color_grading_shift: { mode: 'normal', contrast: 1.04, brightness: 0.005, saturation: 1.05, gamma: 1.0 },
        },
      ];
    } else {
      // Fix invalid clip fields & convert legacy freeze frames to pure slow-mo
      sentence.visuals.forEach((clip, cIdx) => {
        if (clip.type === 'freeze_frame_with_zoom') {
          clip.type = 'freeze_frame';
        }
        if (!clip.type || !VALID_VISUAL_TYPES.includes(clip.type)) {
          clip.type = 'video_cut';
        }
        if (typeof clip.duration !== 'number' || clip.duration <= 0 || isNaN(clip.duration)) {
          clip.duration = Number((targetVoDur / sentence.visuals.length).toFixed(2));
        }
        if (typeof clip.source_start_seconds !== 'number' || isNaN(clip.source_start_seconds) || clip.source_start_seconds < 0) {
          clip.source_start_seconds = Number((idx * 3.0 + cIdx * 2.0).toFixed(1));
        }
        if (!clip.color_grading_shift) {
          clip.color_grading_shift = { mode: 'normal', contrast: 1.04, brightness: 0.005, saturation: 1.05, gamma: 1.0 };
        } else {
          const raw = clip.color_grading_shift;
          const contrast = typeof raw.contrast === 'number' && !isNaN(raw.contrast)
            ? Math.max(0.5, Math.min(2.5, Number(raw.contrast.toFixed(3))))
            : 1.04;
          const brightness = typeof raw.brightness === 'number' && !isNaN(raw.brightness)
            ? Math.max(-0.5, Math.min(0.5, Number(raw.brightness.toFixed(3))))
            : 0.005;
          const saturation = typeof raw.saturation === 'number' && !isNaN(raw.saturation)
            ? Math.max(0.0, Math.min(3.0, Number(raw.saturation.toFixed(3))))
            : 1.05;
          const gamma = typeof raw.gamma === 'number' && !isNaN(raw.gamma)
            ? Math.max(0.5, Math.min(3.0, Number(raw.gamma.toFixed(3))))
            : 1.0;
          const mode = raw.mode || (gamma > 1.1 || brightness > 0.02 ? 'dark_boost' : 'normal');

          clip.color_grading_shift = { mode, contrast, brightness, saturation, gamma };
        }
      });

      // Adjust visual durations sum to match targetVoDur exactly
      let currentSum = sentence.visuals.reduce((acc, c) => acc + (c.duration || 0), 0);
      let diff = targetVoDur - currentSum;

      if (Math.abs(diff) > 0.01) {
        if (sentence.visuals.length === 1) {
          sentence.visuals[0].duration = Number(targetVoDur.toFixed(2));
        } else {
          // Adjust last clip duration
          const lastIdx = sentence.visuals.length - 1;
          const otherSum = sentence.visuals.slice(0, lastIdx).reduce((acc, c) => acc + (c.duration || 0), 0);
          const adjustedLastDur = Number((targetVoDur - otherSum).toFixed(2));
          if (adjustedLastDur > 0.3) {
            sentence.visuals[lastIdx].duration = adjustedLastDur;
          } else {
            // Distribute proportionally across all clips
            const scale = targetVoDur / (currentSum || 1);
            let running = 0;
            for (let i = 0; i < sentence.visuals.length - 1; i++) {
              const scaledDur = Number((sentence.visuals[i].duration * scale).toFixed(2));
              sentence.visuals[i].duration = scaledDur;
              running += scaledDur;
            }
            sentence.visuals[lastIdx].duration = Number((targetVoDur - running).toFixed(2));
          }
        }
      }
    }
  });

  return fixed;
}
