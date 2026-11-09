// dashboard/electron/ipc/facelessHandlers.cjs
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let activeFlowProcess = null;
let activeFlowSender = null;

const DEFAULT_FACELESS_MODEL = process.env.AI_MODEL || 'ag/gemini-3.8-flash-high';
const FALLBACK_MODELS = [
  'zd/claude-sonnet-5-5',
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

  const FACELESS_STATE_FILE = path.join(p.FACELESS_INPUT_DIR, 'faceless_state.json');
  const ACTIVE_SESSION_FILE = path.join(p.FACELESS_INPUT_DIR, 'active_session.json');

  const getActiveSession = () => {
    try {
      if (fs.existsSync(ACTIVE_SESSION_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(ACTIVE_SESSION_FILE, 'utf-8'));
        if (parsed && parsed.activeTopicId && parsed.activeEpisodeId) {
          return parsed;
        }
      }
    } catch {}

    const topicsDir = path.join(p.FACELESS_INPUT_DIR, 'topics');
    if (fs.existsSync(topicsDir)) {
      const topicFolders = fs.readdirSync(topicsDir).filter((name) => {
        const full = path.join(topicsDir, name);
        return fs.statSync(full).isDirectory();
      });
      if (topicFolders.length > 0) {
        const topicId = topicFolders.includes('supermarket_apocalypse') ? 'supermarket_apocalypse' : topicFolders[0];
        const epDir = path.join(topicsDir, topicId, 'episodes');
        let epId = 'ep_01';
        if (fs.existsSync(epDir)) {
          const epFolders = fs.readdirSync(epDir).filter((name) => {
            const full = path.join(epDir, name);
            return fs.statSync(full).isDirectory();
          });
          if (epFolders.length > 0) epId = epFolders[0];
        }
        return { activeTopicId: topicId, activeEpisodeId: epId };
      }
    }
    return { activeTopicId: 'supermarket_apocalypse', activeEpisodeId: 'ep_01' };
  };

  const setActiveSession = (topicId, episodeId) => {
    try {
      const session = { activeTopicId: topicId, activeEpisodeId: episodeId || 'ep_01' };
      fs.writeFileSync(ACTIVE_SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');
      return session;
    } catch (e) {
      console.warn('[FacelessSession] Gagal menyimpan active_session:', e.message);
      return { activeTopicId: topicId, activeEpisodeId: episodeId || 'ep_01' };
    }
  };

  const resolveStateFilePath = (topicId, episodeId) => {
    if (topicId && episodeId) {
      const epDir = path.join(p.FACELESS_INPUT_DIR, 'topics', topicId, 'episodes', episodeId);
      if (!fs.existsSync(epDir)) fs.mkdirSync(epDir, { recursive: true });
      return path.join(epDir, 'faceless_state.json');
    }
    const active = getActiveSession();
    if (active.activeTopicId && active.activeEpisodeId) {
      const epDir = path.join(p.FACELESS_INPUT_DIR, 'topics', active.activeTopicId, 'episodes', active.activeEpisodeId);
      if (!fs.existsSync(epDir)) fs.mkdirSync(epDir, { recursive: true });
      return path.join(epDir, 'faceless_state.json');
    }
    return FACELESS_STATE_FILE;
  };

  // Migration check: ensure supermarket_apocalypse/episodes/ep_01 has faceless_state.json if root faceless_state.json exists
  try {
    const rootStateFile = path.join(p.FACELESS_INPUT_DIR, 'faceless_state.json');
    const targetDir = path.join(p.FACELESS_INPUT_DIR, 'topics', 'supermarket_apocalypse', 'episodes', 'ep_01');
    const targetStateFile = path.join(targetDir, 'faceless_state.json');
    if (fs.existsSync(rootStateFile) && !fs.existsSync(targetStateFile)) {
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(rootStateFile, targetStateFile);
      console.log('📦 [Faceless] Migrated root faceless_state.json to supermarket_apocalypse/episodes/ep_01/faceless_state.json');
    }
  } catch (err) {
    console.warn('[Faceless] Migration check error:', err.message);
  }
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

  const readFacelessState = (topicId, episodeId) => {
    const targetFile = resolveStateFilePath(topicId, episodeId);
    try {
      let stateFileToRead = targetFile;
      if (!fs.existsSync(stateFileToRead)) {
        if (!topicId && !episodeId && fs.existsSync(FACELESS_STATE_FILE)) {
          stateFileToRead = FACELESS_STATE_FILE;
        } else {
          return null;
        }
      }
      const parsed = JSON.parse(fs.readFileSync(stateFileToRead, 'utf-8'));
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
    } catch (err) {
      console.warn('[FacelessState] Gagal membaca state:', err.message);
    }
    return null;
  };

  const writeFacelessState = (state, topicId, episodeId) => {
    const targetFile = resolveStateFilePath(topicId, episodeId);
    const dir = path.dirname(targetFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(targetFile, JSON.stringify(state, null, 2), 'utf-8');
    if (!topicId && !episodeId) {
      try {
        fs.writeFileSync(FACELESS_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
      } catch {}
    }
    return state;
  };

  /**
   * Idea Agent: chat untuk menentukan ide, durasi, alur kasar (A->B->C->D), dan naskah narasi
   */
  ipcMain.handle('faceless-agent-chat', async (_event, { messages = [], model, topicId, episodeId } = {}) => {
    try {
      const active = getActiveSession();
      const targetTopicId = topicId || active.activeTopicId;
      const targetEpisodeId = episodeId || active.activeEpisodeId;
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
      const currentState = readFacelessState(targetTopicId, targetEpisodeId) || createDefaultFacelessState();
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
      // Injeksi panduan kontinuitas jika ini adalah episode lanjutan (continuation)
      if (currentState.continuation?.is_continuation) {
        const topicDir = path.join(p.FACELESS_INPUT_DIR, 'topics', targetTopicId);
        let topicMeta = null;
        if (fs.existsSync(path.join(topicDir, 'topic_meta.json'))) {
          try { topicMeta = JSON.parse(fs.readFileSync(path.join(topicDir, 'topic_meta.json'), 'utf-8')); } catch {}
        }

        const chronology = (Array.isArray(currentState.continuation.series_history) && currentState.continuation.series_history.length > 0)
          ? currentState.continuation.series_history
          : collectSeriesChronology(targetTopicId, targetEpisodeId);

        memoryContextLines.push(
          '=== [BIBLE KONTINUITAS SERIAL & REKAP SELURUH EPISODE SEBELUMNYA] ===',
          `* Judul Serial: "${topicMeta?.title || currentState.idea?.title || targetTopicId}"`,
          `* Dunia & Latar Belakang Cerita: "${topicMeta?.description || currentState.continuation.topic_lore || '-'}"`,
          `* Karakter Utama: ${topicMeta?.character?.name || 'Tokoh Utama'} (${topicMeta?.character?.description || '-'})`,
          `* Gaya Visual: ${topicMeta?.visualTheme?.style || '-'}`,
          `* Episode Saat Ini yang Sedang Dibuat: ${targetEpisodeId.toUpperCase()}`,
          '',
          `KRONOLOGI LENGKAP CERITA EPISODE-EPISODE SEBELUMNYA:`
        );

        chronology.forEach((ep) => {
          memoryContextLines.push(
            `--- [EPISODE ${ep.episode_number} (${ep.episode_id.toUpperCase()}): "${ep.title}"] ---`,
            `- Ringkasan Alur: ${ep.summary || '-'}`,
            ep.key_points?.length ? `- Kejadian Penting: ${ep.key_points.slice(0, 4).join(' | ')}` : '',
            ep.cliffhanger ? `- Cliffhanger / Ending: "${ep.cliffhanger}"` : '',
            ep.ending_script_snippet ? `- Cuplikan Akhir Naskah: "...${ep.ending_script_snippet}"` : ''
          );
        });

        const lastEpInfo = chronology.length > 0 ? chronology[chronology.length - 1] : null;
        const lastEndingSnippet = currentState.continuation.previous_ending_snippet || lastEpInfo?.ending_script_snippet;
        const lastCliffhanger = currentState.continuation.previous_cliffhanger || lastEpInfo?.cliffhanger;

        memoryContextLines.push(
          '',
          `* KONDISI MEMASUKI EPISODE ${targetEpisodeId.toUpperCase()}:`,
          `- Episode ini WAJIB melanjutkan persis dari detik cliffhanger terakhir: "${lastCliffhanger || 'peristiwa terakhir'}"`,
          lastEndingSnippet ? `- Kalimat penutup naskah lalu: "...${lastEndingSnippet}"` : '',
          '',
          `* HUKUM KONTINUITAS SERIAL (MUTLAK):`,
          `  1. KONTINUITAS LANGSUNG: Buka cerita Episode ${targetEpisodeId.toUpperCase()} dengan aksi/respon langsung karakter terhadap cliffhanger di atas. DILARANG mereset cerita atau membuat intro umum seolah cerita baru mulai.`,
          `  2. KONSISTENSI FAKTA: Semua fakta, lokasi, musuh, luka karakter, dan persediaan logistik dari Episode 1 sampai episode lalu harus diakui dan dipertahankan.`,
          `  3. ESKALASI CERITA: Bawa konflik ke level yang lebih tinggi dengan konsekuensi dari apa yang sudah terjadi di episode-episode sebelumnya!`,
          '====================================================================='
        );
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
        } catch { }
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
      writeFacelessState(state, targetTopicId, targetEpisodeId);

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
  ipcMain.handle('get-faceless-state', async (_event, opts = {}) => {
    try {
      const active = getActiveSession();
      const targetTopicId = opts?.topicId || active.activeTopicId;
      const targetEpisodeId = opts?.episodeId || active.activeEpisodeId;
      const state = readFacelessState(targetTopicId, targetEpisodeId) || createDefaultFacelessState();
      return {
        success: true,
        data: state,
        activeTopicId: targetTopicId,
        activeEpisodeId: targetEpisodeId,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Lock Faceless Project
   */
  ipcMain.handle('lock-faceless-project', async (_event, opts = {}) => {
    try {
      const active = getActiveSession();
      const targetTopicId = opts?.topicId || active.activeTopicId;
      const targetEpisodeId = opts?.episodeId || active.activeEpisodeId;
      const state = readFacelessState(targetTopicId, targetEpisodeId) || createDefaultFacelessState();
      state.is_locked = true;
      state.locked_at = new Date().toISOString();
      state.updated_at = new Date().toISOString();
      writeFacelessState(state, targetTopicId, targetEpisodeId);
      return { success: true, data: state };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Unlock Faceless Project
   */
  ipcMain.handle('unlock-faceless-project', async (_event, opts = {}) => {
    try {
      const active = getActiveSession();
      const targetTopicId = opts?.topicId || active.activeTopicId;
      const targetEpisodeId = opts?.episodeId || active.activeEpisodeId;
      const state = readFacelessState(targetTopicId, targetEpisodeId) || createDefaultFacelessState();
      state.is_locked = false;
      state.locked_at = null;
      state.updated_at = new Date().toISOString();
      writeFacelessState(state, targetTopicId, targetEpisodeId);
      return { success: true, data: state };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Save Faceless project state manually
   */
  ipcMain.handle('save-faceless-state', async (_event, { data, topicId, episodeId } = {}) => {
    try {
      if (!data || typeof data !== 'object') {
        return { success: false, error: 'Data state kosong.' };
      }
      const active = getActiveSession();
      const targetTopicId = topicId || active.activeTopicId;
      const targetEpisodeId = episodeId || active.activeEpisodeId;
      const current = readFacelessState(targetTopicId, targetEpisodeId) || createDefaultFacelessState();
      const merged = {
        ...current,
        ...data,
        memory: normalizeMemory(data.memory || current.memory),
        updated_at: new Date().toISOString(),
      };
      writeFacelessState(merged, targetTopicId, targetEpisodeId);
      return { success: true, data: merged };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Reset Faceless project state
   */
  ipcMain.handle('reset-faceless-state', async (_event, opts = {}) => {
    try {
      const active = getActiveSession();
      const targetTopicId = opts?.topicId || active.activeTopicId;
      const targetEpisodeId = opts?.episodeId || active.activeEpisodeId;
      const targetFile = resolveStateFilePath(targetTopicId, targetEpisodeId);
      if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Set Faceless Active Session
   */
  ipcMain.handle('set-faceless-active-session', async (_event, { topicId, episodeId } = {}) => {
    try {
      if (!topicId) return { success: false, error: 'Topic ID is required.' };
      const session = setActiveSession(topicId, episodeId);
      return { success: true, ...session };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Create New Faceless Topic
   */
  ipcMain.handle('create-faceless-topic', async (_event, { title, category, description, characterName, characterDesc, vibe } = {}) => {
    try {
      if (!title || !title.trim()) {
        return { success: false, error: 'Judul topik wajib diisi.' };
      }
      const rawTitle = title.trim();
      let topicId = rawTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      if (!topicId) topicId = `topic_${Date.now()}`;

      const topicDir = path.join(p.FACELESS_INPUT_DIR, 'topics', topicId);
      if (fs.existsSync(topicDir)) {
        topicId = `${topicId}_${Date.now().toString().slice(-4)}`;
      }
      const finalTopicDir = path.join(p.FACELESS_INPUT_DIR, 'topics', topicId);
      fs.mkdirSync(finalTopicDir, { recursive: true });

      const topicMeta = {
        id: topicId,
        title: rawTitle,
        category: category?.trim() || 'Survival Fiction',
        description: description?.trim() || '',
        character: {
          name: characterName?.trim() || 'Tokoh Utama',
          description: characterDesc?.trim() || 'Karakter utama serial faceless.',
          dnaPrompt: '2D flat hand-drawn stickman cartoon, thick black outlines, NOT realistic, NOT 3D, NOT anime.'
        },
        visualTheme: {
          style: '2D flat hand-drawn stickman cartoon, thick black outlines, 16:9',
          environment: description?.trim() || ''
        },
        vibe: vibe?.trim() || 'Tegang, misterius, imersif',
        created_at: new Date().toISOString()
      };
      fs.writeFileSync(path.join(finalTopicDir, 'topic_meta.json'), JSON.stringify(topicMeta, null, 2), 'utf-8');

      // Create Episode 1
      const ep1Dir = path.join(finalTopicDir, 'episodes', 'ep_01');
      fs.mkdirSync(ep1Dir, { recursive: true });

      const ep1State = {
        ...createDefaultFacelessState(),
        topic_id: topicId,
        episode_id: 'ep_01',
        idea_source: 'user',
        idea: {
          title: `${rawTitle} - Episode 1`,
          category: topicMeta.category,
          concept_hook: topicMeta.description || rawTitle,
          description: topicMeta.description || `Permulaan serial ${rawTitle}.`,
          materials: [
            'Visual footage pendukung cerita',
            'Sound FX & ambience lingkungan',
            'Overlay teks narasi'
          ],
          vibe: topicMeta.vibe
        },
        duration: {
          label: 'Video Panjang Modular (±10 Menit / 10 Part Shorts)',
          seconds: 600,
          format: 'long'
        },
        chat_history: [
          {
            role: 'assistant',
            content: `Halo! Selamat datang di serial baru: **${rawTitle}**!\n\nPremis dunia: *"${topicMeta.description || rawTitle}"*.\n\nMari kita mulai rancang **Episode 1**. Kamu mau aku tawarkan beberapa opsi hook pembuka yang menarik untuk Episode 1, atau kamu sudah punya ide kejadian awalnya?`
           }
        ]
      };
      fs.writeFileSync(path.join(ep1Dir, 'faceless_state.json'), JSON.stringify(ep1State, null, 2), 'utf-8');

      setActiveSession(topicId, 'ep_01');

      return {
        success: true,
        topicId,
        episodeId: 'ep_01',
        topicMeta,
        data: ep1State
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Helper untuk mengumpulkan kronologi dan cerita lengkap seluruh episode sebelumnya
   */
  const collectSeriesChronology = (topicId, currentEpId = null) => {
    const topicDir = path.join(p.FACELESS_INPUT_DIR, 'topics', topicId);
    const episodesDir = path.join(topicDir, 'episodes');
    if (!fs.existsSync(episodesDir)) return [];

    const epFolders = fs.readdirSync(episodesDir).filter((name) => {
      return fs.statSync(path.join(episodesDir, name)).isDirectory() && /^ep_\d+$/i.test(name);
    }).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    const chronology = [];
    for (const epId of epFolders) {
      if (currentEpId && epId === currentEpId) continue;
      const epDir = path.join(episodesDir, epId);
      const stateFile = path.join(epDir, 'faceless_state.json');
      if (fs.existsSync(stateFile)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
          const outline = parsed.narration?.outline || parsed.memory?.narration_outline || {};
          const script = parsed.narration?.clean_script || parsed.narration?.draft_script || parsed.memory?.draft_script || '';
          const lines = script.split('\n').map((l) => l.trim()).filter(Boolean);
          const endingSnippet = lines.slice(-4).join(' ');

          const epNumMatch = epId.match(/\d+/);
          const epNum = epNumMatch ? parseInt(epNumMatch[0], 10) : 1;

          chronology.push({
            episode_id: epId,
            episode_number: epNum,
            title: parsed.idea?.title || `Episode ${epNum}`,
            summary: parsed.memory?.summary || parsed.idea?.description || '',
            key_points: parsed.memory?.key_points || [],
            hook: outline.hook || '',
            plan: outline.plan || '',
            twist: outline.twist || '',
            cliffhanger: outline.cliffhanger || '',
            notes: outline.notes || '',
            ending_script_snippet: endingSnippet ? endingSnippet.slice(0, 500) : '',
          });
        } catch (e) {
          console.warn(`[Faceless] Gagal membaca state ${epId} untuk kronologi:`, e.message);
        }
      }
    }
    return chronology;
  };

  /**
   * Create New Episode for an existing Topic (Direct continuation carrying all previous episodes context)
   */
  ipcMain.handle('create-faceless-episode', async (_event, { topicId, title } = {}) => {
    try {
      if (!topicId) return { success: false, error: 'Topic ID is required.' };
      const topicDir = path.join(p.FACELESS_INPUT_DIR, 'topics', topicId);
      if (!fs.existsSync(topicDir)) {
        return { success: false, error: `Topic "${topicId}" tidak ditemukan.` };
      }

      let topicMeta = { id: topicId, title: topicId, description: '', category: 'Faceless Content' };
      const metaPath = path.join(topicDir, 'topic_meta.json');
      if (fs.existsSync(metaPath)) {
        try { topicMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch {}
      }

      const episodesDir = path.join(topicDir, 'episodes');
      if (!fs.existsSync(episodesDir)) fs.mkdirSync(episodesDir, { recursive: true });

      const existingEpFolders = fs.readdirSync(episodesDir).filter((name) => {
        return fs.statSync(path.join(episodesDir, name)).isDirectory() && /^ep_\d+$/i.test(name);
      }).sort();

      let nextEpNum = 1;
      let prevEpId = null;
      if (existingEpFolders.length > 0) {
        const lastFolder = existingEpFolders[existingEpFolders.length - 1];
        const match = lastFolder.match(/\d+/);
        if (match) {
          nextEpNum = parseInt(match[0], 10) + 1;
          prevEpId = lastFolder;
        }
      }
      const newEpId = `ep_${String(nextEpNum).padStart(2, '0')}`;
      const newEpDir = path.join(episodesDir, newEpId);
      fs.mkdirSync(newEpDir, { recursive: true });

      // Kumpulkan kronologi dan cerita LENGKAP dari seluruh episode sebelumnya
      const chronology = collectSeriesChronology(topicId);
      let prevSummary = '';
      let prevCliffhanger = '';
      let prevEndingSnippet = '';
      if (chronology.length > 0) {
        const lastEp = chronology[chronology.length - 1];
        prevEpId = lastEp.episode_id;
        prevSummary = lastEp.summary;
        prevCliffhanger = lastEp.cliffhanger;
        prevEndingSnippet = lastEp.ending_script_snippet;
      }
      const defaultEpTitle = title?.trim() || `${topicMeta.title} - Episode ${nextEpNum}`;
      const continuationHook = prevCliffhanger
        ? `Lanjutan persis setelah: "${prevCliffhanger}"`
        : `Kelanjutan petualangan dari ${prevEpId ? prevEpId.toUpperCase() : 'episode sebelumnya'}`;

      const newEpState = {
        ...createDefaultFacelessState(),
        topic_id: topicId,
        episode_id: newEpId,
        stage: 'outline_discussion',
        continuation: {
          is_continuation: Boolean(prevEpId),
          previous_episode_id: prevEpId,
          previous_episode_number: nextEpNum - 1,
          previous_summary: prevSummary,
          previous_cliffhanger: prevCliffhanger,
          previous_ending_snippet: prevEndingSnippet,
          topic_lore: topicMeta.description || '',
          series_history: chronology,
        },
        idea_source: 'agent',
        idea: {
          title: defaultEpTitle,
          category: topicMeta.category,
          concept_hook: continuationHook,
          description: `Episode ${nextEpNum} menyambung cerita dari ${prevEpId ? prevEpId.toUpperCase() : 'Episode 1'}. Menghadapi situasi setelah peristiwa: ${prevCliffhanger || 'sebelumnya'}`,
          materials: [
            'Footage lanjutan cerita',
            'Sound FX ketegangan & kelanjutan',
            'Overlay teks tracker episode'
          ],
          vibe: topicMeta.vibe || 'Tegang, bersambung, intens'
        },
        duration: {
          label: 'Video Panjang Modular (±10 Menit / 10 Part Shorts)',
          seconds: 600,
          format: 'long'
        },
        memory: {
          ...createDefaultMemory(),
          summary: `Episode ${nextEpNum} resmi dibuat sebagai kelanjutan cerita dari ${prevEpId ? prevEpId.toUpperCase() : 'Episode 1'}. Melanjutkan dari cliffhanger: "${prevCliffhanger || 'Konflik sebelumnya'}".`,
          key_points: [
            `Lanjutan langsung dari ${prevEpId ? prevEpId.toUpperCase() : 'Episode 1'}`,
            prevCliffhanger ? `Melanjutkan cliffhanger: ${prevCliffhanger}` : 'Melanjutkan alur cerita',
            `Karakter: ${topicMeta.character?.name || 'Karakter Utama'}`
          ],
          narration_outline: {
            hook: continuationHook,
            plan: '',
            failure: '',
            improvisation: '',
            stakes: '',
            twist: '',
            cliffhanger: '',
            notes: `Kelanjutan dari ${prevEpId}`
          }
        },
        chat_history: [
          {
            role: 'assistant',
            content: `Halo! Ini adalah **Episode ${nextEpNum}** lanjutan dari serial **${topicMeta.title}**!\n\nDi episode sebelumnya (${prevEpId ? prevEpId.toUpperCase() : 'Episode 1'}), cerita berakhir dengan situasi genting:\n> *"${prevCliffhanger || 'Konflik terakhir masih menggantung dan belum tuntas.'}"*${prevEndingSnippet ? `\n> *(Kalimat penutup naskah: "...${prevEndingSnippet.slice(0, 150)}...")*` : ''}\n\nSeluruh konteks cerita dan kronologi dari ${chronology.length} episode sebelumnya sudah lengkap terbawa. Aku siap merancang naskah kelanjutan yang langsung menyambung dari detik tersebut. Mau aku buatkan draf kasar alur A-B-C-D untuk Episode ${nextEpNum} ini, atau ada plot twist khusus yang ingin kamu masukkan?`
          }
        ]
      };

      fs.writeFileSync(path.join(newEpDir, 'faceless_state.json'), JSON.stringify(newEpState, null, 2), 'utf-8');
      setActiveSession(topicId, newEpId);

      return {
        success: true,
        topicId,
        episodeId: newEpId,
        data: newEpState
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── FACELESS AUDIO STEP 2 HANDLERS ───────────────────────────────────

  /**
   * List all uploaded voiceover audio files for Faceless content
   */
  ipcMain.handle('list-faceless-audios', async (_event, opts = {}) => {
    try {
      const active = getActiveSession();
      const targetTopicId = opts?.topicId || active.activeTopicId;
      const targetEpisodeId = opts?.episodeId || active.activeEpisodeId;

      // STRICT EPISODE ISOLATION:
      if (targetTopicId && targetEpisodeId) {
        const epDir = path.join(p.FACELESS_INPUT_DIR, 'topics', targetTopicId, 'episodes', targetEpisodeId);
        const epAudioDir = path.join(epDir, 'audio');
        if (!fs.existsSync(epAudioDir)) {
          fs.mkdirSync(epAudioDir, { recursive: true });
        }
        const audioExts = ['.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac'];
        const validRecords = [];

        const filesInAudioDir = fs.readdirSync(epAudioDir).filter((f) => {
          return audioExts.includes(path.extname(f).toLowerCase());
        });
        for (const file of filesInAudioDir) {
          const fullPath = path.join(epAudioDir, file);
          const stat = fs.statSync(fullPath);
          let duration = 0;
          if (ffmpeg && ffmpeg.getAudioDurationHelper) {
            duration = await ffmpeg.getAudioDurationHelper(fullPath);
          }
          validRecords.push({
            id: `faceless_audio_${targetTopicId}_${targetEpisodeId}_${file}`,
            part: null,
            name: file,
            originalName: file,
            filePath: fullPath,
            size: stat.size,
            duration: duration || 0,
            uploadedAt: new Date(stat.mtime).toISOString(),
            url: media ? media.mediaUrl(fullPath) : undefined,
          });
        }

        return {
          success: true,
          audios: validRecords,
          inputDir: epDir,
          audioDir: epAudioDir,
          topicId: targetTopicId,
          episodeId: targetEpisodeId,
        };
      }

      return { success: true, audios: [], inputDir: p.FACELESS_INPUT_DIR, audioDir: null };
    } catch (err) {
      console.error('[FacelessAudio] list error:', err);
      return { success: false, audios: [], error: err.message };
    }
  });

  /**
   * Upload Voice Over audio file into faceless input folder
   */
  ipcMain.handle('upload-faceless-audio', async (_event, { filePath, part, topicId, episodeId } = {}) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, error: 'File audio sumber tidak ditemukan.' };
      }

      const active = getActiveSession();
      const targetTopicId = topicId || active.activeTopicId;
      const targetEpisodeId = episodeId || active.activeEpisodeId;

      const epAudioDir = (targetTopicId && targetEpisodeId)
        ? path.join(p.FACELESS_INPUT_DIR, 'topics', targetTopicId, 'episodes', targetEpisodeId, 'audio')
        : null;
      if (epAudioDir && !fs.existsSync(epAudioDir)) {
        fs.mkdirSync(epAudioDir, { recursive: true });
      }
      const audioDir = epAudioDir || path.join(p.FACELESS_INPUT_DIR, 'audio');
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
      fs.copyFileSync(filePath, destPathAudio);

      const stat = fs.statSync(destPathAudio);

      let duration = 0;
      if (ffmpeg && ffmpeg.getAudioDurationHelper) {
        duration = await ffmpeg.getAudioDurationHelper(destPathAudio);
      }

      const newRecord = {
        id: `faceless_audio_${targetTopicId}_${targetEpisodeId}_${targetName}`,
        part: partNum,
        name: targetName,
        originalName: baseName,
        filePath: destPathAudio,
        size: stat.size,
        duration: duration || 0,
        uploadedAt: new Date().toISOString(),
      };

      // Update state for this episode!
      const state = readFacelessState(targetTopicId, targetEpisodeId) || createDefaultFacelessState();
      state.audio = {
        status: 'ready',
        total_duration: duration || 0,
        items_count: 1,
        primary_file: destPathAudio,
        updated_at: new Date().toISOString(),
      };
      state.updated_at = new Date().toISOString();
      writeFacelessState(state, targetTopicId, targetEpisodeId);
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
  ipcMain.handle('delete-faceless-audio', async (_event, { audioId, topicId, episodeId } = {}) => {
    try {
      const active = getActiveSession();
      const targetTopicId = topicId || active.activeTopicId;
      const targetEpisodeId = episodeId || active.activeEpisodeId;

      if (targetTopicId && targetEpisodeId) {
        const epDir = path.join(p.FACELESS_INPUT_DIR, 'topics', targetTopicId, 'episodes', targetEpisodeId);
        const epAudioDir = path.join(epDir, 'audio');
        if (fs.existsSync(epAudioDir)) {
          const files = fs.readdirSync(epAudioDir);
          for (const f of files) {
            const expectedId = `faceless_audio_${targetTopicId}_${targetEpisodeId}_${f}`;
            if (expectedId === audioId || f === audioId || audioId.endsWith(f)) {
              try { fs.unlinkSync(path.join(epAudioDir, f)); } catch {}
            }
          }
        }
        // Update episode state
        const state = readFacelessState(targetTopicId, targetEpisodeId) || createDefaultFacelessState();
        if (state.audio) {
          delete state.audio;
          state.updated_at = new Date().toISOString();
          writeFacelessState(state, targetTopicId, targetEpisodeId);
        }
        return { success: true };
      }

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
          try { fs.unlinkSync(target.filePath); } catch { }
        }
        const copyInInput = path.join(p.FACELESS_INPUT_DIR, target.name);
        if (fs.existsSync(copyInInput)) {
          try { fs.unlinkSync(copyInInput); } catch { }
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
  ipcMain.handle('get-faceless-audio-dir', async (_event, opts = {}) => {
    try {
      const active = getActiveSession();
      const targetTopicId = opts?.topicId || active.activeTopicId;
      const targetEpisodeId = opts?.episodeId || active.activeEpisodeId;

      if (targetTopicId && targetEpisodeId) {
        const epDir = path.join(p.FACELESS_INPUT_DIR, 'topics', targetTopicId, 'episodes', targetEpisodeId);
        const epAudioDir = path.join(epDir, 'audio');
        if (!fs.existsSync(epAudioDir)) fs.mkdirSync(epAudioDir, { recursive: true });
        return {
          success: true,
          dir: epDir,
          audioDir: epAudioDir,
        };
      }

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
  ipcMain.handle('save-faceless-transcript', async (_event, { rawText, part, topicId, episodeId } = {}) => {
    try {
      if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
        return { success: false, error: 'Teks transkrip tidak boleh kosong.' };
      }

      const active = getActiveSession();
      const targetTopicId = topicId || active.activeTopicId;
      const targetEpisodeId = episodeId || active.activeEpisodeId;

      const epDir = (targetTopicId && targetEpisodeId)
        ? path.join(p.FACELESS_INPUT_DIR, 'topics', targetTopicId, 'episodes', targetEpisodeId)
        : null;
      if (!epDir) {
        return { success: false, error: 'Topic ID dan Episode ID wajib ada untuk menyimpan transkrip.' };
      }
      if (!fs.existsSync(epDir)) {
        fs.mkdirSync(epDir, { recursive: true });
      }
      const parsed = parseAndFormatTimecodedTranscript(rawText);
      const partNum = typeof part === 'number' && !isNaN(part) && part > 0 ? part : null;

      const txtName = partNum ? `part_${partNum}_transcript.txt` : 'transcript.txt';
      const jsonName = partNum ? `part_${partNum}_transcript.json` : 'transcript.json';
      const epTxtPath = path.join(epDir, txtName);
      const epJsonPath = path.join(epDir, jsonName);

      fs.writeFileSync(epTxtPath, parsed.formattedText, 'utf-8');
      fs.writeFileSync(epJsonPath, JSON.stringify(parsed.segments, null, 2), 'utf-8');

      // Update state for this episode
      const state = readFacelessState(targetTopicId, targetEpisodeId) || createDefaultFacelessState();
      state.transcript = {
        rawText,
        formattedText: parsed.formattedText,
        segments: parsed.segments,
        segments_count: parsed.segments.length,
        part: partNum,
        filePath: epTxtPath,
        jsonPath: epJsonPath,
        updatedAt: new Date().toISOString(),
      };
      state.updated_at = new Date().toISOString();
      writeFacelessState(state, targetTopicId, targetEpisodeId);
      return {
        success: true,
        data: {
          rawText,
          formattedText: parsed.formattedText,
          segments: parsed.segments,
          updatedAt: state.transcript.updatedAt,
          filePath: epTxtPath,
          jsonPath: epJsonPath,
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
  ipcMain.handle('get-faceless-transcript', async (_event, opts = {}) => {
    try {
      const active = getActiveSession();
      const targetTopicId = opts?.topicId || active.activeTopicId;
      const targetEpisodeId = opts?.episodeId || active.activeEpisodeId;
      const partNum = typeof opts?.part === 'number' && !isNaN(opts.part) && opts.part > 0 ? opts.part : null;

      const txtName = partNum ? `part_${partNum}_transcript.txt` : 'transcript.txt';
      const jsonName = partNum ? `part_${partNum}_transcript.json` : 'transcript.json';

      const epDir = (targetTopicId && targetEpisodeId)
        ? path.join(p.FACELESS_INPUT_DIR, 'topics', targetTopicId, 'episodes', targetEpisodeId)
        : null;

      // 1. Check in episode directory first
      if (epDir && fs.existsSync(path.join(epDir, txtName))) {
        const epTxtPath = path.join(epDir, txtName);
        const epJsonPath = path.join(epDir, jsonName);
        const formattedText = fs.readFileSync(epTxtPath, 'utf-8');
        let segments = [];
        if (fs.existsSync(epJsonPath)) {
          try {
            segments = JSON.parse(fs.readFileSync(epJsonPath, 'utf-8')) || [];
          } catch { }
        }
        if (segments.length === 0) {
          segments = parseAndFormatTimecodedTranscript(formattedText).segments;
        }
        const stat = fs.statSync(epTxtPath);
        return {
          success: true,
          data: {
            rawText: formattedText,
            formattedText,
            segments,
            updatedAt: new Date(stat.mtime).toISOString(),
            filePath: epTxtPath,
            jsonPath: epJsonPath,
          },
        };
      }
      // 2. Fallback to state of this specific episode
      if (targetTopicId && targetEpisodeId) {
        const state = readFacelessState(targetTopicId, targetEpisodeId);
        if (state?.transcript) {
          return {
            success: true,
            data: state.transcript,
          };
        }
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
  ipcMain.handle('generate-faceless-visual-prompts', async (event, { lines, model, instructions, batchSize = 5, topicId, episodeId } = {}) => {
    try {
      facelessVisualStreamCancelled = false;
      const bSize = typeof batchSize === 'number' && batchSize > 0 && batchSize <= 25 ? batchSize : 5;
      let targetSegments = [];

      const active = getActiveSession();
      const targetTopicId = topicId || active.activeTopicId;
      const targetEpisodeId = episodeId || active.activeEpisodeId;

      let epDir = null;
      if (targetTopicId && targetEpisodeId) {
        epDir = path.join(p.FACELESS_INPUT_DIR, 'topics', targetTopicId, 'episodes', targetEpisodeId);
        if (!fs.existsSync(epDir)) fs.mkdirSync(epDir, { recursive: true });
      }

      let jsonPath = path.join(p.FACELESS_INPUT_DIR, 'visual_prompts.json');
      let txtPath = path.join(p.FACELESS_INPUT_DIR, 'visual_prompts.txt');
      if (epDir) {
        jsonPath = path.join(epDir, 'visual_prompts.json');
        txtPath = path.join(epDir, 'visual_prompts.txt');
      }

      if (Array.isArray(lines) && lines.length > 0) {
        targetSegments = lines;
      } else {
        // Read from episode transcript first if scoped
        let epJsonPath = epDir ? path.join(epDir, 'transcript.json') : path.join(p.FACELESS_INPUT_DIR, 'transcript.json');
        let epTxtPath = epDir ? path.join(epDir, 'transcript.txt') : path.join(p.FACELESS_INPUT_DIR, 'transcript.txt');

        if (fs.existsSync(epJsonPath)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(epJsonPath, 'utf-8'));
            if (Array.isArray(parsed.segments) && parsed.segments.length > 0) {
              targetSegments = parsed.segments;
            }
          } catch { }
        }

        if (targetSegments.length === 0 && fs.existsSync(epTxtPath)) {
          const rawTxt = fs.readFileSync(epTxtPath, 'utf-8');
          const parsed = parseAndFormatTimecodedTranscript(rawTxt);
          targetSegments = parsed.segments;
        }

        if (targetSegments.length === 0) {
          const state = readFacelessState(targetTopicId, targetEpisodeId);
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
          } catch { }
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

        const state = readFacelessState(targetTopicId, targetEpisodeId) || createDefaultFacelessState();
        state.visual_prompts = accumulatedPrompts;
        writeFacelessState(state, targetTopicId, targetEpisodeId);

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
  ipcMain.handle('get-faceless-visual-prompts', async (_event, opts = {}) => {
    try {
      const active = getActiveSession();
      const targetTopicId = opts?.topicId || active.activeTopicId;
      const targetEpisodeId = opts?.episodeId || active.activeEpisodeId;

      let jsonPath = path.join(p.FACELESS_INPUT_DIR, 'visual_prompts.json');
      let txtPath = path.join(p.FACELESS_INPUT_DIR, 'visual_prompts.txt');
      let imagesDir = path.join(p.FACELESS_INPUT_DIR, 'images');

      if (targetTopicId && targetEpisodeId) {
        const epDir = path.join(p.FACELESS_INPUT_DIR, 'topics', targetTopicId, 'episodes', targetEpisodeId);
        jsonPath = path.join(epDir, 'visual_prompts.json');
        txtPath = path.join(epDir, 'visual_prompts.txt');
        imagesDir = path.join(epDir, 'images');
        if (!fs.existsSync(imagesDir)) {
          fs.mkdirSync(imagesDir, { recursive: true });
        }
      }

      const enrichItems = (rawItems) => {
        return rawItems.map((item) => {
          const idx = item.index;
          const pad3 = String(idx).padStart(3, '0');
          const possibleFiles = [
            path.join(imagesDir, `scene_${pad3}.jpg`),
            path.join(imagesDir, `scene_${pad3}.png`),
            path.join(imagesDir, `scene_${pad3}.jpeg`),
            path.join(imagesDir, `scene_${pad3}.webp`),
            path.join(imagesDir, `scene_${idx}.jpg`),
            path.join(imagesDir, `scene_${idx}.png`),
            item.image_path,
          ].filter(Boolean);

          let foundPath = null;
          for (const pf of possibleFiles) {
            if (fs.existsSync(pf)) {
              try {
                if (fs.statSync(pf).size > 1000) {
                  foundPath = pf;
                  break;
                }
              } catch { }
            }
          }

          if (foundPath) {
            const stat = fs.statSync(foundPath);
            return {
              ...item,
              image_path: foundPath,
              media_url: media ? `${media.mediaUrl(foundPath)}?t=${stat.mtimeMs}` : undefined,
              has_image: true,
              image_size: stat.size,
            };
          }
          return {
            ...item,
            has_image: false,
          };
        });
      };

      if (fs.existsSync(jsonPath)) {
        try {
          const prompts = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
          if (Array.isArray(prompts) && prompts.length > 0) {
            return {
              success: true,
              data: {
                prompts: enrichItems(prompts),
                jsonPath,
                txtPath,
                updatedAt: fs.statSync(jsonPath).mtime.toISOString(),
              },
            };
          }
        } catch { }
      }

      const state = readFacelessState(targetTopicId, targetEpisodeId);
      if (Array.isArray(state?.visual_prompts) && state.visual_prompts.length > 0) {
        return {
          success: true,
          data: {
            prompts: enrichItems(state.visual_prompts),
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
  ipcMain.handle('save-faceless-visual-prompts', async (_event, prompts, opts = {}) => {
    try {
      if (!Array.isArray(prompts)) {
        return { success: false, error: 'Data prompts harus berupa array.' };
      }

      const active = getActiveSession();
      const targetTopicId = opts?.topicId || active.activeTopicId;
      const targetEpisodeId = opts?.episodeId || active.activeEpisodeId;

      let jsonPath = path.join(p.FACELESS_INPUT_DIR, 'visual_prompts.json');
      let txtPath = path.join(p.FACELESS_INPUT_DIR, 'visual_prompts.txt');

      if (targetTopicId && targetEpisodeId) {
        const epDir = path.join(p.FACELESS_INPUT_DIR, 'topics', targetTopicId, 'episodes', targetEpisodeId);
        if (!fs.existsSync(epDir)) fs.mkdirSync(epDir, { recursive: true });
        jsonPath = path.join(epDir, 'visual_prompts.json');
        txtPath = path.join(epDir, 'visual_prompts.txt');
      }

      fs.writeFileSync(jsonPath, JSON.stringify(prompts, null, 2), 'utf-8');
      fs.writeFileSync(txtPath, buildVisualPromptText(prompts), 'utf-8');

      // Update state for this episode
      const state = readFacelessState(targetTopicId, targetEpisodeId) || createDefaultFacelessState();
      state.visual_prompts = prompts;
      state.updated_at = new Date().toISOString();
      writeFacelessState(state, targetTopicId, targetEpisodeId);

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
      console.error('[FacelessVisual] save prompts error:', err);
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

  /**
   * List available Camoufox browser profiles for Google Flow
   */
  ipcMain.handle('list-faceless-flow-profiles', async () => {
    try {
      const profilesDir = path.join(p.PROJECT_ROOT, 'camoufox', 'profiles');
      if (!fs.existsSync(profilesDir)) {
        return { success: true, profiles: ['jovangithub@gmail.com'] };
      }
      const entries = fs.readdirSync(profilesDir, { withFileTypes: true });
      const profiles = entries
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name)
        .sort();

      return {
        success: true,
        profiles: profiles.length > 0 ? profiles : ['jovangithub@gmail.com'],
      };
    } catch (err) {
      return { success: false, profiles: ['jovangithub@gmail.com'], error: err.message };
    }
  });

  /**
   * Start Google Flow Image Generation via Camoufox
   */
  ipcMain.handle(
    'start-faceless-flow-generation',
    async (event, { email, projectUrl, range, sceneId, prompt, headless = true, overwrite = false, concurrency = 5, topicId, episodeId } = {}) => {
      try {
        if (activeFlowProcess) {
          return {
            success: false,
            error: 'Proses automasi Google Flow sedang berlangsung. Hentikan terlebih dahulu jika ingin memulai ulang.',
          };
        }

        const scriptPath = path.join(p.PROJECT_ROOT, 'camoufox', 'flow_generator.py');
        if (!fs.existsSync(scriptPath)) {
          return {
            success: false,
            error: `Script automasi Google Flow tidak ditemukan di: ${scriptPath}`,
          };
        }

        const active = getActiveSession();
        const targetTopicId = topicId || active.activeTopicId;
        const targetEpisodeId = episodeId || active.activeEpisodeId;

        const epDir = (targetTopicId && targetEpisodeId)
          ? path.join(p.FACELESS_INPUT_DIR, 'topics', targetTopicId, 'episodes', targetEpisodeId)
          : null;

        const imagesDir = epDir
          ? path.join(epDir, 'images')
          : path.join(p.FACELESS_INPUT_DIR, 'images');
        if (!fs.existsSync(imagesDir)) {
          fs.mkdirSync(imagesDir, { recursive: true });
        }

        const inputJson = epDir
          ? path.join(epDir, 'visual_prompts.json')
          : path.join(p.FACELESS_INPUT_DIR, 'visual_prompts.json');

        const targetEmail = (email || 'jovangithub@gmail.com').trim();
        const pythonBin = process.platform === 'win32' ? 'python' : '/usr/bin/python3';

        const args = [
          scriptPath,
          '--email',
          targetEmail,
          '--input-json',
          inputJson,
          '--output-dir',
          imagesDir,
        ];

        if (!headless) {
          args.push('--headed');
        }
        if (overwrite) {
          args.push('--overwrite');
        }
        if (typeof concurrency === 'number' && concurrency > 0) {
          args.push('--concurrency', String(concurrency));
        }
        if (projectUrl && projectUrl.trim()) {
          args.push('--project-url', projectUrl.trim());
        }
        if (typeof sceneId === 'number' && !isNaN(sceneId)) {
          args.push('--scene-id', String(sceneId));
        } else if (range && range.trim()) {
          args.push('--range', range.trim());
        }
        if (prompt && prompt.trim()) {
          args.push('--prompt', prompt.trim());
        }

        activeFlowSender = event?.sender || null;

        const child = spawn(pythonBin, args, {
          cwd: p.PROJECT_ROOT,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONIOENCODING: 'utf-8',
          },
        });

        activeFlowProcess = child;

        const sendProgress = (data) => {
          try {
            if (activeFlowSender && !activeFlowSender.isDestroyed()) {
              activeFlowSender.send('faceless-flow-progress', data);
            }
          } catch (e) {
            console.warn('[FlowGen] Error sending progress:', e.message);
          }
        };

        sendProgress({
          type: 'log',
          message: `🚀 Memulai Camoufox Google Flow (${headless ? 'Headless' : 'Window Browser Terbuka'}) dengan akun: ${targetEmail}...`,
        });

        let lineBuffer = '';

        const handleChunk = (chunk) => {
          lineBuffer += chunk.toString('utf-8');
          const lines = lineBuffer.split(/\r?\n/);
          lineBuffer = lines.pop() || '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            console.log('[FlowGen Stdout]:', line);

            if (line.startsWith('[ITEM_START]')) {
              const sid = parseInt(line.replace('[ITEM_START]', '').trim(), 10);
              sendProgress({
                type: 'item-start',
                sceneId: sid,
                message: `Memproses adegan #${sid}...`,
              });
            } else if (line.startsWith('[ITEM_GENERATING]')) {
              const sid = parseInt(line.replace('[ITEM_GENERATING]', '').trim(), 10);
              sendProgress({
                type: 'item-generating',
                sceneId: sid,
                message: `Menunggu hasil generate Google Flow untuk adegan #${sid}...`,
              });
            } else if (line.startsWith('[ITEM_SUCCESS]')) {
              // [ITEM_SUCCESS] scene_id | new_img_url | dest_path
              const parts = line.replace('[ITEM_SUCCESS]', '').split('|').map((s) => s.trim());
              const sid = parseInt(parts[0], 10);
              const imgUrl = parts[1] || '';
              const destPath = parts[2] || '';
              const stat = fs.existsSync(destPath) ? fs.statSync(destPath) : null;
              const mediaUrl =
                destPath && media
                  ? `${media.mediaUrl(destPath)}?t=${stat ? stat.mtimeMs : Date.now()}`
                  : '';

              sendProgress({
                type: 'item-success',
                sceneId: sid,
                imageUrl: imgUrl,
                imagePath: destPath,
                mediaUrl,
                message: `✓ Adegan #${sid} berhasil digenerate & diunduh!`,
              });
            } else if (line.startsWith('[ITEM_ERROR]')) {
              const parts = line.replace('[ITEM_ERROR]', '').split('|').map((s) => s.trim());
              const sid = parseInt(parts[0], 10);
              const errMsg = parts[1] || 'Gagal membuat gambar.';
              sendProgress({
                type: 'item-error',
                sceneId: sid,
                error: errMsg,
                message: `⚠️ Adegan #${sid} error: ${errMsg}`,
              });
            } else if (line.startsWith('[ITEM_SKIP]')) {
              const parts = line.replace('[ITEM_SKIP]', '').split('|').map((s) => s.trim());
              const sid = parseInt(parts[0], 10);
              const reason = parts[1] || 'Gambar sudah ada di disk';
              const pad3 = String(sid).padStart(3, '0');
              const cachedPath = path.join(imagesDir, `scene_${pad3}.jpg`);
              const stat = fs.existsSync(cachedPath) ? fs.statSync(cachedPath) : null;
              const mediaUrl =
                stat && media ? `${media.mediaUrl(cachedPath)}?t=${stat.mtimeMs}` : '';

              sendProgress({
                type: 'item-skip',
                sceneId: sid,
                imagePath: cachedPath,
                mediaUrl,
                message: `Adegan #${sid} dilewati (${reason})`,
              });
            } else if (line.startsWith('[PROGRESS]')) {
              // [PROGRESS] 1/175 (1%)
              const match = line.match(/\[PROGRESS\]\s*(\d+)\/(\d+)\s*\(([\d]+)%\)/);
              if (match) {
                const current = parseInt(match[1], 10);
                const total = parseInt(match[2], 10);
                const percent = parseInt(match[3], 10);
                sendProgress({
                  type: 'progress',
                  current,
                  total,
                  percent,
                  message: `Kemajuan: ${current}/${total} adegan (${percent}%)`,
                });
              }
            } else if (line.startsWith('[BATCH_COMPLETE]') || line.startsWith('[✓]')) {
              const cleaned = line.replace(/\[BATCH_COMPLETE\]|\[✓\]/g, '').trim();
              sendProgress({
                type: 'batch-complete',
                message: cleaned || '🎉 Seluruh adegan Google Flow selesai diproses!',
              });
            } else {
              sendProgress({
                type: 'log',
                message: line,
              });
            }
          }
        };

        child.stdout.on('data', handleChunk);
        child.stderr.on('data', (data) => {
          const text = data.toString('utf-8').trim();
          if (text) {
            console.warn('[FlowGen Stderr]:', text);
            sendProgress({ type: 'log', message: text });
          }
        });

        child.on('error', (err) => {
          console.error('[FlowGen Process Error]:', err);
          sendProgress({
            type: 'error',
            error: err.message,
            message: `Gagal menjalankan automasi: ${err.message}`,
          });
          activeFlowProcess = null;
        });

        child.on('close', (code, signal) => {
          console.log(`[FlowGen Process Exited] code=${code}, signal=${signal}`);
          if (signal === 'SIGTERM' || signal === 'SIGINT') {
            sendProgress({
              type: 'stopped',
              message: 'Proses generate Google Flow dihentikan oleh pengguna.',
            });
          } else if (code === 0) {
            sendProgress({
              type: 'batch-complete',
              message: '🎉 Automasi generate gambar Google Flow selesai sempurna!',
            });
          } else {
            sendProgress({
              type: 'error',
              error: `Proses keluar dengan status kode ${code}`,
              message: `Automasi selesai dengan kode status ${code}.`,
            });
          }
          activeFlowProcess = null;
        });

        return {
          success: true,
          message: 'Automasi generate gambar Google Flow telah dimulai!',
        };
      } catch (err) {
        activeFlowProcess = null;
        return { success: false, error: err.message };
      }
    }
  );

  /**
   * Stop active Google Flow generation
   */
  ipcMain.handle('stop-faceless-flow-generation', async () => {
    try {
      if (activeFlowProcess) {
        activeFlowProcess.kill('SIGINT');
        setTimeout(() => {
          if (activeFlowProcess) {
            try {
              activeFlowProcess.kill('SIGKILL');
            } catch { }
            activeFlowProcess = null;
          }
        }, 2500);
        return { success: true, message: 'Permintaan penghentian automasi dikirim.' };
      }
      return { success: true, message: 'Tidak ada proses automasi yang sedang berjalan.' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Get active status of Google Flow generation
   */
  ipcMain.handle('get-faceless-flow-status', async () => {
    return { isRunning: Boolean(activeFlowProcess) };
  });

  // ─── Step 4: Preview & Render Per Topik & Episode ─────────────────────────

  function formatBytes(bytes) {
    if (!bytes || isNaN(bytes)) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  /**
   * List all faceless topics and their episodes
   */
  ipcMain.handle('list-faceless-topics-episodes', async () => {
    try {
      const topicsDir = path.join(p.PROJECT_ROOT, 'input', 'faceless', 'topics');
      const outputFacelessDir = path.join(p.PROJECT_ROOT, 'output', 'faceless');

      if (!fs.existsSync(topicsDir)) {
        return { success: true, topics: [] };
      }

      const topicFolders = fs.readdirSync(topicsDir).filter((name) => {
        const full = path.join(topicsDir, name);
        return fs.statSync(full).isDirectory();
      });

      const topics = [];

      for (const topicId of topicFolders) {
        const topicPath = path.join(topicsDir, topicId);
        const metaPath = path.join(topicPath, 'topic_meta.json');
        let meta = {
          id: topicId,
          title: topicId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          description: '',
        };

        if (fs.existsSync(metaPath)) {
          try {
            meta = { ...meta, ...JSON.parse(fs.readFileSync(metaPath, 'utf-8')) };
          } catch (e) {
            console.warn(`[Faceless] Failed to parse ${metaPath}:`, e.message);
          }
        }

        // Check reference images
        const refDir = path.join(topicPath, 'reference');
        const referenceImages = {};
        if (fs.existsSync(refDir)) {
          const charRef = path.join(refDir, 'character_reference.png');
          const dnaRef = path.join(refDir, 'dna_visual_reference.png');
          if (fs.existsSync(charRef)) referenceImages.characterRefUrl = media.mediaUrl(charRef);
          if (fs.existsSync(dnaRef)) referenceImages.dnaVisualRefUrl = media.mediaUrl(dnaRef);
        }

        // Scan episodes
        const episodesDir = path.join(topicPath, 'episodes');
        const episodes = [];

        if (fs.existsSync(episodesDir)) {
          const epFolders = fs.readdirSync(episodesDir).filter((name) => {
            const full = path.join(episodesDir, name);
            return fs.statSync(full).isDirectory();
          });

          for (const epId of epFolders) {
            const epPath = path.join(episodesDir, epId);
            const timelinePath = path.join(epPath, 'timeline.json');
            const transcriptPath = path.join(epPath, 'transcript.json');
            const visualPromptsPath = path.join(epPath, 'visual_prompts.json');
            const imagesDir = path.join(epPath, 'images');
            const audioDir = path.join(epPath, 'audio');

            let epTitle = epId.toUpperCase();
            let totalDuration = 0;
            let scenesCount = 0;
            let fps = 30;
            let resolution = { width: 1920, height: 1080 };
            let sfxCount = 0;
            let typographyCount = 0;
            const cameraPresetsSummary = {};

            if (fs.existsSync(timelinePath)) {
              try {
                const timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf-8'));
                if (timeline.meta) {
                  epTitle = timeline.meta.title || epTitle;
                  totalDuration = timeline.meta.totalDuration || 0;
                  fps = timeline.meta.fps || 30;
                  resolution = timeline.meta.resolution || resolution;
                }
                if (Array.isArray(timeline.scenes)) {
                  scenesCount = timeline.scenes.length;
                  for (const sc of timeline.scenes) {
                    const hasTypo = Boolean(sc.typography && typeof sc.typography === 'object');
                    if (hasTypo) typographyCount++;
                    const preset = sc.camera?.preset || 'unknown';
                    cameraPresetsSummary[preset] = (cameraPresetsSummary[preset] || 0) + 1;
                  }
                }
                if (timeline.audio?.sfx && Array.isArray(timeline.audio.sfx)) {
                  sfxCount = timeline.audio.sfx.length;
                }
              } catch (e) {
                console.warn(`[Faceless] Failed to parse ${timelinePath}:`, e.message);
              }
            }

            // Check voiceover audio
            let audioPath = null;
            let audioUrl = null;
            if (fs.existsSync(audioDir)) {
              const audioCandidates = ['voiceover.wav', 'voiceover.mp3', 'audio.wav', 'audio.mp3'];
              for (const cand of audioCandidates) {
                const candPath = path.join(audioDir, cand);
                if (fs.existsSync(candPath)) {
                  audioPath = candPath;
                  audioUrl = media.mediaUrl(candPath);
                  break;
                }
              }
            }

            // Images count
            let imagesCount = 0;
            if (fs.existsSync(imagesDir)) {
              imagesCount = fs.readdirSync(imagesDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).length;
            }

            // Check rendered video in output/faceless/<topicId>/
            const topicOutputDir = path.join(outputFacelessDir, topicId);
            let isRendered = false;
            let videoPath = null;
            let videoUrl = null;
            let videoSizeBytes = 0;
            let videoSizeFormatted = '0 B';
            let renderedAt = null;

            if (fs.existsSync(topicOutputDir)) {
              const candidates = [
                `${epId}_final_1080p.mp4`,
                `${epId}_final.mp4`,
                `${epId}.mp4`,
              ];
              for (const cand of candidates) {
                const pth = path.join(topicOutputDir, cand);
                if (fs.existsSync(pth)) {
                  const stat = fs.statSync(pth);
                  if (stat.size > 1000) {
                    isRendered = true;
                    videoPath = pth;
                    videoUrl = media.mediaUrl(pth);
                    videoSizeBytes = stat.size;
                    videoSizeFormatted = formatBytes(stat.size);
                    renderedAt = stat.mtime.toISOString();
                    break;
                  }
                }
              }
              // If not matched directly, check if any mp4 contains epId
              if (!isRendered) {
                const files = fs.readdirSync(topicOutputDir).filter((f) => f.endsWith('.mp4') && f.includes(epId));
                if (files.length > 0) {
                  const pth = path.join(topicOutputDir, files[0]);
                  const stat = fs.statSync(pth);
                  if (stat.size > 1000) {
                    isRendered = true;
                    videoPath = pth;
                    videoUrl = media.mediaUrl(pth);
                    videoSizeBytes = stat.size;
                    videoSizeFormatted = formatBytes(stat.size);
                    renderedAt = stat.mtime.toISOString();
                  }
                }
              }
            }

            // Scan short/vertical videos for this episode
            const ep1PartDefs = [
              { num: 1, start: 0.0, end: 53.0, title: 'Part 1 (00:00 - 00:53)', epTitle: 'HARI PERTAMA KIAMAT' },
              { num: 2, start: 53.0, end: 101.0, title: 'Part 2 (00:53 - 01:41)', epTitle: 'ANCAMAN DARI DALAM' },
              { num: 3, start: 101.0, end: 151.0, title: 'Part 3 (01:41 - 02:31)', epTitle: 'PANEL BASEMENT TERKUNCI' },
              { num: 4, start: 151.0, end: 201.0, title: 'Part 4 (02:31 - 03:21)', epTitle: 'PETAKA BARU LANTAI 2' },
              { num: 5, start: 201.0, end: 251.0, title: 'Part 5 (03:21 - 04:11)', epTitle: 'PENGEJARAN ESKALATOR' },
              { num: 6, start: 251.0, end: 303.0, title: 'Part 6 (04:11 - 05:03)', epTitle: 'STOK AIR MENIPIS' },
              { num: 7, start: 303.0, end: 353.0, title: 'Part 7 (05:03 - 05:53)', epTitle: 'BAYANGAN MISTERIUS' },
              { num: 8, start: 353.0, end: 403.0, title: 'Part 8 (05:53 - 06:43)', epTitle: 'TIDAK SENDIRIAN' },
              { num: 9, start: 403.0, end: 455.56, title: 'Part 9 (06:43 - 07:35)', epTitle: 'KLIMAKS & PINTU TERBUKA' },
            ];

            const shortVideos = [];
            for (const pDef of ep1PartDefs) {
              const partPad = String(pDef.num).padStart(2, '0');
              const candName = `${epId}_part_${partPad}_short.mp4`;
              const candPath = path.join(topicOutputDir, candName);
              let isPartRendered = false;
              let sStat = null;
              if (fs.existsSync(candPath)) {
                sStat = fs.statSync(candPath);
                if (sStat.size > 1000) isPartRendered = true;
              }

              shortVideos.push({
                id: `part_${partPad}`,
                partNumber: pDef.num,
                partStart: pDef.start,
                partEnd: pDef.end,
                partTitle: `PART ${pDef.num} : ${pDef.epTitle}`,
                fileName: candName,
                title: pDef.title,
                isRendered: isPartRendered,
                path: isPartRendered ? candPath : undefined,
                url: isPartRendered ? media.mediaUrl(candPath) : undefined,
                sizeBytes: isPartRendered && sStat ? sStat.size : 0,
                sizeFormatted: isPartRendered && sStat ? formatBytes(sStat.size) : 'Belum dirender',
                modifiedAt: isPartRendered && sStat ? sStat.mtime.toISOString() : undefined,
              });
            }
            let isLocked = false;
            let stage = 'idea_discussion';
            let isContinuation = false;
            let prevEpisodeId = null;
            const statePath = path.join(epPath, 'faceless_state.json');
            if (fs.existsSync(statePath)) {
              try {
                const s = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
                if (s.idea?.title && (epTitle === epId.toUpperCase() || epTitle.startsWith('EP_'))) {
                  epTitle = s.idea.title;
                }
                isLocked = !!s.is_locked;
                stage = s.stage || stage;
                if (s.continuation?.is_continuation) {
                  isContinuation = true;
                  prevEpisodeId = s.continuation.previous_episode_id;
                }
              } catch {}
            }

            episodes.push({
              id: epId,
              title: epTitle,
              isLocked,
              stage,
              isContinuation,
              prevEpisodeId,
              statePath: fs.existsSync(statePath) ? statePath : undefined,
              totalDuration,
              scenesCount,
              fps,
              resolution,
              isRendered,
              videoPath,
              videoUrl,
              videoSizeBytes,
              videoSizeFormatted,
              renderedAt,
              shortVideos,
              audioPath,
              audioUrl,
              imagesCount,
              sfxCount,
              typographyCount,
              cameraPresetsSummary,
              timelinePath,
              transcriptPath: fs.existsSync(transcriptPath) ? transcriptPath : undefined,
              visualPromptsPath: fs.existsSync(visualPromptsPath) ? visualPromptsPath : undefined,
            });
          }
        }

        // Sort episodes ep_01, ep_02, etc.
        episodes.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }));

        const totalTopicDuration = episodes.reduce((acc, ep) => acc + (ep.totalDuration || 0), 0);
        const renderedCount = episodes.filter((ep) => ep.isRendered).length;

        topics.push({
          ...meta,
          referenceImages,
          episodesCount: episodes.length,
          renderedCount,
          totalDuration: totalTopicDuration,
          episodes,
        });
      }

      const active = getActiveSession();
      return {
        success: true,
        topics,
        activeTopicId: active.activeTopicId,
        activeEpisodeId: active.activeEpisodeId
      };
    } catch (err) {
      console.error('[Faceless] Error listing topics & episodes:', err);
      return { success: false, error: err.message, topics: [] };
    }
  });

  /**
   * Get full details for an episode (timeline scenes, prompts, images with mediaUrl, sfx)
   */
  ipcMain.handle('get-faceless-episode-details', async (_event, { topicId, episodeId }) => {
    try {
      if (!topicId || !episodeId) {
        return { success: false, error: 'Topic ID and Episode ID are required.' };
      }

      const epDir = path.join(p.PROJECT_ROOT, 'input', 'faceless', 'topics', topicId, 'episodes', episodeId);
      if (!fs.existsSync(epDir)) {
        return { success: false, error: `Folder episode tidak ditemukan: ${epDir}` };
      }

      const timelinePath = path.join(epDir, 'timeline.json');
      const visualPromptsPath = path.join(epDir, 'visual_prompts.json');
      const topicMetaPath = path.join(p.PROJECT_ROOT, 'input', 'faceless', 'topics', topicId, 'topic_meta.json');
      const imagesDir = path.join(epDir, 'images');

      let timeline = null;
      if (fs.existsSync(timelinePath)) {
        timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf-8'));
      }

      let visualPrompts = [];
      if (fs.existsSync(visualPromptsPath)) {
        try {
          visualPrompts = JSON.parse(fs.readFileSync(visualPromptsPath, 'utf-8'));
        } catch { }
      }

      let topicMeta = null;
      if (fs.existsSync(topicMetaPath)) {
        try {
          topicMeta = JSON.parse(fs.readFileSync(topicMetaPath, 'utf-8'));
        } catch { }
      }

      // Check rendered video
      const outputTopicDir = path.join(p.PROJECT_ROOT, 'output', 'faceless', topicId);
      let videoInfo = { exists: false };
      if (fs.existsSync(outputTopicDir)) {
        const candidates = [
          `${episodeId}_final_1080p.mp4`,
          `${episodeId}_final.mp4`,
          `${episodeId}.mp4`,
        ];
        for (const cand of candidates) {
          const pth = path.join(outputTopicDir, cand);
          if (fs.existsSync(pth)) {
            const stat = fs.statSync(pth);
            videoInfo = {
              exists: true,
              filePath: pth,
              mediaUrl: media.mediaUrl(pth),
              sizeBytes: stat.size,
              sizeFormatted: formatBytes(stat.size),
              renderedAt: stat.mtime.toISOString(),
            };
            break;
          }
        }
      }

      // Merge scenes with image URLs and visual prompt details
      const scenes = [];
      const cameraPresetCounts = {};
      let typographyCount = 0;

      const sfxList = timeline?.audio?.sfx || [];

      if (timeline && Array.isArray(timeline.scenes)) {
        for (const sc of timeline.scenes) {
          const preset = sc.camera?.preset || 'standard';
          cameraPresetCounts[preset] = (cameraPresetCounts[preset] || 0) + 1;
          const hasTypo = Boolean(sc.typography && typeof sc.typography === 'object');
          if (hasTypo) typographyCount++;

          // Match image file in imagesDir
          const paddedIndex = String(sc.index).padStart(3, '0');
          let imagePath = null;
          let imageUrl = null;
          const imageExtensions = ['.jpg', '.png', '.jpeg', '.webp'];
          for (const ext of imageExtensions) {
            const imgCandidate = path.join(imagesDir, `scene_${paddedIndex}${ext}`);
            if (fs.existsSync(imgCandidate)) {
              imagePath = imgCandidate;
              imageUrl = media.mediaUrl(imgCandidate);
              break;
            }
          }

          // If not found in episode images, check sc.image relative to input/faceless
          if (!imageUrl && sc.image) {
            const fullImg = path.join(p.PROJECT_ROOT, 'input', 'faceless', sc.image);
            if (fs.existsSync(fullImg)) {
              imagePath = fullImg;
              imageUrl = media.mediaUrl(fullImg);
            }
          }

          // Find visual prompt
          const matchedPrompt = visualPrompts.find((vp) =>
            vp.scene_id === sc.index ||
            vp.scene_id === sc.id ||
            vp.scene_id === `scene-${sc.index}` ||
            vp.sceneId === sc.index
          );

          // Find SFX overlapping with scene
          const sceneEnd = (sc.start || 0) + (sc.duration || 0);
          const sceneSfx = sfxList.filter((s) => {
            const sStart = s.start || 0;
            return sStart >= sc.start && sStart < sceneEnd;
          });

          scenes.push({
            id: sc.id || `scene-${sc.index}`,
            index: sc.index,
            start: sc.start,
            duration: sc.duration,
            end: sceneEnd,
            label: sc.label || '',
            camera: sc.camera || null,
            typography: hasTypo ? { enabled: true, ...sc.typography } : null,
            imagePath,
            imageUrl,
            prompt: matchedPrompt?.prompt || matchedPrompt?.visual_prompt || '',
            shotType: matchedPrompt?.shot_type || '',
            characterDna: matchedPrompt?.character_dna || '',
            hasSfx: sceneSfx.length > 0,
            sfxList: sceneSfx.map((s) => ({
              id: s.id,
              name: s.name,
              start: s.start,
              volume: s.volume,
              src: s.src,
            })),
          });
        }
      }

      // Audio info
      let voiceoverUrl = null;
      if (timeline?.audio?.voiceover?.src) {
        const voFull = path.join(p.PROJECT_ROOT, 'input', 'faceless', timeline.audio.voiceover.src);
        if (fs.existsSync(voFull)) voiceoverUrl = media.mediaUrl(voFull);
      }
      let bgmUrl = null;
      if (timeline?.audio?.bgm?.src) {
        const bgmFull = path.join(p.PROJECT_ROOT, 'input', 'faceless', timeline.audio.bgm.src);
        if (fs.existsSync(bgmFull)) bgmUrl = media.mediaUrl(bgmFull);
      }

      return {
        success: true,
        data: {
          topicId,
          episodeId,
          topicMeta,
          title: timeline?.meta?.title || episodeId.toUpperCase(),
          totalDuration: timeline?.meta?.totalDuration || 0,
          fps: timeline?.meta?.fps || 30,
          resolution: timeline?.meta?.resolution || { width: 1920, height: 1080 },
          video: videoInfo,
          audio: {
            voiceoverUrl,
            bgmUrl,
            bgmSrc: timeline?.audio?.bgm?.src,
            bgmVolume: timeline?.audio?.bgm?.volume,
            sfxCount: sfxList.length,
            sfxList,
          },
          scenes,
          cameraPresetCounts,
          typographyCount,
          sfxCount: sfxList.length,
        },
      };
    } catch (err) {
      console.error('[Faceless] Error getting episode details:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Render faceless episode via hyperframes CLI
   */
  ipcMain.handle('render-faceless-episode', async (event, { topicId, episodeId }) => {
    try {
      if (!topicId || !episodeId) {
        return { success: false, error: 'Topic ID and Episode ID are required.' };
      }

      const epDir = path.join(p.PROJECT_ROOT, 'input', 'faceless', 'topics', topicId, 'episodes', episodeId);
      const outputTopicDir = path.join(p.PROJECT_ROOT, 'output', 'faceless', topicId);
      if (!fs.existsSync(outputTopicDir)) fs.mkdirSync(outputTopicDir, { recursive: true });

      const finalOutputPath = path.join(outputTopicDir, `${episodeId}_final_1080p.mp4`);

      // Determine HTML file
      let htmlPath = path.join(p.PROJECT_ROOT, 'input', 'faceless', 'index.html');
      if (!fs.existsSync(htmlPath)) {
        htmlPath = path.join(epDir, 'index.html');
      }

      if (!fs.existsSync(htmlPath)) {
        return { success: false, error: `File index.html tidak ditemukan: ${htmlPath}` };
      }

      const sendProgress = (stage, progress, message, extra = {}) => {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('faceless-render-progress', {
            topicId,
            episodeId,
            stage,
            progress,
            message,
            ...extra,
          });
        }
      };

      sendProgress('start', 0, `Memulai render Hyperframes ${topicId} / ${episodeId}...`);

      const relHtmlPath = path.relative(path.join(p.PROJECT_ROOT, 'input', 'faceless'), htmlPath) || 'index.html';
      const relOutputPath = path.relative(path.join(p.PROJECT_ROOT, 'input', 'faceless'), finalOutputPath);

      return new Promise((resolve) => {
        const child = spawn(
          'npx',
          ['hyperframes', 'render', relHtmlPath, '-o', finalOutputPath],
          {
            cwd: path.join(p.PROJECT_ROOT, 'input', 'faceless'),
            env: { ...process.env },
          }
        );

        let fullStdout = '';
        let fullStderr = '';

        child.stdout.on('data', (d) => {
          const str = d.toString();
          fullStdout += str;
          const match = str.match(/\[(\d+)\/(\d+)\]/);
          if (match) {
            const current = parseInt(match[1], 10);
            const total = parseInt(match[2], 10);
            const pct = Math.min(Math.round((current / total) * 100), 99);
            sendProgress('rendering', pct / 100, `Rendering frame [${current}/${total}] (${pct}%)...`, {
              currentFrame: current,
              totalFrames: total,
            });
          } else {
            sendProgress('rendering', 0.5, str.trim().slice(0, 100));
          }
        });

        child.stderr.on('data', (d) => {
          fullStderr += d.toString();
        });

        child.on('close', (code) => {
          if (code === 0) {
            sendProgress('done', 1, `Render sukses selesai! Video tersimpan di: ${finalOutputPath}`);
            resolve({
              success: true,
              outputPath: finalOutputPath,
              mediaUrl: media.mediaUrl(finalOutputPath),
            });
          } else {
            sendProgress('error', 0, `Render gagal dengan kode keluar ${code}`);
            resolve({
              success: false,
              error: `Render gagal (kode ${code}).\nStderr:\n${fullStderr.slice(-400)}\nStdout:\n${fullStdout.slice(-400)}`,
            });
          }
        });

        child.on('error', (err) => {
          sendProgress('error', 0, `Error menjalankan hyperframes: ${err.message}`);
          resolve({ success: false, error: err.message });
        });
      });
    } catch (err) {
      console.error('[Faceless] Error in render-faceless-episode:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('render-faceless-short', async (event, { topicId, episodeId, partNumber = 1, partStart, partEnd, partTitle, outroLabel }) => {
    try {
      if (!topicId || !episodeId) {
        return { success: false, error: 'Topic ID and Episode ID are required.' };
      }

      const epDir = path.join(p.PROJECT_ROOT, 'input', 'faceless', 'topics', topicId, 'episodes', episodeId);
      const timelinePath = path.join(epDir, 'timeline.json');
      if (!fs.existsSync(timelinePath)) {
        return { success: false, error: `Timeline tidak ditemukan: ${timelinePath}` };
      }

      const outputTopicDir = path.join(p.PROJECT_ROOT, 'output', 'faceless', topicId);
      if (!fs.existsSync(outputTopicDir)) fs.mkdirSync(outputTopicDir, { recursive: true });

      const partNum = Number(partNumber) || 1;
      const partPad = String(partNum).padStart(2, '0');
      const finalOutputPath = path.join(outputTopicDir, `${episodeId}_part_${partPad}_short.mp4`);

      // Determine part start and end if not explicitly provided
      let pStart = partStart !== undefined ? Number(partStart) : 0.0;
      let pEnd = partEnd !== undefined ? Number(partEnd) : 53.0;
      let pTitle = partTitle;

      if (episodeId === 'ep_01') {
        const ep1Presets = [
          { num: 1, start: 0.0, end: 53.0, title: 'PART 1 : HARI PERTAMA KIAMAT' },
          { num: 2, start: 53.0, end: 101.0, title: 'PART 2 : ANCAMAN DARI DALAM' },
          { num: 3, start: 101.0, end: 151.0, title: 'PART 3 : PANEL BASEMENT TERKUNCI' },
          { num: 4, start: 151.0, end: 201.0, title: 'PART 4 : PETAKA BARU LANTAI 2' },
          { num: 5, start: 201.0, end: 251.0, title: 'PART 5 : PENGEJARAN ESKALATOR' },
          { num: 6, start: 251.0, end: 303.0, title: 'PART 6 : STOK AIR MENIPIS' },
          { num: 7, start: 303.0, end: 353.0, title: 'PART 7 : BAYANGAN MISTERIUS' },
          { num: 8, start: 353.0, end: 403.0, title: 'PART 8 : TIDAK SENDIRIAN' },
          { num: 9, start: 403.0, end: 455.56, title: 'PART 9 : KLIMAKS & PINTU TERBUKA' },
        ];
        const match = ep1Presets.find((p) => p.num === partNum);
        if (match) {
          if (partStart === undefined) pStart = match.start;
          if (partEnd === undefined) pEnd = match.end;
          if (!pTitle) pTitle = match.title;
        }
      }

      if (!pTitle) {
        pTitle = `PART ${partNum} : ${episodeId.toUpperCase()}`;
      }

      const sendProgress = (stage, progress, message, extra = {}) => {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('faceless-render-progress', {
            topicId,
            episodeId,
            partNumber: partNum,
            isShort: true,
            stage,
            progress,
            message,
            ...extra,
          });
        }
      };

      sendProgress('start', 0, `Mengompilasi Part ${partNum} (${pStart.toFixed(1)}s - ${pEnd.toFixed(1)}s)...`);

      // 1. Compile portrait index.html
      const compiler = require(path.join(p.PROJECT_ROOT, 'input', 'faceless', 'templates', 'compile_short_portrait.cjs'));
      const htmlPath = path.join(p.PROJECT_ROOT, 'input', 'faceless', 'index.html');
      compiler.compilePortraitShort({
        projectRoot: path.join(p.PROJECT_ROOT, 'input', 'faceless'),
        episodeDir: epDir,
        partNumber: partNum,
        partStart: pStart,
        partEnd: pEnd,
        partTitle: pTitle,
        outroLabel: outroLabel || `AKHIR PART ${partNum} • KLIMAKS`,
        outputPath: htmlPath,
      });

      sendProgress('compile', 0.05, `Memulai render Hyperframes Portrait (1080x1920)...`);

      const relOutputPath = path.relative(path.join(p.PROJECT_ROOT, 'input', 'faceless'), finalOutputPath);

      return new Promise((resolve) => {
        const child = spawn(
          'npx',
          ['hyperframes', 'render', '--resolution=portrait', '-o', finalOutputPath],
          {
            cwd: path.join(p.PROJECT_ROOT, 'input', 'faceless'),
            env: { ...process.env },
          }
        );

        let fullStdout = '';
        let fullStderr = '';

        child.stdout.on('data', (d) => {
          const str = d.toString();
          fullStdout += str;
          const frameMatch = str.match(/frame\s+(\d+)\/(\d+)/i);
          const pctMatch = str.match(/(\d+)%/);
          if (frameMatch && pctMatch) {
            const current = parseInt(frameMatch[1], 10);
            const total = parseInt(frameMatch[2], 10);
            const pct = parseInt(pctMatch[1], 10);
            sendProgress('rendering', pct / 100, `Rendering Short Part ${partNum}: [${current}/${total}] (${pct}%)...`, {
              currentFrame: current,
              totalFrames: total,
            });
          } else if (pctMatch) {
            const pct = parseInt(pctMatch[1], 10);
            sendProgress('rendering', pct / 100, `Rendering Short Part ${partNum}: ${pct}%...`);
          } else if (str.includes('Assembling')) {
            sendProgress('rendering', 0.95, `Menggabungkan audio dan video...`);
          }
        });

        child.stderr.on('data', (d) => {
          fullStderr += d.toString();
        });

        child.on('close', (code) => {
          if (code === 0) {
            sendProgress('done', 1, `Render Short Part ${partNum} sukses selesai!`);
            resolve({
              success: true,
              outputPath: finalOutputPath,
              mediaUrl: media.mediaUrl(finalOutputPath),
            });
          } else {
            sendProgress('error', 0, `Render Short Part ${partNum} gagal (kode ${code}).`);
            resolve({
              success: false,
              error: `Render gagal (kode ${code}).\nStderr:\n${fullStderr.slice(-400)}\nStdout:\n${fullStdout.slice(-400)}`,
            });
          }
        });

        child.on('error', (err) => {
          sendProgress('error', 0, `Error menjalankan hyperframes: ${err.message}`);
          resolve({ success: false, error: err.message });
        });
      });
    } catch (err) {
      console.error('[Faceless] Error in render-faceless-short:', err);
      return { success: false, error: err.message };
    }
  });
}

module.exports = {
  register,
  cleanVoiceoverScript,
  parseAndFormatTimecodedTranscript,
};
