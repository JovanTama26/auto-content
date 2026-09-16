
// dashboard/electron/ipc/humanologiHandlers.cjs
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chatCompletion, streamChatCompletion, extractCleanJsonObject } = require('../aiClient.cjs');

/**
 * Context-aware sentence & clause splitter for Humanologi documentary video pacing (~5 - 9s per visual shot)
 * Keeps natural sentences intact; splits very long sentences (>20 words) at major contrast/causal clauses.
 * Results in ~35 - 50 coherent contextual scenes per part (previously ~150 fragmented scenes).
 */
function splitHumanologiNarrationWithContext(text) {
  if (!text || typeof text !== 'string') return [];
  const normalized = text.replace(/\.\.\./g, '…').trim();
  const baseSentences = normalized
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const rawItems = [];
  for (const sent of baseSentences) {
    const subPhrases = splitLongSentenceByContext(sent);
    for (const p of subPhrases) {
      if (p.trim()) {
        rawItems.push({
          text: p.trim(),
          sentenceContext: sent,
        });
      }
    }
  }

  // Merge any accidental tiny fragments (<= 2 words)
  const merged = [];
  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (!item.text) continue;
    const words = item.text.split(/\s+/).filter(Boolean);
    if (words.length <= 2 && i + 1 < rawItems.length) {
      rawItems[i + 1].text = item.text + ' ' + rawItems[i + 1].text;
      continue;
    }
    if (words.length <= 2 && merged.length > 0) {
      merged[merged.length - 1].text = merged[merged.length - 1].text + ' ' + item.text;
      continue;
    }
    merged.push(item);
  }
  return merged;
}

function splitHumanologiNarration(text) {
  return splitHumanologiNarrationWithContext(text).map((i) => i.text);
}

function splitLongSentenceByContext(sent) {
  const words = sent.split(/\s+/).filter(Boolean);
  // Sentences up to 20 words stay 100% intact as a single contextual scene
  if (words.length <= 20) return [sent];

  const contrastKeywords = [
    'tapi', 'tetapi', 'namun', 'sedangkan', 'sementara', 'sementara itu',
    'padahal', 'sehingga', 'karena itu', 'bahkan', 'di satu sisi', 'di sisi lain'
  ];

  if (sent.includes(',')) {
    const commaParts = sent.split(/,\s+/);
    if (commaParts.length >= 2) {
      let currentWords = 0;
      let splitIdx = -1;

      for (let i = 0; i < commaParts.length - 1; i++) {
        const pWords = commaParts[i].split(/\s+/).filter(Boolean).length;
        currentWords += pWords;
        const nextPart = commaParts[i + 1].trim();
        const hasContrast = contrastKeywords.some((kw) => nextPart.toLowerCase().startsWith(kw));

        if (currentWords >= 7 && (words.length - currentWords) >= 7) {
          if (hasContrast || currentWords >= 12) {
            splitIdx = i;
            break;
          }
        }
      }

      if (splitIdx !== -1) {
        const leftParts = commaParts.slice(0, splitIdx + 1);
        const rightParts = commaParts.slice(splitIdx + 1);
        let left = leftParts.join(', ');
        let right = rightParts.join(', ');
        if (!/[.!?…,]$/.test(left)) left += ',';
        return [left, right];
      }
    }
  }
  return [sent];
}

function register(ipcMain, { paths: p, media, ffmpeg }) {
  /**
   * Retrieve the Humanologi master narration prompt markdown
   */
  ipcMain.handle('get-humanologi-prompt', async () => {
    try {
      const promptPath = path.join(p.HUMANOLOGI_PROMPTS_DIR, 'humanologi-narasi-prompt.md');
      if (fs.existsSync(promptPath)) {
        const content = fs.readFileSync(promptPath, 'utf-8');
        return { success: true, prompt: content };
      }
      return { success: false, error: 'File prompt Humanologi tidak ditemukan.' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Retrieve the latest Humanologi narration JSON
   */
  ipcMain.handle('get-latest-humanologi-narasi', async () => {
    try {
      const jsonPath = path.join(p.HUMANOLOGI_INPUT_DIR, 'humanologi_narasi.json');
      if (fs.existsSync(jsonPath)) {
        const content = fs.readFileSync(jsonPath, 'utf-8');
        return { success: true, data: JSON.parse(content) };
      }
      return { success: false };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Save Humanologi narration JSON
   */
  ipcMain.handle('save-humanologi-narasi', async (_event, { data }) => {
    try {
      if (!data) return { success: false, error: 'Data naskah JSON kosong.' };
      if (!fs.existsSync(p.HUMANOLOGI_INPUT_DIR)) {
        fs.mkdirSync(p.HUMANOLOGI_INPUT_DIR, { recursive: true });
      }
      const jsonPath = path.join(p.HUMANOLOGI_INPUT_DIR, 'humanologi_narasi.json');
      fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
      return { success: true, filePath: jsonPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * List all uploaded narrator audios for Humanologi
   */
  ipcMain.handle('list-humanologi-audios', async () => {
    try {
      if (!fs.existsSync(p.HUMANOLOGI_AUDIO_DIR)) {
        fs.mkdirSync(p.HUMANOLOGI_AUDIO_DIR, { recursive: true });
      }

      const audiosJsonPath = path.join(p.HUMANOLOGI_INPUT_DIR, 'humanologi_audios.json');
      let records = [];
      if (fs.existsSync(audiosJsonPath)) {
        try {
          records = JSON.parse(fs.readFileSync(audiosJsonPath, 'utf-8')) || [];
        } catch {
          records = [];
        }
      }

      // Filter existing files
      let updated = false;
      const validRecords = [];
      for (const rec of records) {
        if (rec.filePath && fs.existsSync(rec.filePath)) {
          validRecords.push({
            ...rec,
            url: media.mediaUrl(rec.filePath),
          });
        } else {
          updated = true;
        }
      }

      // Scan directory for unmapped part audio files (auto-discovery)
      const existingFiles = fs.readdirSync(p.HUMANOLOGI_AUDIO_DIR);
      for (const file of existingFiles) {
        if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file)) {
          const match = file.match(/^part_(\d+)_/i);
          if (match) {
            const partNum = parseInt(match[1], 10);
            const alreadyLogged = validRecords.find((r) => r.part === partNum);
            if (!alreadyLogged) {
              const fullPath = path.join(p.HUMANOLOGI_AUDIO_DIR, file);
              const stat = fs.statSync(fullPath);
              let duration = 0;
              if (ffmpeg && ffmpeg.getAudioDurationHelper) {
                duration = await ffmpeg.getAudioDurationHelper(fullPath);
              }
              validRecords.push({
                id: `humanologi_audio_part_${partNum}`,
                part: partNum,
                name: file,
                originalName: file,
                filePath: fullPath,
                size: stat.size,
                duration: duration || 0,
                url: media.mediaUrl(fullPath),
                uploadedAt: stat.birthtime.toISOString(),
              });
              updated = true;
            }
          }
        }
      }

      validRecords.sort((a, b) => a.part - b.part);

      if (updated || !fs.existsSync(audiosJsonPath)) {
        fs.writeFileSync(
          audiosJsonPath,
          JSON.stringify(
            validRecords.map((r) => {
              const { url, ...rest } = r;
              return rest;
            }),
            null,
            2
          ),
          'utf-8'
        );
      }

      return { success: true, audios: validRecords };
    } catch (err) {
      return { success: false, audios: [], error: err.message };
    }
  });

  /**
   * Upload narrator audio for a specific part
   */
  ipcMain.handle('upload-humanologi-audio', async (_event, { part, filePath }) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, error: 'File audio sumber tidak ditemukan.' };
      }
      const partNum = Number(part);
      if (isNaN(partNum) || partNum < 1) {
        return { success: false, error: 'Nomor part tidak valid.' };
      }

      if (!fs.existsSync(p.HUMANOLOGI_AUDIO_DIR)) {
        fs.mkdirSync(p.HUMANOLOGI_AUDIO_DIR, { recursive: true });
      }

      const ext = path.extname(filePath) || '.mp3';
      const targetName = `part_${partNum}_narration${ext}`;
      const destPath = path.join(p.HUMANOLOGI_AUDIO_DIR, targetName);

      fs.copyFileSync(filePath, destPath);
      const stat = fs.statSync(destPath);

      let duration = 0;
      if (ffmpeg && ffmpeg.getAudioDurationHelper) {
        duration = await ffmpeg.getAudioDurationHelper(destPath);
      }

      const audiosJsonPath = path.join(p.HUMANOLOGI_INPUT_DIR, 'humanologi_audios.json');
      let records = [];
      if (fs.existsSync(audiosJsonPath)) {
        try {
          records = JSON.parse(fs.readFileSync(audiosJsonPath, 'utf-8')) || [];
        } catch {
          records = [];
        }
      }

      const newRecord = {
        id: `humanologi_audio_part_${partNum}`,
        part: partNum,
        name: targetName,
        originalName: path.basename(filePath),
        filePath: destPath,
        size: stat.size,
        duration: duration || 0,
        uploadedAt: new Date().toISOString(),
      };

      // Replace if part exists, otherwise add
      records = records.filter((r) => r.part !== partNum);
      records.push(newRecord);
      records.sort((a, b) => a.part - b.part);

      fs.writeFileSync(audiosJsonPath, JSON.stringify(records, null, 2), 'utf-8');

      return {
        success: true,
        audio: {
          ...newRecord,
          url: media.mediaUrl(destPath),
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Delete narrator audio for a specific part
   */
  ipcMain.handle('delete-humanologi-audio', async (_event, { part }) => {
    try {
      const partNum = Number(part);
      const audiosJsonPath = path.join(p.HUMANOLOGI_INPUT_DIR, 'humanologi_audios.json');
      let records = [];
      if (fs.existsSync(audiosJsonPath)) {
        try {
          records = JSON.parse(fs.readFileSync(audiosJsonPath, 'utf-8')) || [];
        } catch {
          records = [];
        }
      }

      const target = records.find((r) => r.part === partNum);
      if (target && target.filePath && fs.existsSync(target.filePath)) {
        try {
          fs.unlinkSync(target.filePath);
        } catch (e) {
          console.warn('[delete-humanologi-audio] Failed to unlink file:', e.message);
        }
      }

      // Also clean any loose part_${partNum}_* in audio dir
      if (fs.existsSync(p.HUMANOLOGI_AUDIO_DIR)) {
        const files = fs.readdirSync(p.HUMANOLOGI_AUDIO_DIR);
        for (const f of files) {
          if (f.startsWith(`part_${partNum}_`)) {
            try {
              fs.unlinkSync(path.join(p.HUMANOLOGI_AUDIO_DIR, f));
            } catch { }
          }
        }
      }

      records = records.filter((r) => r.part !== partNum);
      fs.writeFileSync(audiosJsonPath, JSON.stringify(records, null, 2), 'utf-8');

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Get audio directory path for open-in-folder
   */
  ipcMain.handle('get-humanologi-audio-dir', async () => {
    return { success: true, dir: p.HUMANOLOGI_AUDIO_DIR };
  });

  /**
   * Get Humanologi transcript & visual mapping master prompt
   */
  ipcMain.handle('get-humanologi-transcript-prompt', async () => {
    try {
      const promptPath = path.join(
        p.HUMANOLOGI_PROMPTS_DIR,
        'humanologi-transcript-mapping-prompt.md'
      );
      if (fs.existsSync(promptPath)) {
        const content = fs.readFileSync(promptPath, 'utf-8');
        return { success: true, prompt: content };
      }
      return { success: false, error: 'Prompt transcript mapping tidak ditemukan.' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Get Visual Director & Scene Generator master prompt
   */
  ipcMain.handle('get-humanologi-visual-scenes-prompt', async () => {
    try {
      const promptPath = path.join(
        p.HUMANOLOGI_PROMPTS_DIR,
        'humanologi-visual-scenes-prompt.md'
      );
      if (fs.existsSync(promptPath)) {
        const content = fs.readFileSync(promptPath, 'utf-8');
        return { success: true, prompt: content };
      }
      return { success: false, error: 'Prompt visual scenes tidak ditemukan.' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Generate visual scenes via 9router with exact transcript-derived duration & real-time streaming
   */
  ipcMain.handle('generate-humanologi-scenes-9router', async (event, { part = 1, model = 'ag/gemini-3-flash' } = {}) => {
    try {
      const partNum = Number(part) || 1;
      const narasiJsonPath = path.join(p.HUMANOLOGI_INPUT_DIR, 'humanologi_narasi.json');
      if (!fs.existsSync(narasiJsonPath)) {
        return { success: false, error: 'File humanologi_narasi.json belum ditemukan di Step 1.' };
      }
      const narasiData = JSON.parse(fs.readFileSync(narasiJsonPath, 'utf-8'));
      const partData = (narasiData.narasi || []).find((n) => n.part === partNum);
      if (!partData || !partData.teks) {
        return { success: false, error: `Naskah narasi Part #${partNum} belum ditemukan di Step 1.` };
      }

      // Check transcript for word timing
      const transcriptPath = path.join(p.HUMANOLOGI_TRANSCRIPTS_DIR, `part_${partNum}_transcript.json`);
      if (!fs.existsSync(transcriptPath)) {
        return {
          success: false,
          error: `Transcript part_${partNum}_transcript.json belum ada. Silakan jalankan Faster-Whisper (Step 3) terlebih dahulu agar durasi kata tersinkronisasi.`,
        };
      }
      const transcriptData = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
      const words = transcriptData.entries || [];
      if (words.length === 0) {
        return { success: false, error: `Transcript Part #${partNum} kosong.` };
      }

      // Split into short punchy phrases (3 - 6 words each) with full sentence context
      const phraseItems = splitHumanologiNarrationWithContext(partData.teks);
      let cursor = 0;
      const scenesWithDuration = [];

      for (let i = 0; i < phraseItems.length; i++) {
        const item = phraseItems[i];
        const text = item.text;
        const tokens = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
        if (tokens.length === 0) continue;

        let matched = [];
        let searchCursor = cursor;
        let matchedCount = 0;

        while (searchCursor < words.length && matchedCount < tokens.length) {
          const w = words[searchCursor];
          const rawW = w ? (w.text || w.word || '') : '';
          const cleanW = String(rawW).toLowerCase().replace(/[^\w\s]/g, '').trim();
          if (cleanW === tokens[matchedCount]) {
            matched.push(w);
            matchedCount++;
          }
          searchCursor++;
        }

        if (matched.length < tokens.length) {
          const fallbackEnd = cursor + tokens.length;
          matched = words.slice(cursor, Math.min(fallbackEnd, words.length));
          cursor = Math.min(fallbackEnd, words.length);
        } else {
          cursor = searchCursor;
        }

        const start = matched.length > 0 ? matched[0].start_seconds : 0;
        const end = matched.length > 0 ? matched[matched.length - 1].end_seconds : start + 2;
        const wordSum = matched.reduce((acc, w) => acc + (w.end_seconds - w.start_seconds), 0);

        scenesWithDuration.push({
          scene_number: i + 1,
          part_narasi: partNum,
          start_seconds: start,
          end_seconds: end,
          durasi_detik: Number((end - start).toFixed(2)),
          durasi_kata_total: Number(wordSum.toFixed(2)),
          potongan_narasi: text,
          konteks_kalimat: item.sentenceContext,
          word_count: tokens.length,
        });
      }

      // Smooth gaps (<= 1.2s) between consecutive scenes so video transitions are seamless
      for (let i = 0; i < scenesWithDuration.length - 1; i++) {
        const curr = scenesWithDuration[i];
        const next = scenesWithDuration[i + 1];
        if (curr.end_seconds < next.start_seconds && (next.start_seconds - curr.end_seconds) <= 1.2) {
          curr.end_seconds = next.start_seconds;
          curr.durasi_detik = Number((curr.end_seconds - curr.start_seconds).toFixed(2));
        }
      }

      // Batch call 9router with streaming
      const BATCH_SIZE = 25;
      const visualPromptsMap = {};
      const totalBatches = Math.ceil(scenesWithDuration.length / BATCH_SIZE);

      event.sender.send('humanologi-scenes-stream-progress', {
        type: 'start',
        part: partNum,
        totalScenes: scenesWithDuration.length,
        totalBatches,
        percent: 0,
        message: `Memulai streaming 9router (${model}) untuk ${scenesWithDuration.length} adegan konteks kalimat...`,
      });

      for (let b = 0; b < scenesWithDuration.length; b += BATCH_SIZE) {
        const batchNum = Math.floor(b / BATCH_SIZE) + 1;
        const batch = scenesWithDuration.slice(b, b + BATCH_SIZE);
        const startScene = batch[0].scene_number;
        const endScene = batch[batch.length - 1].scene_number;

        event.sender.send('humanologi-scenes-stream-progress', {
          type: 'batch-start',
          part: partNum,
          batchNum,
          totalBatches,
          percent: Math.round(((batchNum - 1) / totalBatches) * 100),
          message: `Mengirim Batch ${batchNum}/${totalBatches} (Scene #${startScene} - #${endScene})...`,
        });

        const prompt = `Kamu adalah visual director untuk channel YouTube edukasi HUMANOLOGI.
Tugasmu adalah membuat deskripsi_visual_singkat dan image_prompt untuk setiap adegan visual berbasis konteks kalimat utuh di bawah ini agar membentuk animasi edukasi yang LINIER, KONSISTEN, dan BERSAMBUNG (ala channel YouTube Humanova / MinutePhysics / Kok Bisa?).
Setiap adegan mewakili satu konteks kalimat narasi utuh (~5 - 9 detik). Rancang visual ilustrasi yang menceritakan makna gagasan tersebut secara utuh dan jelas!

JUDUL VIDEO: "${narasiData.judul_video || 'Humanologi'}"
BAGIAN: Part #${partNum} - ${partData.judul_bagian || ''}

==================================================
NASKAH LENGKAP PART #${partNum} (KONTEKS CERITA BESAR):
==================================================
${partData.teks}
==================================================

PANDUAN GAYA VISUAL MUTLAK (HUMANOVA / WHITEBOARD DOODLE STYLE):
Wajib sertakan persis di awal SETIAP image_prompt:
"simple hand-drawn 2D cartoon doodle illustration, minimalist educational YouTube whiteboard animation style, thick black marker pen outlines, flat solid color fills, clean hand-drawn line art, pure solid stark white background, isolated on pure white void, 16:9, no text in image"

ATURAN VISUAL & KONTINUITAS (SANGAT KRUSIAL):
1. 🛑 BACKGROUND MUTLAK PUTIH POLOS PEKAT (#FFFFFF):
   - Background WAJIB polos putih bersih tanpa gradasi, tanpa tekstur rumit, dan tanpa latar pemandangan penuh.
   - Semua elemen (matahari, gurun pasir, pohon, diagram sains, DNA) digambar sebagai DOODLE SPIDOL SIMPEL yang terisolasi di atas kanvas putih polos.
2. ✍️ GAYA ILUSTRASI HANDWRITING / DOODLE (HUMANOVA STYLE):
   - Gambar tangan kartun 2D simpel dengan garis spidol/marker hitam tebal yang organik.
   - Warna flat/solid bersih, tidak berlebihan detailnya.
3. 👤 KARAKTER & EKSPRESI DEWASA (BUKAN KANAK-KANAK):
   - Karakter manusia 2D simpel bertubuh proporsional dewasa (BUKAN chibi anak TK, BUKAN balita).
   - Mata berupa titik hitam simpel (simple dot eyes) atau garis kurva dengan alis ekspresif.
   - Pose berpikir/menganalisis ala narator sains: tangan memegang dagu (hand on chin thinking pose), penasaran, mengamati, atau menjelaskan.
4. 🔗 KONTINUITAS & KONSISTENSI ANTAR SCENE (LINEAR STORYTELLING):
   - JANGAN membuat adegan yang berdiri sendiri-sendiri tanpa konteks!
   - Baca "konteks_kalimat" dan "Naskah Lengkap": jika 2 atau lebih scene merupakan bagian dari 1 kalimat atau 1 ide, visualnya HARUS MENYAMBUNG dan memperlihatkan karakter yang sama!
   - Karakter konsisten:
     * Pria Arab: Gamis/thobe putih simpel, sorban/penutup kepala simpel.
     * Pria Papua: Pakaian tradisional Papua simpel, rambut ikal hitam.
     * Narator/Ilmuwan: Karakter kartun memakai jas lab putih (white lab coat) saat membahas sains/sel/biologi.
   - Jika satu scene membahas satu orang (misal Arab di gurun), lalu scene berikutnya orang kedua (Papua di hutan), buat kontras yang jelas namun tetap konsisten gayanya di atas latar putih polos!

FORMAT OUTPUT WAJIB JSON VALID (array of objects):
[
  {
    "scene_number": angka,
    "deskripsi_visual_singkat": "string (1 kalimat bahasa Indonesia tentang aksi/karakter yang tampil)",
    "image_prompt": "string (prompt bahasa Inggris lengkap ±45-65 kata diawali formula gaya wajib di atas, diakhiri 'isolated on pure stark white background')"
  }
]

DAFTAR SCENE DENGAN KONTEKS KALIMAT:
${JSON.stringify(
  batch.map((item) => ({
    scene_number: item.scene_number,
    potongan_narasi: item.potongan_narasi,
    konteks_kalimat: item.konteks_kalimat,
  })),
  null,
  2
)}
`;

        let rawResponse = '';
        try {
          rawResponse = await streamChatCompletion({
            prompt,
            model: model || 'ag/gemini-3-flash',
            jsonMode: true,
            temperature: 0.7,
            onChunk: (delta) => {
              event.sender.send('humanologi-scenes-stream-progress', {
                type: 'chunk',
                part: partNum,
                batchNum,
                totalBatches,
                delta,
              });
            },
          });
        } catch (streamErr) {
          console.warn('[streamChatCompletion fallback to chatCompletion]:', streamErr.message);
          rawResponse = await chatCompletion({
            prompt,
            model: model || 'ag/gemini-3-flash',
            jsonMode: true,
            temperature: 0.7,
          });
        }

        try {
          const cleanJson = extractCleanJsonObject(rawResponse);
          const parsedBatch = JSON.parse(cleanJson);
          const list = Array.isArray(parsedBatch) ? parsedBatch : (parsedBatch.scenes || parsedBatch.items || []);
          for (const item of list) {
            visualPromptsMap[item.scene_number] = item;
          }

          event.sender.send('humanologi-scenes-stream-progress', {
            type: 'batch-done',
            part: partNum,
            batchNum,
            totalBatches,
            percent: Math.round((batchNum / totalBatches) * 100),
            message: `Batch ${batchNum}/${totalBatches} selesai terurai (${list.length} scene baru).`,
            newScenesCount: Object.keys(visualPromptsMap).length,
          });
        } catch (e) {
          console.warn('[generate-humanologi-scenes-9router] Batch parse error:', e.message);
        }
      }

      const finalScenes = scenesWithDuration.map((s) => {
        const ai = visualPromptsMap[s.scene_number] || {};
        return {
          scene_number: s.scene_number,
          part_narasi: s.part_narasi,
          start_seconds: s.start_seconds,
          end_seconds: s.end_seconds,
          durasi_detik: s.durasi_detik,
          durasi_kata_total: s.durasi_kata_total,
          potongan_narasi: s.potongan_narasi,
          konteks_kalimat: s.konteks_kalimat,
          deskripsi_visual_singkat: ai.deskripsi_visual_singkat || `Visualisasi: ${s.potongan_narasi}`,
          image_prompt: ai.image_prompt || `simple hand-drawn 2D cartoon doodle illustration, minimalist educational YouTube whiteboard animation style, thick black marker pen outlines, flat solid color fills, clean hand-drawn line art, pure solid stark white background, isolated on pure white void, 16:9, no text in image, scene depicting ${s.potongan_narasi}, isolated on pure stark white background`,
        };
      });

      const scenesDir = p.HUMANOLOGI_SCENES_DIR || path.join(p.HUMANOLOGI_INPUT_DIR, 'scenes');
      if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });

      const finalData = {
        judul_video: narasiData.judul_video || 'Humanologi',
        part: partNum,
        total_scene: finalScenes.length,
        audio_duration: transcriptData.audio_duration || finalScenes[finalScenes.length - 1]?.end_seconds,
        gaya_visual_global: 'simple hand-drawn 2D cartoon doodle illustration, minimalist educational YouTube whiteboard animation style, thick black marker pen outlines, flat solid color fills, clean hand-drawn line art, pure solid stark white background, isolated on pure white void, 16:9, no text in image',
        scenes: finalScenes,
        updated_at: new Date().toISOString(),
      };

      const outPath = path.join(scenesDir, `part_${partNum}_scenes.json`);
      fs.writeFileSync(outPath, JSON.stringify(finalData, null, 2), 'utf-8');

      event.sender.send('humanologi-scenes-stream-progress', {
        type: 'completed',
        part: partNum,
        percent: 100,
        message: `Sukses! Total ${finalScenes.length} adegan visual berhasil disimpan.`,
        data: finalData,
      });

      return { success: true, data: finalData, filePath: outPath };
    } catch (err) {
      event.sender.send('humanologi-scenes-stream-progress', {
        type: 'error',
        message: err.message,
      });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get generated visual scenes for a part
   */
  ipcMain.handle('get-humanologi-scenes', async (_event, { part = 1 } = {}) => {
    try {
      const partNum = Number(part) || 1;
      const scenesDir = p.HUMANOLOGI_SCENES_DIR || path.join(p.HUMANOLOGI_INPUT_DIR, 'scenes');
      const outPath = path.join(scenesDir, `part_${partNum}_scenes.json`);
      if (fs.existsSync(outPath)) {
        const content = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
        const partImagesDir = path.join(p.HUMANOLOGI_IMAGES_DIR, `part_${partNum}`);
        if (fs.existsSync(partImagesDir) && Array.isArray(content.scenes)) {
          for (const s of content.scenes) {
            const imgFileName = `scene_${String(s.scene_number).padStart(3, '0')}.png`;
            const fullImgPath = path.join(partImagesDir, imgFileName);
            if (fs.existsSync(fullImgPath)) {
              try {
                const fileStat = fs.statSync(fullImgPath);
                if (fileStat.size > 1000) {
                  s.image_path = fullImgPath;
                  s.image_url = `${media.mediaUrl(fullImgPath)}?t=${fileStat.mtimeMs}`;
                }
              } catch {}
            }
          }
        }
        return { success: true, data: content };
      }
      return { success: false };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Save edited visual scenes for a part
   */
  ipcMain.handle('save-humanologi-scenes', async (_event, { part = 1, data } = {}) => {
    try {
      const partNum = Number(part) || 1;
      if (!data) return { success: false, error: 'Data scenes kosong.' };
      const scenesDir = p.HUMANOLOGI_SCENES_DIR || path.join(p.HUMANOLOGI_INPUT_DIR, 'scenes');
      if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
      const outPath = path.join(scenesDir, `part_${partNum}_scenes.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');
      return { success: true, filePath: outPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  let activeFlowChild = null;

  async function downloadAndSaveFlowImage(partNum, sceneNumber, imgInfo) {
    const partImagesDir = path.join(p.HUMANOLOGI_IMAGES_DIR, `part_${partNum}`);
    if (!fs.existsSync(partImagesDir)) {
      fs.mkdirSync(partImagesDir, { recursive: true });
    }
    const destPath = path.join(partImagesDir, `scene_${String(sceneNumber).padStart(3, '0')}.png`);

    const imageUrl = typeof imgInfo === 'string' ? imgInfo : imgInfo?.url;
    const directFilePath = typeof imgInfo === 'object' ? imgInfo?.filePath : null;

    let saved = false;

    // 1. Direct file check if runner saved image buffer directly to disk
    if (directFilePath && fs.existsSync(directFilePath)) {
      try {
        if (fs.statSync(directFilePath).size > 500) {
          if (path.resolve(directFilePath) !== path.resolve(destPath)) {
            fs.copyFileSync(directFilePath, destPath);
          }
          saved = true;
        }
      } catch (e) {
        console.warn('[downloadAndSaveFlowImage] directFilePath copy error:', e.message);
      }
    } else if (fs.existsSync(destPath)) {
      try {
        if (fs.statSync(destPath).size > 500) {
          saved = true;
        }
      } catch {}
    }

    // 2. Fetch image via network with Google Referer headers and cleaned URL
    if (!saved) {
      if (!imageUrl) {
        throw new Error(`Gagal download gambar scene #${sceneNumber}: URL gambar tidak valid`);
      }

      const cleanedUrl = imageUrl
        .replace(/\\u0026/g, '&')
        .replace(/\\u003d/g, '=')
        .replace(/\\u0025/g, '%')
        .replace(/\\/g, '');

      let res, lastErr;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          res = await fetch(cleanedUrl, {
            headers: {
              'Referer': 'https://flow.google.com/',
              'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            },
          });
          if (res.ok) break;
          lastErr = new Error(`HTTP ${res.status}`);
        } catch (err) {
          lastErr = err;
        }
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
      }

      if (!res || !res.ok) {
        throw new Error(`Gagal download gambar scene #${sceneNumber}: ${lastErr?.message || 'Network error'}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      await fs.promises.writeFile(destPath, Buffer.from(arrayBuffer));
      saved = true;
    }

    // Update scenes JSON
    try {
      const scenesDir = p.HUMANOLOGI_SCENES_DIR || path.join(p.HUMANOLOGI_INPUT_DIR, 'scenes');
      const scenesJsonPath = path.join(scenesDir, `part_${partNum}_scenes.json`);
      if (fs.existsSync(scenesJsonPath)) {
        const scenesData = JSON.parse(fs.readFileSync(scenesJsonPath, 'utf-8'));
        if (Array.isArray(scenesData.scenes)) {
          const target = scenesData.scenes.find((s) => Number(s.scene_number) === Number(sceneNumber));
          if (target) {
            target.image_path = destPath;
            target.image_url = `${media.mediaUrl(destPath)}?t=${Date.now()}`;
            fs.writeFileSync(scenesJsonPath, JSON.stringify(scenesData, null, 2), 'utf-8');
          }
        }
      }
    } catch (updateErr) {
      console.warn('[downloadAndSaveFlowImage] Warning updating scenes JSON:', updateErr.message);
    }

    return {
      sceneNumber,
      filePath: destPath,
      url: `${media.mediaUrl(destPath)}?t=${Date.now()}`,
    };
  }

  /**
   * Auto generate images via Google Flow Playwright runner
   */
  ipcMain.handle('generate-humanologi-flow-images', async (event, {
    part = 1,
    concurrency = 5,
    sceneNumbers = [],
    overwriteExisting = false,
    headed = true,
  } = {}) => {
    const partNum = Number(part) || 1;
    const scenesDir = p.HUMANOLOGI_SCENES_DIR || path.join(p.HUMANOLOGI_INPUT_DIR, 'scenes');
    const scenesJsonPath = path.join(scenesDir, `part_${partNum}_scenes.json`);

    if (!fs.existsSync(scenesJsonPath)) {
      return { success: false, error: `File part_${partNum}_scenes.json belum dibuat di Step 4.` };
    }

    const scenesData = JSON.parse(fs.readFileSync(scenesJsonPath, 'utf-8'));
    let scenes = Array.isArray(scenesData.scenes) ? scenesData.scenes : [];
    if (scenes.length === 0) {
      return { success: false, error: 'Daftar scenes kosong.' };
    }

    // Filter by sceneNumbers if specified
    if (Array.isArray(sceneNumbers) && sceneNumbers.length > 0) {
      const allowed = new Set(sceneNumbers.map(Number));
      scenes = scenes.filter((s) => allowed.has(Number(s.scene_number)));
    }

    // Check existing images if not overwriting
    const partImagesDir = path.join(p.HUMANOLOGI_IMAGES_DIR, `part_${partNum}`);
    if (!fs.existsSync(partImagesDir)) {
      fs.mkdirSync(partImagesDir, { recursive: true });
    }

    const itemsToProcess = [];
    for (const s of scenes) {
      const imgFileName = `scene_${String(s.scene_number).padStart(3, '0')}.png`;
      const fullImgPath = path.join(partImagesDir, imgFileName);
      if (!overwriteExisting && fs.existsSync(fullImgPath)) {
        try {
          if (fs.statSync(fullImgPath).size > 1000) {
            continue;
          }
        } catch {}
      }
      itemsToProcess.push({
        segment_id: Number(s.scene_number),
        prompt: s.image_prompt || `simple hand-drawn 2D cartoon doodle illustration, minimalist educational YouTube whiteboard animation style, thick black marker pen outlines, flat solid color fills, clean hand-drawn line art, pure solid stark white background, isolated on pure white void, ${s.potongan_narasi}`,
        output_path: fullImgPath,
      });
    }

    if (itemsToProcess.length === 0) {
      return {
        success: true,
        message: 'Semua gambar untuk scene yang dipilih sudah ada di folder disk.',
        total: 0,
        completed: 0,
      };
    }

    const tempItemsPath = path.join(p.TMP_DIR, `flow_items_part_${partNum}_${Date.now()}.json`);
    fs.writeFileSync(tempItemsPath, JSON.stringify(itemsToProcess, null, 2), 'utf-8');

    const cliPath = path.join(p.PROJECT_ROOT, 'playwright', 'cli.ts');
    const conc = Math.max(1, Number(concurrency) || 5);

    const useTsxBin = fs.existsSync(p.tsxBinPath);
    const cmd = useTsxBin ? p.tsxBinPath : 'npx';
    const baseArgs = useTsxBin ? [cliPath] : ['tsx', cliPath];
    const runArgs = [
      ...baseArgs,
      'batch-runner',
      '-f', tempItemsPath,
      '-c', String(conc),
      headed ? '--headed' : '--no-headed',
    ];

    return new Promise((resolve) => {
      let completedCount = 0;
      const totalCount = itemsToProcess.length;

      const child = spawn(cmd, runArgs, {
        cwd: p.PROJECT_ROOT,
        env: { ...process.env },
        shell: process.platform === 'win32',
      });
      activeFlowChild = child;

      let buffer = '';
      child.stdout.on('data', (data) => {
        const str = data.toString();
        buffer += str;
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.includes('[ITEM_START]')) {
            const segId = Number(trimmed.split('[ITEM_START]')[1].trim());
            try {
              event.sender.send('humanologi-image-chunk-start', {
                part: partNum,
                sceneNumber: segId,
              });
            } catch {}
          } else if (trimmed.includes('[ITEM_LOG]')) {
            const parts = trimmed.split('[ITEM_LOG]')[1].split('|');
            const segId = Number(parts[0].trim());
            const text = parts.slice(1).join('|').trim();
            try {
              event.sender.send('humanologi-image-log', {
                part: partNum,
                sceneNumber: segId,
                text,
              });
            } catch {}
          } else if (trimmed.includes('[ITEM_SUCCESS]')) {
            const parts = trimmed.split('[ITEM_SUCCESS]')[1].split('|');
            const segId = Number(parts[0].trim());
            const jsonStr = parts.slice(1).join('|').trim();
            try {
              const imgObj = JSON.parse(jsonStr);
              if (imgObj) {
                downloadAndSaveFlowImage(partNum, segId, imgObj)
                  .then((saved) => {
                    completedCount++;
                    try {
                      event.sender.send('humanologi-image-log', {
                        part: partNum,
                        sceneNumber: segId,
                        text: `💾 Gambar scene #${segId} tersimpan: ${path.basename(saved.filePath)}`,
                      });
                      event.sender.send('humanologi-image-progress', {
                        part: partNum,
                        current: completedCount,
                        total: totalCount,
                        sceneNumber: segId,
                        status: 'success',
                        imageUrl: saved.url,
                        filePath: saved.filePath,
                      });
                    } catch {}
                  })
                  .catch((err) => {
                    completedCount++;
                    try {
                      event.sender.send('humanologi-image-progress', {
                        part: partNum,
                        current: completedCount,
                        total: totalCount,
                        sceneNumber: segId,
                        status: 'error',
                        error: err.message,
                      });
                    } catch {}
                  });
              }
            } catch (e) {
              console.warn('[ITEM_SUCCESS] Error:', e.message);
            }
          } else if (trimmed.includes('[ITEM_ERROR]')) {
            const parts = trimmed.split('[ITEM_ERROR]')[1].split('|');
            const segId = Number(parts[0].trim());
            const errorMsg = parts.slice(1).join('|').trim();
            completedCount++;
            try {
              event.sender.send('humanologi-image-progress', {
                part: partNum,
                current: completedCount,
                total: totalCount,
                sceneNumber: segId,
                status: 'error',
                error: errorMsg,
              });
            } catch {}
          }
        }
      });

      child.stderr.on('data', (data) => {
        console.warn('[flow batch runner stderr]:', data.toString());
      });

      child.on('close', (code) => {
        activeFlowChild = null;
        try {
          if (fs.existsSync(tempItemsPath)) fs.unlinkSync(tempItemsPath);
        } catch {}

        resolve({
          success: code === 0 || completedCount > 0,
          completed: completedCount,
          total: totalCount,
          exitCode: code,
        });
      });

      child.on('error', (err) => {
        activeFlowChild = null;
        try {
          if (fs.existsSync(tempItemsPath)) fs.unlinkSync(tempItemsPath);
        } catch {}
        resolve({
          success: false,
          error: err.message,
          completed: completedCount,
          total: totalCount,
        });
      });
    });
  });

  /**
   * Cancel ongoing Google Flow image generation
   */
  ipcMain.handle('cancel-humanologi-flow-images', async () => {
    if (activeFlowChild) {
      try {
        activeFlowChild.kill('SIGTERM');
        setTimeout(() => {
          try { activeFlowChild?.kill('SIGKILL'); } catch {}
        }, 1500);
      } catch {}
      activeFlowChild = null;
      return { success: true, message: 'Proses generate image dibatalkan.' };
    }
    return { success: true, message: 'Tidak ada proses berjalan.' };
  });

  /**
   * Get all generated images for a part
   */
  ipcMain.handle('get-humanologi-images', async (_event, { part = 1 } = {}) => {
    try {
      const partNum = Number(part) || 1;
      const partImagesDir = path.join(p.HUMANOLOGI_IMAGES_DIR, `part_${partNum}`);
      if (!fs.existsSync(partImagesDir)) {
        return { success: true, images: [], total: 0 };
      }

      const files = fs.readdirSync(partImagesDir).filter((f) => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.webp'));
      const images = files.map((file) => {
        const fullPath = path.join(partImagesDir, file);
        const match = file.match(/scene_(\d+)/i);
        const sceneNumber = match ? Number(match[1]) : null;
        const stat = fs.statSync(fullPath);
        return {
          scene_number: sceneNumber,
          file_name: file,
          file_path: fullPath,
          url: `${media.mediaUrl(fullPath)}?t=${stat.mtimeMs}`,
          size: stat.size,
        };
      });

      images.sort((a, b) => (a.scene_number || 0) - (b.scene_number || 0));
      return { success: true, images, total: images.length };
    } catch (err) {
      return { success: false, error: err.message, images: [], total: 0 };
    }
  });

  /**
   * Get transcript & visual mapping for a specific part
   */
  ipcMain.handle('get-humanologi-transcript', async (_event, { part }) => {
    try {
      const partNum = Number(part);
      const jsonPath = path.join(p.HUMANOLOGI_TRANSCRIPTS_DIR, `part_${partNum}_transcript.json`);
      if (fs.existsSync(jsonPath)) {
        const content = fs.readFileSync(jsonPath, 'utf-8');
        return { success: true, data: JSON.parse(content) };
      }
      return { success: false };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Save transcript & visual mapping for a specific part
   */
  ipcMain.handle('save-humanologi-transcript', async (_event, { part, data }) => {
    try {
      const partNum = Number(part);
      if (!data) return { success: false, error: 'Payload transcript kosong.' };
      if (!fs.existsSync(p.HUMANOLOGI_TRANSCRIPTS_DIR)) {
        fs.mkdirSync(p.HUMANOLOGI_TRANSCRIPTS_DIR, { recursive: true });
      }
      const jsonPath = path.join(p.HUMANOLOGI_TRANSCRIPTS_DIR, `part_${partNum}_transcript.json`);
      const payload = {
        ...data,
        part: partNum,
        updated_at: new Date().toISOString(),
      };
      fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf-8');
      return { success: true, filePath: jsonPath, data: payload };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * List all transcript & visual mappings
   */
  ipcMain.handle('list-humanologi-transcripts', async () => {
    try {
      if (!fs.existsSync(p.HUMANOLOGI_TRANSCRIPTS_DIR)) {
        fs.mkdirSync(p.HUMANOLOGI_TRANSCRIPTS_DIR, { recursive: true });
      }
      const files = fs.readdirSync(p.HUMANOLOGI_TRANSCRIPTS_DIR);
      const transcripts = {};
      for (const file of files) {
        const match = file.match(/^part_(\d+)_transcript\.json$/i);
        if (match) {
          const partNum = parseInt(match[1], 10);
          const fullPath = path.join(p.HUMANOLOGI_TRANSCRIPTS_DIR, file);
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            transcripts[partNum] = JSON.parse(content);
          } catch {}
        }
      }
      return { success: true, transcripts };
    } catch (err) {
      return { success: false, transcripts: {}, error: err.message };
    }
  });

  /**
   * Run Faster-Whisper alignment for Humanologi part audio & narration
   */
  ipcMain.handle('run-humanologi-whisper-alignment', async (event, { part, model = 'medium' }) => {
    const partNum = Number(part) || 1;
    function sendProgress(stage, progress, log) {
      if (event && event.sender) {
        try {
          event.sender.send('humanologi-alignment-progress', { stage, progress, log, part: partNum });
        } catch {}
      }
    }

    sendProgress('preparing', 5, `Menyiapkan Faster-Whisper untuk Part #${partNum}...`);

    // 1. Find audio file for this part
    let audioPath = null;
    const audiosJsonPath = path.join(p.HUMANOLOGI_INPUT_DIR, 'humanologi_audios.json');
    if (fs.existsSync(audiosJsonPath)) {
      try {
        const records = JSON.parse(fs.readFileSync(audiosJsonPath, 'utf-8'));
        const matched = records.find((r) => r.part === partNum);
        if (matched && matched.filePath && fs.existsSync(matched.filePath)) {
          audioPath = matched.filePath;
        }
      } catch {}
    }

    if (!audioPath && fs.existsSync(p.HUMANOLOGI_AUDIO_DIR)) {
      const candidates = fs.readdirSync(p.HUMANOLOGI_AUDIO_DIR).filter((f) =>
        new RegExp(`^part_${partNum}_`, 'i').test(f)
      );
      if (candidates.length > 0) {
        audioPath = path.join(p.HUMANOLOGI_AUDIO_DIR, candidates[0]);
      }
    }

    if (!audioPath || !fs.existsSync(audioPath)) {
      throw new Error(`File audio untuk Part #${partNum} belum di-upload di Step 2.`);
    }

    // 2. Find narration text for this part
    let scriptText = '';
    const narasiJsonPath = path.join(p.HUMANOLOGI_INPUT_DIR, 'humanologi_narasi.json');
    if (fs.existsSync(narasiJsonPath)) {
      try {
        const narasiData = JSON.parse(fs.readFileSync(narasiJsonPath, 'utf-8'));
        const pItem = (narasiData.narasi || []).find((n) => n.part === partNum);
        if (pItem && pItem.teks) scriptText = pItem.teks;
      } catch {}
    }

    if (!scriptText.trim()) {
      throw new Error(`Naskah narasi Part #${partNum} belum tersimpan di Step 1.`);
    }

    // 3. Prepare paths & split script into punchy scenes
    if (!fs.existsSync(p.HUMANOLOGI_TRANSCRIPTS_DIR)) {
      fs.mkdirSync(p.HUMANOLOGI_TRANSCRIPTS_DIR, { recursive: true });
    }

    const timestamp = Date.now();
    const splitSegments = splitHumanologiNarration(scriptText);
    const sentenceList = splitSegments.map((text, idx) => ({ id: idx + 1, text }));
    const tmpInputPath = path.join(p.HUMANOLOGI_TRANSCRIPTS_DIR, `tmp_input_${partNum}_${timestamp}.json`);
    const tmpOutputPath = path.join(p.HUMANOLOGI_TRANSCRIPTS_DIR, `tmp_output_${partNum}_${timestamp}.json`);
    fs.writeFileSync(tmpInputPath, JSON.stringify({ sentences: sentenceList }, null, 2), 'utf-8');

    const projectRoot = p.PROJECT_ROOT;
    const pythonBin = process.platform === 'win32'
      ? (fs.existsSync(path.join(projectRoot, 'whisperx', 'venv', 'Scripts', 'python.exe'))
          ? path.join(projectRoot, 'whisperx', 'venv', 'Scripts', 'python.exe')
          : 'python')
      : (fs.existsSync(path.join(projectRoot, 'whisperx', 'venv', 'bin', 'python3'))
          ? path.join(projectRoot, 'whisperx', 'venv', 'bin', 'python3')
          : 'python3');
    const alignCli = path.join(projectRoot, 'whisperx', 'align_cli.py');

    if (!fs.existsSync(alignCli)) {
      throw new Error('Script whisperx/align_cli.py tidak ditemukan.');
    }

    sendProgress('transcribing', 25, `Menjalankan Faster-Whisper (${model}) pada ${path.basename(audioPath)}...`);

    await new Promise((resolve, reject) => {
      const proc = spawn(
        pythonBin,
        [
          alignCli,
          '--audio', audioPath,
          '--text', tmpInputPath,
          '--output', tmpOutputPath,
          '--model', model || 'medium',
          '--device', 'cpu',
          '--language', 'id',
        ],
        {
          cwd: projectRoot,
          env: { ...process.env, PYTHONSAFEPATH: '1' },
        }
      );

      proc.stdout.on('data', (d) => {
        const line = d.toString().trim();
        if (line) sendProgress('aligning', 50, line);
      });

      proc.stderr.on('data', (d) => {
        const line = d.toString().trim();
        if (line) sendProgress('aligning', 65, line);
      });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(tmpOutputPath)) {
          resolve();
        } else {
          reject(new Error(`Faster-Whisper proses selesai dengan kode exit ${code}`));
        }
      });

      proc.on('error', (err) => reject(err));
    });

    sendProgress('processing', 85, 'Menyusun hasil transkrip dan memetakan arahan visual...');

    const rawResult = JSON.parse(fs.readFileSync(tmpOutputPath, 'utf-8'));
    // Single-word transcript entries from Faster-Whisper word-level alignment
    const rawItems = Array.isArray(rawResult.words) && rawResult.words.length > 0
      ? rawResult.words
      : (Array.isArray(rawResult) ? rawResult : rawResult.sentences || rawResult.transcript || []);

    // Clean temp files
    try {
      if (fs.existsSync(tmpInputPath)) fs.unlinkSync(tmpInputPath);
      if (fs.existsSync(tmpOutputPath)) fs.unlinkSync(tmpOutputPath);
    } catch {}

    const visualTypePalette = [
      'cinematic_broll',
      'microscopic',
      'map_infographic',
      'anatomical_illustration',
      'historic_archive',
    ];
    const cameraMovements = [
      'Slow Zoom In',
      'Pan Left',
      'Slow Zoom Out',
      'Static Dramatic',
      'Macro Focus Pull',
      'Drone Aerial Orbit',
      'Pan Right',
    ];

    const formattedEntries = rawItems.map((item, idx) => {
      const wordText = (item.word || item.text || '').trim();
      const startSec = Number((item.start !== undefined ? item.start : item.start_seconds !== undefined ? item.start_seconds : 0).toFixed(2));
      const endSec = Number((item.end !== undefined ? item.end : item.end_seconds !== undefined ? item.end_seconds : startSec + 0.4).toFixed(2));
      const m1 = Math.floor(startSec / 60); const s1 = Math.floor(startSec % 60);
      const m2 = Math.floor(endSec / 60); const s2 = Math.floor(endSec % 60);
      const tsMin = `${String(m1).padStart(2, '0')}:${String(s1).padStart(2, '0')} - ${String(m2).padStart(2, '0')}:${String(s2).padStart(2, '0')}`;

      const isMicro = /melanin|sel|gen|kulit|folat|vitamin|sel-sel|dna|biokimia/i.test(wordText);
      const isMap = /papua|arab|khatulistiwa|benua|migrasi|wilayah|geografis|afrika/i.test(wordText);
      const isHistory = /purba|nenek|moyang|sejarah|puluhan|ribu|tahun|neolitikum/i.test(wordText);

      const chosenType = isMicro
        ? 'microscopic'
        : isMap
        ? 'map_infographic'
        : isHistory
        ? 'historic_archive'
        : visualTypePalette[idx % visualTypePalette.length];

      const chosenCamera = cameraMovements[idx % cameraMovements.length];

      return {
        id: idx + 1,
        start_seconds: startSec,
        end_seconds: endSec,
        timestamp_minute: tsMin,
        text: wordText,
        visual_description: `Visualisasi sinematik: ${wordText}`,
        visual_prompt: `Cinematic documentary scene, ${chosenType} style visual representation of human anthropology and biology, dramatic lighting, photorealistic 8k --ar 16:9`,
        camera_movement: chosenCamera,
        visual_type: chosenType,
        broll_keyword: wordText.replace(/[,.!?…]/g, '').toLowerCase(),
      };
    });

    const finalData = {
      part: partNum,
      audio_duration: rawResult.audio_duration || (formattedEntries[formattedEntries.length - 1]?.end_seconds || 0),
      total_entries: formattedEntries.length,
      entries: formattedEntries,
      updated_at: new Date().toISOString(),
    };

    const finalJsonPath = path.join(p.HUMANOLOGI_TRANSCRIPTS_DIR, `part_${partNum}_transcript.json`);
    fs.writeFileSync(finalJsonPath, JSON.stringify(finalData, null, 2), 'utf-8');

    sendProgress('done', 100, `Selesai! Berhasil membuat ${formattedEntries.length} entri transcript dengan Faster-Whisper.`);

    return {
      success: true,
      data: finalData,
      filePath: finalJsonPath,
    };
  });

  /**
   * Get render readiness status for all parts and full video
   */
  ipcMain.handle('get-humanologi-render-readiness', async () => {
    try {
      const narasiPath = path.join(p.HUMANOLOGI_INPUT_DIR, 'humanologi_narasi.json');
      let totalParts = 3;
      if (fs.existsSync(narasiPath)) {
        try {
          const nData = JSON.parse(fs.readFileSync(narasiPath, 'utf-8'));
          if (Array.isArray(nData.narasi) && nData.narasi.length > 0) {
            totalParts = nData.narasi.length;
          }
        } catch { }
      }

      const outputDir = p.HUMANOLOGI_OUTPUT_DIR || path.join(p.PROJECT_ROOT, 'output', 'humanologi');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      const partsStatus = [];

      for (let pt = 1; pt <= totalParts; pt++) {
        // Scenes
        const scenesFile = path.join(p.HUMANOLOGI_SCENES_DIR || path.join(p.HUMANOLOGI_INPUT_DIR, 'scenes'), `part_${pt}_scenes.json`);
        let totalScenes = 0;
        let scenesDuration = 0;
        if (fs.existsSync(scenesFile)) {
          try {
            const sc = JSON.parse(fs.readFileSync(scenesFile, 'utf-8'));
            totalScenes = Array.isArray(sc.scenes) ? sc.scenes.length : (sc.total_scene || 0);
            scenesDuration = sc.audio_duration || 0;
          } catch { }
        }

        // Images count
        const imagesDir = path.join(p.HUMANOLOGI_IMAGES_DIR || path.join(p.HUMANOLOGI_INPUT_DIR, 'images'), `part_${pt}`);
        let readyImages = 0;
        if (fs.existsSync(imagesDir)) {
          const files = fs.readdirSync(imagesDir).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
          for (const f of files) {
            try {
              const stat = fs.statSync(path.join(imagesDir, f));
              if (stat.size > 1000) readyImages++;
            } catch { }
          }
        }

        // Audio
        const audioDir = p.HUMANOLOGI_AUDIO_DIR || path.join(p.HUMANOLOGI_INPUT_DIR, 'audio');
        let audioExists = false;
        let audioDuration = 0;
        let audioFileName = null;
        if (fs.existsSync(audioDir)) {
          const candidates = fs.readdirSync(audioDir).filter((f) => {
            const lower = f.toLowerCase();
            return (
              (lower.includes(`part_${pt}`) || lower.includes(`part${pt}`) || lower.includes(`a${pt}.`)) &&
              /\.(mp3|wav|m4a|aac|flac)$/i.test(lower)
            );
          });
          if (candidates.length > 0) {
            audioFileName = candidates[0];
            const fullAudioPath = path.join(audioDir, candidates[0]);
            audioExists = true;
            try {
              if (ffmpeg && ffmpeg.getVideoMeta) {
                const meta = await ffmpeg.getVideoMeta(fullAudioPath);
                if (meta?.duration) audioDuration = meta.duration;
              }
            } catch { }
          }
        }

        // Rendered Part MP4
        const partVideoFile = path.join(outputDir, `part_${pt}.mp4`);
        let isRendered = false;
        let videoSize = 0;
        let videoMtime = null;
        let videoUrl = null;
        if (fs.existsSync(partVideoFile)) {
          try {
            const stat = fs.statSync(partVideoFile);
            if (stat.size > 10000) {
              isRendered = true;
              videoSize = stat.size;
              videoMtime = stat.mtimeMs;
              videoUrl = `${media.mediaUrl(partVideoFile)}?t=${stat.mtimeMs}`;
            }
          } catch { }
        }

        partsStatus.push({
          part: pt,
          totalScenes,
          readyImages,
          imagesPercent: totalScenes > 0 ? Math.min(100, Math.round((readyImages / totalScenes) * 100)) : 0,
          audioExists,
          audioFileName,
          audioDuration: audioDuration || scenesDuration,
          isRendered,
          videoSize,
          videoMtime,
          videoUrl,
          videoPath: partVideoFile,
        });
      }

      // Check Full Merged Video
      const fullVideoFile = path.join(outputDir, 'humanologi_full_video.mp4');
      let fullRendered = false;
      let fullSize = 0;
      let fullMtime = null;
      let fullUrl = null;
      if (fs.existsSync(fullVideoFile)) {
        try {
          const stat = fs.statSync(fullVideoFile);
          if (stat.size > 20000) {
            fullRendered = true;
            fullSize = stat.size;
            fullMtime = stat.mtimeMs;
            fullUrl = `${media.mediaUrl(fullVideoFile)}?t=${stat.mtimeMs}`;
          }
        } catch { }
      }

      return {
        success: true,
        parts: partsStatus,
        fullVideo: {
          isRendered: fullRendered,
          size: fullSize,
          mtime: fullMtime,
          url: fullUrl,
          filePath: fullVideoFile,
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Render single part video using render-humanologi.ts
   */
  ipcMain.handle('render-humanologi-part', async (event, { part = 1, enableSubtitles = true, kenBurns = true, concurrency = 4 } = {}) => {
    const partNum = Number(part) || 1;
    const scriptPath = path.join(p.PROJECT_ROOT, 'render-humanologi.ts');

    if (!fs.existsSync(scriptPath)) {
      return { success: false, error: `Script renderer tidak ditemukan: ${scriptPath}` };
    }

    const outputDir = p.HUMANOLOGI_OUTPUT_DIR || path.join(p.PROJECT_ROOT, 'output', 'humanologi');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const finalOutputPath = path.join(outputDir, `part_${partNum}.mp4`);

    const args = [
      scriptPath,
      'render',
      '--part', String(partNum),
      '--concurrency', String(concurrency || 4),
      '--output', finalOutputPath,
    ];

    if (enableSubtitles === false) args.push('--no-subtitles');
    if (kenBurns === false) args.push('--no-ken-burns');

    return new Promise((resolve) => {
      const startTime = Date.now();
      const sendProgress = (stage, progress, message, extra = {}) => {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('humanologi-render-progress', {
            part: partNum,
            stage,
            progress,
            message,
            ...extra,
          });
        }
      };

      sendProgress('start', 0, `Memulai render video Humanologi Part ${partNum}...`);

      const child = spawn('npx', ['tsx', ...args], {
        cwd: p.PROJECT_ROOT,
        env: { ...process.env },
      });

      let fullStdout = '';
      let fullStderr = '';

      child.stdout.on('data', (d) => {
        const text = d.toString();
        fullStdout += text;
        const lines = text.split('\n').filter(Boolean);

        for (const line of lines) {
          // Check [PROGRESS] scene=X/Y progress=Z message="..."
          const sceneMatch = line.match(/\[PROGRESS\]\s+scene=(\d+)\/(\d+)\s+progress=([0-9.]+)\s+message="([^"]*)"/);
          if (sceneMatch) {
            const curr = parseInt(sceneMatch[1], 10);
            const total = parseInt(sceneMatch[2], 10);
            const prog = parseFloat(sceneMatch[3]);
            const msg = sceneMatch[4];
            sendProgress('scenes', prog, msg, { currentScene: curr, totalScenes: total });
            continue;
          }

          // Check [PROGRESS] stage=X progress=Y message="..."
          const stageMatch = line.match(/\[PROGRESS\]\s+stage=([a-zA-Z0-9_]+)\s+progress=([0-9.]+)\s+message="([^"]*)"/);
          if (stageMatch) {
            const st = stageMatch[1];
            const prog = parseFloat(stageMatch[2]);
            const msg = stageMatch[3];
            sendProgress(st, prog, msg);
            continue;
          }

          // Plain log forwarding
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('[PROGRESS]')) {
            sendProgress('log', null, trimmed, { rawLine: trimmed });
          }
        }
      });

      child.stderr.on('data', (d) => {
        const text = d.toString();
        fullStderr += text;
        const lines = text.split('\n').filter(Boolean);
        for (const line of lines) {
          sendProgress('log', null, line.trim(), { rawLine: line.trim(), isError: true });
        }
      });

      child.on('close', (code) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        if (code === 0 && fs.existsSync(finalOutputPath)) {
          const stat = fs.statSync(finalOutputPath);
          const mediaUrl = `${media.mediaUrl(finalOutputPath)}?t=${stat.mtimeMs}`;
          sendProgress('done', 1, `Render Part ${partNum} selesai sukses dalam ${elapsed}s!`, {
            outputPath: finalOutputPath,
            mediaUrl,
            elapsed,
          });
          resolve({
            success: true,
            part: partNum,
            outputPath: finalOutputPath,
            mediaUrl,
            fileSize: stat.size,
            elapsed,
          });
        } else {
          const errTail = fullStderr.split('\n').filter(Boolean).slice(-10).join('\n');
          const outTail = fullStdout.split('\n').filter(Boolean).slice(-10).join('\n');
          sendProgress('error', 0, `Render gagal (kode keluar ${code})`);
          resolve({
            success: false,
            error: `Render gagal (kode ${code}).\n\nStderr:\n${errTail}\n\nStdout:\n${outTail}`,
          });
        }
      });

      child.on('error', (err) => {
        sendProgress('error', 0, `Gagal menjalankan child process: ${err.message}`);
        resolve({ success: false, error: err.message });
      });
    });
  });

  /**
   * Merge all rendered part videos into final longform video
   */
  ipcMain.handle('merge-humanologi-full', async (event) => {
    const scriptPath = path.join(p.PROJECT_ROOT, 'render-humanologi.ts');
    if (!fs.existsSync(scriptPath)) {
      return { success: false, error: `Script renderer tidak ditemukan: ${scriptPath}` };
    }

    const outputDir = p.HUMANOLOGI_OUTPUT_DIR || path.join(p.PROJECT_ROOT, 'output', 'humanologi');
    const finalOutputPath = path.join(outputDir, 'humanologi_full_video.mp4');

    return new Promise((resolve) => {
      const startTime = Date.now();
      const sendProgress = (stage, progress, message, extra = {}) => {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('humanologi-render-progress', {
            part: 0,
            stage,
            progress,
            message,
            ...extra,
          });
        }
      };

      sendProgress('merge', 0.1, 'Menggabungkan seluruh part video Humanologi...');

      const child = spawn('npx', ['tsx', scriptPath, 'merge', '--output', finalOutputPath], {
        cwd: p.PROJECT_ROOT,
        env: { ...process.env },
      });

      let fullStdout = '';
      let fullStderr = '';

      child.stdout.on('data', (d) => {
        const text = d.toString();
        fullStdout += text;
        const lines = text.split('\n').filter(Boolean);
        for (const line of lines) {
          const stageMatch = line.match(/\[PROGRESS\]\s+stage=([a-zA-Z0-9_]+)\s+progress=([0-9.]+)\s+message="([^"]*)"/);
          if (stageMatch) {
            sendProgress(stageMatch[1], parseFloat(stageMatch[2]), stageMatch[3]);
          } else if (line.trim() && !line.startsWith('[PROGRESS]')) {
            sendProgress('log', null, line.trim(), { rawLine: line.trim() });
          }
        }
      });

      child.stderr.on('data', (d) => {
        fullStderr += d.toString();
      });

      child.on('close', (code) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        if (code === 0 && fs.existsSync(finalOutputPath)) {
          const stat = fs.statSync(finalOutputPath);
          const mediaUrl = `${media.mediaUrl(finalOutputPath)}?t=${stat.mtimeMs}`;
          sendProgress('done', 1, `Penggabungan Full Video sukses dalam ${elapsed}s!`, {
            outputPath: finalOutputPath,
            mediaUrl,
            elapsed,
          });
          resolve({
            success: true,
            outputPath: finalOutputPath,
            mediaUrl,
            fileSize: stat.size,
            elapsed,
          });
        } else {
          resolve({
            success: false,
            error: `Merge gagal (kode ${code}).\n${fullStderr || fullStdout}`,
          });
        }
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  });
}

module.exports = { register };
