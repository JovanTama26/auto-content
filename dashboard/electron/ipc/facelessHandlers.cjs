// dashboard/electron/ipc/facelessHandlers.cjs
const path = require('path');
const fs = require('fs');

function register(ipcMain, { paths: p, aiClient, loadPrompt }) {
  if (!fs.existsSync(p.FACELESS_INPUT_DIR)) fs.mkdirSync(p.FACELESS_INPUT_DIR, { recursive: true });

  const FACELESS_STATE_FILE = path.join(p.FACELESS_INPUT_DIR, 'faceless_state.json');

  const createDefaultFacelessState = () => ({
    version: 1,
    stage: 'idea_discussion',
    idea_source: null,
    idea: null,
    chat_history: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const readFacelessState = () => {
    try {
      if (fs.existsSync(FACELESS_STATE_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(FACELESS_STATE_FILE, 'utf-8'));
        return {
          ...createDefaultFacelessState(),
          ...parsed,
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

  const normalizeFacelessIdea = (idea = {}) => ({
    title: String(idea.title || '').trim(),
    category: String(idea.category || 'Faceless Content').trim(),
    concept_hook: String(idea.concept_hook || '').trim(),
    description: String(idea.description || '').trim(),
    materials: Array.isArray(idea.materials)
      ? idea.materials.map((m) => String(m).trim()).filter(Boolean)
      : [],
    vibe: String(idea.vibe || '').trim(),
  });

  /**
   * Idea Agent: chat untuk menentukan ide konten faceless
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

      const transcript = history
        .map((m) => `${m.role === 'user' ? 'USER' : 'AGENT'}: ${m.content}`)
        .join('\n\n');

      const userPrompt = [
        'Berikut adalah riwayat percakapan dengan user:',
        '',
        transcript,
        '',
        'Berikan balasan berikutnya sesuai aturan sistem. Ingat: balas HANYA JSON valid.',
      ].join('\n');

      const FALLBACK_MODELS = [
        'gemini/gemini-3.1-flash-lite-preview',
        'gemini/gemini-3-flash-preview',
        'ds/deepseek-chat',
        'cmc/Qwen/Qwen3.6-Plus',
        'cmc/deepseek/deepseek-v4-flash',
      ];

      const modelsToTry = model ? [model, ...FALLBACK_MODELS.filter((m) => m !== model)] : FALLBACK_MODELS;

      let rawResponse = '';
      let lastErr = null;

      for (const targetModel of modelsToTry) {
        try {
          rawResponse = await aiClient.chatCompletion({
            prompt: userPrompt,
            systemPrompt,
            model: targetModel,
            jsonMode: true,
            temperature: 0.8,
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
        parsed = { reply: rawResponse, idea_ready: false, idea: null, suggested_actions: [] };
      }

      const reply =
        typeof parsed.reply === 'string' && parsed.reply.trim()
          ? parsed.reply.trim()
          : 'Aku belum bisa merumuskan balasan. Bisa ulangi?';

      const now = new Date().toISOString();
      const state = readFacelessState() || createDefaultFacelessState();

      state.chat_history = [
        ...history,
        { role: 'assistant', content: reply, at: now },
      ];

      const ideaReady = !!parsed.idea_ready && parsed.idea && typeof parsed.idea === 'object';
      if (ideaReady) {
        state.stage = 'idea_ready';
        state.idea = normalizeFacelessIdea(parsed.idea);
        if (parsed.idea_source === 'user' || parsed.idea_source === 'agent') {
          state.idea_source = parsed.idea_source;
        }
      }

      state.updated_at = now;
      writeFacelessState(state);

      return {
        success: true,
        data: {
          reply,
          idea_ready: ideaReady,
          idea: state.idea,
          suggested_actions: Array.isArray(parsed.suggested_actions)
            ? parsed.suggested_actions.map((a) => String(a).trim()).filter(Boolean).slice(0, 3)
            : [],
          state,
        },
      };
    } catch (err) {
      console.error('[FacelessIdeaAgent] Chat error:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Retrieve saved Faceless project state (idea + chat history)
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
   * Save Faceless project state manually
   */
  ipcMain.handle('save-faceless-state', async (_event, { data } = {}) => {
    try {
      if (!data || typeof data !== 'object') {
        return { success: false, error: 'Data state kosong.' };
      }
      const merged = {
        ...createDefaultFacelessState(),
        ...data,
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
