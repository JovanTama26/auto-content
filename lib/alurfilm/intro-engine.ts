// lib/alurfilm/intro-engine.ts
import path from 'path';
import fs from 'fs';
import { runFFmpegProgress } from '../../cli/shared/ffmpeg-helpers.js';

// Font paths — assets/fonts/ relative to project root
const FONT_DIR = 'assets/fonts';
const FONT_TITLE = path.join(FONT_DIR, 'Dorsa-Regular.ttf');    // Ultra-Condensed Display / Empire style
const FONT_SUBTITLE = path.join(FONT_DIR, 'Montserrat-ExtraBold.ttf'); // Subtitle / Label

export interface IntroRenderOptions {
  titleText: string;
  subtitleText: string;
  audioPath?: string;
  impactTimestamp?: number;
  duration?: number;
  stylePreset?: 'cinematic_gold' | 'silver_epic' | 'neon_thriller';
  outputPath?: string;
}

// Helper to space out subtitle characters for wide cinematic tracking (e.g. "FILM 2014" -> "F I L M   2 0 1 4")
function formatCinematicTracking(text: string): string {
  if (!text) return '';
  let trimmed = text.trim();
  // Auto-prefix "FILM" if user only provided a 4-digit year like "2014"
  if (/^\d{4}$/.test(trimmed)) {
    trimmed = `FILM ${trimmed}`;
  }
  // If already spaced out, keep as is
  if (trimmed.includes('  ')) return trimmed;
  return trimmed
    .split(/\s+/)
    .map((word) => word.split('').join(' '))
    .join('   ');
}

export async function renderIntroVideo(
  options: IntroRenderOptions,
  onProgress?: (percent: number, msg: string) => void
): Promise<{ success: boolean; outputPath: string; error?: string }> {
  const {
    titleText = 'UNDER THE DOME',
    subtitleText = 'FILM 2013',
    audioPath = 'assets/The Final Horizon.mp3',
    impactTimestamp = 0.48,
    duration = 6.0,
    stylePreset = 'cinematic_gold',
    outputPath = 'output/testing/intro_test.mp4',
  } = options;

  const cwd = process.cwd();
  const resolvedAudio = path.isAbsolute(audioPath) ? audioPath : path.resolve(cwd, audioPath);
  const resolvedOutput = path.isAbsolute(outputPath) ? outputPath : path.resolve(cwd, outputPath);

  const outDir = path.dirname(resolvedOutput);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Define styling based on preset
  let titleColor = '0xE5B83A'; // Gold
  let subtitleColor = '0xFFFFFF'; // White

  if (stylePreset === 'silver_epic') {
    titleColor = '0xE2E8F0';
    subtitleColor = '0x94A3B8';
  } else if (stylePreset === 'neon_thriller') {
    titleColor = '0xEF4444';
    subtitleColor = '0x38BDF8';
  }

  // Resolve font paths absolute from cwd
  const fontTitle = path.isAbsolute(FONT_TITLE) ? FONT_TITLE : path.resolve(cwd, FONT_TITLE);
  const fontSubtitle = path.isAbsolute(FONT_SUBTITLE) ? FONT_SUBTITLE : path.resolve(cwd, FONT_SUBTITLE);

  // FFmpeg drawtext requires escaped colons/backslashes in file/font path on Linux
  const escPath = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
  const fontTitleEsc = escPath(fontTitle);
  const fontSubtitleEsc = escPath(fontSubtitle);

  // Format subtitle with cinematic wide tracking
  const formattedSubtitle = formatCinematicTracking(subtitleText);

  // Write title and subtitle to temp text files so special characters (apostrophes, quotes, colons, commas)
  // never break FFmpeg filtergraph syntax parsing (e.g. titles like "Don't Breathe")
  const tmpDir = path.join(cwd, 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const titleFile = path.join(tmpDir, `intro_title_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.txt`);
  const subtitleFile = path.join(tmpDir, `intro_sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.txt`);
  fs.writeFileSync(titleFile, titleText, 'utf-8');
  fs.writeFileSync(subtitleFile, formattedSubtitle, 'utf-8');

  const titleFileEsc = escPath(titleFile);
  const subtitleFileEsc = escPath(subtitleFile);

  const titleFadeAlpha = `if(lt(t,${impactTimestamp}),0,if(lt(t,${impactTimestamp + 0.3}),(t-${impactTimestamp})/0.3,if(gt(t,${duration - 1.0}),(${duration}-t)/1.0,1)))`;
  const subtitleFadeAlpha = `if(lt(t,${impactTimestamp + 0.1}),0,if(lt(t,${impactTimestamp + 0.4}),(t-${impactTimestamp}-0.1)/0.3,if(gt(t,${duration - 1.0}),(${duration}-t)/1.0,1)))`;

  // Dynamic font sizing for Dorsa ultra-condensed title
  const titleLen = titleText.trim().length;
  let titleFontSize = 320;
  let titleYOffset = 45;
  let subYOffset = 135;

  if (titleLen > 24) {
    titleFontSize = 210;
    titleYOffset = 35;
    subYOffset = 110;
  } else if (titleLen > 16) {
    titleFontSize = 250;
    titleYOffset = 40;
    subYOffset = 120;
  } else if (titleLen > 10) {
    titleFontSize = 280;
    titleYOffset = 45;
    subYOffset = 130;
  }

  const filterComplex = [
    `color=c=black:s=1920x1080:d=${duration}:r=30[bg]`,
    // Drop shadow layer for title (offset +4px, semi-transparent black)
    `[bg]drawtext=textfile='${titleFileEsc}':fontfile='${fontTitleEsc}':fontcolor=0x000000:fontsize=${titleFontSize}:x=(w-text_w)/2+4:y=(h-text_h)/2-${titleYOffset - 4}:enable='between(t,${impactTimestamp},${duration})':alpha='${titleFadeAlpha}*0.6'[shadow]`,
    // Main title — Dorsa (Empire ultra-condensed style)
    `[shadow]drawtext=textfile='${titleFileEsc}':fontfile='${fontTitleEsc}':fontcolor=${titleColor}:fontsize=${titleFontSize}:x=(w-text_w)/2:y=(h-text_h)/2-${titleYOffset}:enable='between(t,${impactTimestamp},${duration})':alpha='${titleFadeAlpha}'[v1]`,
    // Subtitle — Montserrat ExtraBold with wide cinematic tracking (FILM [YEAR])
    `[v1]drawtext=textfile='${subtitleFileEsc}':fontfile='${fontSubtitleEsc}':fontcolor=${subtitleColor}:fontsize=34:x=(w-text_w)/2:y=(h-text_h)/2+${subYOffset}:enable='between(t,${impactTimestamp + 0.1},${duration})':alpha='${subtitleFadeAlpha}'[vfinal]`
  ].join(';');

  const ffmpegArgs = [
    '-y',
    '-progress', 'pipe:1',
    '-f', 'lavfi', '-i', `color=c=black:s=1920x1080:d=${duration}:r=30`,
    '-i', resolvedAudio,
    '-filter_complex', filterComplex,
    '-map', '[vfinal]',
    '-map', '1:a',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-r', '30',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    resolvedOutput
  ];

  try {
    await runFFmpegProgress(ffmpegArgs, cwd, duration, (pct, msg) => {
      if (onProgress) {
        onProgress(pct, msg);
      }
    });

    return { success: true, outputPath: resolvedOutput };
  } catch (err: any) {
    console.error('❌ Intro render error:', err);
    return { success: false, outputPath: resolvedOutput, error: err.message };
  } finally {
    try { fs.unlinkSync(titleFile); } catch {}
    try { fs.unlinkSync(subtitleFile); } catch {}
  }
}
