// dashboard/src/components/faceless/FacelessIdeaAgentStep.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cleanVoiceoverScript } from '../../utils/cleanScript';
import { MarkdownView } from '../common/MarkdownView';
import type {
  FacelessChatMessage,
  FacelessProjectState,
  FacelessStage,
  FacelessTopicItem,
  FacelessEpisodeSummary,
} from '../../electron-api';

const INITIAL_GREETING: FacelessChatMessage = {
  role: 'assistant',
  content:
    'Halo! Kita mulai dari ide ya. Kamu sudah punya ide untuk konten faceless-nya, atau mau aku tawarkan beberapa ide?',
};

const INITIAL_ACTIONS = ['Aku punya ide sendiri', 'Kasih aku ide (AI)'];

const STAGE_LABELS: Record<FacelessStage, string> = {
  idea_discussion: 'Tahap 1 · Cari Ide',
  duration_discussion: 'Tahap 2 · Tentukan Durasi',
  outline_discussion: 'Tahap 3 · Gambaran Kasar Alur',
  narration_discussion: 'Tahap 4 · Naskah Narasi Lengkap',
};

const DEFAULT_ACTIONS_BY_STAGE: Record<FacelessStage, string[]> = {
  idea_discussion: ['Aku punya ide sendiri', 'Kasih aku ide (AI)'],
  duration_discussion: ['Video pendek (±60 detik)', 'Video panjang (Long Form 3-10 menit)'],
  outline_discussion: ['Setuju alur ini, buatkan naskahnya!', 'Ubah bagian alur ini', 'Pertebal unsur ketegangan'],
  narration_discussion: [
    '🔒 Naskah Sudah Mantap, Kunci Proyek (Setuju)',
    'Revisi dialog atau adegan...',
    'Ubah gaya bahasa agar lebih santai',
  ],
};

const FACELESS_MODELS = [
  { id: 'zd/claude-sonnet-5-5', label: 'Claude 3.5 Sonnet (zd/claude-sonnet-5-5 - Cerdas & Sinematik)' },
  { id: 'ag/gemini-3.8-flash-high', label: 'Gemini 3.8 Flash High (9router - Cepat & Cerdas)' },
  { id: 'ag/gemini-3-flash-agent', label: 'Gemini 3 Flash Agent (9router - Stabil)' },
  { id: 'gemini/gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite (9router - Hemat)' },
  { id: 'ds/deepseek-chat', label: 'DeepSeek Chat (Kreatif & Naratif)' },
  { id: 'cmc/Qwen/Qwen3.6-Plus', label: 'Qwen 3.6 Plus' },
];

export interface FacelessIdeaAgentStepProps {
  onGoToAudio?: () => void;
}

export const FacelessIdeaAgentStep: React.FC<FacelessIdeaAgentStepProps> = ({ onGoToAudio }) => {
  // Multi-topic & Multi-episode state
  const [topics, setTopics] = useState<FacelessTopicItem[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string>('');
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>('');
  const [loadingTopics, setLoadingTopics] = useState<boolean>(true);
  // Selected AI Model
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    try {
      return localStorage.getItem('faceless_idea_agent_model') || 'zd/claude-sonnet-5-5';
    } catch {
      return 'zd/claude-sonnet-5-5';
    }
  });

  // Modals state
  const [showNewTopicModal, setShowNewTopicModal] = useState<boolean>(false);
  const [showNewEpisodeModal, setShowNewEpisodeModal] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);

  // New Topic Form
  const [newTopicTitle, setNewTopicTitle] = useState<string>('');
  const [newTopicCategory, setNewTopicCategory] = useState<string>('Survival Fiction / Horror Storytelling');
  const [newTopicDescription, setNewTopicDescription] = useState<string>('');
  const [newTopicCharacterName, setNewTopicCharacterName] = useState<string>('Tokoh Utama');
  const [newTopicCharacterDesc, setNewTopicCharacterDesc] = useState<string>('');

  // New Episode Form
  const [newEpisodeTitle, setNewEpisodeTitle] = useState<string>('');

  // Active Episode Chat & State
  const [messages, setMessages] = useState<FacelessChatMessage[]>([INITIAL_GREETING]);
  const [state, setState] = useState<FacelessProjectState | null>(null);
  const [input, setInput] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [suggestedActions, setSuggestedActions] = useState<string[]>(INITIAL_ACTIONS);
  const [scriptViewMode, setScriptViewMode] = useState<'clean' | 'raw'>('clean');
  const [copiedType, setCopiedType] = useState<'clean' | 'raw' | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);
  const [showSeriesHistory, setShowSeriesHistory] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const isLocked = Boolean(state?.is_locked);

  // Current active topic & episode memo
  const currentTopic = useMemo(() => {
    return topics.find((t) => t.id === selectedTopicId) || topics[0] || null;
  }, [topics, selectedTopicId]);

  const currentEpisode = useMemo(() => {
    return currentTopic?.episodes.find((e) => e.id === selectedEpisodeId) || currentTopic?.episodes[0] || null;
  }, [currentTopic, selectedEpisodeId]);

  const continuationInfo = state?.continuation;
  const isContinuation = Boolean(continuationInfo?.is_continuation);

  // Load episode state helper
  const loadEpisodeState = async (topicId: string, episodeId: string) => {
    try {
      if (!window.electronAPI?.getFacelessState) return;
      const res = await window.electronAPI.getFacelessState({ topicId, episodeId });
      if (res.success && res.data) {
        setState(res.data);
        if (res.data.chat_history?.length) {
          setMessages(res.data.chat_history);
        } else {
          setMessages([INITIAL_GREETING]);
        }
        if (res.data.is_locked) {
          setSuggestedActions(['🔓 Buka Kunci (Edit Kembali)']);
        } else {
          setSuggestedActions(DEFAULT_ACTIONS_BY_STAGE[res.data.stage] || INITIAL_ACTIONS);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Gagal memuat state episode: ${msg}`);
    }
  };

  // Load topics & active episode on mount
  const loadTopicsAndState = async (preferredTopicId?: string, preferredEpisodeId?: string) => {
    setLoadingTopics(true);
    try {
      if (!window.electronAPI?.listFacelessTopicsAndEpisodes) return;
      const res = await window.electronAPI.listFacelessTopicsAndEpisodes();
      if (res.success && res.topics) {
        setTopics(res.topics);
        const targetTopicId = preferredTopicId || res.activeTopicId || res.topics[0]?.id || 'supermarket_apocalypse';
        setSelectedTopicId(targetTopicId);

        const currentTopicObj = res.topics.find((t) => t.id === targetTopicId) || res.topics[0];
        const targetEpId = preferredEpisodeId || (targetTopicId === res.activeTopicId ? res.activeEpisodeId : null) || currentTopicObj?.episodes[0]?.id || 'ep_01';
        setSelectedEpisodeId(targetEpId);

        await loadEpisodeState(targetTopicId, targetEpId);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Gagal memuat daftar topik serial: ${msg}`);
    } finally {
      setLoadingTopics(false);
    }
  };

  useEffect(() => {
    loadTopicsAndState();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isSending]);

  // Switch Topic handler
  const handleSelectTopic = async (topicId: string) => {
    if (topicId === selectedTopicId) return;
    setSelectedTopicId(topicId);
    const targetTopicObj = topics.find((t) => t.id === topicId);
    const targetEpId = targetTopicObj?.episodes[0]?.id || 'ep_01';
    setSelectedEpisodeId(targetEpId);
    await window.electronAPI?.setFacelessActiveSession?.({ topicId, episodeId: targetEpId });
    await loadEpisodeState(topicId, targetEpId);
  };

  // Switch Episode handler
  const handleSelectEpisode = async (episodeId: string) => {
    if (episodeId === selectedEpisodeId) return;
    setSelectedEpisodeId(episodeId);
    await window.electronAPI?.setFacelessActiveSession?.({ topicId: selectedTopicId, episodeId });
    await loadEpisodeState(selectedTopicId, episodeId);
  };

  // Lock handler
  const handleLock = async () => {
    if (!window.electronAPI?.lockFacelessProject) return;
    try {
      const res = await window.electronAPI.lockFacelessProject({
        topicId: selectedTopicId,
        episodeId: selectedEpisodeId,
      });
      if (res.success && res.data) {
        setState(res.data);
        setSuggestedActions(['🔓 Buka Kunci (Edit Kembali)']);
        showToast('🔒 Proyek naskah episode ini resmi dikunci (final)!', 'success');
        // Refresh topics list to show locked indicator
        const topRes = await window.electronAPI?.listFacelessTopicsAndEpisodes?.();
        if (topRes?.success && topRes.topics) setTopics(topRes.topics);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Gagal mengunci proyek: ${msg}`);
    }
  };

  // Unlock handler
  const handleUnlock = async () => {
    if (!window.electronAPI?.unlockFacelessProject) return;
    try {
      const res = await window.electronAPI.unlockFacelessProject({
        topicId: selectedTopicId,
        episodeId: selectedEpisodeId,
      });
      if (res.success && res.data) {
        setState(res.data);
        setSuggestedActions(DEFAULT_ACTIONS_BY_STAGE[res.data.stage] || []);
        showToast('🔓 Kunci dibuka. Kamu dapat mengedit kembali ide atau naskah.', 'info');
        // Refresh topics list
        const topRes = await window.electronAPI?.listFacelessTopicsAndEpisodes?.();
        if (topRes?.success && topRes.topics) setTopics(topRes.topics);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Gagal membuka kunci proyek: ${msg}`);
    }
  };

  // Chat sender
  const handleSend = async (forcedText?: string) => {
    const content = (typeof forcedText === 'string' ? forcedText : input).trim();
    if (!content || isSending) return;

    if (content.includes('Buka Kunci') || content.includes('🔓')) {
      await handleUnlock();
      return;
    }

    if (isLocked) {
      setErrorMessage('Chat Step 1 sedang terkunci. Klik "Buka Kunci" terlebih dahulu untuk mengirim pesan atau revisi.');
      return;
    }

    if (!window.electronAPI?.facelessAgentChat) {
      setErrorMessage('Fitur AI Agent belum tersedia di lingkungan ini.');
      return;
    }

    const userMessage: FacelessChatMessage = {
      role: 'user',
      content,
      at: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setInput('');
    setSuggestedActions([]);
    setErrorMessage(null);
    setIsSending(true);

    try {
      const res = await window.electronAPI.facelessAgentChat({
        messages: nextMessages,
        model: selectedModel,
        topicId: selectedTopicId,
        episodeId: selectedEpisodeId,
      });
      if (res.success && res.data) {
        setMessages([
          ...nextMessages,
          { role: 'assistant', content: res.data.reply, at: new Date().toISOString() },
        ]);
        setState(res.data.state);
        const nextActions = res.data.suggested_actions?.length
          ? res.data.suggested_actions
          : DEFAULT_ACTIONS_BY_STAGE[res.data.stage] || [];
        setSuggestedActions(nextActions);
        // Refresh topics list
        const topRes = await window.electronAPI?.listFacelessTopicsAndEpisodes?.();
        if (topRes?.success && topRes.topics) setTopics(topRes.topics);
      } else {
        setErrorMessage(res.error || 'Gagal mendapatkan balasan dari AI Agent.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Terjadi kesalahan: ${msg}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReset = async () => {
    if (!window.confirm(`Reset ide, memori, dan riwayat chat untuk ${currentEpisode?.id?.toUpperCase() || 'episode ini'}? Topik dan episode lainnya tetap aman.`)) return;
    try {
      await window.electronAPI?.resetFacelessState?.({
        topicId: selectedTopicId,
        episodeId: selectedEpisodeId,
      });
    } catch {}
    setMessages([INITIAL_GREETING]);
    setState(null);
    setSuggestedActions(INITIAL_ACTIONS);
    setInput('');
    setErrorMessage(null);
    showToast(`Episode ${selectedEpisodeId.toUpperCase()} berhasil direset.`, 'info');
  };

  // Create New Topic Action
  const handleCreateNewTopic = async () => {
    if (!newTopicTitle.trim()) {
      alert('Judul topik serial wajib diisi!');
      return;
    }
    setIsCreating(true);
    try {
      if (!window.electronAPI?.createFacelessTopic) return;
      const res = await window.electronAPI.createFacelessTopic({
        title: newTopicTitle.trim(),
        category: newTopicCategory.trim() || 'Survival Fiction',
        description: newTopicDescription.trim(),
        characterName: newTopicCharacterName.trim(),
        characterDesc: newTopicCharacterDesc.trim(),
        vibe: 'Tegang, misterius, imersif',
      });
      if (res.success && res.topicId) {
        setShowNewTopicModal(false);
        setNewTopicTitle('');
        setNewTopicDescription('');
        setNewTopicCharacterName('Tokoh Utama');
        setNewTopicCharacterDesc('');
        showToast(`🎉 Topik baru "${newTopicTitle.trim()}" berhasil dibuat tanpa menghapus topik sebelumnya!`, 'success');
        await loadTopicsAndState(res.topicId, 'ep_01');
      } else {
        alert(res.error || 'Gagal membuat topik baru.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Gagal membuat topik: ${msg}`);
    } finally {
      setIsCreating(false);
    }
  };

  // Create New Episode Action (Continuation)
  const handleCreateNewEpisode = async () => {
    if (!selectedTopicId) return;
    setIsCreating(true);
    try {
      if (!window.electronAPI?.createFacelessEpisode) return;
      const res = await window.electronAPI.createFacelessEpisode({
        topicId: selectedTopicId,
        title: newEpisodeTitle.trim() || undefined,
      });
      if (res.success && res.episodeId) {
        setShowNewEpisodeModal(false);
        setNewEpisodeTitle('');
        showToast(`🎬 Episode baru (${res.episodeId.toUpperCase()}) berhasil dibuat! Cerita bersambung langsung dari episode sebelumnya.`, 'success');
        await loadTopicsAndState(selectedTopicId, res.episodeId);
      } else {
        alert(res.error || 'Gagal membuat episode baru.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Gagal membuat episode: ${msg}`);
    } finally {
      setIsCreating(false);
    }
  };

  const idea = state?.idea;
  const hasIdea = !!idea;
  const duration = state?.duration;
  const currentStage: FacelessStage = state?.stage || 'idea_discussion';
  const memory = state?.memory;
  const narrationOutline = memory?.narration_outline;
  const draftScript = state?.narration?.draft_script || memory?.draft_script || '';

  const cleanScript = useMemo(() => {
    return cleanVoiceoverScript(draftScript);
  }, [draftScript]);

  const cleanWordCount = useMemo(() => {
    return cleanScript.split(/\s+/).filter(Boolean).length;
  }, [cleanScript]);

  const rawWordCount = useMemo(() => {
    return draftScript.split(/\s+/).filter(Boolean).length;
  }, [draftScript]);

  const handleCopyClean = () => {
    if (!cleanScript) return;
    navigator.clipboard.writeText(cleanScript);
    setCopiedType('clean');
    setTimeout(() => setCopiedType(null), 2500);
  };

  const handleCopyRaw = () => {
    if (!draftScript) return;
    navigator.clipboard.writeText(draftScript);
    setCopiedType('raw');
    setTimeout(() => setCopiedType(null), 2500);
  };

  const hasNarrationOutline =
    !!narrationOutline &&
    Object.values(narrationOutline).some((v) => typeof v === 'string' && v.trim().length > 0);

  // Next episode number helper for modal preview
  const nextEpNumber = (currentTopic?.episodes?.length || 1) + 1;
  const lastCliffhanger = useMemo(() => {
    const out = state?.narration?.outline || state?.memory?.narration_outline;
    return out?.cliffhanger || out?.hook || '';
  }, [state]);

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-12">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 px-4 py-2.5 rounded-xl text-xs font-bold shadow-xl border flex items-center gap-2 animate-bounce ${
            toast.type === 'success'
              ? 'bg-emerald-600 text-white border-emerald-400'
              : toast.type === 'error'
              ? 'bg-red-600 text-white border-red-400'
              : 'bg-indigo-600 text-white border-indigo-400'
          }`}
        >
          <span>{toast.type === 'success' ? '✅' : toast.type === 'error' ? '⚠️' : 'ℹ️'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-gray-900/90 border border-gray-800 rounded-3xl p-6 shadow-2xl backdrop-blur-md relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 rounded-full bg-amber-950/80 text-amber-300 border border-amber-700/50 text-[11px] font-mono font-bold tracking-wider uppercase">
                🎯 Step 1: Idea & Narration Agent
              </span>
              <div className="flex items-center gap-1.5 bg-gray-950/90 border border-emerald-800/60 rounded-xl px-2.5 py-0.5 shadow-inner">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span className="text-[10px] text-gray-400 font-mono">Model:</span>
                <select
                  value={selectedModel}
                  onChange={(e) => {
                    const m = e.target.value;
                    setSelectedModel(m);
                    try { localStorage.setItem('faceless_idea_agent_model', m); } catch {}
                    showToast(`🤖 Model AI diubah ke: ${m}`, 'info');
                  }}
                  className="bg-transparent text-[11px] font-bold text-amber-300 focus:outline-none cursor-pointer pr-1"
                >
                  {FACELESS_MODELS.map((m) => (
                    <option key={m.id} value={m.id} className="bg-gray-900 text-white">
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-purple-950/60 text-purple-300 text-[10px] font-mono border border-purple-800/60 flex items-center gap-1">
                ⚡ Proactive Drafting
              </span>
              {isLocked ? (
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/90 text-emerald-300 border border-emerald-500/60 text-[10px] font-mono font-bold flex items-center gap-1 shadow-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  🔒 {selectedEpisodeId.toUpperCase()} Terkunci (Final)
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full bg-sky-950/60 text-sky-300 text-[10px] font-mono border border-sky-800/60">
                  {STAGE_LABELS[currentStage]}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <span>💬</span> Faceless Content Director
            </h1>
            <p className="text-xs text-gray-400 leading-relaxed max-w-3xl">
              AI Agent proaktif yang merancang alur cerita DNA Retention, mendukung <strong>multi-topik independen</strong> dan <strong>multi-episode serial berkelanjutan</strong> tanpa menghapus karya sebelumnya.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {isLocked ? (
              <button
                onClick={handleUnlock}
                disabled={isSending}
                className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 hover:text-amber-200 text-xs font-bold rounded-xl border border-amber-500/50 transition-all shrink-0 flex items-center gap-1.5 shadow-md"
                title="Buka kunci proyek untuk mengedit kembali ide atau naskah"
              >
                <span>🔓</span> Buka Kunci
              </button>
            ) : draftScript ? (
              <button
                onClick={handleLock}
                disabled={isSending}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-gray-950 text-xs font-black rounded-xl transition-all shrink-0 flex items-center gap-1.5 shadow-lg shadow-emerald-900/40"
                title="Setujui dan kunci naskah Step 1"
              >
                <span>🔒</span> Kunci Naskah (Setuju)
              </button>
            ) : null}
            {onGoToAudio && draftScript && (
              <button
                onClick={async () => {
                  if (selectedTopicId && selectedEpisodeId) {
                    await window.electronAPI?.setFacelessActiveSession?.({
                      topicId: selectedTopicId,
                      episodeId: selectedEpisodeId,
                    });
                  }
                  onGoToAudio();
                }}
                className="px-3.5 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-gray-950 text-xs font-black rounded-xl transition-all shrink-0 flex items-center gap-1.5 shadow-md shadow-amber-600/30"
                title="Lanjut ke Step 2 untuk upload voice over audio"
              >
                <span>🎙️ Lanjut ke Step 2 (Upload Audio) ➔</span>
              </button>
            )}
            <button
              onClick={handleReset}
              disabled={isSending}
              className="px-3 py-1.5 bg-gray-800/80 hover:bg-red-900/60 text-gray-400 hover:text-red-300 text-xs font-semibold rounded-xl border border-gray-700 hover:border-red-800/60 transition-all shrink-0 flex items-center gap-1.5"
              title="Reset hanya episode yang aktif"
            >
              <span>🔄</span> Reset Episode Ini
            </button>
          </div>
        </div>
      </div>

      {/* ─── GROUPING BAR 1: MULTI-TOPIK SERIAL ─── */}
      <div className="bg-gray-900/60 border border-gray-800/80 rounded-2xl p-3.5 shadow-lg space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
            <span>📁</span> Topik Serial ({topics.length} Topik Tersimpan):
          </label>
          <button
            onClick={() => setShowNewTopicModal(true)}
            className="px-3 py-1 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-gray-950 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm shadow-amber-500/20"
          >
            <span>➕</span> Buat Topik Baru
          </button>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {topics.map((t) => {
            const isSelected = t.id === selectedTopicId;
            return (
              <button
                key={t.id}
                onClick={() => handleSelectTopic(t.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  isSelected
                    ? 'bg-amber-500 text-gray-950 border-amber-400 shadow-md shadow-amber-500/20'
                    : 'bg-gray-950 text-gray-300 border-gray-800 hover:bg-gray-800 hover:border-gray-700'
                }`}
              >
                <span>{isSelected ? '📂' : '📁'}</span>
                <span>{t.title}</span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
                    isSelected ? 'bg-black/20 text-gray-950 font-black' : 'bg-gray-800 text-gray-400'
                  }`}
                >
                  {t.episodesCount || (t.episodes && t.episodes.length) || 1} Ep
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── GROUPING BAR 2: MULTI-EPISODE BERKELANJUTAN ─── */}
      {currentTopic && (
        <div className="bg-gray-900/60 border border-gray-800/80 rounded-2xl p-3.5 shadow-lg space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                <span>🎞️</span> Episode Serial: <span className="text-white normal-case font-semibold">{currentTopic.title}</span>
              </label>
              <span className="text-[10px] text-gray-500 font-mono">({currentTopic.episodes?.length || 1} Total)</span>
            </div>
            <button
              onClick={() => {
                setNewEpisodeTitle(`${currentTopic.title} - Episode ${nextEpNumber}`);
                setShowNewEpisodeModal(true);
              }}
              className="px-3 py-1 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm shadow-cyan-500/20"
              title="Buat episode baru yang otomatis melanjutkan alur cerita dari episode sebelumnya"
            >
              <span>➕</span> Buat Episode Baru (Lanjutan Cerita)
            </button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
            {(currentTopic.episodes || []).map((ep: FacelessEpisodeSummary) => {
              const isSelected = ep.id === selectedEpisodeId;
              const epLocked = ep.isLocked;
              return (
                <button
                  key={ep.id}
                  onClick={() => handleSelectEpisode(ep.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    isSelected
                      ? 'bg-gray-800 text-cyan-300 border-cyan-500/70 shadow-sm ring-1 ring-cyan-500/30'
                      : 'bg-gray-950 text-gray-400 border-gray-800 hover:bg-gray-900 hover:text-gray-200'
                  }`}
                >
                  <span className="font-mono font-bold uppercase">{ep.id}:</span>
                  <span className="font-medium max-w-[220px] truncate">{ep.title.replace(/^Supermarket Apocalypse - /i, '')}</span>
                  {epLocked ? (
                    <span className="px-1.5 py-0.2 bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 rounded text-[9px] font-bold">
                      🔒 Terkunci
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.2 bg-amber-950/60 text-amber-400 border border-amber-800/50 rounded text-[9px] font-medium">
                      ✏️ Draf
                    </span>
                  )}
                  {ep.isContinuation && (
                    <span className="text-[10px]" title="Episode kelanjutan cerita">
                      🔗
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Continuation Lore & Cliffhanger Banner */}
      {isContinuation && (
        <div className="bg-gradient-to-r from-indigo-950/40 via-purple-950/30 to-gray-900/60 border border-indigo-700/40 rounded-2xl p-4 shadow-md space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xl">🔗</span>
              <div>
                <span className="text-xs font-bold text-indigo-300 uppercase tracking-wider block">
                  Kelanjutan Cerita Aktif:
                </span>
                <span className="text-xs text-white font-semibold">
                  {selectedEpisodeId.toUpperCase()} menyambung langsung dari {(continuationInfo?.previous_episode_id || 'Episode 1').toUpperCase()}
                </span>
              </div>
            </div>
            {continuationInfo?.series_history && continuationInfo.series_history.length > 0 && (
              <button
                onClick={() => setShowSeriesHistory(!showSeriesHistory)}
                className="px-2.5 py-1 bg-indigo-900/60 hover:bg-indigo-800 text-indigo-200 text-[11px] font-semibold rounded-lg border border-indigo-700/50 transition-all flex items-center gap-1"
              >
                <span>📜</span> {showSeriesHistory ? 'Sembunyikan Riwayat' : `Lihat Riwayat (${continuationInfo.series_history.length} Episode Sebelumnya)`}
              </button>
            )}
          </div>

          {continuationInfo?.previous_cliffhanger && (
            <p className="text-xs text-gray-300 italic leading-relaxed bg-black/40 p-2.5 rounded-xl border border-indigo-900/50">
              📌 <strong>Cliffhanger Sebelumnya:</strong> "{continuationInfo.previous_cliffhanger}"
            </p>
          )}

          {continuationInfo?.previous_ending_snippet && (
            <p className="text-[11px] text-gray-400 font-mono bg-black/30 p-2 rounded-xl border border-gray-800/60">
              💬 <strong>Cuplikan Akhir Naskah Lalu:</strong> "...{continuationInfo.previous_ending_snippet}"
            </p>
          )}

          {showSeriesHistory && continuationInfo?.series_history && (
            <div className="mt-2 pt-2 border-t border-indigo-900/40 space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 block">
                Kronologi Seluruh Episode Sebelumnya:
              </span>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                {continuationInfo.series_history.map((h, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-gray-950/80 border border-gray-800 text-[11px] space-y-1">
                    <div className="flex items-center justify-between text-indigo-300 font-bold">
                      <span>{h.episode_id.toUpperCase()}: {h.title}</span>
                    </div>
                    {h.summary && <p className="text-gray-300 text-[10px] leading-relaxed">{h.summary}</p>}
                    {h.cliffhanger && <p className="text-amber-400/90 text-[10px] italic">Cliffhanger: "{h.cliffhanger}"</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="bg-red-950/40 border border-red-800/60 rounded-2xl p-4 flex items-start gap-3 shadow-lg">
          <span className="text-xl">⚠️</span>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold text-red-300">Gagal Memproses Chat</h4>
            <p className="text-xs text-red-200/80 mt-0.5 whitespace-pre-wrap">{errorMessage}</p>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-400 hover:text-red-200 text-xs px-2 py-1 rounded-lg hover:bg-red-900/40 transition-colors"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Modal Buat Topik Baru */}
      {showNewTopicModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6 max-w-lg w-full space-y-4 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-gray-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>📁</span> Buat Topik Serial Baru
              </h3>
              <button
                onClick={() => setShowNewTopicModal(false)}
                className="text-gray-400 hover:text-white text-xs px-2 py-1 rounded-lg hover:bg-gray-800"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-gray-400 leading-relaxed">
              Topik serial baru akan dibuat dalam folder terpisah tanpa menghapus atau menimpa topik yang sudah ada sebelumnya.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Judul Topik Serial *</label>
                <input
                  type="text"
                  value={newTopicTitle}
                  onChange={(e) => setNewTopicTitle(e.target.value)}
                  placeholder="Contoh: Bunker Kiamat Bawah Tanah"
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/60"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Kategori / Genre</label>
                <input
                  type="text"
                  value={newTopicCategory}
                  onChange={(e) => setNewTopicCategory(e.target.value)}
                  placeholder="Survival Fiction / Horror / Thriller"
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/60"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Premis Dunia & Latar Cerita</label>
                <textarea
                  rows={3}
                  value={newTopicDescription}
                  onChange={(e) => setNewTopicDescription(e.target.value)}
                  placeholder="Deskripsikan latar belakang dunia, situasi awal, atau krisis yang terjadi..."
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/60 resize-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Nama Tokoh Utama (Opsional)</label>
                <input
                  type="text"
                  value={newTopicCharacterName}
                  onChange={(e) => setNewTopicCharacterName(e.target.value)}
                  placeholder="Contoh: Si Topeng Gas / Arga"
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/60"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-800">
              <button
                onClick={() => setShowNewTopicModal(false)}
                className="px-3.5 py-2 text-xs text-gray-400 hover:text-white rounded-xl hover:bg-gray-800 transition-all"
              >
                Batal
              </button>
              <button
                onClick={handleCreateNewTopic}
                disabled={isCreating || !newTopicTitle.trim()}
                className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-gray-950 font-bold rounded-xl text-xs transition-all flex items-center gap-1.5 shadow-md shadow-amber-600/30"
              >
                <span>{isCreating ? '⏳ Memproses...' : '🚀 Buat Topik & Mulai Episode 1'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Buat Episode Baru (Lanjutan Cerita) */}
      {showNewEpisodeModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6 max-w-lg w-full space-y-4 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-gray-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>🎬</span> Buat Episode Baru (Lanjutan Cerita)
              </h3>
              <button
                onClick={() => setShowNewEpisodeModal(false)}
                className="text-gray-400 hover:text-white text-xs px-2 py-1 rounded-lg hover:bg-gray-800"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="bg-gray-950 p-3 rounded-xl border border-gray-800 space-y-1.5">
                <span className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider block">
                  Konteks Lanjutan dari Episode Sebelumnya:
                </span>
                <p className="text-xs text-gray-300 leading-relaxed italic">
                  "{lastCliffhanger || 'Konflik terakhir masih belum terselesaikan dan berlanjut ke babak baru.'}"
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Judul Episode {nextEpNumber}</label>
                <input
                  type="text"
                  value={newEpisodeTitle}
                  onChange={(e) => setNewEpisodeTitle(e.target.value)}
                  placeholder={`${currentTopic?.title} - Episode ${nextEpNumber}`}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/60"
                />
              </div>
            </div>

            <p className="text-[11px] text-gray-400 leading-relaxed">
              Episode baru akan mewarisi lore dunia, karakter, dan langsung memulai dialog AI Agent dengan kelanjutan dari cliffhanger di atas.
            </p>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-800">
              <button
                onClick={() => setShowNewEpisodeModal(false)}
                className="px-3.5 py-2 text-xs text-gray-400 hover:text-white rounded-xl hover:bg-gray-800 transition-all"
              >
                Batal
              </button>
              <button
                onClick={handleCreateNewEpisode}
                disabled={isCreating}
                className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-all flex items-center gap-1.5 shadow-md shadow-cyan-600/30"
              >
                <span>{isCreating ? '⏳ Memproses...' : `🚀 Buat Episode ${nextEpNumber} & Mulai Alur Lanjutan`}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid: Card Snapshot + Chat Studio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Idea Snapshot & Narration Card */}
        <div className="lg:col-span-5 space-y-4">
          {/* Card Ide & Naskah Terkunci / Berjalan */}
          {hasIdea ? (
            <div className="bg-gray-900/90 border border-gray-800 rounded-3xl p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-700/50 text-[10px] font-mono font-bold uppercase flex items-center gap-1">
                  <span>✓</span> Ide Terkunci
                </span>
                <span className="text-[10px] text-gray-500 font-mono">
                  {selectedTopicId}/{selectedEpisodeId}
                </span>
              </div>

              <div>
                <h3 className="text-lg font-black text-white leading-tight">{idea.title}</h3>
                <p className="text-xs text-amber-400 font-medium mt-0.5">{idea.category}</p>
              </div>

              {idea.concept_hook && (
                <div className="p-3 rounded-2xl bg-black/40 border border-gray-800/80 text-xs text-gray-300 leading-relaxed italic">
                  🔥 "{idea.concept_hook}"
                </div>
              )}

              {duration && (
                <div className="flex items-center justify-between p-3 rounded-2xl bg-gray-950 border border-gray-800/80 text-xs">
                  <span className="text-gray-400 font-semibold">Durasi Target:</span>
                  <span className="text-white font-bold">{duration.label}</span>
                </div>
              )}

              {idea.description && (
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block">Deskripsi:</span>
                  <p className="text-xs text-gray-300 leading-relaxed">{idea.description}</p>
                </div>
              )}

              {idea.materials && idea.materials.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block">Elemen / Aset:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {idea.materials.map((m, idx) => (
                      <span key={idx} className="px-2 py-0.5 bg-gray-950 border border-gray-800 text-[10px] text-gray-400 rounded-lg font-mono">
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Draf Naskah Narasi Card */}
              {draftScript && (
                <div className="pt-3 border-t border-gray-800 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-bold text-amber-300 flex items-center gap-1">
                      <span>📜</span> Naskah Voiceover ({cleanWordCount} kata bersih)
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={handleCopyClean}
                        className="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg text-[10px] font-bold transition-all"
                      >
                        {copiedType === 'clean' ? '✓ Tersalin' : '📋 Salin Bersih'}
                      </button>
                      <button
                        onClick={handleCopyRaw}
                        className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-[10px] font-medium transition-all"
                      >
                        {copiedType === 'raw' ? '✓ Tersalin' : 'Raw'}
                      </button>
                    </div>
                  </div>

                  <div className="bg-gray-950 p-3.5 rounded-2xl border border-gray-850 text-xs text-gray-300 font-mono leading-relaxed max-h-60 overflow-y-auto whitespace-pre-wrap select-text">
                    {scriptViewMode === 'clean' ? cleanScript : draftScript}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-gray-900/60 border border-dashed border-gray-800 rounded-3xl p-6 text-center space-y-3">
              <span className="text-4xl block">💡</span>
              <h4 className="text-sm font-bold text-gray-300">Belum Ada Ide Terpilih</h4>
              <p className="text-xs text-gray-500 max-w-sm mx-auto leading-relaxed">
                Mulai percakapan dengan AI Agent di panel sebelah kanan untuk merumuskan ide, durasi, dan naskah narasi.
              </p>
            </div>
          )}
        </div>

        {/* Right Column: Chat Studio */}
        <div className="lg:col-span-7 bg-gray-900/90 border border-gray-800 rounded-3xl p-5 shadow-2xl flex flex-col h-[650px] relative">
          {/* Chat Messages Scroll Area */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin">
            {messages.map((m, idx) => {
              const isUser = m.role === 'user';
              return (
                <div key={idx} className={`flex items-start gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
                  {!isUser && (
                    <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-amber-600 to-amber-500 text-gray-950 flex items-center justify-center font-bold text-xs shrink-0 shadow-sm shadow-amber-500/20">
                      AI
                    </div>
                  )}
                  <div
                    className={`p-3.5 rounded-2xl max-w-[85%] text-xs leading-relaxed select-text ${
                      isUser
                        ? 'bg-amber-500 text-gray-950 font-medium rounded-tr-sm whitespace-pre-wrap'
                        : 'bg-gray-950 text-gray-200 border border-gray-800/80 rounded-tl-sm shadow-sm'
                    }`}
                  >
                    {isUser ? m.content : <MarkdownView content={m.content} />}
                  </div>
                </div>
              );
            })}
            {isSending && (
              <div className="flex items-center gap-2 text-xs text-amber-400 font-mono animate-pulse pl-1">
                <span className="animate-spin">⚙️</span> Sedang meracik alur & naskah dengan AI Agent...
              </div>
            )}
          </div>

          {/* Quick Suggested Actions */}
          {suggestedActions.length > 0 && !isSending && (
            <div className="pt-3 pb-2 flex items-center gap-1.5 flex-wrap border-t border-gray-800/60 mt-2">
              <span className="text-[10px] text-gray-500 uppercase font-mono mr-1">Saran:</span>
              {suggestedActions.map((action, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(action)}
                  className="px-2.5 py-1 bg-gray-950 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 text-gray-300 hover:text-white rounded-xl text-[11px] font-medium transition-all"
                >
                  {action}
                </button>
              ))}
            </div>
          )}

          {/* Chat Input Bar */}
          <div className="pt-2 border-t border-gray-800/60 flex items-end gap-2">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLocked || isSending}
              placeholder={
                isLocked
                  ? '🔒 Proyek episode ini terkunci. Klik "Buka Kunci" untuk mengedit kembali.'
                  : 'Ketik pesan atau instruksi untuk AI Director (tekan Enter untuk kirim)...'
              }
              className="flex-1 bg-gray-950 border border-gray-800 rounded-2xl p-3 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/60 disabled:opacity-50 resize-none"
            />
            <button
              onClick={() => handleSend()}
              disabled={isLocked || isSending || !input.trim()}
              className="px-4 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-40 text-gray-950 font-bold rounded-2xl text-xs transition-all flex items-center gap-1 shadow-md shadow-amber-600/20 shrink-0"
            >
              <span>{isLocked ? 'Terkunci 🔒' : 'Kirim'}</span>
              {!isLocked && <span>➔</span>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FacelessIdeaAgentStep;
