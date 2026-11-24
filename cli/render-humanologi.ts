// cli/render-humanologi.ts
import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { runFFmpeg, getVideoMeta } from './shared/ffmpeg-helpers.js';

interface HumanologiScene {
  scene_number: number;
  part_narasi?: number;
  start_seconds: number;
  end_seconds: number;
  durasi_detik?: number;
  duration?: number;
  potongan_narasi?: string;
  deskripsi_visual_singkat?: string;
  image_prompt?: string;
  image_path?: string;
  konteks_kalimat?: string;
}

interface HumanologiScenesFile {
  judul_video?: string;
  part?: number;
  total_scene?: number;
  audio_duration?: number;
  scenes: HumanologiScene[];
}

function pad3(num: number): string {
  return String(num).padStart(3, '0');
}

/**
 * Format seconds to ASS timestamp: H:MM:SS.cs
 */
function formatAssTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Clean text for ASS dialogue
 */
function cleanAssText(text?: string): string {
  if (!text) return '';
  return text
    .replace(/\\/g, '')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, ' ')
    .trim();
}

/**
 * Generate ASS subtitle file for documentary styling
 */
function generateAssSubtitleFile(scenes: HumanologiScene[], outputPath: string): void {
  const lines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Clean yellow/white documentary style with soft outline and semi-transparent dark backing
    'Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H90000000,&H80000000,1,0,0,0,100,100,0,0,1,3,1,2,70,70,55,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  for (const scene of scenes) {
    const text = cleanAssText(scene.potongan_narasi || (scene as any).text);
    if (!text) continue;
    const startStr = formatAssTime(scene.start_seconds);
    const endStr = formatAssTime(scene.end_seconds);
    lines.push(`Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${text}`);
  }

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
}

/**
 * Concurrency worker pool helper
 */
async function asyncPool<T>(
  concurrency: number,
  items: T[],
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  const executing: Promise<void>[] = [];
  for (let i = 0; i < items.length; i++) {
    const p = Promise.resolve().then(() => fn(items[i], i));
    executing.push(p);
    const clean = () => {
      const idx = executing.indexOf(p);
      if (idx !== -1) executing.splice(idx, 1);
    };
    p.then(clean, clean);
    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

const program = new Command();

program
  .name('render-humanologi')
  .description('Dedicated 16:9 Humanologi Documentary FFmpeg Video Renderer')
  .version('1.0.0');

// ─── COMMAND: render ─────────────────────────────────────────────────────────

program
  .command('render')
  .description('Render a Humanologi part video from scenes JSON and images')
  .option('-p, --part <number>', 'Part number to render (e.g. 1, 2, 3)', '1')
  .option('-s, --scenes <path>', 'Custom path to scenes JSON file')
  .option('-a, --audio <path>', 'Custom path to voiceover audio file')
  .option('-i, --images-dir <path>', 'Custom path to images directory')
  .option('-o, --output <path>', 'Custom output MP4 file path')
  .option('--no-subtitles', 'Disable burning in clean documentary subtitles')
  .option('--no-ken-burns', 'Disable Ken Burns dynamic zoom and pan effects')
  .option('-c, --concurrency <number>', 'Concurrent workers for scene clip rendering', '4')
  .action(async (opts: {
    part: string;
    scenes?: string;
    audio?: string;
    imagesDir?: string;
    output?: string;
    subtitles?: boolean;
    kenBurns?: boolean;
    concurrency?: string;
  }) => {
    const cwd = process.cwd();
    const partNum = parseInt(opts.part, 10) || 1;
    const concurrency = Math.max(1, parseInt(opts.concurrency || '4', 10) || 4);
    const enableSubtitles = opts.subtitles !== false;
    const enableKenBurns = opts.kenBurns !== false;

    console.log(`\n======================================================`);
    console.log(`🧠 [Humanologi Engine] Rendering Part ${partNum}`);
    console.log(`   Ken Burns: ${enableKenBurns ? 'ON' : 'OFF'}`);
    console.log(`   Subtitles: ${enableSubtitles ? 'ON' : 'OFF'}`);
    console.log(`   Concurrency: ${concurrency} workers`);
    console.log(`======================================================\n`);

    // 1. Resolve scenes file
    let scenesPath = opts.scenes
      ? path.resolve(cwd, opts.scenes)
      : path.join(cwd, 'input', 'humanologi', 'scenes', `part_${partNum}_scenes.json`);

    if (!fs.existsSync(scenesPath)) {
      console.error(`❌ Scenes file not found: ${scenesPath}`);
      process.exit(1);
    }

    const scenesRaw = JSON.parse(fs.readFileSync(scenesPath, 'utf-8')) as HumanologiScenesFile;
    const scenes = scenesRaw.scenes || [];
    if (scenes.length === 0) {
      console.error(`❌ No scenes found in ${scenesPath}`);
      process.exit(1);
    }

    console.log(`📋 Loaded ${scenes.length} scenes from ${path.basename(scenesPath)}`);

    // 2. Resolve images dir
    const imagesDir = opts.imagesDir
      ? path.resolve(cwd, opts.imagesDir)
      : path.join(cwd, 'input', 'humanologi', 'images', `part_${partNum}`);

    // 3. Resolve audio file
    let audioFile: string | null = null;
    if (opts.audio) {
      const explicit = path.resolve(cwd, opts.audio);
      if (fs.existsSync(explicit)) audioFile = explicit;
    }

    if (!audioFile) {
      // Check default naming conventions in input/humanologi/audio/
      const audioBaseDir = path.join(cwd, 'input', 'humanologi', 'audio');
      if (fs.existsSync(audioBaseDir)) {
        const candidates = fs.readdirSync(audioBaseDir).filter((f) => {
          const lower = f.toLowerCase();
          return (
            (lower.includes(`part_${partNum}`) || lower.includes(`part${partNum}`) || lower.includes(`a${partNum}.`)) &&
            /\.(mp3|wav|m4a|aac|flac)$/i.test(lower)
          );
        });
        if (candidates.length > 0) {
          audioFile = path.join(audioBaseDir, candidates[0]);
        }
      }
    }

    let audioDuration = 0;
    if (audioFile && fs.existsSync(audioFile)) {
      console.log(`🎙️ [Humanologi Engine] Found voiceover audio: ${path.basename(audioFile)}`);
      const meta = await getVideoMeta(audioFile);
      if (meta && meta.duration) {
        audioDuration = meta.duration;
        console.log(`   Audio duration: ${audioDuration.toFixed(2)}s`);
      }
    } else {
      console.warn(`⚠️ No voiceover audio found for Part ${partNum} - rendering silent video`);
    }

    // 4. Resolve output MP4 path
    const outputDir = path.join(cwd, 'output', 'humanologi');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const finalOutput = opts.output
      ? path.resolve(cwd, opts.output)
      : path.join(outputDir, `part_${partNum}.mp4`);

    // 5. Temporary workspace directory for segment clips
    const tempWorkDir = path.join(cwd, 'input', '.tmp', `humanologi_part_${partNum}_${Date.now()}`);
    if (!fs.existsSync(tempWorkDir)) fs.mkdirSync(tempWorkDir, { recursive: true });

    const clipFiles: string[] = new Array(scenes.length);
    let completedCount = 0;
    const startTime = Date.now();

    // 6. Render each scene to an intermediate .ts clip
    console.log(`\n🎞️ Starting scene clip generation (${scenes.length} scenes)...`);

    await asyncPool(concurrency, scenes, async (scene, idx) => {
      const sceneNum = scene.scene_number || idx + 1;
      const rawDur = scene.durasi_detik || scene.duration || (scene.end_seconds - scene.start_seconds) || 2.5;
      const duration = Math.max(0.4, Number(rawDur.toFixed(3)));
      const frames = Math.max(2, Math.round(duration * 30));

      const outClip = path.join(tempWorkDir, `clip_${pad3(sceneNum)}.ts`);
      clipFiles[idx] = outClip;

      // Locate image
      let imgPath: string | null = null;
      if (scene.image_path && fs.existsSync(scene.image_path)) {
        imgPath = scene.image_path;
      } else {
        const expected = path.join(imagesDir, `scene_${pad3(sceneNum)}.png`);
        if (fs.existsSync(expected)) {
          imgPath = expected;
        } else {
          // Check for .jpg
          const expectedJpg = path.join(imagesDir, `scene_${pad3(sceneNum)}.jpg`);
          if (fs.existsSync(expectedJpg)) imgPath = expectedJpg;
        }
      }

      let ffmpegArgs: string[];

      if (imgPath && fs.existsSync(imgPath)) {
        let vfFilter: string;

        if (enableKenBurns) {
          const mode = idx % 3;
          let zoompanStr = '';

          if (mode === 0) {
            // Smooth Zoom In: 1.00 -> 1.07
            const zoomStep = (0.07 / frames).toFixed(6);
            zoompanStr = `zoompan=z='min(1.0+on*${zoomStep},1.07)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=30`;
          } else if (mode === 1) {
            // Smooth Zoom Out: 1.07 -> 1.00
            const zoomStep = (0.07 / frames).toFixed(6);
            zoompanStr = `zoompan=z='max(1.07-on*${zoomStep},1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=30`;
          } else {
            // Smooth Subtle Pan Left to Right (z=1.04)
            zoompanStr = `zoompan=z=1.04:x='(on/${frames})*(iw-iw/zoom)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=30`;
          }

          vfFilter = `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,${zoompanStr},setsar=1`;
        } else {
          // Static fit
          vfFilter = `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1`;
        }

        ffmpegArgs = [
          '-y',
          '-i', imgPath,
          '-vf', vfFilter,
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '19',
          '-pix_fmt', 'yuv420p',
          outClip,
        ];
      } else {
        // Missing image fallback: elegant dark background card with label
        console.warn(`⚠️ Scene ${sceneNum} missing image — generating visual placeholder`);
        const safeText = (scene.potongan_narasi || `Scene ${sceneNum}`).slice(0, 50).replace(/'/g, '');
        const vfFilter = `drawtext=text='Scene ${sceneNum}':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=(h-text_h)/2-30,drawtext=text='${safeText}':fontcolor=gray:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2+30`;
        ffmpegArgs = [
          '-y',
          '-f', 'lavfi',
          '-i', `color=c=0x0f172a:s=1920x1080:d=${duration}:r=30`,
          '-vf', vfFilter,
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-pix_fmt', 'yuv420p',
          outClip,
        ];
      }

      await runFFmpeg(ffmpegArgs, cwd, `Scene ${sceneNum}`);

      completedCount++;
      const pct = Math.round((completedCount / scenes.length) * 85); // 0-85% for scene generation
      console.log(`[PROGRESS] scene=${completedCount}/${scenes.length} progress=${(pct / 100).toFixed(2)} message="Scene ${completedCount}/${scenes.length} ready"`);
    });

    console.log(`✅ All ${scenes.length} scene clips generated in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

    // 7. Write concat list
    const concatListPath = path.join(tempWorkDir, 'concat_list.txt');
    const concatContent = clipFiles
      .filter((f) => f && fs.existsSync(f))
      .map((f) => `file '${f.replace(/\\/g, '/')}'`)
      .join('\n');
    fs.writeFileSync(concatListPath, concatContent, 'utf-8');

    // 8. Generate Subtitles ASS file if requested
    let assSubtitlePath: string | null = null;
    if (enableSubtitles) {
      assSubtitlePath = path.join(tempWorkDir, `subtitles_part_${partNum}.ass`);
      generateAssSubtitleFile(scenes, assSubtitlePath);
      console.log(`📝 Generated documentary ASS subtitles: ${path.basename(assSubtitlePath)}`);
    }

    // 9. Concat clips and mux audio + subtitles
    console.log(`\n🎬 Muxing final video and syncing audio...`);
    console.log(`[PROGRESS] stage=concat progress=0.88 message="Muxing audio and burning subtitles..."`);

    const muxArgs: string[] = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
    ];

    if (audioFile && fs.existsSync(audioFile)) {
      muxArgs.push('-i', audioFile);
    }

    if (enableSubtitles && assSubtitlePath && fs.existsSync(assSubtitlePath)) {
      // Escape for FFmpeg subtitle filter syntax
      const escapedAss = assSubtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:');
      muxArgs.push('-vf', `subtitles='${escapedAss}'`);
      muxArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19');
    } else {
      // Fast stream copy if no subtitle re-encoding needed
      muxArgs.push('-c:v', 'copy');
    }

    if (audioFile && fs.existsSync(audioFile)) {
      muxArgs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    }

    muxArgs.push('-movflags', '+faststart', '-pix_fmt', 'yuv420p', finalOutput);

    await runFFmpeg(muxArgs, cwd, 'Final Mux');

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n🎉 [Humanologi Engine] Successfully rendered Part ${partNum}!`);
    console.log(`   Output: ${finalOutput}`);
    console.log(`   Elapsed time: ${totalElapsed}s`);
    console.log(`[PROGRESS] stage=done progress=1.00 message="Selesai dalam ${totalElapsed} detik"`);

    // Clean up temporary workspace
    try {
      fs.rmSync(tempWorkDir, { recursive: true, force: true });
    } catch { }
  });

// ─── COMMAND: merge ──────────────────────────────────────────────────────────

program
  .command('merge')
  .description('Merge all rendered Humanologi parts into one final full video')
  .option('-o, --output <path>', 'Custom output MP4 file path')
  .action(async (opts: { output?: string }) => {
    const cwd = process.cwd();
    const outputDir = path.join(cwd, 'output', 'humanologi');
    if (!fs.existsSync(outputDir)) {
      console.error(`❌ Directory not found: ${outputDir}`);
      process.exit(1);
    }

    // Find all part_*.mp4 files
    const allFiles = fs.readdirSync(outputDir);
    const partFiles = allFiles
      .filter((f) => /^part_\d+\.mp4$/i.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
        return numA - numB;
      })
      .map((f) => path.join(outputDir, f));

    if (partFiles.length < 2) {
      console.error(`❌ Minimum 2 rendered part files required to merge. Found: ${partFiles.length}`);
      process.exit(1);
    }

    console.log(`\n======================================================`);
    console.log(`✨ [Humanologi Engine] Merging ${partFiles.length} Parts into Full Video`);
    partFiles.forEach((f, i) => console.log(`   ${i + 1}. ${path.basename(f)}`));
    console.log(`======================================================\n`);

    const finalMergedOutput = opts.output
      ? path.resolve(cwd, opts.output)
      : path.join(outputDir, 'humanologi_full_video.mp4');

    const mergeListPath = path.join(outputDir, `merge_list_${Date.now()}.txt`);
    const mergeContent = partFiles
      .map((f) => `file '${f.replace(/\\/g, '/')}'`)
      .join('\n');
    fs.writeFileSync(mergeListPath, mergeContent, 'utf-8');

    console.log(`[PROGRESS] stage=merge progress=0.20 message="Merging ${partFiles.length} parts..."`);
    const startTime = Date.now();

    const mergeArgs = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', mergeListPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      finalMergedOutput,
    ];

    await runFFmpeg(mergeArgs, cwd, 'Merge Parts');

    try { fs.unlinkSync(mergeListPath); } catch { }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n🎉 Full video successfully created: ${finalMergedOutput}`);
    console.log(`   Elapsed time: ${elapsed}s`);
    console.log(`[PROGRESS] stage=done progress=1.00 message="Full Video selesai dalam ${elapsed}s"`);
  });

program.parse(process.argv);
