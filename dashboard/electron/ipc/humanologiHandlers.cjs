
// dashboard/electron/ipc/humanologiHandlers.cjs
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chatCompletion, streamChatCompletion, extractCleanJsonObject } = require('../aiClient.cjs');

/**
 * Smart phrase splitter for Humanologi documentary video pacing (2 - 5s per visual shot)
 * Splits paragraphs, compound sentences, and long clauses into punchy short phrases (3 - 6 words).
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
    const subPhrases = splitSingleSentence(sent);
    for (const p of subPhrases) {
      rawItems.push({
        text: p.trim(),
        sentenceContext: sent,
      });
    }
  }

  const merged = [];
  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (!item.text) continue;
    const words = item.text.split(/\s+/).filter(Boolean);
    if (words.length <= 2 && /[,]$/.test(item.text) && i + 1 < rawItems.length) {
      rawItems[i + 1].text = item.text + ' ' + rawItems[i + 1].text;
      continue;
    }
    if (words.length === 1 && !/[.!?…]$/.test(item.text) && merged.length > 0) {
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

function splitSingleSentence(sent) {
  const words = sent.split(/\s+/).filter(Boolean);
  if (words.length <= 6) return [sent];

  if (sent.includes(',')) {
    const commaParts = sent.split(/,\s+/);
    const parts = [];
    let current = '';

    for (let i = 0; i < commaParts.length; i++) {
      const part = commaParts[i].trim();
      if (!part) continue;

      if (!current) {
        current = part;
      } else {
        const curWords = current.split(/\s+/).filter(Boolean).length;
        const partWords = part.split(/\s+/).filter(Boolean).length;
        if (curWords >= 3 && partWords >= 3) {
          const trailing = /[.!?…,]$/.test(current) ? '' : ',';
          parts.push(current + trailing);
          current = part;
        } else {
          current = current + ', ' + part;
        }
      }
    }
    if (current) parts.push(current);

    const subResult = [];
    for (const p of parts) {
      const pWords = p.split(/\s+/).filter(Boolean);
      if (pWords.length > 6) {
        subResult.push(...splitLongClause(p));
      } else {
        subResult.push(p);
      }
    }
    return subResult;
  }

  return splitLongClause(sent);
}

function splitLongClause(str) {
  const words = str.split(/\s+/).filter(Boolean);
  if (words.length <= 6) return [str];

  const conjunctions = [
    'dibanding', 'dibandingkan', 'daripada', 'sehingga', 'karena',
    'seperti', 'bahkan', 'yaitu', 'yakni', 'bahwa', 'agar',
    'meskipun', 'walaupun', 'tapi', 'namun', 'antara', 'sedangkan',
    'soal', 'tentang', 'maupun', 'hingga', 'sampai',
    'yang', 'untuk', 'dengan', 'dalam', 'sangat', 'secara', 'dan', 'bisa', 'sebenarnya',
    'punya', 'adalah'
  ];

  let bestIdx = -1;
  let minDiffFromCenter = 999;
  const center = words.length / 2;

  for (let i = 2; i <= words.length - 2; i++) {
    const w = words[i].toLowerCase().replace(/[^\w]/g, '');
    if (conjunctions.includes(w)) {
      const isStrong = ['dibanding', 'dibandingkan', 'daripada', 'sehingga', 'karena', 'tapi', 'namun', 'bahkan', 'yaitu', 'yakni', 'bahwa', 'meskipun', 'walaupun', 'sedangkan'].includes(w);
      const isRel = ['yang', 'dan', 'secara', 'sangat', 'sebenarnya', 'bisa', 'punya'].includes(w);
      const weight = isStrong ? 0.3 : (isRel ? 0.6 : 1.0);
      let diff = Math.abs(i - center) * weight;

      const prevW = words[i - 1].toLowerCase().replace(/[^\w]/g, '');
      if (prevW === 'warna' && w === 'kulit') diff += 10;
      if (prevW === 'jazirah' && w === 'arab') diff += 10;
      if (prevW === 'orang' && (w === 'arab' || w === 'papua')) diff += 10;
      if (prevW === 'radiasi' && w === 'uv') diff += 10;
      if (prevW === 'asam' && w === 'folat') diff += 10;
      if (prevW === 'vitamin' && w === 'd') diff += 10;
      if (prevW === 'seleksi' && w === 'alam') diff += 10;
      if (prevW === 'bawah' && w === 'matahari') diff += 10;
      if (prevW === 'berdiri' && w === 'di') diff += 10;

      if (diff < minDiffFromCenter) {
        minDiffFromCenter = diff;
        bestIdx = i;
      }
    }
  }

  if (bestIdx <= 0 && words.length > 7) {
    bestIdx = Math.floor(words.length / 2);
  }

  if (bestIdx > 0) {
    const leftWords = words.slice(0, bestIdx);
    const rightWords = words.slice(bestIdx);
    let left = leftWords.join(' ');
    let right = rightWords.join(' ');
    if (!/[.!?…,]$/.test(left)) left += ',';

    const leftList = leftWords.length > 6 ? splitLongClause(left) : [left];
    const rightList = rightWords.length > 6 ? splitLongClause(right) : [right];
    return [...leftList, ...rightList];
  }

  return [str];
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
      const BATCH_SIZE = 30;
      const visualPromptsMap = {};
      const totalBatches = Math.ceil(scenesWithDuration.length / BATCH_SIZE);

      event.sender.send('humanologi-scenes-stream-progress', {
        type: 'start',
        part: partNum,
        totalScenes: scenesWithDuration.length,
        totalBatches,
        percent: 0,
        message: `Memulai streaming 9router (${model}) untuk ${scenesWithDuration.length} adegan pendek...`,
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
Tugasmu adalah membuat deskripsi_visual_singkat dan image_prompt untuk setiap potongan scene visual pendek di bawah ini agar membentuk animasi edukasi yang LINIER, KONSISTEN, dan BERSAMBUNG (ala channel YouTube Humanova / MinutePhysics / Kok Bisa?).

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
}

module.exports = { register };
