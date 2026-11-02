// dashboard/electron/ipc/facelessHandlers.cjs
const path = require('path');
const fs = require('fs');

const DEFAULT_FACELESS_MODEL = process.env.AI_MODEL || 'ag/gemini-3.8-flash-high';
const FALLBACK_MODELS = [
  'ag/gemini-3.8-flash-high',
  'ag/gemini-3-flash-agent',
  'gemini/gemini-3.1-flash-lite-preview',
  'gemini/gemini-3-flash-preview',
  'ds/deepseek-chat',
  'cmc/Qwen/Qwen3.6-Plus',
  'cmc/deepseek/deepseek-v4-flash',
];

function cleanVoiceoverScript(raw) {
  if (!raw || typeof raw !== 'string') return '';

  const lines = raw.split(/\r?\n/);
  const cleanedLines = [];

  const PART_HEADER_REGEX =
    /^\s*(?:#+\s*)?(?:\*{1,3})?\s*(?:PART|BAGIAN|BAB|SCENE|EPISODE|ACT|SEGMENT|CHUNK|ADEGAN)\s*\d+(?:\s*(?:\/|dari)\s*\d+)?(?:[^\n:]*)?(?::[^\n]*)?(?:\*{1,3})?\s*$/i;

  const SECTION_HEADER_REGEX =
    /^\s*(?:#+\s*)?(?:\*{1,3})?\s*(?:HOOK|INTRO|OUTRO|CLIMAX|CLIFFHANGER|ENDING|PENUTUP|PEMBUKA|REKAP|KESIMPULAN)\s*(?:\([^)]*\))?\s*:\s*(?:\*{1,3})?\s*$/i;

  const CUE_LINE_REGEX =
    /^\s*(?:#+\s*)?(?:\*{1,3})?\s*(?:Visual(?:\s*\d+)?|Footage|B-roll|SFX|Sound\s*FX|Audio|Musik|Music|Backsound|Teks\s*Overlay|Teks\s*Layar|Teks|Text|Catatan|Notes|Prompt\s*Visual|Prompt|Kamera|Camera|Shot|Transisi|Transition|Durasi|Duration)\s*:[^\n]*$/i;

  const DIVIDER_REGEX = /^\s*[-=_*~]{3,}\s*$/;

  const DURATION_ONLY_REGEX =
    /^(?:\[|\()(?:\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?|durasi[^\)]*|\d+\s*(?:detik|menit|s|sec|min))\s*(?:\]|\))$/i;

  for (const line of lines) {
    let trimmed = line.trim();

    if (!trimmed) {
      if (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1] !== '') {
        cleanedLines.push('');
      }
      continue;
    }

    if (DIVIDER_REGEX.test(trimmed)) continue;
    if (PART_HEADER_REGEX.test(trimmed)) continue;
    if (SECTION_HEADER_REGEX.test(trimmed)) continue;
    if (CUE_LINE_REGEX.test(trimmed)) continue;
    if (DURATION_ONLY_REGEX.test(trimmed)) continue;
    if (/^\s*\[[^\]]+\]\s*$/.test(trimmed)) continue;
    if (
      /^\s*\((?:visual|footage|b-roll|sfx|audio|sound|musik|music|backsound|teks|text|overlay|kamera|camera|shot|scene|suara|ambience|durasi)[^)]*\)\s*$/i.test(
        trimmed
      )
    ) {
      continue;
    }

    let cleaned = trimmed.replace(/\[[^\]]*\]/g, '');
    cleaned = cleaned.replace(
      /\((?:visual|footage|b-roll|sfx|audio|sound|musik|music|backsound|teks|text|overlay|kamera|camera|shot|scene|suara|ambience|durasi)[^)]*\)/gi,
      ''
    );
    cleaned = cleaned.replace(
      /^(?:#+\s*)?(?:\*{1,3})?\s*(?:Narator|Narasi|Voiceover|VO|Host|Speaker)\s*:\s*(?:\*{1,3})?\s*/i,
      ''
    );
    cleaned = cleaned.replace(/^#+\s*/, '');
    cleaned = cleaned.replace(/^\*\*(.*?)\*\*$/, '$1').replace(/^_(.*?)_$/, '$1');

    if (
      (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith('“') && cleaned.endsWith('”'))
    ) {
      cleaned = cleaned.slice(1, -1).trim();
    }

    cleaned = cleaned.replace(/[ \t]+/g, ' ').trim();
    if (cleaned) {
      cleanedLines.push(cleaned);
    }
  }

  return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parseAndFormatTimecodedTranscript(input) {
  if (!input || typeof input !== 'string') return { formattedText: '', segments: [] };

  const trimmed = input.trim();

  // 1. Handle standard SRT subtitle format if detected
  if (/^\d+\r?\n\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->/m.test(trimmed)) {
    const blocks = trimmed.split(/\r?\n\r?\n/);
    const segments = [];
    const lines = [];

    for (const block of blocks) {
      const bLines = block.trim().split(/\r?\n/);
      if (bLines.length >= 3) {
        const timeMatch = bLines[1].match(/(\d{2}:\d{2}:\d{2})/);
        const text = bLines.slice(2).join(' ').trim();
        if (timeMatch && text) {
          const partsArr = timeMatch[1].split(':').map(Number);
          const sec = partsArr[0] * 3600 + partsArr[1] * 60 + partsArr[2];
          const m = Math.floor(sec / 60);
          const s = sec % 60;
          const displayTc = `(${m}:${s.toString().padStart(2, '0')})`;
          segments.push({ timecode: displayTc, seconds: sec, text });
          lines.push(`${displayTc} ${text}`);
        }
      }
    }

    if (segments.length > 0) {
      return { formattedText: lines.join('\n'), segments };
    }
  }

  // 2. Find bracketed or parenthesized timecodes
  const regex =
    /(?:[\(\[]\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*[\)\]]?|(?:\b)(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*[\)\]])/g;

  const matches = [];
  let m;
  while ((m = regex.exec(trimmed)) !== null) {
    matches.push({
      index: m.index,
      fullLength: m[0].length,
      timecode: m[1] || m[2],
    });
  }

  // Standalone timecodes fallback
  if (matches.length === 0) {
    const standaloneRegex = /\b(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\b/g;
    while ((m = standaloneRegex.exec(trimmed)) !== null) {
      matches.push({
        index: m.index,
        fullLength: m[0].length,
        timecode: m[1],
      });
    }
  }

  if (matches.length === 0) {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    return {
      formattedText: lines.map((l, i) => (i === 0 ? `(0:00) ${l}` : l)).join('\n'),
      segments: [{ timecode: '(0:00)', seconds: 0, text: trimmed }],
    };
  }

  const segments = [];
  const lines = [];

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const nextIndex = i + 1 < matches.length ? matches[i + 1].index : trimmed.length;
    const textStart = current.index + current.fullLength;
    const text = trimmed.slice(textStart, nextIndex).trim().replace(/^[-–—:]\s*/, '');

    const partsArr = current.timecode.split(':').map(Number);
    let sec = 0;
    if (partsArr.length === 3) {
      sec = partsArr[0] * 3600 + partsArr[1] * 60 + partsArr[2];
    } else if (partsArr.length === 2) {
      sec = partsArr[0] * 60 + partsArr[1];
    }

    const formattedTc = `(${current.timecode})`;
    if (text) {
      segments.push({
        timecode: formattedTc,
        seconds: sec,
        text,
      });
      lines.push(`${formattedTc} ${text}`);
    }
  }

  return {
    formattedText: lines.join('\n'),
    segments,
  };
}

function register(ipcMain, { paths: p, aiClient, loadPrompt, ffmpeg, media }) {
  if (!fs.existsSync(p.FACELESS_INPUT_DIR)) fs.mkdirSync(p.FACELESS_INPUT_DIR, { recursive: true });
  if (p.FACELESS_AUDIO_DIR && !fs.existsSync(p.FACELESS_AUDIO_DIR)) {
    fs.mkdirSync(p.FACELESS_AUDIO_DIR, { recursive: true });
  }
  if (p.FACELESS_TRANSCRIPTS_DIR && !fs.existsSync(p.FACELESS_TRANSCRIPTS_DIR)) {
    fs.mkdirSync(p.FACELESS_TRANSCRIPTS_DIR, { recursive: true });
  }

  const FACELESS_STATE_FILE = path.join(p.FACELESS_INPUT_DIR, 'faceless_state.json');

  const createDefaultMemory = () => ({
    summary: '',
    key_points: [],
    user_preferences: [],
    draft_script: '',
    clean_script: '',
    narration_outline: {
      hook: '',
      plan: '',
      failure: '',
      improvisation: '',
      stakes: '',
      twist: '',
      cliffhanger: '',
      notes: '',
    },
  });

  const createDefaultFacelessState = () => ({
    version: 4,
    stage: 'idea_discussion',
    is_locked: false,
    locked_at: null,
    idea_source: null,
    idea: null,
    duration: null,
    narration: null,
    memory: createDefaultMemory(),
    chat_history: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const VALID_STAGES = [
    'idea_discussion',
    'duration_discussion',
    'outline_discussion',
    'narration_discussion',
  ];

  const normalizeMemory = (mem = {}) => {
    const m = mem && typeof mem === 'object' ? mem : {};
    const outline = m.narration_outline && typeof m.narration_outline === 'object' ? m.narration_outline : {};
    return {
      summary: String(m.summary || '').trim(),
      key_points: Array.isArray(m.key_points)
        ? m.key_points.map((p) => String(p).trim()).filter(Boolean)
        : [],
      user_preferences: Array.isArray(m.user_preferences)
        ? m.user_preferences.map((p) => String(p).trim()).filter(Boolean)
        : [],
      draft_script: String(m.draft_script || '').trim(),
      clean_script: String(m.clean_script || cleanVoiceoverScript(m.draft_script || '')).trim(),
      narration_outline: {
        hook: String(outline.hook || '').trim(),
        plan: String(outline.plan || '').trim(),
        failure: String(outline.failure || '').trim(),
        improvisation: String(outline.improvisation || '').trim(),
        stakes: String(outline.stakes || '').trim(),
        twist: String(outline.twist || '').trim(),
        cliffhanger: String(outline.cliffhanger || '').trim(),
        notes: String(outline.notes || '').trim(),
      },
    };
  };

  const normalizeFacelessIdea = (idea = {}) => {
    if (!idea || typeof idea !== 'object') return null;
    const title = String(idea.title || '').trim();
    if (!title) return null;
    return {
      title,
      category: String(idea.category || 'Faceless Content').trim(),
      concept_hook: String(idea.concept_hook || '').trim(),
      description: String(idea.description || '').trim(),
      materials: Array.isArray(idea.materials)
        ? idea.materials.map((m) => String(m).trim()).filter(Boolean)
        : [],
      vibe: String(idea.vibe || '').trim(),
    };
  };

  const normalizeFacelessDuration = (duration) => {
    if (!duration) return null;

    if (typeof duration === 'string') {
      const label = duration.trim();
      if (!label) return null;
      const secondsMatch = label.match(/(\d+(?:[.,]\d+)?)/);
      const seconds = secondsMatch ? Math.round(Number(secondsMatch[1].replace(',', '.'))) : 0;
      return { label, seconds, format: seconds > 0 && seconds <= 90 ? 'short' : 'long' };
    }

    if (typeof duration !== 'object') return null;

    const label = String(duration.label || duration.text || '').trim();
    const secondsValue = Number(duration.seconds ?? duration.duration_seconds ?? 0);
    let seconds = Number.isFinite(secondsValue) ? Math.max(0, Math.round(secondsValue)) : 0;

    if (!seconds && label) {
      const match = label.match(/(\d+(?:[.,]\d+)?)/);
      if (match) {
        const value = Number(match[1].replace(',', '.'));
        seconds = Math.round(/menit|minute|min/i.test(label) ? value * 60 : value);
      }
    }

    const format = duration.format === 'short' || duration.format === 'long'
      ? duration.format
      : seconds > 0
        ? seconds <= 90 ? 'short' : 'long'
        : null;

    if (!label && !seconds) return null;
    return { label, seconds, format };
  };

  const readFacelessState = () => {
    try {
      if (fs.existsSync(FACELESS_STATE_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(FACELESS_STATE_FILE, 'utf-8'));
        const stage = VALID_STAGES.includes(parsed.stage)
          ? parsed.stage
          : parsed.idea
            ? (parsed.duration
                ? (parsed.narration?.draft_script || parsed.memory?.draft_script
                    ? 'narration_discussion'
                    : 'outline_discussion')
                : 'duration_discussion')
            : 'idea_discussion';
        return {
          ...createDefaultFacelessState(),
          ...parsed,
          stage,
          is_locked: !!parsed.is_locked,
          locked_at: parsed.locked_at || null,
          idea: parsed.idea ? normalizeFacelessIdea(parsed.idea) : null,
          duration: parsed.duration ? normalizeFacelessDuration(parsed.duration) : null,
          memory: normalizeMemory(parsed.memory),
          narration: parsed.narration
            ? {
                ...parsed.narration,
                clean_script:
                  parsed.narration.clean_script ||
                  cleanVoiceoverScript(parsed.narration.draft_script || parsed.memory?.draft_script || ''),
              }
            : null,
          chat_history: Array.isArray(parsed.chat_history) ? parsed.chat_history : [],
        };
      }
    } catch (err) {
      console.warn('[FacelessState] Gagal membaca state:', err.message);
    }
    return null;
  };

  const writeFacelessState = (state) => {
    fs.writeFileSync(FACELESS_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    return state;
  };

  /**
   * Idea Agent: chat untuk menentukan ide, durasi, alur kasar (A->B->C->D), dan naskah narasi
   */
  ipcMain.handle('faceless-agent-chat', async (_event, { messages = [], model } = {}) => {
    try {
      let systemPrompt = '';
      try {
        systemPrompt = loadPrompt ? loadPrompt('faceless/faceless-idea-agent-prompt.md') : '';
      } catch {
        const fallbackPath = path.join(p.PROMPTS_DIR, 'faceless', 'faceless-idea-agent-prompt.md');
        if (fs.existsSync(fallbackPath)) {
          systemPrompt = fs.readFileSync(fallbackPath, 'utf-8');
        }
      }

      if (!systemPrompt) {
        return { success: false, error: 'Berkas template prompt faceless-idea-agent-prompt.md tidak ditemukan.' };
      }

      let narrationDna = '';
      try {
        narrationDna = loadPrompt ? loadPrompt('faceless/faceless-narration-dna.md') : '';
      } catch {
        const fallbackDnaPath = path.join(p.PROMPTS_DIR, 'faceless', 'faceless-narration-dna.md');
        if (fs.existsSync(fallbackDnaPath)) {
          narrationDna = fs.readFileSync(fallbackDnaPath, 'utf-8');
        }
      }

      if (narrationDna.trim()) {
        systemPrompt = `${systemPrompt}\n\n---\n\n${narrationDna.trim()}`;
      }

      const history = (Array.isArray(messages) ? messages : [])
        .filter(
          (m) =>
            m &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string' &&
            m.content.trim()
        )
        .map((m) => ({
          role: m.role,
          content: m.content.trim(),
          at: m.at || new Date().toISOString(),
        }));

      if (history.length === 0) {
        return { success: false, error: 'Belum ada pesan untuk diproses.' };
      }

      // ─── INJEKSI MEMORI & CURRENT STATE (FLOW BERTAHAP & PENGUNCIAN) ─────────
      const currentState = readFacelessState() || createDefaultFacelessState();

      const memoryContextLines = [
        '=== [MEMORI & KONTEKS PROYEK TERKINI] ===',
        `- Tahap Proyek Saat Ini: ${currentState.stage}`,
        `- Status Terkunci (Locked): ${currentState.is_locked ? 'YA (TERKUNCI)' : 'BELUM'}`,
      ];

      if (currentState.idea) {
        memoryContextLines.push(
          `- [IDE SUDAH DISEPAKATI / TERKUNCI]:`,
          `  * Judul: "${currentState.idea.title}"`,
          `  * Kategori: ${currentState.idea.category}`,
          `  * Concept Hook: "${currentState.idea.concept_hook}"`,
          `  * Deskripsi: ${currentState.idea.description || '-'}`,
          `  * Bahan / Aset Kunci: ${(currentState.idea.materials || []).join(', ') || '-'}`,
          `  * Vibe: ${currentState.idea.vibe || '-'}`
        );
      } else {
        memoryContextLines.push('- [IDE]: Belum ditentukan.');
      }

      if (currentState.duration) {
        memoryContextLines.push(
          `- [DURASI SUDAH DISEPAKATI / TERKUNCI]: ${currentState.duration.label} (${currentState.duration.seconds} detik, tipe: ${currentState.duration.format})`
        );
      } else {
        memoryContextLines.push('- [DURASI]: Belum ditentukan.');
      }

      if (currentState.memory) {
        if (currentState.memory.summary) {
          memoryContextLines.push(`- [RINGKASAN KONTEKS]: ${currentState.memory.summary}`);
        }
        if (currentState.memory.key_points?.length) {
          memoryContextLines.push(`- [POIN-POIN KUNCI]: ${currentState.memory.key_points.join(' | ')}`);
        }
        if (currentState.memory.user_preferences?.length) {
          memoryContextLines.push(`- [PREFERENSI USER]: ${currentState.memory.user_preferences.join(' | ')}`);
        }
        const outline = currentState.memory.narration_outline || {};
        const outlineParts = [];
        if (outline.hook) outlineParts.push(`Hook: "${outline.hook}"`);
        if (outline.plan) outlineParts.push(`Rencana: "${outline.plan}"`);
        if (outline.failure) outlineParts.push(`Kegagalan: "${outline.failure}"`);
        if (outline.improvisation) outlineParts.push(`Improvisasi: "${outline.improvisation}"`);
        if (outline.stakes) outlineParts.push(`Stakes: "${outline.stakes}"`);
        if (outline.twist) outlineParts.push(`Twist: "${outline.twist}"`);
        if (outline.cliffhanger) outlineParts.push(`Cliffhanger: "${outline.cliffhanger}"`);
        if (outline.notes) outlineParts.push(`Catatan: "${outline.notes}"`);
        if (outlineParts.length > 0) {
          memoryContextLines.push(`- [GAMBARAN KASAR ALUR TERBENTUK]:\n  * ${outlineParts.join('\n  * ')}`);
        }
        if (currentState.memory.draft_script) {
          memoryContextLines.push(
            `- [DRAF NASKAH SEBELUMNYA]:\n${currentState.memory.draft_script.slice(0, 300)}...`
          );
        }
      }
      memoryContextLines.push('========================================================');

      const transcript = history
        .map((m) => `${m.role === 'user' ? 'USER' : 'AGENT'}: ${m.content}`)
        .join('\n\n');

      const userPrompt = [
        memoryContextLines.join('\n'),
        '',
        'Berikut adalah riwayat percakapan dengan user:',
        '',
        transcript,
        '',
        'PERINGATAN ATURAN FLOW & PENGUNCIAN (LOCK):',
        '1. Tahap 1 (Ide): Kunci ide dan TANYA DURASI TARGET.',
        '2. Tahap 2 (Durasi): Kunci durasi, ubah stage ke "outline_discussion", dan SAJIKAN GAMBARAN KASAR ALUR (Flow A -> B -> C -> D). Tanyakan apakah user setuju. JANGAN buat naskah narasi lengkap dulu!',
        '3. Tahap 3 (Gambaran Kasar Alur): Jika user belum menyetujui, perbaiki alur kasarnya.',
        '4. Tahap 4 (Naskah Narasi Lengkap): HANYA buat naskah narasi lengkap (draft_script) jika user sudah MENYETUJUI gambaran kasar alur! Begitu naskah selesai, WAJIB sertakan bubble konfirmasi penguncian (Lock Confirmation) di akhir balasan.',
        '5. PENGUNCIAN (is_locked): Jika user menyatakan setuju/kunci (misal: "setuju", "kunci", "naskah sudah mantap", "kunci naskah", "deal", "fix", dll.), set is_locked = true dan konfirmasi bahwa Step 1 terkunci.',
        '6. Balas HANYA JSON valid.',
      ].join('\n');

      const chosenModel = model || DEFAULT_FACELESS_MODEL;
      const modelsToTry = [chosenModel, ...FALLBACK_MODELS.filter((m) => m !== chosenModel)];

      let rawResponse = '';
      let lastErr = null;

      for (const targetModel of modelsToTry) {
        try {
          rawResponse = await aiClient.chatCompletion({
            prompt: userPrompt,
            systemPrompt,
            model: targetModel,
            jsonMode: true,
            temperature: 0.7,
          });
          if (rawResponse) break;
        } catch (err) {
          lastErr = err;
          console.warn(`[FacelessIdeaAgent] Model ${targetModel} error:`, err.message);
        }
      }

      if (!rawResponse) {
        return {
          success: false,
          error: lastErr ? `AI API error: ${lastErr.message}` : 'Tidak ada respon dari model AI.',
        };
      }

      let parsed = null;
      try {
        parsed = JSON.parse(aiClient.extractCleanJsonObject(rawResponse));
      } catch {
        try {
          parsed = JSON.parse(rawResponse);
        } catch {}
      }

      if (!parsed || typeof parsed !== 'object') {
        parsed = {
          reply: rawResponse,
          stage: currentState.stage || 'idea_discussion',
          idea_ready: !!currentState.idea,
          idea: currentState.idea,
          duration_ready: !!currentState.duration,
          duration: currentState.duration,
          is_locked: currentState.is_locked,
          memory: currentState.memory,
          suggested_actions: [],
        };
      }

      const reply =
        typeof parsed.reply === 'string' && parsed.reply.trim()
          ? parsed.reply.trim()
          : 'Aku sudah memproses alurnya untukmu.';

      const now = new Date().toISOString();
      const state = { ...currentState };

      state.chat_history = [
        ...history,
        { role: 'assistant', content: reply, at: now },
      ];

      const STAGE_ORDER = VALID_STAGES;
      const isValidStage = (value) => STAGE_ORDER.includes(value);
      const canEnterStage = (stage) => {
        if (stage === 'duration_discussion') return !!state.idea;
        if (stage === 'outline_discussion') return !!state.idea && !!state.duration;
        if (stage === 'narration_discussion') return !!state.idea && !!state.duration;
        return true;
      };

      const parsedIdea = normalizeFacelessIdea(parsed.idea);
      const ideaReady = (!!parsed.idea_ready && !!parsedIdea) || !!state.idea;
      const parsedDuration = normalizeFacelessDuration(parsed.duration);
      const durationReady = (!!parsed.duration_ready && !!parsedDuration) || !!state.duration;

      // Update idea jika belum ada atau diperbarui
      if (parsedIdea) {
        state.idea = parsedIdea;
        if (parsed.idea_source === 'user' || parsed.idea_source === 'agent') {
          state.idea_source = parsed.idea_source;
        }
        if (!state.duration) {
          state.stage = 'duration_discussion';
        }
      }

      // Update durasi jika valid
      if (parsedDuration) {
        state.duration = parsedDuration;
        if (state.idea && state.stage === 'duration_discussion') {
          state.stage = 'outline_discussion';
        }
      }

      // Transisi tahap aman sesuai model output
      if (isValidStage(parsed.stage)) {
        if (canEnterStage(parsed.stage)) {
          state.stage = parsed.stage;
        }
      }

      // ─── SIMPAN & UPDATE MEMORI PROYEK ────────────────────────────────────
      const incomingMemory = normalizeMemory(parsed.memory);
      const prevMemory = state.memory || createDefaultMemory();
      const mergedKeyPoints = Array.from(
        new Set([...(prevMemory.key_points || []), ...(incomingMemory.key_points || [])])
      );
      const mergedPreferences = Array.from(
        new Set([...(prevMemory.user_preferences || []), ...(incomingMemory.user_preferences || [])])
      );

      const mergedOutline = {
        hook: incomingMemory.narration_outline.hook || prevMemory.narration_outline.hook || '',
        plan: incomingMemory.narration_outline.plan || prevMemory.narration_outline.plan || '',
        failure: incomingMemory.narration_outline.failure || prevMemory.narration_outline.failure || '',
        improvisation: incomingMemory.narration_outline.improvisation || prevMemory.narration_outline.improvisation || '',
        stakes: incomingMemory.narration_outline.stakes || prevMemory.narration_outline.stakes || '',
        twist: incomingMemory.narration_outline.twist || prevMemory.narration_outline.twist || '',
        cliffhanger: incomingMemory.narration_outline.cliffhanger || prevMemory.narration_outline.cliffhanger || '',
        notes: incomingMemory.narration_outline.notes || prevMemory.narration_outline.notes || '',
      };

      // draft_script hanya ada jika sudah masuk narration_discussion atau dikirim oleh parsed
      const finalDraftScript = state.stage === 'narration_discussion'
        ? String(
            parsed.draft_script ||
            parsed.narration?.draft_script ||
            incomingMemory.draft_script ||
            prevMemory.draft_script ||
            state.narration?.draft_script ||
            ''
          ).trim()
        : '';

      const finalCleanScript = cleanVoiceoverScript(finalDraftScript);

      state.memory = {
        summary: incomingMemory.summary || prevMemory.summary || (state.idea ? `Konten: ${state.idea.title}` : ''),
        key_points: mergedKeyPoints,
        user_preferences: mergedPreferences,
        draft_script: finalDraftScript,
        clean_script: finalCleanScript,
        narration_outline: mergedOutline,
      };

      // ─── MEKANISME PENGUNCIAN (LOCKING) ───────────────────────────────────
      const lastUserMsg = history.filter((m) => m.role === 'user').pop()?.content || '';
      
      // Apakah naskah sudah pernah ada sebelum giliran chat ini?
      const hadExistingScriptBefore = !!(
        currentState.narration?.draft_script ||
        currentState.memory?.draft_script
      );
      const isAlreadyInNarrationStage =
        currentState.stage === 'narration_discussion' && hadExistingScriptBefore;

      const hasScriptToLock = !!finalDraftScript || !!state.narration?.draft_script;

      // Niat eksplisit mengunci (kunci naskah, lock, kunci proyek, dll.)
      const explicitLockIntent = /(?:^|\b)(?:kunci|lock|kunci\s*naskah|kunci\s*proyek|siap\s*kunci|sudah\s*mantap(?:\s*kunci)?)(?:\b|$)/i.test(lastUserMsg);

      // Persetujuan umum (setuju, mantap, deal, dll.) HANYA memicu kunci jika naskah memang SUDAH ada dan sedang ditinjau
      const generalAgreementOnScript =
        isAlreadyInNarrationStage &&
        /(?:^|\b)(?:setuju|mantap|deal|ok\s*kunci|oke\s*kunci|sudah\s*oke|sudah\s*pas|fix|siap|cocok)(?:\b|$)/i.test(lastUserMsg);

      const userConfirmedLock = explicitLockIntent || generalAgreementOnScript;
      const willLock = !!(
        parsed.is_locked ||
        (userConfirmedLock && hasScriptToLock)
      );

      if (willLock) {
        state.is_locked = true;
        state.locked_at = state.locked_at || now;
      } else {
        state.is_locked = false;
        state.locked_at = null;
      }

      // Pastikan ada bubble konfirmasi jika di tahap naskah narasi dan belum terkunci
      let finalReply = reply;
      if (
        state.stage === 'narration_discussion' &&
        hasScriptToLock &&
        !state.is_locked
      ) {
        const lowerReply = finalReply.toLowerCase();
        const hasConfirmationQuestion =
          (lowerReply.includes('kunci') || lowerReply.includes('setuju')) &&
          (lowerReply.includes('revisi') || lowerReply.includes('kurang') || lowerReply.includes('mantap') || lowerReply.includes('konfirmasi'));

        if (!hasConfirmationQuestion) {
          finalReply = `${finalReply}\n\n---\n\n🎙️ **Konfirmasi Penguncian Proyek (Step 1):**\nApakah seluruh naskah narasi ini sudah sesuai dan kamu setuju untuk mengunci (lock) proyek Step 1 ini, atau masih ada bagian/dialog yang ingin kamu revisi?`;
        }
      } else if (state.is_locked) {
        const lowerReply = finalReply.toLowerCase();
        if (!lowerReply.includes('terkunci') && !lowerReply.includes('kunci')) {
          finalReply = `${finalReply}\n\n🔒 **Proyek Step 1 Resmi Dikunci!** Ide, durasi, dan naskah narasi final sudah disetujui. Chat Step 1 dibekukan. Jika suatu saat ingin mengubah naskah, kamu bisa klik tombol **🔓 Buka Kunci** kapan saja.`;
        }
      }

      // Sinkronisasi state.narration
      state.narration = {
        status: state.is_locked
          ? 'ready'
          : finalDraftScript
            ? 'ready'
            : state.stage === 'narration_discussion' || state.stage === 'outline_discussion'
              ? 'discussing'
              : null,
        draft_script: finalDraftScript,
        clean_script: finalCleanScript,
        outline: mergedOutline,
        updated_at: now,
      };

      state.updated_at = now;
      writeFacelessState(state);

      let suggestedActions = Array.isArray(parsed.suggested_actions)
        ? parsed.suggested_actions.map((a) => String(a).trim()).filter(Boolean).slice(0, 3)
        : [];

      if (state.is_locked) {
        suggestedActions = ['🔓 Buka Kunci (Edit Kembali)'];
      } else if (state.stage === 'narration_discussion' && hasScriptToLock) {
        if (!suggestedActions.some((a) => a.toLowerCase().includes('kunci') || a.toLowerCase().includes('setuju'))) {
          suggestedActions = [
            '🔒 Naskah Sudah Mantap, Kunci Proyek (Setuju)',
            'Revisi dialog / adegan...',
            'Ubah gaya bahasa agar lebih santai',
          ];
        }
      }

      return {
        success: true,
        data: {
          reply: finalReply,
          stage: state.stage,
          idea_ready: ideaReady,
          idea: state.idea,
          duration_ready: durationReady,
          duration: state.duration,
          is_locked: state.is_locked,
          draft_script: finalDraftScript || null,
          clean_script: finalCleanScript || null,
          memory: state.memory,
          narration: state.narration,
          suggested_actions: suggestedActions,
          state,
        },
      };
    } catch (err) {
      console.error('[FacelessIdeaAgent] Chat error:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Retrieve saved Faceless project state
   */
  ipcMain.handle('get-faceless-state', async () => {
    try {
      const state = readFacelessState();
      return { success: true, data: state };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Lock Faceless Project
   */
  ipcMain.handle('lock-faceless-project', async () => {
    try {
      const state = readFacelessState() || createDefaultFacelessState();
      state.is_locked = true;
      state.locked_at = new Date().toISOString();
      state.updated_at = new Date().toISOString();
      writeFacelessState(state);
      return { success: true, data: state };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Unlock Faceless Project
   */
  ipcMain.handle('unlock-faceless-project', async () => {
    try {
      const state = readFacelessState() || createDefaultFacelessState();
      state.is_locked = false;
      state.locked_at = null;
      state.updated_at = new Date().toISOString();
      writeFacelessState(state);
      return { success: true, data: state };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Save Faceless project state manually
   */
  ipcMain.handle('save-faceless-state', async (_event, { data } = {}) => {
    try {
      if (!data || typeof data !== 'object') {
        return { success: false, error: 'Data state kosong.' };
      }
      const current = readFacelessState() || createDefaultFacelessState();
      const merged = {
        ...current,
        ...data,
        memory: normalizeMemory(data.memory || current.memory),
        updated_at: new Date().toISOString(),
      };
      writeFacelessState(merged);
      return { success: true, data: merged };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Reset Faceless project state
   */
  ipcMain.handle('reset-faceless-state', async () => {
    try {
      if (fs.existsSync(FACELESS_STATE_FILE)) fs.unlinkSync(FACELESS_STATE_FILE);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── FACELESS AUDIO STEP 2 HANDLERS ───────────────────────────────────

  /**
   * List all uploaded voiceover audio files for Faceless content
   */
  ipcMain.handle('list-faceless-audios', async () => {
    try {
      const audioDir = p.FACELESS_AUDIO_DIR || path.join(p.FACELESS_INPUT_DIR, 'audio');
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }

      const audiosJsonPath = path.join(p.FACELESS_INPUT_DIR, 'faceless_audios.json');
      let records = [];
      if (fs.existsSync(audiosJsonPath)) {
        try {
          records = JSON.parse(fs.readFileSync(audiosJsonPath, 'utf-8')) || [];
        } catch {
          records = [];
        }
      }

      const audioExts = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'];
      const validRecords = [];
      let updated = false;

      // 1. Verify existing records
      for (const rec of records) {
        if (rec.filePath && fs.existsSync(rec.filePath)) {
          const stat = fs.statSync(rec.filePath);
          let duration = rec.duration;
          if (!duration && ffmpeg && ffmpeg.getAudioDurationHelper) {
            duration = await ffmpeg.getAudioDurationHelper(rec.filePath);
            updated = true;
          }
          validRecords.push({
            ...rec,
            size: stat.size,
            duration: duration || 0,
            url: media ? media.mediaUrl(rec.filePath) : undefined,
          });
        } else {
          updated = true;
        }
      }

      // 2. Scan audioDir for untracked audio files
      if (fs.existsSync(audioDir)) {
        const filesInAudioDir = fs.readdirSync(audioDir).filter((f) => {
          return audioExts.includes(path.extname(f).toLowerCase());
        });

        for (const file of filesInAudioDir) {
          const fullPath = path.join(audioDir, file);
          const exists = validRecords.some((r) => r.filePath === fullPath || r.name === file);
          if (!exists) {
            const stat = fs.statSync(fullPath);
            let duration = 0;
            if (ffmpeg && ffmpeg.getAudioDurationHelper) {
              duration = await ffmpeg.getAudioDurationHelper(fullPath);
            }
            const partMatch = file.match(/part[_-]?(\d+)/i);
            const partNum = partMatch ? parseInt(partMatch[1], 10) : null;
            const newRec = {
              id: `faceless_audio_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              part: partNum,
              name: file,
              originalName: file,
              filePath: fullPath,
              size: stat.size,
              duration: duration || 0,
              uploadedAt: new Date(stat.mtime).toISOString(),
              url: media ? media.mediaUrl(fullPath) : undefined,
            };
            validRecords.push(newRec);
            updated = true;
          }
        }
      }

      // 3. Also scan input/faceless root for direct audio files (e.g. voiceover.mp3)
      if (fs.existsSync(p.FACELESS_INPUT_DIR)) {
        const filesInInputDir = fs.readdirSync(p.FACELESS_INPUT_DIR).filter((f) => {
          return audioExts.includes(path.extname(f).toLowerCase());
        });

        for (const file of filesInInputDir) {
          const fullPath = path.join(p.FACELESS_INPUT_DIR, file);
          const exists = validRecords.some((r) => r.name === file);
          if (!exists) {
            const stat = fs.statSync(fullPath);
            let duration = 0;
            if (ffmpeg && ffmpeg.getAudioDurationHelper) {
              duration = await ffmpeg.getAudioDurationHelper(fullPath);
            }
            const partMatch = file.match(/part[_-]?(\d+)/i);
            const partNum = partMatch ? parseInt(partMatch[1], 10) : null;
            const newRec = {
              id: `faceless_audio_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              part: partNum,
              name: file,
              originalName: file,
              filePath: fullPath,
              size: stat.size,
              duration: duration || 0,
              uploadedAt: new Date(stat.mtime).toISOString(),
              url: media ? media.mediaUrl(fullPath) : undefined,
            };
            validRecords.push(newRec);
            updated = true;
          }
        }
      }

      validRecords.sort((a, b) => {
        if (a.part !== null && b.part !== null) return a.part - b.part;
        if (a.part !== null) return -1;
        if (b.part !== null) return 1;
        return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
      });

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

      return {
        success: true,
        audios: validRecords,
        inputDir: p.FACELESS_INPUT_DIR,
        audioDir,
      };
    } catch (err) {
      console.error('[FacelessAudio] list error:', err);
      return { success: false, audios: [], error: err.message };
    }
  });

  /**
   * Upload Voice Over audio file into faceless input folder
   */
  ipcMain.handle('upload-faceless-audio', async (_event, { filePath, part } = {}) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, error: 'File audio sumber tidak ditemukan.' };
      }

      const audioDir = p.FACELESS_AUDIO_DIR || path.join(p.FACELESS_INPUT_DIR, 'audio');
      if (!fs.existsSync(p.FACELESS_INPUT_DIR)) {
        fs.mkdirSync(p.FACELESS_INPUT_DIR, { recursive: true });
      }
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }

      const ext = path.extname(filePath) || '.mp3';
      const baseName = path.basename(filePath);
      const partNum = typeof part === 'number' && !isNaN(part) && part > 0 ? part : null;

      // Clean standardized filename
      let targetName = '';
      if (partNum) {
        targetName = `part_${partNum}_narration${ext}`;
      } else {
        targetName = `voiceover${ext}`;
      }

      const destPathAudio = path.join(audioDir, targetName);
      const destPathInput = path.join(p.FACELESS_INPUT_DIR, targetName);

      // Copy to both input/faceless/audio/ and input/faceless/
      fs.copyFileSync(filePath, destPathAudio);
      try {
        fs.copyFileSync(filePath, destPathInput);
      } catch (err) {
        console.warn('[FacelessAudio] Warning copying to input root:', err.message);
      }

      const stat = fs.statSync(destPathAudio);

      let duration = 0;
      if (ffmpeg && ffmpeg.getAudioDurationHelper) {
        duration = await ffmpeg.getAudioDurationHelper(destPathAudio);
      }

      const audiosJsonPath = path.join(p.FACELESS_INPUT_DIR, 'faceless_audios.json');
      let records = [];
      if (fs.existsSync(audiosJsonPath)) {
        try {
          records = JSON.parse(fs.readFileSync(audiosJsonPath, 'utf-8')) || [];
        } catch {
          records = [];
        }
      }

      // If replacing same part or same single voiceover, remove old record
      records = records.filter((r) => {
        if (partNum !== null && r.part === partNum) return false;
        if (partNum === null && (r.name === targetName || r.part === null)) return false;
        return true;
      });

      const newRecord = {
        id: `faceless_audio_${partNum ? `part_${partNum}` : 'main'}_${Date.now()}`,
        part: partNum,
        name: targetName,
        originalName: baseName,
        filePath: destPathAudio,
        size: stat.size,
        duration: duration || 0,
        uploadedAt: new Date().toISOString(),
      };

      records.push(newRecord);
      records.sort((a, b) => {
        if (a.part !== null && b.part !== null) return a.part - b.part;
        if (a.part !== null) return -1;
        if (b.part !== null) return 1;
        return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
      });

      fs.writeFileSync(audiosJsonPath, JSON.stringify(records, null, 2), 'utf-8');

      // Update faceless_state.json with audio metadata
      const state = readFacelessState() || createDefaultFacelessState();
      const totalDur = records.reduce((acc, cur) => acc + (cur.duration || 0), 0);
      state.audio = {
        status: 'ready',
        total_duration: totalDur,
        items_count: records.length,
        primary_file: destPathAudio,
        updated_at: new Date().toISOString(),
      };
      state.updated_at = new Date().toISOString();
      writeFacelessState(state);

      return {
        success: true,
        audio: {
          ...newRecord,
          url: media ? media.mediaUrl(destPathAudio) : undefined,
        },
      };
    } catch (err) {
      console.error('[FacelessAudio] upload error:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Delete uploaded voiceover audio
   */
  ipcMain.handle('delete-faceless-audio', async (_event, { audioId } = {}) => {
    try {
      const audiosJsonPath = path.join(p.FACELESS_INPUT_DIR, 'faceless_audios.json');
      if (!fs.existsSync(audiosJsonPath)) {
        return { success: true };
      }

      let records = [];
      try {
        records = JSON.parse(fs.readFileSync(audiosJsonPath, 'utf-8')) || [];
      } catch {
        records = [];
      }

      const target = records.find((r) => r.id === audioId);
      if (target) {
        if (target.filePath && fs.existsSync(target.filePath)) {
          try { fs.unlinkSync(target.filePath); } catch {}
        }
        const copyInInput = path.join(p.FACELESS_INPUT_DIR, target.name);
        if (fs.existsSync(copyInInput)) {
          try { fs.unlinkSync(copyInInput); } catch {}
        }
      }

      records = records.filter((r) => r.id !== audioId);
      fs.writeFileSync(audiosJsonPath, JSON.stringify(records, null, 2), 'utf-8');

      // Update faceless_state.json
      const state = readFacelessState() || createDefaultFacelessState();
      const totalDur = records.reduce((acc, cur) => acc + (cur.duration || 0), 0);
      state.audio = {
        status: records.length > 0 ? 'ready' : 'idle',
        total_duration: totalDur,
        items_count: records.length,
        primary_file: records[0]?.filePath || null,
        updated_at: new Date().toISOString(),
      };
      state.updated_at = new Date().toISOString();
      writeFacelessState(state);

      return { success: true };
    } catch (err) {
      console.error('[FacelessAudio] delete error:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Get Faceless audio directory path
   */
  ipcMain.handle('get-faceless-audio-dir', async () => {
    try {
      const audioDir = p.FACELESS_AUDIO_DIR || path.join(p.FACELESS_INPUT_DIR, 'audio');
      if (!fs.existsSync(p.FACELESS_INPUT_DIR)) {
        fs.mkdirSync(p.FACELESS_INPUT_DIR, { recursive: true });
      }
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }
      return {
        success: true,
        dir: p.FACELESS_INPUT_DIR,
        audioDir,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── FACELESS TRANSCRIPT HANDLERS ─────────────────────────────────────

  /**
   * Save and auto-format timecoded transcript for Faceless content
   */
  ipcMain.handle('save-faceless-transcript', async (_event, { rawText, part } = {}) => {
    try {
      if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
        return { success: false, error: 'Teks transkrip tidak boleh kosong.' };
      }

      if (!fs.existsSync(p.FACELESS_INPUT_DIR)) {
        fs.mkdirSync(p.FACELESS_INPUT_DIR, { recursive: true });
      }
      const transcriptsDir =
        p.FACELESS_TRANSCRIPTS_DIR || path.join(p.FACELESS_INPUT_DIR, 'transcripts');
      if (!fs.existsSync(transcriptsDir)) {
        fs.mkdirSync(transcriptsDir, { recursive: true });
      }

      const parsed = parseAndFormatTimecodedTranscript(rawText);
      const partNum = typeof part === 'number' && !isNaN(part) && part > 0 ? part : null;

      const txtName = partNum ? `part_${partNum}_transcript.txt` : 'transcript.txt';
      const jsonName = partNum ? `part_${partNum}_transcript.json` : 'transcript.json';

      // Save directly in input/faceless/ (as requested: "disimpan di folder input faceless")
      const txtPathInput = path.join(p.FACELESS_INPUT_DIR, txtName);
      const jsonPathInput = path.join(p.FACELESS_INPUT_DIR, jsonName);

      // Also save in input/faceless/transcripts/
      const txtPathDir = path.join(transcriptsDir, txtName);
      const jsonPathDir = path.join(transcriptsDir, jsonName);

      fs.writeFileSync(txtPathInput, parsed.formattedText, 'utf-8');
      fs.writeFileSync(jsonPathInput, JSON.stringify(parsed.segments, null, 2), 'utf-8');

      try {
        fs.writeFileSync(txtPathDir, parsed.formattedText, 'utf-8');
        fs.writeFileSync(jsonPathDir, JSON.stringify(parsed.segments, null, 2), 'utf-8');
      } catch {}

      // Update faceless_state.json
      const state = readFacelessState() || createDefaultFacelessState();
      state.transcript = {
        rawText,
        formattedText: parsed.formattedText,
        segments: parsed.segments,
        segments_count: parsed.segments.length,
        part: partNum,
        filePath: txtPathInput,
        jsonPath: jsonPathInput,
        updatedAt: new Date().toISOString(),
      };
      state.updated_at = new Date().toISOString();
      writeFacelessState(state);

      return {
        success: true,
        data: {
          rawText,
          formattedText: parsed.formattedText,
          segments: parsed.segments,
          updatedAt: state.transcript.updatedAt,
          filePath: txtPathInput,
          jsonPath: jsonPathInput,
        },
      };
    } catch (err) {
      console.error('[FacelessTranscript] save error:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Get saved Faceless transcript
   */
  ipcMain.handle('get-faceless-transcript', async (_event, { part } = {}) => {
    try {
      const partNum = typeof part === 'number' && !isNaN(part) && part > 0 ? part : null;
      const txtName = partNum ? `part_${partNum}_transcript.txt` : 'transcript.txt';
      const jsonName = partNum ? `part_${partNum}_transcript.json` : 'transcript.json';

      const txtPath = path.join(p.FACELESS_INPUT_DIR, txtName);
      const jsonPath = path.join(p.FACELESS_INPUT_DIR, jsonName);

      if (fs.existsSync(txtPath)) {
        const formattedText = fs.readFileSync(txtPath, 'utf-8');
        let segments = [];
        if (fs.existsSync(jsonPath)) {
          try {
            segments = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) || [];
          } catch {}
        }
        if (segments.length === 0) {
          segments = parseAndFormatTimecodedTranscript(formattedText).segments;
        }

        const stat = fs.statSync(txtPath);
        return {
          success: true,
          data: {
            rawText: formattedText,
            formattedText,
            segments,
            updatedAt: new Date(stat.mtime).toISOString(),
            filePath: txtPath,
            jsonPath,
          },
        };
      }

      // Check state
      const state = readFacelessState();
      if (state?.transcript) {
        return {
          success: true,
          data: state.transcript,
        };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── FACELESS VISUAL PROMPT HANDLERS (SI KUPLUK KUNING & NANO BANANA) ──────

  const buildVisualPromptText = (prompts) => {
    return prompts
      .map((item, idx) => {
        return [
          `#${idx + 1} | Timecode: ${item.timecode || '-'} (${item.shotType || 'medium shot'}) [Template ${item.templateType || 'A'}]`,
          `Narasi: "${item.narration || ''}"`,
          `Prompt: ${item.finalPrompt || ''}`,
          '',
        ].join('\n');
      })
      .join('\n');
  };

  let facelessVisualStreamCancelled = false;

  ipcMain.handle('cancel-faceless-visual-stream', () => {
    facelessVisualStreamCancelled = true;
    return { success: true };
  });

  /**
   * Generate visual prompts per transcript line based on DNA Visual (Si Kupluk Kuning)
   * Processed in configurable batches (default 5 lines per batch) with real-time streaming updates
   */
  ipcMain.handle('generate-faceless-visual-prompts', async (event, { lines, model, instructions, batchSize = 5 } = {}) => {
    try {
      facelessVisualStreamCancelled = false;
      const bSize = typeof batchSize === 'number' && batchSize > 0 && batchSize <= 25 ? batchSize : 5;
      let targetSegments = [];

      if (Array.isArray(lines) && lines.length > 0) {
        targetSegments = lines;
      } else {
        // Read from transcript.json or transcript.txt
        const jsonPath = path.join(p.FACELESS_INPUT_DIR, 'transcript.json');
        const txtPath = path.join(p.FACELESS_INPUT_DIR, 'transcript.txt');

        if (fs.existsSync(jsonPath)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
            if (Array.isArray(parsed.segments) && parsed.segments.length > 0) {
              targetSegments = parsed.segments;
            }
          } catch {}
        }

        if (targetSegments.length === 0 && fs.existsSync(txtPath)) {
          const rawTxt = fs.readFileSync(txtPath, 'utf-8');
          const parsed = parseAndFormatTimecodedTranscript(rawTxt);
          targetSegments = parsed.segments;
        }

        if (targetSegments.length === 0) {
          const state = readFacelessState();
          if (Array.isArray(state?.transcript?.segments) && state.transcript.segments.length > 0) {
            targetSegments = state.transcript.segments;
          }
        }
      }

      if (targetSegments.length === 0) {
        return {
          success: false,
          error:
            'Belum ada transkrip timecode yang tersimpan di Step 2 (input/faceless/transcript.txt). Pastikan sudah menyimpan transkrip terlebih dahulu.',
        };
      }

      // Load prompt template
      let systemPrompt = '';
      try {
        systemPrompt = loadPrompt ? loadPrompt('faceless/faceless-visual-dna-prompt.md') : '';
      } catch {
        const fallbackPath = path.join(p.PROMPTS_DIR, 'faceless', 'faceless-visual-dna-prompt.md');
        if (fs.existsSync(fallbackPath)) {
          systemPrompt = fs.readFileSync(fallbackPath, 'utf-8');
        }
      }

      if (!systemPrompt) {
        return { success: false, error: 'Berkas template faceless-visual-dna-prompt.md tidak ditemukan.' };
      }

      const totalLines = targetSegments.length;
      const totalBatches = Math.ceil(totalLines / bSize);

      if (event?.sender) {
        event.sender.send('faceless-visual-stream-progress', {
          type: 'start',
          totalLines,
          totalBatches,
          batchSize: bSize,
          percent: 0,
          message: `Memulai streaming per ${bSize} baris untuk total ${totalLines} adegan...`,
        });
      }

      const chosenModel = model || DEFAULT_FACELESS_MODEL;
      const modelsToTry = [chosenModel, ...FALLBACK_MODELS.filter((m) => m !== chosenModel)];

      if (!fs.existsSync(p.FACELESS_INPUT_DIR)) {
        fs.mkdirSync(p.FACELESS_INPUT_DIR, { recursive: true });
      }
      const jsonPath = path.join(p.FACELESS_INPUT_DIR, 'visual_prompts.json');
      const txtPath = path.join(p.FACELESS_INPUT_DIR, 'visual_prompts.txt');

      const accumulatedPrompts = [];

      for (let b = 0; b < totalLines; b += bSize) {
        if (facelessVisualStreamCancelled) {
          if (event?.sender) {
            event.sender.send('faceless-visual-stream-progress', {
              type: 'cancelled',
              message: `Streaming dihentikan. ${accumulatedPrompts.length} adegan tersimpan aman.`,
              totalPromptsCount: accumulatedPrompts.length,
              percent: Math.round((accumulatedPrompts.length / totalLines) * 100),
            });
          }
          break;
        }

        const batchIndex = Math.floor(b / bSize) + 1;
        const currentChunk = targetSegments.slice(b, b + bSize);
        const startLineNum = b + 1;
        const endLineNum = b + currentChunk.length;

        if (event?.sender) {
          event.sender.send('faceless-visual-stream-progress', {
            type: 'batch-start',
            batchIndex,
            totalBatches,
            startLineNum,
            endLineNum,
            percent: Math.round((b / totalLines) * 100),
            message: `Memproses Batch ${batchIndex}/${totalBatches} (Baris #${startLineNum} - #${endLineNum})...`,
          });
        }

        const linesFormatted = currentChunk
          .map((seg, i) => `${startLineNum + i}. ${seg.timecode || ''} ${seg.text || ''}`)
          .join('\n');

        const userPrompt = [
          'Berikut adalah daftar baris naskah transkrip voiceover per timecode untuk batch ini:',
          linesFormatted,
          '',
          instructions ? `Catatan/instruksi tambahan: ${instructions}\n` : '',
          'Buatkan prompt gambar untuk setiap baris di atas dengan mematuhi Template A (jika Si Kupluk Kuning tampil) atau Template B (jika hanya benda/lokasi/zombie).',
          'Keluarkan HANYA JSON sesuai format dengan key "prompts".',
        ].join('\n');

        let rawResponse = '';
        let lastErr = null;

        for (const targetModel of modelsToTry) {
          try {
            rawResponse = await aiClient.chatCompletion({
              prompt: userPrompt,
              systemPrompt,
              model: targetModel,
              jsonMode: true,
              temperature: 0.6,
            });
            if (rawResponse) break;
          } catch (err) {
            lastErr = err;
            console.warn(`[FacelessVisualDNA Batch ${batchIndex}] Model ${targetModel} error:`, err.message);
          }
        }

        if (!rawResponse) {
          console.error(`Batch ${batchIndex} gagal:`, lastErr ? lastErr.message : 'No response');
          if (event?.sender) {
            event.sender.send('faceless-visual-stream-progress', {
              type: 'batch-error',
              batchIndex,
              totalBatches,
              error: lastErr ? lastErr.message : 'Tidak ada respon dari 9router AI.',
            });
          }
          continue;
        }

        let parsed = null;
        try {
          parsed = JSON.parse(aiClient.extractCleanJsonObject(rawResponse));
        } catch {
          try {
            parsed = JSON.parse(rawResponse);
          } catch {}
        }

        const promptList = Array.isArray(parsed?.prompts) ? parsed.prompts : [];

        // Normalize batch items
        const batchNormalized = currentChunk.map((seg, idxInChunk) => {
          const overallIndex = b + idxInChunk + 1;
          const aiItem = promptList[idxInChunk] || {};
          const templateType = (aiItem.templateType || 'A').toUpperCase() === 'B' ? 'B' : 'A';
          const shotType = aiItem.shotType || (templateType === 'B' ? 'wide shot' : 'medium shot');
          const sceneDesc = (aiItem.sceneDescription || '').replace(/\[|\]/g, '').trim();

          let finalPrompt = aiItem.finalPrompt || '';

          // Standardize template if AI altered it
          if (
            !finalPrompt ||
            (!finalPrompt.startsWith('2D flat hand-drawn stickman cartoon') &&
              !finalPrompt.startsWith('2D flat hand-drawn stickman cartoon style'))
          ) {
            if (templateType === 'A') {
              finalPrompt = `2D flat hand-drawn stickman cartoon, thick black outlines, NOT realistic, NOT 3D, NOT anime. Stickman: round white head, two round white eyes with small black dot pupils, tiny neutral mouth, thin black stick body and limbs (no clothes, no muscles, no realistic anatomy), mustard yellow beanie, army green sling bag. Scene: ${sceneDesc || 'the stickman in a survival situation'}. ${shotType}. Muted dark color palette, no text, no labels, 16:9.`;
            } else {
              finalPrompt = `2D flat hand-drawn stickman cartoon style, thick black outlines, NOT realistic, NOT 3D, NOT anime. Scene: ${sceneDesc || 'an empty desolate environment'}. ${shotType}. Muted dark color palette, no text, no labels, 16:9.`;
            }
          }

          return {
            id: `visual-${overallIndex}-${Date.now()}`,
            index: overallIndex,
            timecode: seg.timecode || `(0:${(overallIndex * 3).toString().padStart(2, '0')})`,
            seconds: typeof seg.seconds === 'number' ? seg.seconds : overallIndex * 3,
            narration: seg.text || '',
            templateType,
            shotType,
            sceneDescription: sceneDesc,
            finalPrompt,
          };
        });

        accumulatedPrompts.push(...batchNormalized);

        // Incremental save so user never loses progress!
        fs.writeFileSync(jsonPath, JSON.stringify(accumulatedPrompts, null, 2), 'utf-8');
        fs.writeFileSync(txtPath, buildVisualPromptText(accumulatedPrompts), 'utf-8');

        const state = readFacelessState() || createDefaultFacelessState();
        state.visual_prompts = accumulatedPrompts;
        writeFacelessState(state);

        // Send streaming batch-complete event
        if (event?.sender) {
          event.sender.send('faceless-visual-stream-progress', {
            type: 'batch-complete',
            batchIndex,
            totalBatches,
            batchSize: currentChunk.length,
            newPrompts: batchNormalized,
            totalPromptsCount: accumulatedPrompts.length,
            percent: Math.round((accumulatedPrompts.length / totalLines) * 100),
            message: `Batch ${batchIndex}/${totalBatches} selesai! (${accumulatedPrompts.length}/${totalLines} adegan)`,
          });
        }
      }

      // Stream complete
      if (event?.sender && !facelessVisualStreamCancelled) {
        event.sender.send('faceless-visual-stream-progress', {
          type: 'complete',
          totalPromptsCount: accumulatedPrompts.length,
          percent: 100,
          message: `🎉 Seluruh ${accumulatedPrompts.length} visual prompt berhasil dibuat!`,
        });
      }

      return {
        success: true,
        data: {
          prompts: accumulatedPrompts,
          jsonPath,
          txtPath,
          updatedAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Get existing visual prompts
   */
  ipcMain.handle('get-faceless-visual-prompts', async () => {
    try {
      const jsonPath = path.join(p.FACELESS_INPUT_DIR, 'visual_prompts.json');
      const txtPath = path.join(p.FACELESS_INPUT_DIR, 'visual_prompts.txt');

      if (fs.existsSync(jsonPath)) {
        try {
          const prompts = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
          if (Array.isArray(prompts) && prompts.length > 0) {
            return {
              success: true,
              data: {
                prompts,
                jsonPath,
                txtPath,
                updatedAt: fs.statSync(jsonPath).mtime.toISOString(),
              },
            };
          }
        } catch {}
      }

      const state = readFacelessState();
      if (Array.isArray(state?.visual_prompts) && state.visual_prompts.length > 0) {
        return {
          success: true,
          data: {
            prompts: state.visual_prompts,
            jsonPath,
            txtPath,
            updatedAt: state.updated_at || new Date().toISOString(),
          },
        };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Save edited visual prompts
   */
  ipcMain.handle('save-faceless-visual-prompts', async (_event, prompts) => {
    try {
      if (!Array.isArray(prompts)) {
        return { success: false, error: 'Data prompts harus berupa array.' };
      }

      if (!fs.existsSync(p.FACELESS_INPUT_DIR)) {
        fs.mkdirSync(p.FACELESS_INPUT_DIR, { recursive: true });
      }

      const jsonPath = path.join(p.FACELESS_INPUT_DIR, 'visual_prompts.json');
      const txtPath = path.join(p.FACELESS_INPUT_DIR, 'visual_prompts.txt');

      fs.writeFileSync(jsonPath, JSON.stringify(prompts, null, 2), 'utf-8');
      fs.writeFileSync(txtPath, buildVisualPromptText(prompts), 'utf-8');

      const state = readFacelessState() || createDefaultFacelessState();
      state.visual_prompts = prompts;
      writeFacelessState(state);

      return {
        success: true,
        data: {
          prompts,
          jsonPath,
          txtPath,
          updatedAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Regenerate single line visual prompt
   */
  ipcMain.handle(
    'regenerate-single-faceless-visual-prompt',
    async (_event, { item, customInstruction, model } = {}) => {
      try {
        if (!item || !item.narration) {
          return { success: false, error: 'Data item baris tidak valid.' };
        }

        let systemPrompt = '';
        try {
          systemPrompt = loadPrompt ? loadPrompt('faceless/faceless-visual-dna-prompt.md') : '';
        } catch {
          const fallbackPath = path.join(p.PROMPTS_DIR, 'faceless', 'faceless-visual-dna-prompt.md');
          if (fs.existsSync(fallbackPath)) {
            systemPrompt = fs.readFileSync(fallbackPath, 'utf-8');
          }
        }

        const userPrompt = [
          `Buatkan prompt visual HANYA untuk satu baris adegan ini:`,
          `Timecode: ${item.timecode || '(0:00)'}`,
          `Narasi: "${item.narration}"`,
          `Shot sebelumnya: ${item.shotType || 'medium shot'}`,
          `Template sebelumnya: ${item.templateType || 'A'}`,
          customInstruction ? `Instruksi khusus revisi: ${customInstruction}` : '',
          '',
          'Keluarkan JSON dengan format:',
          '{ "prompts": [ { "templateType": "A", "shotType": "...", "sceneDescription": "...", "finalPrompt": "..." } ] }',
        ].join('\n');

        const chosenModel = model || DEFAULT_FACELESS_MODEL;
        const response = await aiClient.chatCompletion({
          prompt: userPrompt,
          systemPrompt,
          model: chosenModel,
          jsonMode: true,
          temperature: 0.7,
        });

        let parsed = null;
        try {
          parsed = JSON.parse(aiClient.extractCleanJsonObject(response));
        } catch {
          parsed = JSON.parse(response);
        }

        const resItem = parsed?.prompts?.[0] || parsed;
        const templateType = (resItem.templateType || item.templateType || 'A').toUpperCase() === 'B' ? 'B' : 'A';
        const shotType = resItem.shotType || item.shotType || 'medium shot';
        const sceneDesc = (resItem.sceneDescription || item.sceneDescription || '').replace(/\[|\]/g, '').trim();

        let finalPrompt = resItem.finalPrompt || '';
        if (
          !finalPrompt ||
          (!finalPrompt.startsWith('2D flat') && !finalPrompt.startsWith('2D flat hand-drawn'))
        ) {
          if (templateType === 'A') {
            finalPrompt = `2D flat hand-drawn stickman cartoon, thick black outlines, NOT realistic, NOT 3D, NOT anime. Stickman: round white head, two round white eyes with small black dot pupils, tiny neutral mouth, thin black stick body and limbs (no clothes, no muscles, no realistic anatomy), mustard yellow beanie, army green sling bag. Scene: ${sceneDesc}. ${shotType}. Muted dark color palette, no text, no labels, 16:9.`;
          } else {
            finalPrompt = `2D flat hand-drawn stickman cartoon style, thick black outlines, NOT realistic, NOT 3D, NOT anime. Scene: ${sceneDesc}. ${shotType}. Muted dark color palette, no text, no labels, 16:9.`;
          }
        }

        const updated = {
          ...item,
          templateType,
          shotType,
          sceneDescription: sceneDesc,
          finalPrompt,
        };

        return { success: true, item: updated };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  );
}

module.exports = {
  register,
  cleanVoiceoverScript,
  parseAndFormatTimecodedTranscript,
};
