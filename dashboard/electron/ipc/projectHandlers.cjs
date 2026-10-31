// dashboard/electron/ipc/projectHandlers.cjs
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { clearCloudData } = require('../shared/supabaseClient.cjs');

function register(ipcMain, { paths: p, media, ffmpeg, aiClient, loadPrompt, getMainWindow }) {
  // ─── Content ID Helper ────────────────────────────────
  ipcMain.handle('get-content-id', async (_event, mode) => {
    return p.getOrGenerateContentId(mode);
  });

  // ─── Reset project workspace ───────────────────────────
  ipcMain.handle('reset-project', async (_event, mode = 'longform') => {
    if (mode === 'faceless') {
      try {
        const facelessStateFile = path.join(p.FACELESS_INPUT_DIR, 'faceless_state.json');
        if (fs.existsSync(facelessStateFile)) fs.unlinkSync(facelessStateFile);
      } catch (err) {
        console.warn('[Reset Faceless] Gagal membersihkan state:', err.message);
      }
      return { success: true, content_id: 'WV-FACELESS-DRAFT' };
    }
    if (mode === 'humanologi') {
      try {
        let oldContentId = null;
        try {
          oldContentId = p.getOrGenerateContentId('humanologi');
        } catch (e) {
          console.warn('[Reset Humanologi] Could not retrieve old content ID:', e.message);
        }

        if (oldContentId) {
          console.log(`🧹 [Reset Humanologi] Purging Supabase cloud data (Target ID: ${oldContentId})...`);
          try {
            await clearCloudData(oldContentId);
          } catch (cloudErr) {
            console.warn('⚠️ [Reset Humanologi] Failed or partial cloud purge:', cloudErr.message);
          }
        }

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randStr = Math.random().toString(36).substring(2, 6).toUpperCase();
        const newId = `WV-HUMAN-${dateStr}-${randStr}`;

        console.log(`🧹 [Reset Humanologi] Clearing all Humanologi workspace files and setting new ID: ${newId}`);

        // 1. Clear input/humanologi JSON files
        const narasiJson = path.join(p.HUMANOLOGI_INPUT_DIR, 'humanologi_narasi.json');
        const audiosJson = path.join(p.HUMANOLOGI_INPUT_DIR, 'humanologi_audios.json');
        if (fs.existsSync(narasiJson)) {
          try { fs.unlinkSync(narasiJson); } catch (e) { console.error('[Reset Humanologi] Failed unlinking narasi json:', e); }
        }
        if (fs.existsSync(audiosJson)) {
          try { fs.unlinkSync(audiosJson); } catch (e) { console.error('[Reset Humanologi] Failed unlinking audios json:', e); }
        }

        // 2. Clear input/humanologi subdirectories (audio, transcripts, scenes, images)
        const subdirsToClear = [
          p.HUMANOLOGI_AUDIO_DIR,
          p.HUMANOLOGI_TRANSCRIPTS_DIR,
          p.HUMANOLOGI_SCENES_DIR,
          p.HUMANOLOGI_IMAGES_DIR,
        ];
        for (const dir of subdirsToClear) {
          if (fs.existsSync(dir)) {
            try {
              const files = fs.readdirSync(dir);
              for (const f of files) {
                try { fs.rmSync(path.join(dir, f), { recursive: true, force: true }); } catch (err) {
                  console.error(`[Reset Humanologi] Failed to remove ${f} from ${dir}:`, err);
                }
              }
            } catch (e) {
              console.error(`[Reset Humanologi] Error reading dir ${dir}:`, e);
            }
          } else {
            fs.mkdirSync(dir, { recursive: true });
          }
        }

        // 3. Clear output/humanologi (rendered MP4s and subtitle files)
        if (fs.existsSync(p.HUMANOLOGI_OUTPUT_DIR)) {
          try {
            const outFiles = fs.readdirSync(p.HUMANOLOGI_OUTPUT_DIR);
            for (const f of outFiles) {
              try { fs.rmSync(path.join(p.HUMANOLOGI_OUTPUT_DIR, f), { recursive: true, force: true }); } catch (err) {
                console.error(`[Reset Humanologi] Failed to remove output file ${f}:`, err);
              }
            }
          } catch (e) {
            console.error('[Reset Humanologi] Error reading output dir:', e);
          }
        } else {
          fs.mkdirSync(p.HUMANOLOGI_OUTPUT_DIR, { recursive: true });
        }

        // 4. Update .current_content_id
        if (!fs.existsSync(p.HUMANOLOGI_INPUT_DIR)) fs.mkdirSync(p.HUMANOLOGI_INPUT_DIR, { recursive: true });
        fs.writeFileSync(path.join(p.HUMANOLOGI_INPUT_DIR, '.current_content_id'), newId, 'utf-8');

        return { success: true, content_id: newId };
      } catch (err) {
        console.error('[Reset Humanologi] Error:', err);
        return { success: false, error: err.message };
      }
    }
    const isLongform = mode === 'longform';
    try {
      let oldContentId = null;
      try {
        oldContentId = p.getOrGenerateContentId('longform');
      } catch (e) {
        console.warn('[Reset Longform] Could not retrieve old content ID:', e.message);
      }

      console.log(`🧹 [Reset Longform] Purging Supabase cloud data (Target ID: ${oldContentId || 'all'})...`);
      try {
        await clearCloudData(oldContentId);
      } catch (cloudErr) {
        console.warn('⚠️ [Reset Longform] Failed or partial cloud purge:', cloudErr.message);
      }

      const outputDir = path.join(p.PROJECT_ROOT, 'output');
      const inputDir = path.join(p.PROJECT_ROOT, 'input');
      const alurfilmDir = path.join(p.PROJECT_ROOT, 'input', 'alurfilm');
      const alurfilmChunksDir = path.join(p.PROJECT_ROOT, 'input', 'alurfilm', 'chunks');
      const assetsDir = path.join(p.PROJECT_ROOT, 'input', 'assets');
      const tmpDir = path.join(p.PROJECT_ROOT, 'input', '.tmp');

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const randStr = Math.random().toString(36).substring(2, 6).toUpperCase();
      const prefix = 'WV-FILM';
      const newId = `${prefix}-${dateStr}-${randStr}`;

      console.log(`🧹 [Reset Longform] Clearing all longform files and setting new Content ID: ${newId}`);
      if (fs.existsSync(alurfilmDir)) {
        try {
          const items = fs.readdirSync(alurfilmDir);
          for (const item of items) {
            try { fs.rmSync(path.join(alurfilmDir, item), { recursive: true, force: true }); } catch (err) {
              console.error(`[Reset Longform] Failed to delete ${item}:`, err);
            }
          }
        } catch (e) {
          console.error('[Reset Longform] Error reading input/alurfilm:', e);
        }
      } else {
        fs.mkdirSync(alurfilmDir, { recursive: true });
      }

      if (fs.existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir);
        for (const f of files) { try { fs.unlinkSync(path.join(outputDir, f)); } catch { } }
      }
      const mappingFile = path.join(inputDir, 'longform_mapping.json');
      const defaultMapping = {
        settings: { fps: 30, format: "16:9", fg_aspect: "16:9", bgm: "random", content_id: newId },
        timeline: []
      };
      fs.writeFileSync(mappingFile, JSON.stringify(defaultMapping, null, 2), 'utf-8');
      if (!fs.existsSync(alurfilmDir)) fs.mkdirSync(alurfilmDir, { recursive: true });
      fs.writeFileSync(path.join(alurfilmDir, '.current_content_id'), newId, 'utf-8');
      return { success: true, content_id: newId };
    } catch (err) {
      console.error('Reset project error:', err);
      return { success: false, error: err.message };
    }
  });

  // ─── List project assets ──────────────────────────────
  ipcMain.handle('list-project-assets', async () => {
    const assetsDir = path.join(p.PROJECT_ROOT, 'assets');
    if (!fs.existsSync(assetsDir)) return { logos: [], bgms: [] };

    const logos = [];
    const bgms = [];

    const scanDir = (dir) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile()) {
          const relPath = path.relative(p.PROJECT_ROOT, fullPath);
          if (entry.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
            logos.push({ name: entry.name, path: relPath, fullPath, url: media.mediaUrl(fullPath) });
          } else if (entry.name.match(/\.(mp3|wav|m4a|aac|flac)$/i)) {
            bgms.push({ name: entry.name, path: relPath, fullPath, url: media.mediaUrl(fullPath) });
          }
        }
      }
    };

    scanDir(assetsDir);
    return { logos, bgms };
  });
}

module.exports = { register };
