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

function register(ipcMain, { paths: p, aiClient, loadPrompt }) {
  if (!fs.existsSync(p.FACELESS_INPUT_DIR)) fs.mkdirSync(p.FACELESS_INPUT_DIR, { recursive: true });

  const FACELESS_STATE_FILE = path.join(p.FACELESS_INPUT_DIR, 'faceless_state.json');

  const createDefaultMemory = () => ({
    summary: '',
    key_points: [],
    user_preferences: [],
    draft_script: '',
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

      state.memory = {
        summary: incomingMemory.summary || prevMemory.summary || (state.idea ? `Konten: ${state.idea.title}` : ''),
        key_points: mergedKeyPoints,
        user_preferences: mergedPreferences,
        draft_script: finalDraftScript,
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
}

module.exports = { register };
