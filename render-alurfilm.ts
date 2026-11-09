// render-alurfilm.ts
import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { z } from 'zod';
import { runFFmpeg, runFFmpegProgress, getVideoMeta } from './cli/shared/ffmpeg-helpers.js';

const program = new Command();

program
  .name('render-alurfilm')
  .description('Dedicated 16:9 Alur Cerita Film FFmpeg Video Renderer')
  .version('1.0.0');

// ─── Zod Schema for Alurfilm Mapping ─────────────────────

const positiveDurationSchema = z.preprocess(
  (val) => (typeof val === 'number' && val <= 0 ? 0.1 : val),
  z.number().positive()
);

const VisualClipSchema = z.object({
  type: z.enum(['slow_motion', 'mirror_cut', 'freeze_frame_with_zoom', 'video_cut', 'pan_and_zoom_cut']).optional().default('video_cut'),
  duration: positiveDurationSchema,
  source_start_seconds: z.number().min(0).optional(),
  source_timestamp_seconds: z.number().min(0).optional(),
  slow_mo_factor: z.number().optional(),
  mirror_mode: z.enum(['horizontal', 'vertical']).optional(),
  zoom_speed: z.number().optional(),
  pan_direction: z.enum(['left', 'right', 'up', 'down', 'center']).optional(),
  color_grading_shift: z.object({
    mode: z.string().optional(),
    contrast: z.number().optional(),
    brightness: z.number().optional(),
    saturation: z.number().optional(),
    gamma: z.number().optional(),
  }).optional(),
});

const SentenceMappingSchema = z.object({
  sentence_index: z.number().int().min(0),
  text: z.string().optional(),
  type: z.string().optional(),
  start: z.number().min(0).optional(),
  end: z.number().min(0).optional(),
  duration: positiveDurationSchema.optional(),
  visuals: z.array(VisualClipSchema).optional(),
});

const BgmTimelineSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  category: z.string().optional(),
  file: z.string()
});

const AlurfilmMappingSchema = z.object({
  scene_id: z.string().optional(),
  bgm_timeline: z.array(BgmTimelineSchema).optional(),
  mappings: z.array(SentenceMappingSchema).min(1),
  status: z.string().optional(),
});

type AlurfilmMapping = z.infer<typeof AlurfilmMappingSchema>;

function findBgmFile(fileName?: string): string | null {
  const cwd = process.cwd();
  if (fileName) {
    // Strip leading/trailing single or double quotes if present
    const cleanFileName = fileName.trim().replace(/^['"]+|['"]+$/g, '');
    const directPath = path.isAbsolute(fileName) ? fileName : path.resolve(cwd, fileName);
    if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
      return directPath;
    }
    const cleanDirectPath = path.isAbsolute(cleanFileName) ? cleanFileName : path.resolve(cwd, cleanFileName);
    if (fs.existsSync(cleanDirectPath) && fs.statSync(cleanDirectPath).isFile()) {
      return cleanDirectPath;
    }
  }

  const bgmBaseDir = path.join(cwd, 'assets', 'bgm');
  if (!fs.existsSync(bgmBaseDir)) return null;

  // Primary Default Base BGM
  const defaultBaseBgmPath = path.join(
    bgmBaseDir,
    '05_santai_misteri',
    "'Solace' [Calm Piano & Strings CC-BY] - Scott Buckley.mp3"
  );

  if (fileName) {
    const rawClean = fileName.trim().replace(/^['"]+|['"]+$/g, '');
    const baseName = path.basename(rawClean).toLowerCase().normalize('NFC');
    const baseNameNoExt = baseName.replace(/\.[^/.]+$/, '').trim();

    const scanBgm = (dir: string): string | null => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const subMatch = scanBgm(full);
          if (subMatch) return subMatch;
        } else if (entry.isFile() && entry.name.match(/\.(mp3|wav|m4a|aac|flac)$/i)) {
          const entryNorm = entry.name.toLowerCase().normalize('NFC');
          const entryNormNoExt = entryNorm.replace(/\.[^/.]+$/, '').trim();
          if (
            entryNorm === baseName ||
            entryNorm.includes(baseNameNoExt) ||
            baseName.includes(entryNormNoExt)
          ) {
            return full;
          }
        }
      }
      return null;
    };
    const matched = scanBgm(bgmBaseDir);
    if (matched) return matched;
  }

  // Fallback 1: Return the default Base / General BGM ('Solace')
  if (fs.existsSync(defaultBaseBgmPath)) {
    return defaultBaseBgmPath;
  }

  // Fallback 2: Any mp3 in 05_santai_misteri
  const santaiDir = path.join(bgmBaseDir, '05_santai_misteri');
  if (fs.existsSync(santaiDir)) {
    const santaiFiles = fs.readdirSync(santaiDir).filter(f => f.match(/\.(mp3|wav|m4a|aac|flac)$/i));
    if (santaiFiles.length > 0) {
      return path.join(santaiDir, santaiFiles[0]);
    }
  }

  // Fallback 3: Return first available mp3 file anywhere in assets/bgm
  const firstAny = (dir: string): string | null => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = firstAny(full);
        if (sub) return sub;
      } else if (entry.isFile() && entry.name.match(/\.(mp3|wav|m4a|aac|flac)$/i)) {
        return full;
      }
    }
    return null;
  };

  return firstAny(bgmBaseDir);
}


program
  .command('render')
  .description('Render a 16:9 Alur Cerita Film video from mapping JSON')
  .argument('<mapping>', 'Path to Alurfilm mapping JSON file')
  .requiredOption('--video <path>', 'Path to source video chunk')
  .option('-a, --audio <path>', 'Path to voice-over audio file')
  .option('-b, --bgm <path>', 'Path to background music file')
  .option('--no-bgm', 'Disable adding background music (for partial/preview renders)')
  .option('--bgm-offset <seconds>', 'BGM start seek offset in seconds for cross-part continuity (e.g. 120.0)', '0')
  .option('--bgm-volume <volume>', 'BGM volume factor (e.g. 0.28)')
  .option('--narration-volume <volume>', 'Voiceover/Narration volume factor (e.g. 1.8)')
  .option('-l, --logo <path>', 'Path to logo image watermark')
  .option('--logo-opacity <opacity>', 'Logo opacity factor (0.1 to 1.0)')
  .option('--logo-margin <pixels>', 'Logo margin from top-left corner in px')
  .option('--logo-scale <height>', 'Logo height in pixels for watermark')
  .option('--config <path>', 'Path to render settings JSON file', 'input/render_settings.json')
  .option('-o, --output <path>', 'Output MP4 file path', 'output/alurfilm_render.mp4')
  .action(async (mappingPath: string, opts: {
    video: string;
    audio?: string;
    bgm?: string;
    noBgm?: boolean;
    bgmOffset?: string;
    bgmVolume?: string;
    narrationVolume?: string;
    logo?: string;
    logoOpacity?: string;
    logoMargin?: string;
    logoScale?: string;
    config?: string;
    output: string;
  }) => {
    const resolvedMap = path.resolve(mappingPath);
    const resolvedVideo = path.resolve(opts.video);
    const resolvedAudio = opts.audio ? path.resolve(opts.audio) : null;
    const resolvedOutput = path.resolve(opts.output);

    // Load render_settings.json if present
    let jsonSettings: any = {};
    const configPath = opts.config ? path.resolve(opts.config) : path.join(process.cwd(), 'input', 'render_settings.json');
    if (fs.existsSync(configPath)) {
      try {
        jsonSettings = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        console.log(`⚙️ [Alurfilm Engine] Loaded render settings from ${path.basename(configPath)}`);
      } catch (err: any) {
        console.warn(`⚠️ Failed to parse ${configPath}: ${err.message}`);
      }
    }

    if (!fs.existsSync(resolvedMap)) { console.error(`❌ Mapping file not found: ${resolvedMap}`); process.exit(1); }
    if (!fs.existsSync(resolvedVideo)) { console.error(`❌ Source video chunk not found: ${resolvedVideo}`); process.exit(1); }

    let resolvedAudioFinal = resolvedAudio;
    if (resolvedAudio && !fs.existsSync(resolvedAudio)) {
      console.warn(`⚠️ Voiceover audio file not found — rendering video only`);
      resolvedAudioFinal = null;
    }

    const outDir = path.dirname(resolvedOutput);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // Use explicit logo file if provided, or fallback to jsonSettings.logoPath, or default assets/logo.png
    let logoFile: string | null = opts.logo ? path.resolve(opts.logo) : (jsonSettings.logoPath ? path.resolve(jsonSettings.logoPath) : null);
    if (!logoFile) {
      const alurfilmDefaultLogo = path.join(process.cwd(), 'assets', 'logo.png');
      if (fs.existsSync(alurfilmDefaultLogo)) logoFile = alurfilmDefaultLogo;
    } else if (logoFile && !fs.existsSync(logoFile)) {
      console.warn(`⚠️ Specified logo watermark file not found: ${logoFile}`);
      logoFile = null;
    }

    if (jsonSettings.logoEnabled === false && !opts.logo) {
      logoFile = null;
    }

    console.log('🎬 [Alurfilm Engine] Loading 16:9 mapping JSON...');
    let mapping: AlurfilmMapping;
    try {
      const raw = JSON.parse(fs.readFileSync(resolvedMap, 'utf-8'));
      if (raw && Array.isArray(raw.mappings)) {
        raw.mappings = raw.mappings.map((m: any) => {
          if (!m || typeof m !== 'object') return m;
          const s = typeof m.start === 'number' ? m.start : 0;
          const e = typeof m.end === 'number' ? m.end : s;
          const visSum = Array.isArray(m.visuals)
            ? Number(m.visuals.reduce((acc: number, c: any) => acc + (c.duration || 0), 0).toFixed(2))
            : 0;

          if (typeof m.duration !== 'number' || m.duration <= 0.2) {
            if (e > s) {
              m.duration = Number((e - s).toFixed(2));
            } else if (visSum > 0.5) {
              m.duration = visSum;
            } else {
              m.duration = 3.0;
            }
          }

          const isVisOnly = m.type === 'visual_only' || String(m.text || '').includes('VISUAL_ONLY');
          if (Array.isArray(m.visuals)) {
            if (isVisOnly) {
              m.duration = Number(m.visuals.reduce((acc: number, c: any) => acc + (c.duration || 0), 0).toFixed(2));
            }
          }
          return m;
        });
      }
      mapping = AlurfilmMappingSchema.parse(raw);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        console.error('❌ Schema validation failed:');
        for (const issue of err.issues) {
          console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
        }
        process.exit(1);
      }
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }

    // Use explicit BGM file if provided, or fallback to jsonSettings.bgmPath, or resolve from mapping.bgm_timeline or default baseline
    let bgmCandidate = opts.bgm || jsonSettings.bgmPath;
    let bgmFile: string | null = findBgmFile(bgmCandidate);
    if (bgmFile) {
      console.log(`🎵 [Alurfilm Engine] Selected BGM: ${path.basename(bgmFile)}`);
    } else if (mapping.bgm_timeline && mapping.bgm_timeline.length > 0) {
      for (const item of mapping.bgm_timeline) {
        const found = findBgmFile(item.file);
        if (found) {
          bgmFile = found;
          console.log(`🎵 [Alurfilm Engine] Auto-selected BGM from mapping timeline: ${path.basename(found)}`);
          break;
        }
      }
    }
    if (!bgmFile) {
      bgmFile = findBgmFile();
      if (bgmFile) {
        console.log(`🎵 [Alurfilm Engine] Auto-selected Default Baseline BGM: ${path.basename(bgmFile)}`);
      }
    }

    if ((opts.noBgm || jsonSettings.bgmEnabled === false) && !opts.bgm) {
      bgmFile = null;
    }

    const narrationVolume = parseFloat(opts.narrationVolume || String(jsonSettings.narrationVolume ?? '1.8')) || 1.8;
    const bgmVolume = parseFloat(opts.bgmVolume || String(jsonSettings.bgmVolume ?? '0.28')) || 0.28;
    const logoOpacity = parseFloat(opts.logoOpacity || String(jsonSettings.logoOpacity ?? '0.6')) || 0.6;
    const logoMargin = parseInt(opts.logoMargin || String(jsonSettings.logoMargin ?? '40'), 10) || 40;
    const logoScale = parseInt(opts.logoScale || String(jsonSettings.logoScale ?? '60'), 10) || 60;

    // Probe actual voiceover audio duration BEFORE building timeline so mapping aligns with real audio length
    let maxAudioDurationSec = 0;
    if (resolvedAudioFinal && fs.existsSync(resolvedAudioFinal)) {
      try {
        const voMeta = await getVideoMeta(resolvedAudioFinal);
        if (voMeta && voMeta.duration && voMeta.duration > 0) {
          maxAudioDurationSec = voMeta.duration;
          console.log(`🎙️ [Alurfilm Engine] Voiceover Audio Duration: ${maxAudioDurationSec.toFixed(2)}s`);
        }
      } catch (err: any) {
        console.warn(`⚠️ Could not probe audio metadata: ${err?.message}`);
      }
    }

    // Inspect actual source video chunk duration to prevent EOF boundary overflow
    let sourceVideoDuration = 0;
    try {
      const vidMeta = await getVideoMeta(resolvedVideo);
      if (vidMeta && vidMeta.duration && vidMeta.duration > 0) {
        sourceVideoDuration = vidMeta.duration;
        console.log(`📹 [Alurfilm Engine] Source Video Chunk Duration: ${sourceVideoDuration.toFixed(2)}s`);
      }
    } catch (err: any) {
      console.warn(`⚠️ Could not probe video chunk metadata: ${err?.message}`);
    }

    // Outro cushion: add 1.2s of breathing room after voiceover finishes so narration is NEVER abruptly cut off
    const OUTRO_CUSHION_SEC = 1.2;
    const minTargetDuration = maxAudioDurationSec > 0
      ? Number((maxAudioDurationSec + OUTRO_CUSHION_SEC).toFixed(3))
      : 0;
    if (minTargetDuration > 0) {
      console.log(`🎯 [Alurfilm Engine] Target Duration with Outro Cushion: ${minTargetDuration.toFixed(2)}s (${(minTargetDuration / 60).toFixed(2)} min)`);
    }

    // Flatten sentence mappings into individual clip items
    interface FlattenedClip {
      id: number;
      sentenceIndex: number;
      text: string;
      sourceStart: number;
      duration: number;
      type: string;
      slowMoFactor?: number;
      colorShift?: { mode?: string; contrast?: number; brightness?: number; saturation?: number; gamma?: number };
      isVisualOnly: boolean;
    }

    const clips: FlattenedClip[] = [];
    let clipIdCounter = 1;
    let currentTimelineClock = 0;
    const numSents = mapping.mappings.length;

    for (let sIdx = 0; sIdx < numSents; sIdx++) {
      const sentence = mapping.mappings[sIdx];
      const nextSentence = sIdx < numSents - 1 ? mapping.mappings[sIdx + 1] : null;

      const isVisualOnly = Boolean(
        (sentence.type && sentence.type.toLowerCase().includes('visual_only')) ||
        (sentence.text && /\[visual_only/i.test(sentence.text))
      );

      const sentStart = (sentence.start !== undefined && sentence.start >= currentTimelineClock)
        ? sentence.start
        : currentTimelineClock;

      let sentEnd: number;
      if (nextSentence && typeof nextSentence.start === 'number' && nextSentence.start > sentStart) {
        sentEnd = nextSentence.start;
      } else {
        const naturalEnd = (sentence.end && sentence.end > sentStart)
          ? sentence.end
          : sentStart + (sentence.duration || 3.0);
        // For the final sentence, ensure it covers at least minTargetDuration so it NEVER ends before audio!
        sentEnd = (sIdx === numSents - 1 && minTargetDuration > 0)
          ? Math.max(naturalEnd, minTargetDuration)
          : naturalEnd;
      }

      const targetSentDur = Math.max(0.2, Number((sentEnd - sentStart).toFixed(3)));

      const visuals = (sentence.visuals && sentence.visuals.length > 0) ? sentence.visuals : null;
      const sumVisDur = visuals
        ? Number(visuals.reduce((sum, v) => sum + (v.duration || 0), 0).toFixed(3))
        : 0;

      const scale = (visuals && sumVisDur > 0)
        ? (targetSentDur / sumVisDur)
        : 1.0;

      if (visuals) {
        let runningOffset = 0;
        visuals.forEach((vis, vIdx) => {
          const ss = vis.source_start_seconds !== undefined
            ? vis.source_start_seconds
            : (vis.source_timestamp_seconds !== undefined ? vis.source_timestamp_seconds : 0);

          let adjustedDur: number;
          if (vIdx === visuals.length - 1) {
            adjustedDur = Math.max(0.2, Number((targetSentDur - runningOffset).toFixed(3)));
          } else {
            adjustedDur = Math.max(0.2, Number(((vis.duration || 3.0) * scale).toFixed(3)));
            runningOffset += adjustedDur;
          }

          // If this is the final visual clip of the final sentence and adjustedDur is long (e.g. > 4.2s),
          // split it into a pleasant final narrative cut + slow-motion outro extension
          if (vIdx === visuals.length - 1 && sIdx === numSents - 1 && adjustedDur > 4.2) {
            const cut1Dur = Number(Math.min(3.0, (vis.duration || 2.5)).toFixed(3));
            const outroDur = Number((adjustedDur - cut1Dur).toFixed(3));
            clips.push({
              id: clipIdCounter++,
              sentenceIndex: sentence.sentence_index,
              text: sentence.text || '',
              sourceStart: ss,
              duration: cut1Dur,
              type: vis.type || 'video_cut',
              slowMoFactor: vis.slow_mo_factor || (vis.type === 'slow_motion' ? 0.35 : undefined),
              colorShift: vis.color_grading_shift,
              isVisualOnly,
            });
            const safeSs = (sourceVideoDuration > 15)
              ? Math.max(0, sourceVideoDuration - outroDur - 5)
              : Math.max(0, ss - outroDur);
            clips.push({
              id: clipIdCounter++,
              sentenceIndex: sentence.sentence_index,
              text: 'Outro video extension',
              sourceStart: safeSs,
              duration: outroDur,
              type: 'slow_motion',
              slowMoFactor: 0.35,
              colorShift: { mode: 'normal', contrast: 1.04, brightness: 0.005, saturation: 1.05, gamma: 1.0 },
              isVisualOnly: false,
            });
          } else {
            clips.push({
              id: clipIdCounter++,
              sentenceIndex: sentence.sentence_index,
              text: sentence.text || '',
              sourceStart: ss,
              duration: adjustedDur,
              type: vis.type || 'video_cut',
              slowMoFactor: vis.slow_mo_factor || (vis.type === 'slow_motion' ? 0.35 : undefined),
              colorShift: vis.color_grading_shift,
              isVisualOnly,
            });
          }
        });
      } else {
        const fallbackSs = (sentence as any).source_start_seconds !== undefined
          ? (sentence as any).source_start_seconds
          : ((sentence as any).source_timestamp_seconds !== undefined ? (sentence as any).source_timestamp_seconds : (sentence.start || 0));

        clips.push({
          id: clipIdCounter++,
          sentenceIndex: sentence.sentence_index,
          text: sentence.text || '',
          sourceStart: fallbackSs,
          duration: targetSentDur,
          type: 'video_cut',
          isVisualOnly,
        });
      }

      currentTimelineClock = sentEnd;
    }

    let totalDur = clips.reduce((s, c) => s + c.duration, 0);

    // Anti-Freeze & Audio-Sync Protection: Ensure total video duration strictly covers 100% of VO + Outro Cushion
    if (minTargetDuration > 0 && totalDur < minTargetDuration) {
      const remainingGap = Number((minTargetDuration - totalDur).toFixed(3));
      if (remainingGap > 0.05 && clips.length > 0) {
        console.log(`⚠️ [Alurfilm Engine] Video total duration (${totalDur.toFixed(2)}s) is shorter than target (${minTargetDuration.toFixed(2)}s). Extending outro by ${remainingGap}s to prevent audio cut-off.`);
        if (remainingGap <= 2.5) {
          clips[clips.length - 1].duration = Number((clips[clips.length - 1].duration + remainingGap).toFixed(3));
        } else {
          const lastClip = clips[clips.length - 1];
          const safeSs = (sourceVideoDuration > 15)
            ? Math.max(0, sourceVideoDuration - remainingGap - 5)
            : Math.max(0, lastClip.sourceStart - remainingGap);
          clips.push({
            id: clipIdCounter++,
            sentenceIndex: lastClip.sentenceIndex,
            text: 'Outro video extension',
            sourceStart: safeSs,
            duration: remainingGap,
            type: 'slow_motion',
            slowMoFactor: 0.35,
            colorShift: { mode: 'normal', contrast: 1.04, brightness: 0.005, saturation: 1.05, gamma: 1.0 },
            isVisualOnly: false,
          });
        }
        totalDur = clips.reduce((s, c) => s + c.duration, 0);
      }
    }

    // Quantize every clip duration to exact 30fps frames to eliminate PTS drift and frame quantization loss
    clips.forEach((c) => {
      const frames = Math.max(6, Math.round(c.duration * 30));
      c.duration = Number((frames / 30).toFixed(4));
    });
    totalDur = Number(clips.reduce((s, c) => s + c.duration, 0).toFixed(3));

    const width = 1920;
    const height = 1080;

    console.log(`✅ [Alurfilm Engine] ${clips.length} Visual Clips across ${mapping.mappings.length} Sentences | Total Duration: ${totalDur.toFixed(1)}s (${(totalDur / 60).toFixed(2)} min) | Resolution ${width}x${height} (16:9)`);

    // Collect exact frame-accurate time intervals for all VISUAL_ONLY clips on the rendered timeline
    const visualOnlyIntervals: Array<{ start: number; end: number }> = [];
    let runningTimelineTime = 0;

    for (const clip of clips) {
      const clipStart = runningTimelineTime;
      const clipEnd = clipStart + clip.duration;

      if (clip.isVisualOnly) {
        visualOnlyIntervals.push({
          start: Number(clipStart.toFixed(3)),
          end: Number(clipEnd.toFixed(3)),
        });
      }
      runningTimelineTime = clipEnd;
    }

    let visualOnlyConditions = '0';
    if (visualOnlyIntervals.length > 0) {
      // Extend bounds by 0.05s on each side to prevent frame-boundary BGM ducking misses
      // (FFmpeg between() is inclusive but frame-sampled, so exact boundary can miss 1-2 frames)
      visualOnlyConditions = visualOnlyIntervals
        .map(inv => `between(t,${Math.max(0, inv.start - 0.05).toFixed(2)},${(inv.end + 0.05).toFixed(2)})`)
        .join('+');
    }
    console.log(`🎬 [Alurfilm Engine] VISUAL_ONLY Intervals: ${visualOnlyIntervals.map(i => `${i.start.toFixed(1)}s-${i.end.toFixed(1)}s`).join(', ') || 'None'}`);

    const tmpDir = path.join(os.tmpdir(), `alurfilm-render-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      // Optimize concurrency based on available CPU cores (up to 8 parallel workers)
      const CONCURRENCY = Math.min(Math.max(2, os.cpus().length), 8);
      const clipFiles: string[] = new Array(clips.length);

      for (let batch = 0; batch < clips.length; batch += CONCURRENCY) {
        const batchEnd = Math.min(batch + CONCURRENCY, clips.length);
        const batchClips = clips.slice(batch, batchEnd);

        const tasks = batchClips.map((clip, bi) => {
          const i = batch + bi;
          const outFile = path.join(tmpDir, `c${String(i).padStart(4, '0')}.ts`);
          clipFiles[i] = outFile;

          const fxFilters: string[] = [];

          // 1. PTS normalization & Slow motion (setpts)
          // Base raw footage is strictly clamped to max 2.0s from source video
          let baseDur = clip.duration;
          if (clip.type === 'slow_motion' && clip.slowMoFactor && clip.slowMoFactor > 0 && clip.slowMoFactor !== 1) {
            baseDur = Math.min(2.0, clip.duration * clip.slowMoFactor);
            const ptsFactor = (clip.duration / baseDur).toFixed(2);
            fxFilters.push(`setpts=(PTS-STARTPTS)*${ptsFactor}`);
          } else if (clip.duration > 2.0) {
            baseDur = 2.0;
            const ptsFactor = (clip.duration / 2.0).toFixed(2);
            fxFilters.push(`setpts=(PTS-STARTPTS)*${ptsFactor}`);
          } else {
            baseDur = Math.min(2.0, clip.duration);
            fxFilters.push('setpts=PTS-STARTPTS');
          }

          // 3. Color grading shift & Dark boost (FFmpeg eq filter)
          if (clip.colorShift) {
            const contrast = Math.max(0.5, Math.min(2.5, clip.colorShift.contrast ?? 1.04));
            const brightness = Math.max(-0.5, Math.min(0.5, clip.colorShift.brightness ?? 0.005));
            const saturation = Math.max(0.0, Math.min(3.0, clip.colorShift.saturation ?? 1.05));
            const gamma = Math.max(0.5, Math.min(3.0, clip.colorShift.gamma ?? 1.0));
            fxFilters.push(`eq=contrast=${contrast.toFixed(3)}:brightness=${brightness.toFixed(3)}:saturation=${saturation.toFixed(3)}:gamma=${gamma.toFixed(3)}`);
          }

          // 4. Anti-Content ID Spatial Defense: Authentic 35mm Luma Film Grain (c0s luma-only is 2x faster than chroma noise)
          fxFilters.push('noise=c0s=6:allf=t');

          const fxChain = fxFilters.length > 0 ? ',' + fxFilters.join(',') : '';

          // Zoom Rate (default 1.0 = no zoom / 100% original framing)
          const zoomRate = (jsonSettings as any).zoomRate ?? 1.0;
          const scaledWidth = Math.round(width * zoomRate);
          const scaledHeight = Math.round(height * zoomRate);

          const scaleFilter = `scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1${fxChain},fps=fps=30:round=near`;
          // Base footage is max 2.0s, add +1.5s headroom so decoder is never starved of input frames
          inputReadDur = (Math.min(2.0, baseDur) + 1.5).toFixed(3);

          const readDurNum = parseFloat(inputReadDur) || 0.5;
          let safeSourceStart = clip.sourceStart;
          if (sourceVideoDuration > 0 && safeSourceStart + readDurNum > sourceVideoDuration - 0.2) {
            safeSourceStart = Math.max(0, Number((sourceVideoDuration - readDurNum - 0.2).toFixed(3)));
            console.log(`⚠️ [Alurfilm Engine] Clip #${clip.id} boundary overflow (${clip.sourceStart}s + ${readDurNum}s > ${sourceVideoDuration.toFixed(1)}s). Safely shifted sourceStart to ${safeSourceStart}s.`);
          }

          const ffmpegArgs: string[] = [
            '-y',
            '-ss', String(safeSourceStart),
            '-t', inputReadDur,
            '-threads', '2',
            '-an',
            '-sn',
            '-i', resolvedVideo,
            '-vf', scaleFilter,
            '-t', String(clip.duration),
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-r', '30',
            '-avoid_negative_ts', 'make_zero',
            '-pix_fmt', 'yuv420p',
            outFile
          ];

          return runFFmpeg(ffmpegArgs, process.cwd(), `Clip #${clip.id} (Sentence ${clip.sentenceIndex})`);
        });

        await Promise.all(tasks);
        const done = batch + batchClips.length;
        const extractPct = Math.round((done / clips.length) * 70);
        process.stdout.write(`\r   ✂️ [Alurfilm Engine] Extracted ${done}/${clips.length} clips (${extractPct}%)   `);
      }
      console.log('');

      // Generate sample-accurate pre-aligned Movie FX audio track (movie_fx.wav)
      const hasVisualOnly = clips.some(c => c.isVisualOnly);
      let fullMovieFxWav: string | null = null;

      if (hasVisualOnly) {
        console.log('🔊 [Alurfilm Engine] Generating sample-accurate Movie FX audio track...');
        const fxDir = path.join(tmpDir, 'fx_parts');
        fs.mkdirSync(fxDir, { recursive: true });

        interface FxSegment {
          type: 'silence' | 'movie';
          duration: number;
          sourceStart?: number;
        }

        const rawFxSegments: FxSegment[] = [];
        for (const clip of clips) {
          if (clip.isVisualOnly) {
            rawFxSegments.push({
              type: 'movie',
              duration: clip.duration,
              sourceStart: clip.sourceStart,
            });
          } else {
            rawFxSegments.push({
              type: 'silence',
              duration: clip.duration,
            });
          }
        }

        // Merge consecutive silence segments
        const mergedFxSegments: FxSegment[] = [];
        for (const seg of rawFxSegments) {
          if (seg.type === 'silence') {
            const last = mergedFxSegments[mergedFxSegments.length - 1];
            if (last && last.type === 'silence') {
              last.duration = Number((last.duration + seg.duration).toFixed(3));
            } else {
              mergedFxSegments.push({ ...seg });
            }
          } else {
            mergedFxSegments.push({ ...seg });
          }
        }

        const fxWavFiles: string[] = new Array(mergedFxSegments.length);
        const fxTasks = mergedFxSegments.map(async (seg, idx) => {
          const wavPath = path.join(fxDir, `fx_${String(idx).padStart(4, '0')}.wav`);
          fxWavFiles[idx] = wavPath;
          if (seg.type === 'silence') {
            const sArgs = [
              '-y',
              '-f', 'lavfi',
              '-t', String(seg.duration),
              '-i', 'anullsrc=r=48000:cl=stereo',
              '-c:a', 'pcm_s16le',
              '-ar', '48000',
              '-ac', '2',
              wavPath
            ];
            await runFFmpeg(sArgs, process.cwd(), `FX Silence #${idx}`);
          } else {
            let safeSs = seg.sourceStart || 0;
            if (sourceVideoDuration > 0 && safeSs + seg.duration > sourceVideoDuration - 0.2) {
              safeSs = Math.max(0, Number((sourceVideoDuration - seg.duration - 0.2).toFixed(3)));
            }
            const mArgs = [
              '-y',
              '-ss', String(safeSs),
              '-t', String(seg.duration),
              '-i', resolvedVideo,
              '-af', `atrim=0:${seg.duration},asetpts=PTS-STARTPTS,aresample=48000:first_pts=0`,
              '-c:a', 'pcm_s16le',
              '-ar', '48000',
              '-ac', '2',
              wavPath
            ];
            await runFFmpeg(mArgs, process.cwd(), `FX Movie #${idx}`);
          }
        });

        await Promise.all(fxTasks);

        const fxListFile = path.join(tmpDir, 'fx_list.txt');
        fs.writeFileSync(fxListFile, fxWavFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'), 'utf-8');
        fullMovieFxWav = path.join(tmpDir, 'movie_fx.wav');
        await runFFmpeg([
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', fxListFile,
          '-c:a', 'copy',
          fullMovieFxWav
        ], process.cwd(), 'Concat Movie FX WAV');
        console.log('✅ [Alurfilm Engine] Sample-accurate Movie FX track ready');
      }

      // Concat all TS clips & mix Voiceover audio + Logo
      console.log('🔗 [Alurfilm Engine] Concatenating visual clips & logo overlay...');
      const listFile = path.join(tmpDir, 'list.txt');
      fs.writeFileSync(listFile, clipFiles.map((f) => `file '${f}'`).join('\n'), 'utf-8');

      const fargs: string[] = [
        '-y',
        '-f', 'concat', '-safe', '0', '-i', listFile, // Stream 0:v (video only)
      ];

      let streamIndex = 1;
      let voIndex: number | null = null;
      let movieFxIndex: number | null = null;
      let logoIndex: number | null = null;

      if (resolvedAudioFinal) {
        fargs.push('-i', resolvedAudioFinal);
        voIndex = streamIndex++;
      }

      if (hasVisualOnly && fullMovieFxWav && fs.existsSync(fullMovieFxWav)) {
        fargs.push('-i', fullMovieFxWav);
        movieFxIndex = streamIndex++;
      }

      // Collect all BGM timeline segments
      interface BgmSegmentInput {
        filePath: string;
        start: number;
        end: number;
      }
      const bgmSegments: BgmSegmentInput[] = [];

      if (mapping.bgm_timeline && mapping.bgm_timeline.length > 0) {
        for (const item of mapping.bgm_timeline) {
          const found = findBgmFile(item.file);
          if (found) {
            bgmSegments.push({ filePath: found, start: item.start, end: item.end });
          } else {
            console.warn(`⚠️ BGM file from timeline not found: ${item.file}`);
          }
        }
      }

      if (bgmSegments.length === 0) {
        const fallbackBgm = opts.bgm ? path.resolve(opts.bgm) : (bgmFile || findBgmFile());
        if (fallbackBgm && fs.existsSync(fallbackBgm)) {
          bgmSegments.push({ filePath: fallbackBgm, start: 0, end: totalDur });
        }
      }

      // Ensure the last BGM segment strictly extends to totalDur so music covers the entire outro cushion
      if (bgmSegments.length > 0) {
        const lastBgm = bgmSegments[bgmSegments.length - 1];
        if (lastBgm.end < totalDur) {
          lastBgm.end = totalDur;
        }
      }

      const bgmStreamIndices: number[] = [];
      for (const seg of bgmSegments) {
        console.log(`🎵 [Alurfilm Engine] BGM Segment: ${path.basename(seg.filePath)} (${seg.start}s - ${seg.end}s)`);
        fargs.push('-i', seg.filePath);
        bgmStreamIndices.push(streamIndex++);
      }

      if (logoFile) {
        console.log(`🎨 [Alurfilm Engine] Logo Watermark: ${path.basename(logoFile)} (Margin: ${logoMargin}px, Opacity: ${logoOpacity})`);
        fargs.push('-i', logoFile);
        logoIndex = streamIndex++;
      }

      const filterParts: string[] = [];
      let vMap = '0:v';
      let aMap: string | null = null;

      // Video filter for logo watermark
      if (logoIndex !== null) {
        filterParts.push(`[${logoIndex}:v]scale=-1:${logoScale},format=rgba,colorchannelmixer=aa=${logoOpacity}[logo_alpha]`);
        filterParts.push(`[0:v][logo_alpha]overlay=${logoMargin}:${logoMargin}[vout]`);
        vMap = '[vout]';
      }

      // Build Multi-BGM Audio Filter Graph
      if (bgmStreamIndices.length > 0) {
        const bgmSegNames: string[] = [];
        for (let idx = 0; idx < bgmStreamIndices.length; idx++) {
          const sIdx = bgmStreamIndices[idx];
          const seg = bgmSegments[idx];
          const segDur = Math.max(0.5, seg.end - seg.start);
          const delayMs = Math.round(seg.start * 1000);
          const fadeInSec = idx === 0 ? 0.8 : 1.2;
          const fadeOutSec = 1.2;
          const fadeOutStart = Math.max(0, segDur - fadeOutSec);
          const tag = `bgm_seg_${idx}`;

          filterParts.push(`[${sIdx}:a]atrim=0:${segDur.toFixed(3)},aloop=loop=-1:size=2e+09,atrim=0:${segDur.toFixed(3)},afade=t=in:st=0:d=${fadeInSec},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutSec},adelay=${delayMs}|${delayMs}[${tag}]`);
          bgmSegNames.push(`[${tag}]`);
        }

        const numBgmSegs = bgmSegNames.length;
        if (numBgmSegs > 1) {
          filterParts.push(`${bgmSegNames.join('')}amix=inputs=${numBgmSegs}:dropout_transition=0[bgm_full]`);
        } else {
          filterParts.push(`${bgmSegNames[0]}acopy[bgm_full]`);
        }

        const bgmSegScale = numBgmSegs > 1 ? numBgmSegs : 1;

        if (voIndex !== null && movieFxIndex !== null) {
          const numFinalInputs = 3;
          const targetBgmVol = (bgmVolume * bgmSegScale * numFinalInputs).toFixed(3);
          const targetVisualOnlyVol = (Math.max(bgmVolume * 1.6, 0.45) * bgmSegScale * numFinalInputs).toFixed(3);
          const targetVoVol = (narrationVolume * numFinalInputs).toFixed(3);
          const targetMovieFxVol = (1.8 * numFinalInputs).toFixed(3);

          filterParts.push(`[${voIndex}:a]volume=${targetVoVol}[vo]`);
          filterParts.push(`[${movieFxIndex}:a]volume=${targetMovieFxVol}[movie_fx]`);
          filterParts.push(`[bgm_full]volume='if(${visualOnlyConditions}, ${targetVisualOnlyVol}, ${targetBgmVol})':eval=frame[bgm_ducked]`);
          filterParts.push(`[vo][movie_fx][bgm_ducked]amix=inputs=3:duration=longest:dropout_transition=0,atrim=0:${totalDur.toFixed(3)},asetpts=PTS-STARTPTS[aout]`);
          aMap = '[aout]';
        } else if (voIndex !== null) {
          const numFinalInputs = 2;
          const targetBgmVol = (bgmVolume * bgmSegScale * numFinalInputs).toFixed(3);
          const targetVoVol = (narrationVolume * numFinalInputs).toFixed(3);

          filterParts.push(`[${voIndex}:a]volume=${targetVoVol}[vo]`);
          filterParts.push(`[bgm_full]volume=${targetBgmVol}[bgm_ducked]`);
          filterParts.push(`[vo][bgm_ducked]amix=inputs=2:duration=longest:dropout_transition=0,atrim=0:${totalDur.toFixed(3)},asetpts=PTS-STARTPTS[aout]`);
          aMap = '[aout]';
        } else if (movieFxIndex !== null) {
          const numFinalInputs = 2;
          const targetBgmVol = (bgmVolume * bgmSegScale * numFinalInputs).toFixed(3);
          const targetVisualOnlyVol = (Math.max(bgmVolume * 1.6, 0.45) * bgmSegScale * numFinalInputs).toFixed(3);
          const targetMovieFxVol = (1.8 * numFinalInputs).toFixed(3);

          filterParts.push(`[${movieFxIndex}:a]volume=${targetMovieFxVol}[movie_fx]`);
          filterParts.push(`[bgm_full]volume='if(${visualOnlyConditions}, ${targetVisualOnlyVol}, ${targetBgmVol})':eval=frame[bgm_ducked]`);
          filterParts.push(`[movie_fx][bgm_ducked]amix=inputs=2:duration=longest:dropout_transition=0,atrim=0:${totalDur.toFixed(3)},asetpts=PTS-STARTPTS[aout]`);
          aMap = '[aout]';
        } else {
          filterParts.push(`[bgm_full]volume=${bgmVolume},atrim=0:${totalDur.toFixed(3)},asetpts=PTS-STARTPTS[aout]`);
          aMap = '[aout]';
        }
      } else {
        // No BGM
        if (voIndex !== null && movieFxIndex !== null) {
          const numFinalInputs = 2;
          const targetVoVol = (narrationVolume * numFinalInputs).toFixed(3);
          const targetMovieFxVol = (1.8 * numFinalInputs).toFixed(3);

          filterParts.push(`[${voIndex}:a]volume=${targetVoVol}[vo]`);
          filterParts.push(`[${movieFxIndex}:a]volume=${targetMovieFxVol}[movie_fx]`);
          filterParts.push(`[vo][movie_fx]amix=inputs=2:duration=longest:dropout_transition=0,apad,atrim=0:${totalDur.toFixed(3)},asetpts=PTS-STARTPTS[aout]`);
          aMap = '[aout]';
        } else if (voIndex !== null) {
          filterParts.push(`[${voIndex}:a]volume=${narrationVolume},apad,atrim=0:${totalDur.toFixed(3)},asetpts=PTS-STARTPTS[aout]`);
          aMap = '[aout]';
        } else if (movieFxIndex !== null) {
          filterParts.push(`[${movieFxIndex}:a]volume=1.8,apad,atrim=0:${totalDur.toFixed(3)},asetpts=PTS-STARTPTS[aout]`);
          aMap = '[aout]';
        }
      }

      if (filterParts.length > 0) {
        fargs.push('-filter_complex', filterParts.join(';'));
      }

      fargs.push('-map', vMap);
      if (aMap) {
        fargs.push('-map', aMap);
      }

      if (logoIndex !== null) {
        fargs.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p');
      } else {
        fargs.push('-c:v', 'copy');
      }

      if (aMap) {
        fargs.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2');
      }

      fargs.push(
        '-t', totalDur.toFixed(3),
        '-shortest',
        '-movflags', '+faststart',
        '-progress', 'pipe:1', '-nostats',
        resolvedOutput,
      );

      const t0 = Date.now();
      await runFFmpegProgress(fargs, process.cwd(), totalDur, (pct, msg) => {
        const displayPct = 70 + Math.round(pct * 0.3);
        process.stdout.write(`\r   🎥 [Alurfilm Engine] Rendering: ${displayPct}% (${msg})   `);
      });
      console.log('');

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`🎉 [Alurfilm Engine] Render Complete! File: ${resolvedOutput} (${elapsed}s, Total Duration: ${totalDur.toFixed(1)}s)`);
    } catch (err: any) {
      console.error(`❌ [Alurfilm Engine Error] ${err.message}`);
      process.exit(1);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch { }
    }
  });

program.parse(process.argv);
