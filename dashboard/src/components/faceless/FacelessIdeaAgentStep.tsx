// dashboard/src/components/faceless/FacelessIdeaAgentStep.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cleanVoiceoverScript } from '../../utils/cleanScript';
import type {
  FacelessChatMessage,
  FacelessProjectState,
  FacelessStage,
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

const FACELESS_MODEL = 'ag/gemini-3.8-flash-high';

export interface FacelessIdeaAgentStepProps {
  onGoToAudio?: () => void;
}

export const FacelessIdeaAgentStep: React.FC<FacelessIdeaAgentStepProps> = ({ onGoToAudio }) => {
  const [messages, setMessages] = useState<FacelessChatMessage[]>([INITIAL_GREETING]);
  const [state, setState] = useState<FacelessProjectState | null>(null);
  const [input, setInput] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [suggestedActions, setSuggestedActions] = useState<string[]>(INITIAL_ACTIONS);
  const [scriptViewMode, setScriptViewMode] = useState<'clean' | 'raw'>('clean');
  const [copiedType, setCopiedType] = useState<'clean' | 'raw' | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const isLocked = Boolean(state?.is_locked);

  const handleLock = async () => {
    if (!window.electronAPI?.lockFacelessProject) return;
    try {
      const res = await window.electronAPI.lockFacelessProject();
      if (res.success && res.data) {
        setState(res.data);
        setSuggestedActions(['🔓 Buka Kunci (Edit Kembali)']);
      }
    } catch (err: any) {
      setErrorMessage(`Gagal mengunci proyek: ${err.message}`);
    }
  };

  const handleUnlock = async () => {
    if (!window.electronAPI?.unlockFacelessProject) return;
    try {
      const res = await window.electronAPI.unlockFacelessProject();
      if (res.success && res.data) {
        setState(res.data);
        setSuggestedActions(DEFAULT_ACTIONS_BY_STAGE[res.data.stage] || []);
      }
    } catch (err: any) {
      setErrorMessage(`Gagal membuka kunci proyek: ${err.message}`);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        if (!window.electronAPI?.getFacelessState) return;
        const res = await window.electronAPI.getFacelessState();
        if (res.success && res.data) {
          setState(res.data);
          if (res.data.chat_history?.length) {
            setMessages(res.data.chat_history);
          }
          if (res.data.is_locked) {
            setSuggestedActions(['🔓 Buka Kunci (Edit Kembali)']);
          } else {
            setSuggestedActions(DEFAULT_ACTIONS_BY_STAGE[res.data.stage] || INITIAL_ACTIONS);
          }
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isSending]);

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
        model: FACELESS_MODEL,
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
      } else {
        setErrorMessage(res.error || 'Gagal mendapatkan balasan dari AI Agent.');
      }
    } catch (err: any) {
      setErrorMessage(`Terjadi kesalahan: ${err.message}`);
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
    if (!window.confirm('Reset ide, memori, dan riwayat chat Faceless Content?')) return;
    try {
      await window.electronAPI?.resetFacelessState?.();
    } catch {}
    setMessages([INITIAL_GREETING]);
    setState(null);
    setSuggestedActions(INITIAL_ACTIONS);
    setInput('');
    setErrorMessage(null);
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

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-gray-900/90 border border-gray-800 rounded-3xl p-6 shadow-2xl backdrop-blur-md relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 rounded-full bg-amber-950/80 text-amber-300 border border-amber-700/50 text-[11px] font-mono font-bold tracking-wider uppercase">
                🎯 Step 1: Idea & Narration Agent
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/60 text-emerald-300 text-[10px] font-mono border border-emerald-800/60 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                9router · {FACELESS_MODEL}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-purple-950/60 text-purple-300 text-[10px] font-mono border border-purple-800/60 flex items-center gap-1">
                ⚡ Proactive Drafting
              </span>
              {isLocked ? (
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/90 text-emerald-300 border border-emerald-500/60 text-[10px] font-mono font-bold flex items-center gap-1 shadow-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  🔒 Step 1 Terkunci (Final)
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
              AI Agent proaktif yang langsung merancang alur cerita DNA Retention hingga menyusun <strong>draf kasar naskah narasi lengkap</strong> siap voiceover tanpa perlu melewati wawancara panjang.
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
                onClick={onGoToAudio}
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
            >
              <span>🔄</span> Reset State & Chat
            </button>
          </div>
        </div>
      </div>

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
            className="text-red-400 hover:text-red-200 text-xs font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Saved Idea & Memory Card */}
      {hasIdea && idea && (
        <div className="bg-gradient-to-br from-emerald-950/40 via-gray-900 to-gray-900 border border-emerald-700/50 rounded-3xl p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono font-bold uppercase">
                  ✓ Ide Terkunci
                </span>
                <span className="px-2.5 py-0.5 rounded-md bg-gray-800 text-gray-400 border border-gray-700 text-[10px] font-mono">
                  {state?.idea_source === 'agent' ? 'Dari Agent' : state?.idea_source === 'user' ? 'Dari Kamu' : 'Ide'}
                </span>
              </div>
              <h2 className="text-xl font-black text-white">{idea.title}</h2>
              <p className="text-xs text-emerald-300/80 font-mono">{idea.category}</p>
            </div>
            <span className="text-[10px] font-mono text-gray-500 break-all max-w-full">
              input/faceless/faceless_state.json
            </span>
          </div>

          <p className="text-xs text-amber-200/90 font-medium bg-gray-950/60 p-3 rounded-xl border border-gray-800">
            🔥 <em>"{idea.concept_hook}"</em>
          </p>

          {duration && (
            <div className="flex flex-wrap items-center gap-2 text-xs bg-gray-950/60 p-3 rounded-xl border border-gray-800">
              <span className="text-gray-500 font-bold uppercase tracking-wider text-[10px]">
                ⏱️ Durasi Target
              </span>
              <span className="text-white font-bold">
                {duration.label || `${duration.seconds} detik`}
              </span>
              {duration.format && (
                <span className="px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[10px] font-mono font-bold uppercase">
                  {duration.format === 'short' ? 'Video Pendek' : 'Video Panjang'}
                </span>
              )}
            </div>
          )}

          {currentStage === 'outline_discussion' && (
            <div className="text-[11px] text-amber-200/90 bg-amber-950/40 border border-amber-800/50 p-3 rounded-xl space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <span>💡</span> Tahap 3: Gambaran Kasar Alur Cerita (Flow A → B → C → D)
              </p>
              <p className="text-gray-300">
                Tinjau rancangan gambaran kasar alur di chat atau di bawah. Jika kamu setuju, agen akan lanjut menyusun naskah narasi lengkap kata demi kata.
              </p>
            </div>
          )}

          {currentStage === 'narration_discussion' && (
            <div className="text-[11px] text-emerald-200/90 bg-emerald-950/40 border border-emerald-800/50 p-3 rounded-xl space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <span>🎙️</span> Tahap 4: Naskah Narasi Lengkap Siap Voiceover
              </p>
              <p className="text-gray-300">
                Alur cerita telah disetujui. Naskah narasi lengkap siap dibaca atau diproduksi.
              </p>
            </div>
          )}

          {idea.description && (
            <p className="text-xs text-gray-300 leading-relaxed">{idea.description}</p>
          )}

          {idea.materials?.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                Elemen / Aset Kunci
              </span>
              <div className="flex flex-wrap gap-1.5">
                {idea.materials.map((material) => (
                  <span
                    key={material}
                    className="px-2.5 py-1 rounded-lg bg-gray-950 text-gray-300 border border-gray-800 text-[11px]"
                  >
                    {material}
                  </span>
                ))}
              </div>
            </div>
          )}

          {idea.vibe && (
            <div className="text-[11px] text-gray-400">
              <span className="text-gray-500 font-bold uppercase tracking-wider">Vibe:</span>{' '}
              {idea.vibe}
            </div>
          )}

          {/* DRAF NASKAH NARASI (VOICEOVER SCRIPT) */}
          {Boolean(draftScript) && (
            <div className="bg-gray-950/90 border border-amber-500/40 rounded-2xl p-4 shadow-xl space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">🎙️</span>
                  <div>
                    <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                      <span>Draf Naskah Narasi Faceless</span>
                      <span className="px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-700/60 text-[10px] font-mono">
                        {scriptViewMode === 'clean'
                          ? `${cleanWordCount} kata narasi (bersih)`
                          : `${rawWordCount} kata draf`}
                      </span>
                    </h3>
                    <p className="text-[10px] text-gray-400">
                      Naskah siap voiceover (ElevenLabs / TTS) yang dirumuskan agent berdasarkan DNA Retention.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* View Mode Toggle: Naskah Bersih vs Format Lengkap */}
                  <div className="flex items-center bg-gray-900 border border-gray-800 rounded-xl p-0.5 text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setScriptViewMode('clean')}
                      className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 ${
                        scriptViewMode === 'clean'
                          ? 'bg-amber-500 text-gray-950 font-bold shadow-sm'
                          : 'text-gray-400 hover:text-gray-200'
                      }`}
                      title="Lihat teks naskah bersih murni (tanpa label Part dan tanpa arahan visual)"
                    >
                      <span>✨ Naskah Bersih</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setScriptViewMode('raw')}
                      className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 ${
                        scriptViewMode === 'raw'
                          ? 'bg-gray-800 text-amber-300 font-bold border border-gray-700'
                          : 'text-gray-400 hover:text-gray-200'
                      }`}
                      title="Lihat format lengkap asli beserta Part dan catatan visual director"
                    >
                      <span>📑 Format Lengkap (Raw)</span>
                    </button>
                  </div>

                  {/* Primary: Salin Naskah Bersih */}
                  <button
                    onClick={handleCopyClean}
                    className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-gray-950 text-xs font-black transition-all shadow-md shadow-amber-600/20 flex items-center gap-1.5"
                    title="Salin naskah bersih tanpa Part & tanpa arahan visual, siap paste ke ElevenLabs / TTS"
                  >
                    <span>
                      {copiedType === 'clean' ? '✓ Tersalin Bersih!' : '📋 Salin Naskah Bersih'}
                    </span>
                  </button>

                  {/* Secondary: Salin Format Lengkap */}
                  <button
                    onClick={handleCopyRaw}
                    className="px-2.5 py-1.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-gray-300 hover:text-white border border-gray-700 text-xs font-semibold transition-all flex items-center gap-1"
                    title="Salin naskah asli lengkap dengan part dan arahan visual"
                  >
                    <span>{copiedType === 'raw' ? '✓ Tersalin Raw!' : '📑 Salin Raw'}</span>
                  </button>

                  {isLocked ? (
                    <div className="flex items-center gap-1.5">
                      <span className="px-2.5 py-1 rounded-xl bg-emerald-950 text-emerald-300 border border-emerald-500/50 text-[11px] font-mono font-bold flex items-center gap-1">
                        <span>🔒</span> Terkunci
                      </span>
                      <button
                        onClick={handleUnlock}
                        className="px-2.5 py-1 rounded-xl bg-gray-800 hover:bg-gray-700 text-amber-300 text-[11px] font-bold border border-gray-700 transition-all flex items-center gap-1"
                      >
                        <span>🔓</span> Buka Kunci
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleLock}
                      className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-xs font-black transition-all shadow-md flex items-center gap-1.5"
                    >
                      <span>🔒</span> Kunci Naskah
                    </button>
                  )}
                </div>
              </div>

              {/* Status info bar */}
              <div className="flex items-center justify-between text-[11px] px-3 py-1.5 rounded-xl bg-gray-900/60 border border-gray-800 text-gray-400">
                {scriptViewMode === 'clean' ? (
                  <span className="flex items-center gap-1.5 text-amber-300/90 font-medium">
                    <span>✨</span>
                    <span>
                      <strong>Naskah Bersih Siap VO:</strong> Label part, tag [Visual], SFX, dan instruksi director otomatis dibersihkan agar langsung siap di-paste ke ElevenLabs / TTS.
                    </span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-gray-300">
                    <span>📑</span>
                    <span>
                      <strong>Format Lengkap (Draf):</strong> Menampilkan naskah asli dengan pembagian part dan catatan visual director untuk panduan footage.
                    </span>
                  </span>
                )}
                <span className="text-[10px] font-mono text-gray-500 shrink-0 ml-2">
                  {scriptViewMode === 'clean' ? `${cleanWordCount} kata` : `${rawWordCount} kata`}
                </span>
              </div>

              {/* Script Text Box */}
              <div className="bg-gray-900/80 border border-gray-800 rounded-xl p-4 text-xs font-mono text-gray-200 leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto selection:bg-amber-500 selection:text-black">
                {scriptViewMode === 'clean' ? (cleanScript || 'Belum ada naskah narasi.') : draftScript}
              </div>
            </div>
          )}

          {/* Persistent Memory & Narration DNA Beats Display */}
          {(memory?.summary || (memory?.key_points && memory.key_points.length > 0) || hasNarrationOutline) && (
            <div className="pt-2 border-t border-gray-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>🧠</span> Memori Alur Cerita DNA (Retention)
                </span>
                {memory?.summary && (
                  <span className="text-[10px] text-gray-400 italic truncate max-w-sm">
                    {memory.summary}
                  </span>
                )}
              </div>

              {/* Key points tags */}
              {memory?.key_points && memory.key_points.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {memory.key_points.map((pt, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-md bg-purple-950/40 text-purple-300 border border-purple-800/40 text-[10px]"
                    >
                      📌 {pt}
                    </span>
                  ))}
                </div>
              )}

              {/* DNA Narasi Beats Breakdown */}
              {hasNarrationOutline && narrationOutline && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 text-xs">
                  {narrationOutline.hook && (
                    <div className="bg-gray-950/80 border border-gray-800 rounded-xl p-2.5 space-y-1">
                      <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                        <span>🎣</span> 1. Hook Pembuka
                      </div>
                      <p className="text-gray-200 text-[11px] leading-tight">{narrationOutline.hook}</p>
                    </div>
                  )}
                  {narrationOutline.plan && (
                    <div className="bg-gray-950/80 border border-gray-800 rounded-xl p-2.5 space-y-1">
                      <div className="text-[10px] font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1">
                        <span>📋</span> 2. Rencana Awal
                      </div>
                      <p className="text-gray-200 text-[11px] leading-tight">{narrationOutline.plan}</p>
                    </div>
                  )}
                  {narrationOutline.failure && (
                    <div className="bg-gray-950/80 border border-gray-800 rounded-xl p-2.5 space-y-1">
                      <div className="text-[10px] font-bold text-red-400 uppercase tracking-wider flex items-center gap-1">
                        <span>💥</span> 3. Kegagalan / Kendala
                      </div>
                      <p className="text-gray-200 text-[11px] leading-tight">{narrationOutline.failure}</p>
                    </div>
                  )}
                  {narrationOutline.improvisation && (
                    <div className="bg-gray-950/80 border border-gray-800 rounded-xl p-2.5 space-y-1">
                      <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                        <span>🛠️</span> 4. Improvisasi Tokoh
                      </div>
                      <p className="text-gray-200 text-[11px] leading-tight">{narrationOutline.improvisation}</p>
                    </div>
                  )}
                  {narrationOutline.stakes && (
                    <div className="bg-gray-950/80 border border-gray-800 rounded-xl p-2.5 space-y-1">
                      <div className="text-[10px] font-bold text-orange-400 uppercase tracking-wider flex items-center gap-1">
                        <span>⚡</span> 5. Stakes Naik (Eskalasi)
                      </div>
                      <p className="text-gray-200 text-[11px] leading-tight">{narrationOutline.stakes}</p>
                    </div>
                  )}
                  {narrationOutline.twist && (
                    <div className="bg-gray-950/80 border border-gray-800 rounded-xl p-2.5 space-y-1">
                      <div className="text-[10px] font-bold text-pink-400 uppercase tracking-wider flex items-center gap-1">
                        <span>🎭</span> 6. Plot Twist
                      </div>
                      <p className="text-gray-200 text-[11px] leading-tight">{narrationOutline.twist}</p>
                    </div>
                  )}
                  {narrationOutline.cliffhanger && (
                    <div className="bg-gray-950/80 border border-gray-800 rounded-xl p-2.5 space-y-1">
                      <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1">
                        <span>⏳</span> 7. Cliffhanger / Open Loop
                      </div>
                      <p className="text-gray-200 text-[11px] leading-tight">{narrationOutline.cliffhanger}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chat Panel */}
      <div className="bg-gray-900/70 border border-gray-800 rounded-3xl shadow-xl overflow-hidden flex flex-col">
        <div ref={scrollRef} className="p-5 space-y-4 max-h-[420px] overflow-y-auto">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  message.role === 'user'
                    ? 'bg-amber-500 text-gray-950 font-medium rounded-br-md'
                    : 'bg-gray-950 border border-gray-800 text-gray-200 rounded-bl-md'
                }`}
              >
                {message.role === 'assistant' && (
                  <div className="text-[10px] font-mono uppercase tracking-wider text-amber-400 mb-1 flex items-center gap-1.5">
                    <span>Faceless Director</span>
                    <span className="text-[9px] text-gray-500 font-normal">({FACELESS_MODEL})</span>
                  </div>
                )}
                {message.content}
              </div>
            </div>
          ))}

          {isSending && (
            <div className="flex justify-start">
              <div className="bg-gray-950 border border-gray-800 rounded-2xl rounded-bl-md px-4 py-3 text-sm text-gray-400 flex items-center gap-2">
                <span className="animate-spin">⏳</span> Agent sedang menyusun alur & naskah narasi...
              </div>
            </div>
          )}
        </div>

        {/* Suggested Actions */}
        {suggestedActions.length > 0 && !isSending && (
          <div className="px-5 pb-2 flex flex-wrap gap-2">
            {suggestedActions.map((action) => (
              <button
                key={action}
                onClick={() => handleSend(action)}
                className="px-3 py-1.5 rounded-xl bg-gray-950 hover:bg-gray-800 text-gray-300 hover:text-amber-300 border border-gray-800 hover:border-amber-500/40 text-xs font-medium transition-all flex items-center gap-1.5"
              >
                <span>💡</span>
                <span>{action}</span>
              </button>
            ))}
          </div>
        )}

        {/* Banner Status Terkunci */}
        {isLocked && (
          <div className="mx-4 mb-2 p-3.5 bg-gradient-to-r from-emerald-950/50 via-gray-900 to-gray-950 border border-emerald-600/40 rounded-2xl flex items-center justify-between gap-3 shadow-lg">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">🔒</span>
              <div>
                <h4 className="text-xs font-bold text-emerald-300 flex items-center gap-2">
                  <span>Chat Step 1 Terkunci (Naskah Disetujui)</span>
                  {state?.locked_at && (
                    <span className="text-[10px] text-gray-400 font-mono font-normal">
                      · {new Date(state.locked_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </h4>
                <p className="text-[11px] text-gray-400 leading-tight">
                  Naskah dan konsep telah dikunci agar tidak berubah tanpa sengaja. Klik "Buka Kunci" jika ingin memberikan revisi baru.
                </p>
              </div>
            </div>
            <button
              onClick={handleUnlock}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-gray-950 text-xs font-black rounded-xl transition-all shadow-md shrink-0 flex items-center gap-1"
            >
              <span>🔓</span> Buka Kunci
            </button>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-gray-800 bg-gray-950/60">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              disabled={isSending || isLocked}
              placeholder={
                isLocked
                  ? '🔒 Chat Step 1 terkunci karena naskah sudah disetujui. Klik "Buka Kunci" jika ingin merevisi.'
                  : 'Tulis ide, jawaban, atau revisimu... (Enter untuk kirim, Shift+Enter baris baru)'
              }
              className={`flex-1 rounded-2xl px-4 py-3 text-sm transition-all shadow-inner font-medium resize-none ${
                isLocked
                  ? 'bg-gray-900/40 border border-gray-800 text-gray-500 placeholder-gray-500 cursor-not-allowed'
                  : 'bg-gray-950 border border-gray-800 focus:border-amber-500 text-white placeholder-gray-600 focus:outline-none'
              }`}
            />
            <button
              onClick={() => handleSend()}
              disabled={isSending || isLocked || !input.trim()}
              className={`px-5 py-3 rounded-2xl text-xs font-extrabold uppercase tracking-wider transition-all shadow-lg flex items-center justify-center gap-2 shrink-0 ${
                isSending || isLocked || !input.trim()
                  ? 'bg-gray-800 text-gray-500 border border-gray-700 cursor-not-allowed'
                  : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-gray-950 shadow-amber-600/30'
              }`}
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
