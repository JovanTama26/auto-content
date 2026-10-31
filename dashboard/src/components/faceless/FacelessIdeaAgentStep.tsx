// dashboard/src/components/faceless/FacelessIdeaAgentStep.tsx
import React, { useEffect, useRef, useState } from 'react';
import type { FacelessChatMessage, FacelessProjectState } from '../../electron-api';

const INITIAL_GREETING: FacelessChatMessage = {
  role: 'assistant',
  content:
    'Halo! Kita mulai dari ide ya. Kamu sudah punya ide untuk konten faceless-nya, atau mau aku tawarkan beberapa ide?',
};

const INITIAL_ACTIONS = ['Aku punya ide sendiri', 'Kasih aku ide (AI)'];

export const FacelessIdeaAgentStep: React.FC = () => {
  const [messages, setMessages] = useState<FacelessChatMessage[]>([INITIAL_GREETING]);
  const [state, setState] = useState<FacelessProjectState | null>(null);
  const [input, setInput] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [suggestedActions, setSuggestedActions] = useState<string[]>(INITIAL_ACTIONS);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!window.electronAPI?.getFacelessState) return;
        const res = await window.electronAPI.getFacelessState();
        if (res.success && res.data) {
          setState(res.data);
          if (res.data.chat_history?.length) {
            setMessages(res.data.chat_history);
            setSuggestedActions(res.data.stage === 'idea_ready' ? [] : INITIAL_ACTIONS);
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
      const res = await window.electronAPI.facelessAgentChat({ messages: nextMessages });
      if (res.success && res.data) {
        setMessages([
          ...nextMessages,
          { role: 'assistant', content: res.data.reply, at: new Date().toISOString() },
        ]);
        setState(res.data.state);
        setSuggestedActions(res.data.idea_ready ? [] : res.data.suggested_actions || []);
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
    if (!window.confirm('Reset ide dan riwayat chat Faceless Content?')) return;
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
  const ideaReady = state?.stage === 'idea_ready' && !!idea;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-gray-900/90 border border-gray-800 rounded-3xl p-6 shadow-2xl backdrop-blur-md relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-amber-950/80 text-amber-300 border border-amber-700/50 text-[11px] font-mono font-bold tracking-wider uppercase">
                🎯 Step 1: Idea Agent
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-gray-800 text-gray-400 text-[10px] font-mono border border-gray-700">
                Faceless Content • JSON State
              </span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <span>💬</span> Temukan Ide Faceless Content
            </h1>
            <p className="text-xs text-gray-400 leading-relaxed max-w-3xl">
              Ngobrol santai dengan AI untuk menentukan ide konten faceless. Kamu bisa bawa ide
              sendiri atau minta rekomendasi. Ide yang sudah disepakati bisa dipakai untuk video
              panjang maupun video pendek, dan otomatis tersimpan ke state proyek.
            </p>
          </div>
          <button
            onClick={handleReset}
            disabled={isSending}
            className="px-3 py-1.5 bg-gray-800/80 hover:bg-red-900/60 text-gray-400 hover:text-red-300 text-xs font-semibold rounded-xl border border-gray-700 hover:border-red-800/60 transition-all shrink-0 flex items-center gap-1.5"
          >
            <span>🔄</span> Reset Ide
          </button>
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

      {/* Saved Idea Card */}
      {ideaReady && idea && (
        <div className="bg-gradient-to-br from-emerald-950/40 via-gray-900 to-gray-900 border border-emerald-700/50 rounded-3xl p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono font-bold uppercase">
                  ✓ Ide Tersimpan
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
                  <div className="text-[10px] font-mono uppercase tracking-wider text-amber-400 mb-1">
                    Idea Agent
                  </div>
                )}
                {message.content}
              </div>
            </div>
          ))}

          {isSending && (
            <div className="flex justify-start">
              <div className="bg-gray-950 border border-gray-800 rounded-2xl rounded-bl-md px-4 py-3 text-sm text-gray-400 flex items-center gap-2">
                <span className="animate-spin">⏳</span> Agent sedang berpikir...
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

        {/* Input */}
        <div className="p-4 border-t border-gray-800 bg-gray-950/60">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              disabled={isSending}
              placeholder="Tulis ide atau jawabanmu... (Enter untuk kirim, Shift+Enter baris baru)"
              className="flex-1 bg-gray-950 border border-gray-800 focus:border-amber-500 rounded-2xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none transition-all shadow-inner font-medium resize-none"
            />
            <button
              onClick={() => handleSend()}
              disabled={isSending || !input.trim()}
              className={`px-5 py-3 rounded-2xl text-xs font-extrabold uppercase tracking-wider transition-all shadow-lg flex items-center justify-center gap-2 shrink-0 ${
                isSending || !input.trim()
                  ? 'bg-gray-800 text-gray-500 border border-gray-700 cursor-not-allowed'
                  : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-gray-950 shadow-amber-600/30'
              }`}
            >
              <span>Kirim</span>
              <span>➔</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FacelessIdeaAgentStep;
