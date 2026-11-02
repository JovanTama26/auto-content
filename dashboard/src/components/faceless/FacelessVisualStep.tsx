// dashboard/src/components/faceless/FacelessVisualStep.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import type {
  FacelessVisualPromptItem,
  FacelessVisualPromptsData,
  FacelessTranscriptData,
  FacelessAudioItem,
  FacelessVisualStreamProgress,
} from '../../electron-api';

const api = window.electronAPI;

interface FacelessVisualStepProps {
  onBackToAudio?: () => void;
}

const TEMPLATE_A_BASE = (scene: string, shot: string) =>
  `2D flat hand-drawn stickman cartoon, thick black outlines, NOT realistic, NOT 3D, NOT anime. Stickman: round white head, two round white eyes with small black dot pupils, tiny neutral mouth, thin black stick body and limbs (no clothes, no muscles, no realistic anatomy), mustard yellow beanie, army green sling bag. Scene: ${scene}. ${shot}. Muted dark color palette, no text, no labels, 16:9.`;

const TEMPLATE_B_BASE = (scene: string, shot: string) =>
  `2D flat hand-drawn stickman cartoon style, thick black outlines, NOT realistic, NOT 3D, NOT anime. Scene: ${scene}. ${shot}. Muted dark color palette, no text, no labels, 16:9.`;

const SHOT_OPTIONS = [
  { value: 'wide shot', label: 'Wide Shot (Lokasi / Pemandangan / Kerumunan)' },
  { value: 'medium shot', label: 'Medium Shot (Aksi Karakter / Interaksi)' },
  { value: 'close-up shot', label: 'Close-Up Shot (Benda / Ekspresi / Detail)' },
  { value: 'top-down shot', label: 'Top-Down Shot (Peta / Denah / Logistik)' },
];

const NINEROUTER_MODELS = [
  { id: 'ag/gemini-3.8-flash-high', label: 'ag/gemini-3.8-flash-high (9router Default - Cepat & Cerdas)' },
  { id: 'ag/gemini-3-flash-agent', label: 'ag/gemini-3-flash-agent (9router Stabil)' },
  { id: 'gemini/gemini-3.1-flash-lite-preview', label: 'gemini-3.1-flash-lite (9router Hemat)' },
  { id: 'ds/deepseek-chat', label: 'DeepSeek Chat (9router Kreatif)' },
  { id: 'cmc/Qwen/Qwen3.6-Plus', label: 'Qwen 3.6 Plus (9router)' },
];

export const FacelessVisualStep: React.FC<FacelessVisualStepProps> = ({ onBackToAudio }) => {
  const [prompts, setPrompts] = useState<FacelessVisualPromptItem[]>([]);
  const [transcript, setTranscript] = useState<FacelessTranscriptData | null>(null);
  const [audioList, setAudioList] = useState<FacelessAudioItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedModel, setSelectedModel] = useState<string>('ag/gemini-3.8-flash-high');
  const [batchSize, setBatchSize] = useState<number>(5);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [streamProgress, setStreamProgress] = useState<{
    active: boolean;
    batchIndex: number;
    totalBatches: number;
    percent: number;
    message: string;
    startLineNum?: number;
    endLineNum?: number;
  } | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [customInstructions, setCustomInstructions] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [templateFilter, setTemplateFilter] = useState<'ALL' | 'A' | 'B'>('ALL');
  const [shotFilter, setShotFilter] = useState<string>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const [isGuideExpanded, setIsGuideExpanded] = useState<boolean>(false);
  const [singleRegenModalItem, setSingleRegenModalItem] = useState<FacelessVisualPromptItem | null>(null);
  const [singleRegenFeedback, setSingleRegenFeedback] = useState<string>('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  const audioPlayerRef = useRef<HTMLAudioElement>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Load saved visual prompts
      if (api?.getFacelessVisualPrompts) {
        const vRes = await api.getFacelessVisualPrompts();
        if (vRes?.success && vRes.data?.prompts && vRes.data.prompts.length > 0) {
          setPrompts(vRes.data.prompts);
        }
      }

      // 2. Load transcript segments from Step 2
      if (api?.getFacelessTranscript) {
        const tRes = await api.getFacelessTranscript();
        if (tRes?.success && tRes.data) {
          setTranscript(tRes.data);
        }
      }

      // 3. Load audio list for timecode seeking
      if (api?.listFacelessAudios) {
        const aRes = await api.listFacelessAudios();
        if (aRes?.success && aRes.audios) {
          setAudioList(aRes.audios);
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Gagal memuat data visual prompt.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Listen to real-time batch streaming progress from 9router AI
  useEffect(() => {
    if (!api?.onFacelessVisualStreamProgress) return;
    const cleanup = api.onFacelessVisualStreamProgress((data: FacelessVisualStreamProgress) => {
      if (data.type === 'start') {
        setIsGenerating(true);
        setStreamProgress({
          active: true,
          batchIndex: 0,
          totalBatches: data.totalBatches || 1,
          percent: 0,
          message: data.message || `Memulai streaming per ${data.batchSize || batchSize} baris...`,
          startLineNum: 1,
          endLineNum: data.batchSize || batchSize,
        });
      } else if (data.type === 'batch-start') {
        setIsGenerating(true);
        setStreamProgress((prev) => ({
          active: true,
          batchIndex: data.batchIndex || 1,
          totalBatches: data.totalBatches || prev?.totalBatches || 1,
          percent: typeof data.percent === 'number' ? data.percent : (prev?.percent || 0),
          message: data.message || `Memproses batch ${data.batchIndex}...`,
          startLineNum: data.startLineNum,
          endLineNum: data.endLineNum,
        }));
      } else if (data.type === 'batch-complete') {
        if (Array.isArray(data.newPrompts) && data.newPrompts.length > 0) {
          setPrompts((prev) => {
            const map = new Map(prev.map((item) => [item.index, item]));
            for (const item of data.newPrompts!) {
              map.set(item.index, item);
            }
            return Array.from(map.values()).sort((a, b) => a.index - b.index);
          });
        }
        setStreamProgress((prev) => ({
          active: true,
          batchIndex: data.batchIndex || 1,
          totalBatches: data.totalBatches || prev?.totalBatches || 1,
          percent: typeof data.percent === 'number' ? data.percent : (prev?.percent || 100),
          message: data.message || `Batch ${data.batchIndex} selesai!`,
          startLineNum: data.startLineNum,
          endLineNum: data.endLineNum,
        }));
      } else if (data.type === 'batch-error') {
        showToast(data.message || data.error || 'Terjadi kendala pada batch streaming.', 'error');
      } else if (data.type === 'complete') {
        setIsGenerating(false);
        setStreamProgress((prev) =>
          prev ? { ...prev, active: false, percent: 100, message: data.message || 'Selesai!' } : null
        );
        showToast(
          `🎉 Streaming selesai! Total ${data.totalPromptsCount || prompts.length} visual prompt berhasil digenerate via 9router!`,
          'success'
        );
      } else if (data.type === 'cancelled') {
        setIsGenerating(false);
        setStreamProgress((prev) =>
          prev ? { ...prev, active: false, message: data.message || 'Streaming dihentikan.' } : null
        );
        showToast(data.message || 'Streaming dihentikan. Prompt yang sudah masuk tersimpan aman di disk.', 'info');
      }
    });

    return () => cleanup();
  }, [batchSize, prompts.length]);

  const mainAudio = useMemo(() => {
    return audioList.find((a) => a.part === null || a.name.startsWith('voiceover')) || audioList[0] || null;
  }, [audioList]);

  // Cancel ongoing streaming
  const handleCancelStream = async () => {
    try {
      if (api?.cancelFacelessVisualStream) {
        await api.cancelFacelessVisualStream();
        showToast('Mengirim permintaan pembatalan streaming...', 'info');
      }
    } catch (err: any) {
      showToast(err.message || 'Gagal membatalkan streaming.', 'error');
    }
  };

  // Generate All Prompts in batches with real-time streaming
  const handleGenerateAll = async () => {
    setIsGenerating(true);
    try {
      if (!api?.generateFacelessVisualPrompts) {
        showToast('Fitur AI generate visual prompt tidak tersedia.', 'error');
        return;
      }

      const res = await api.generateFacelessVisualPrompts({
        lines: transcript?.segments || [],
        instructions: customInstructions.trim() || undefined,
        model: selectedModel,
        batchSize,
      });

      if (res?.success && res.data?.prompts) {
        setPrompts(res.data.prompts);
        showToast(
          `🎉 Berhasil menyelesaikan ${res.data.prompts.length} prompt gambar sesuai DNA Visual Si Kupluk Kuning!`,
          'success'
        );
      } else if (!res?.success) {
        showToast(res?.error || 'Gagal membuat visual prompt.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Terjadi kesalahan saat generate AI.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  // Save Prompts
  const handleSave = async (promptsToSave = prompts) => {
    if (promptsToSave.length === 0) return;
    setIsSaving(true);
    try {
      if (api?.saveFacelessVisualPrompts) {
        const res = await api.saveFacelessVisualPrompts(promptsToSave);
        if (res?.success) {
          showToast('💾 Visual prompts berhasil disimpan ke input/faceless/visual_prompts.json & .txt!', 'success');
        } else {
          showToast(res?.error || 'Gagal menyimpan.', 'error');
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Gagal menyimpan.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Update a single item's field and auto-recalculate prompt
  const handleUpdateItem = (
    id: string,
    field: 'templateType' | 'shotType' | 'sceneDescription' | 'finalPrompt',
    value: string
  ) => {
    setPrompts((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        const updated = { ...item, [field]: value };

        // If user altered template, shot, or sceneDesc, recalculate finalPrompt
        if (field !== 'finalPrompt') {
          const t = updated.templateType;
          const s = updated.shotType;
          const sc = updated.sceneDescription;
          updated.finalPrompt = t === 'A' ? TEMPLATE_A_BASE(sc, s) : TEMPLATE_B_BASE(sc, s);
        }

        return updated;
      })
    );
  };

  // Regenerate single prompt
  const handleRegenerateSingle = async (item: FacelessVisualPromptItem, instruction?: string) => {
    setRegeneratingId(item.id);
    try {
      if (!api?.regenerateSingleFacelessVisualPrompt) return;

      const res = await api.regenerateSingleFacelessVisualPrompt({
        item,
        customInstruction: instruction,
        model: selectedModel,
      });

      if (res?.success && res.item) {
        setPrompts((prev) => prev.map((p) => (p.id === item.id ? res.item! : p)));
        showToast(`✨ Adegan #${item.index} berhasil diregenerate!`, 'success');
        setSingleRegenModalItem(null);
        setSingleRegenFeedback('');
      } else {
        showToast(res?.error || 'Gagal me-regenerate adegan.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Gagal me-regenerate.', 'error');
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleCopyPrompt = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    showToast('📋 Prompt disalin ke clipboard!', 'success');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyAllPrompts = () => {
    if (prompts.length === 0) return;
    const allText = prompts
      .map(
        (p, idx) =>
          `#${idx + 1} | ${p.timecode} (${p.shotType}) [Template ${p.templateType}]\nNarasi: "${p.narration}"\nPrompt: ${p.finalPrompt}\n`
      )
      .join('\n');
    navigator.clipboard.writeText(allText);
    setCopiedAll(true);
    showToast(`📋 Seluruh ${prompts.length} prompt berhasil disalin!`, 'success');
    setTimeout(() => setCopiedAll(false), 2500);
  };

  const handleSeekAudio = (sec: number) => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.currentTime = sec;
      audioPlayerRef.current.play().catch(() => {});
      showToast(`⏱️ Audio melompat ke detik ${sec}s`, 'info');
    }
  };

  const handleOpenFolder = () => {
    if (api?.openInFolder) {
      api.openInFolder('input/faceless');
    }
  };

  // Filtered prompts
  const filteredPrompts = useMemo(() => {
    return prompts.filter((p) => {
      if (templateFilter !== 'ALL' && p.templateType !== templateFilter) return false;
      if (shotFilter !== 'ALL' && p.shotType !== shotFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesNarration = p.narration.toLowerCase().includes(q);
        const matchesScene = p.sceneDescription.toLowerCase().includes(q);
        const matchesTc = p.timecode.toLowerCase().includes(q);
        if (!matchesNarration && !matchesScene && !matchesTc) return false;
      }
      return true;
    });
  }, [prompts, templateFilter, shotFilter, searchQuery]);

  const countA = useMemo(() => prompts.filter((p) => p.templateType === 'A').length, [prompts]);
  const countB = useMemo(() => prompts.filter((p) => p.templateType === 'B').length, [prompts]);

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-24">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl shadow-2xl border text-xs font-bold flex items-center gap-2 backdrop-blur-md transition-all animate-bounce ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/50'
              : toast.type === 'error'
              ? 'bg-red-950/90 text-red-200 border-red-500/50'
              : 'bg-amber-950/90 text-amber-200 border-amber-500/50'
          }`}
        >
          <span>{toast.type === 'success' ? '✓' : toast.type === 'error' ? '⚠️' : 'ℹ️'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-gray-900/90 border border-gray-800 rounded-3xl p-6 shadow-2xl backdrop-blur-md relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 rounded-full bg-amber-950/80 text-amber-300 border border-amber-700/50 text-[11px] font-mono font-bold tracking-wider uppercase">
                🎨 Step 3: Visual Prompt Studio
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-yellow-950/80 text-yellow-300 text-[10px] font-mono border border-yellow-700/60 font-bold flex items-center gap-1">
                <span>🧢</span> Si Kupluk Kuning DNA
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 text-[10px] font-mono border border-emerald-600/60 font-bold flex items-center gap-1.5 shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>9router AI Connected</span>
              </span>
              {prompts.length > 0 && (
                <span className="px-2.5 py-0.5 rounded-full bg-sky-950/80 text-sky-300 text-[10px] font-mono border border-sky-700/60 font-bold">
                  ✓ {prompts.length} Prompt Siap
                </span>
              )}
            </div>

            <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <span>🖼️</span> Visual Prompt Studio (Per Line Transkrip)
            </h1>
            <p className="text-xs text-gray-400 leading-relaxed max-w-3xl">
              Membuat prompt gambar AI otomatis untuk setiap baris transkrip voiceover menggunakan aturan baku{' '}
              <strong className="text-amber-300 font-mono">Template A (Si Kupluk Kuning)</strong> dan{' '}
              <strong className="text-sky-300 font-mono">Template B (Objek/Lokasi/Zombie)</strong> untuk Nano Banana / Midjourney / Flux.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleOpenFolder}
              className="px-3.5 py-2 bg-gray-800/90 hover:bg-gray-700 text-amber-300 hover:text-amber-200 text-xs font-bold rounded-xl border border-gray-700 hover:border-amber-500/50 transition-all flex items-center gap-1.5 shadow-md"
            >
              <span>📁</span> Buka Folder Faceless
            </button>
            {onBackToAudio && (
              <button
                onClick={onBackToAudio}
                className="px-3.5 py-2 bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-semibold rounded-xl border border-gray-700 transition-all flex items-center gap-1.5"
              >
                <span>←</span> Step 2 (Audio & Transkrip)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Hidden audio player for timecode clicks */}
      {mainAudio?.url && (
        <audio ref={audioPlayerRef} src={mainAudio.url} className="hidden" preload="metadata" />
      )}

      {/* DNA Visual & Character Guide Cards (Collapsible) */}
      <div className="bg-gray-900/70 border border-gray-800 rounded-2xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-lg">📖</span>
            <div>
              <h3 className="text-xs font-bold text-amber-300 flex items-center gap-2">
                <span>Panduan Karakter Si Kupluk Kuning & DNA Visual Nano Banana</span>
                <span className="px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800/60 text-[10px] font-mono font-bold">
                  Template A & Template B
                </span>
              </h3>
              <p className="text-[10px] text-gray-400">
                Paten visual resmi untuk menjaga konsistensi karakter stickman 2D di setiap adegan.
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsGuideExpanded(!isGuideExpanded)}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-semibold rounded-xl border border-gray-700 transition-all flex items-center gap-1"
          >
            <span>{isGuideExpanded ? '▲ Sembunyikan Pedoman' : '▼ Lihat Pedoman Karakter & DNA Visual'}</span>
          </button>
        </div>

        {isGuideExpanded && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-gray-800">
            {/* Karakter Card */}
            <div className="bg-gray-950/90 border border-gray-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <img
                  src="/assets/faceless/si_kupluk_kuning.png"
                  alt="Si Kupluk Kuning"
                  className="w-16 h-20 object-contain rounded-lg border border-amber-500/30 bg-gray-900"
                  onError={(e) => {
                    // Fallback placeholder if asset not ready
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <div>
                  <span className="text-[10px] uppercase font-bold text-amber-400 font-mono tracking-wider">
                    KARAKTER UTAMA
                  </span>
                  <h4 className="text-sm font-black text-white">Si Kupluk Kuning</h4>
                  <p className="text-[11px] text-gray-400">
                    Satu-satunya karakter protagonis. Di prompt selalu ditulis sebagai{' '}
                    <code className="text-amber-300 font-mono">the stickman</code>.
                  </p>
                </div>
              </div>
              <ul className="text-[11px] text-gray-300 space-y-1 font-mono list-disc list-inside">
                <li>Kepala bulat putih, mata bulat pupil titik kecil, mulut datar (deadpan).</li>
                <li>Badan & anggota tubuh garis hitam tipis (tanpa baju, tanpa otot).</li>
                <li>Beanie <strong className="text-amber-400">mustard kuning</strong> & tas selempang <strong className="text-emerald-400">hijau army</strong>.</li>
                <li>Zombie: stickman abu-abu pucat, mata kosong, bungkuk.</li>
              </ul>
            </div>

            {/* Template Paten Card */}
            <div className="bg-gray-950/90 border border-gray-800 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-sky-400 font-mono tracking-wider">
                  FORMULA PROMPT BAKU
                </span>
                <span className="text-[10px] font-mono text-gray-400">Rasio 16:9 · 2D Flat Cartoon</span>
              </div>
              <div className="space-y-1.5 text-[11px]">
                <div className="p-2 rounded bg-amber-950/30 border border-amber-800/40 text-gray-300 font-mono text-[10px] leading-relaxed">
                  <strong className="text-amber-300">TEMPLATE A (Ada Si Kupluk Kuning):</strong>
                  <br />
                  2D flat hand-drawn stickman cartoon, thick black outlines, NOT realistic, NOT 3D, NOT anime. Stickman: round white head, two round white eyes with small black dot pupils, tiny neutral mouth, thin black stick body and limbs (no clothes, no muscles, no realistic anatomy), mustard yellow beanie, army green sling bag. Scene: [SCENE]. [SHOT]. Muted dark color palette, no text, no labels, 16:9.
                </div>
                <div className="p-2 rounded bg-sky-950/30 border border-sky-800/40 text-gray-300 font-mono text-[10px] leading-relaxed">
                  <strong className="text-sky-300">TEMPLATE B (Benda / Lokasi / Zombie):</strong>
                  <br />
                  2D flat hand-drawn stickman cartoon style, thick black outlines, NOT realistic, NOT 3D, NOT anime. Scene: [SCENE]. [SHOT]. Muted dark color palette, no text, no labels, 16:9.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Streaming Live Progress Banner */}
      {(isGenerating || streamProgress?.active) && (
        <div className="bg-gradient-to-r from-gray-900 via-amber-950/40 to-gray-900 border-2 border-amber-500/60 rounded-3xl p-5 shadow-2xl backdrop-blur-md relative overflow-hidden animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b border-amber-500/20">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black text-white flex items-center gap-2">
                    <span>⚡ Streaming Real-Time (9router AI)</span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold border border-amber-500/40">
                      Batch per {batchSize} baris
                    </span>
                  </h3>
                </div>
                <p className="text-xs text-amber-200/90 font-medium">
                  {streamProgress?.message || `Sedang memproses naskah dalam kelompok ${batchSize} baris...`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xs font-mono font-bold text-amber-300">
                  Batch {streamProgress?.batchIndex || 1} dari {streamProgress?.totalBatches || Math.ceil((transcript?.segments?.length || 1) / batchSize)}
                </div>
                <div className="text-[11px] text-gray-400 font-mono">
                  {prompts.length} / {transcript?.segments?.length || 0} Prompt Masuk
                </div>
              </div>

              <button
                onClick={handleCancelStream}
                className="px-3.5 py-2 bg-red-600/90 hover:bg-red-500 text-white font-bold text-xs rounded-xl border border-red-400/50 transition-all flex items-center gap-1.5 shadow-lg shadow-red-900/40 hover:scale-105 active:scale-95 cursor-pointer"
                title="Hentikan proses streaming sekarang (prompt yang sudah masuk tersimpan aman)"
              >
                <span>⏹️</span>
                <span>Hentikan Streaming</span>
              </button>
            </div>
          </div>

          {/* Live Progress Bar */}
          <div className="pt-3 space-y-1.5">
            <div className="flex justify-between items-center text-[10px] font-mono text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                <span>Kartu prompt langsung muncul di bawah secara bertahap</span>
              </span>
              <span className="text-amber-300 font-bold">{streamProgress?.percent || 0}% Selesai</span>
            </div>
            <div className="w-full h-2.5 bg-gray-950 rounded-full overflow-hidden border border-gray-800 p-0.5 shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-amber-500 via-yellow-400 to-emerald-400 rounded-full transition-all duration-300 shadow-sm"
                style={{ width: `${Math.min(100, Math.max(2, streamProgress?.percent || 0))}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* MAIN STUDIO AREA */}
      {prompts.length === 0 ? (
        /* Empty State: Ready to generate */
        <div className="bg-gray-900/80 border border-gray-800 rounded-3xl p-8 shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 rounded-3xl bg-amber-500/10 text-amber-400 border border-amber-500/30 mx-auto flex items-center justify-center text-3xl shadow-inner">
            🎨
          </div>

          <div className="space-y-2 max-w-xl mx-auto">
            <h2 className="text-xl font-black text-white">
              Visual Prompts Belum Dibuat
            </h2>
            <p className="text-xs text-gray-400 leading-relaxed">
              {transcript?.segments?.length ? (
                <>
                  Ditemukan <strong className="text-amber-300 font-mono">{transcript.segments.length} baris transkrip timecode</strong> dari Step 2. AI akan menganalisis setiap baris naskah, menentukan apakah Si Kupluk Kuning hadir (Template A) atau adegan lokasi/objek (Template B), serta menentukan shot sinematik terbaik.
                </>
              ) : (
                <>
                  Belum ada transkrip timecode dari Step 2. Kamu bisa kembali ke Step 2 untuk paste/upload transkrip terlebih dahulu.
                </>
              )}
            </p>
          </div>

          {/* Optional instructions */}
          <div className="max-w-xl mx-auto text-left space-y-1.5">
            <label className="text-[11px] font-bold text-gray-400">
              Instruksi Tambahan untuk Visual (Opsional):
            </label>
            <input
              type="text"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="Contoh: Suasana malam berkabut, supermarket gelap hanya diterangi senter..."
              className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-amber-500/80 font-sans"
            />
          </div>

          {/* 9router Model Selector */}
          <div className="max-w-xl mx-auto text-left space-y-1.5">
            <label className="text-[11px] font-bold text-gray-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Pilih Model AI (9router API):</span>
              </span>
              <span className="text-[10px] text-emerald-400 font-mono font-normal">
                https://9router.riztama.my.id/v1
              </span>
            </label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-amber-300 font-mono font-medium focus:outline-none focus:border-amber-500/80 cursor-pointer shadow-inner"
            >
              {NINEROUTER_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Batch Size Selector */}
          <div className="max-w-xl mx-auto text-left space-y-1.5">
            <label className="text-[11px] font-bold text-gray-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span>⚡ Mode Batch Streaming:</span>
              </span>
              <span className="text-[10px] text-amber-400 font-mono font-bold">
                Streaming Real-Time per Batch
              </span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { size: 3, label: '3 Baris (Cepat)' },
                { size: 5, label: '5 Baris (Optimal ⭐)' },
                { size: 10, label: '10 Baris' },
              ].map((b) => (
                <button
                  key={b.size}
                  type="button"
                  onClick={() => setBatchSize(b.size)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all text-center ${
                    batchSize === b.size
                      ? 'bg-amber-500 text-gray-950 border-amber-400 shadow-md shadow-amber-500/20'
                      : 'bg-gray-950 text-gray-400 border-gray-800 hover:text-gray-200 hover:border-gray-700'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-500 italic">
              * AI akan memproses naskah per {batchSize} baris. Kartu visual prompt akan langsung streaming muncul di layar setiap {batchSize} baris selesai tanpa harus menunggu semuanya!
            </p>
          </div>

          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleGenerateAll}
              disabled={isGenerating || !transcript?.segments?.length}
              className="px-6 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-gray-950 font-black text-sm shadow-xl shadow-amber-600/30 transition-all inline-flex items-center gap-2 cursor-pointer"
            >
              <span>{isGenerating ? '⏳ 9router Sedang Streaming Visual DNA...' : `⚡ Generate Streaming (Batch per ${batchSize} Baris)`}</span>
            </button>
            {isGenerating && (
              <button
                onClick={handleCancelStream}
                className="px-4 py-3 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-lg shadow-red-900/40 transition-all inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>⏹️</span>
                <span>Hentikan</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Prompts List View */
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="bg-gray-900/90 border border-gray-800 rounded-2xl p-4 shadow-xl flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="🔍 Cari baris narasi atau scene..."
                className="bg-gray-950 border border-gray-800 rounded-xl px-3 py-1.5 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-amber-500/80 w-60"
              />

              {/* 9router Model Selector */}
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-gray-950 border border-gray-800 rounded-xl px-2.5 py-1.5 text-xs text-amber-300 font-mono focus:outline-none focus:border-amber-500/80 cursor-pointer"
                title="Model 9router yang digunakan untuk generate & revisi prompt"
              >
                {NINEROUTER_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>

              {/* Batch Size Selector */}
              <select
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                className="bg-gray-950 border border-gray-800 rounded-xl px-2.5 py-1.5 text-xs text-amber-300 font-mono focus:outline-none focus:border-amber-500/80 cursor-pointer"
                title="Ukuran batch baris per panggilan AI streaming"
              >
                <option value={3}>Batch: 3 baris</option>
                <option value={5}>Batch: 5 baris (Optimal)</option>
                <option value={10}>Batch: 10 baris</option>
              </select>

              {/* Template filter */}
              <div className="flex items-center gap-1 bg-gray-950 border border-gray-800 rounded-xl p-1">
                <button
                  onClick={() => setTemplateFilter('ALL')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    templateFilter === 'ALL'
                      ? 'bg-amber-500 text-gray-950 shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  Semua ({prompts.length})
                </button>
                <button
                  onClick={() => setTemplateFilter('A')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    templateFilter === 'A'
                      ? 'bg-amber-500 text-gray-950 shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  🧢 Template A ({countA})
                </button>
                <button
                  onClick={() => setTemplateFilter('B')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    templateFilter === 'B'
                      ? 'bg-amber-500 text-gray-950 shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  🏙️ Template B ({countB})
                </button>
              </div>

              {/* Shot filter */}
              <select
                value={shotFilter}
                onChange={(e) => setShotFilter(e.target.value)}
                className="bg-gray-950 border border-gray-800 rounded-xl px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-amber-500/80"
              >
                <option value="ALL">Semua Shot</option>
                <option value="wide shot">Wide Shot</option>
                <option value="medium shot">Medium Shot</option>
                <option value="close-up shot">Close-Up Shot</option>
                <option value="top-down shot">Top-Down Shot</option>
              </select>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {isGenerating ? (
                <button
                  onClick={handleCancelStream}
                  className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-red-900/30 flex items-center gap-1.5 cursor-pointer animate-pulse"
                  title="Hentikan streaming AI sekarang"
                >
                  <span>⏹️</span>
                  <span>Hentikan Streaming</span>
                </button>
              ) : (
                <button
                  onClick={handleGenerateAll}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-amber-300 text-xs font-bold rounded-xl border border-gray-700 transition-all flex items-center gap-1.5 cursor-pointer"
                  title="Generate ulang seluruh adegan secara streaming dalam batch"
                >
                  <span>🔄 Generate Ulang (Batch {batchSize})</span>
                </button>
              )}
              <button
                onClick={handleCopyAllPrompts}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-sky-300 text-xs font-bold rounded-xl border border-sky-800/50 transition-all flex items-center gap-1.5"
              >
                <span>{copiedAll ? '✓ Tersalin!' : '📋 Salin Semua Prompt'}</span>
              </button>
              <button
                onClick={() => handleSave()}
                disabled={isSaving}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-emerald-700/20 flex items-center gap-1.5"
              >
                <span>{isSaving ? '⏳ Menyimpan...' : '💾 Simpan Perubahan'}</span>
              </button>
            </div>
          </div>

          {/* Cards List */}
          <div className="space-y-4">
            {filteredPrompts.map((item) => {
              const isTemplateA = item.templateType === 'A';
              const isRegeneratingThis = regeneratingId === item.id;

              return (
                <div
                  key={item.id}
                  className={`bg-gray-900/90 border rounded-2xl p-5 shadow-xl space-y-3.5 transition-all ${
                    isTemplateA ? 'border-amber-500/40 hover:border-amber-500/70' : 'border-sky-500/40 hover:border-sky-500/70'
                  }`}
                >
                  {/* Top line header */}
                  <div className="flex items-center justify-between gap-3 flex-wrap border-b border-gray-800/80 pb-3">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="w-7 h-7 rounded-lg bg-gray-800 text-amber-300 border border-gray-700 flex items-center justify-center text-xs font-mono font-bold">
                        #{item.index}
                      </span>

                      {/* Timecode seek badge */}
                      <button
                        onClick={() => handleSeekAudio(item.seconds)}
                        className="px-2.5 py-0.5 rounded-lg bg-gray-800 hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 border border-gray-700 font-mono text-xs font-bold transition-all flex items-center gap-1"
                        title="Dengarkan narasi di detik ini"
                      >
                        <span>▶</span>
                        <span>{item.timecode}</span>
                      </button>

                      {/* Template Selector Button Group */}
                      <div className="flex items-center bg-gray-950 border border-gray-800 rounded-lg p-0.5">
                        <button
                          onClick={() => handleUpdateItem(item.id, 'templateType', 'A')}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all ${
                            isTemplateA
                              ? 'bg-amber-500 text-gray-950 shadow-sm'
                              : 'text-gray-400 hover:text-gray-200'
                          }`}
                        >
                          🧢 Template A (Kupluk Kuning)
                        </button>
                        <button
                          onClick={() => handleUpdateItem(item.id, 'templateType', 'B')}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all ${
                            !isTemplateA
                              ? 'bg-sky-500 text-gray-950 shadow-sm'
                              : 'text-gray-400 hover:text-gray-200'
                          }`}
                        >
                          🏙️ Template B (Objek/Lokasi)
                        </button>
                      </div>

                      {/* Shot Type Dropdown */}
                      <select
                        value={item.shotType}
                        onChange={(e) => handleUpdateItem(item.id, 'shotType', e.target.value)}
                        className="bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-0.5 text-[11px] text-gray-200 font-mono focus:outline-none focus:border-amber-500/80"
                      >
                        {SHOT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Quick action buttons */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setSingleRegenModalItem(item)}
                        disabled={isRegeneratingThis}
                        className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-amber-300 text-xs font-semibold rounded-lg border border-gray-700 transition-all flex items-center gap-1"
                        title="Revisi atau regenerate scene ini dengan prompt khusus"
                      >
                        <span>🔄</span>
                        <span>Revisi AI</span>
                      </button>
                      <button
                        onClick={() => handleCopyPrompt(item.id, item.finalPrompt)}
                        className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-gray-950 text-xs font-bold rounded-lg transition-all shadow-sm flex items-center gap-1"
                      >
                        <span>{copiedId === item.id ? '✓ Tersalin!' : '📋 Salin Prompt'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Indonesian Narration Quote */}
                  <div className="text-xs text-gray-300 bg-gray-950/60 border border-gray-800/80 rounded-xl p-3 flex items-start gap-2">
                    <span className="text-amber-400 text-sm leading-none shrink-0">💬</span>
                    <p className="leading-relaxed font-sans font-medium">
                      "{item.narration}"
                    </p>
                  </div>

                  {/* Scene Description input */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-gray-400 uppercase font-bold tracking-wider flex items-center justify-between">
                      <span>Scene Description (Bahasa Inggris):</span>
                      <span className="text-gray-500 font-normal">Maksimal 3 elemen latar</span>
                    </label>
                    <input
                      type="text"
                      value={item.sceneDescription}
                      onChange={(e) => handleUpdateItem(item.id, 'sceneDescription', e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-1.5 text-xs text-amber-200 font-mono focus:outline-none focus:border-amber-500/80"
                    />
                  </div>

                  {/* Final Full Prompt Display */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono">
                      <span>FINAL AI PROMPT (NANO BANANA / MIDJOURNEY):</span>
                      <button
                        onClick={() => handleCopyPrompt(item.id, item.finalPrompt)}
                        className="text-amber-400 hover:underline font-bold"
                      >
                        Copy
                      </button>
                    </div>
                    <div className="p-3 rounded-xl bg-gray-950 border border-gray-800/80 text-[11px] font-mono text-gray-300 leading-relaxed break-words select-all selection:bg-amber-500 selection:text-black">
                      {item.finalPrompt}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal / Dialog for Single Line Revision */}
      {singleRegenModalItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6 max-w-lg w-full space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>🔄</span>
                <span>Revisi Adegan #{singleRegenModalItem.index} ({singleRegenModalItem.timecode})</span>
              </h3>
              <button
                onClick={() => setSingleRegenModalItem(null)}
                className="text-gray-400 hover:text-white text-xs font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-gray-300 bg-gray-950 p-3 rounded-xl border border-gray-800 font-sans">
              "{singleRegenModalItem.narration}"
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-gray-300">
                Instruksi Revisi Khusus:
              </label>
              <textarea
                value={singleRegenFeedback}
                onChange={(e) => setSingleRegenFeedback(e.target.value)}
                placeholder="Contoh: Ubah jadi close-up gembok baja berkarat, atau buat Si Kupluk Kuning memegang senter..."
                rows={3}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-amber-500/80 leading-relaxed font-sans"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setSingleRegenModalItem(null)}
                className="px-3.5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold rounded-xl"
              >
                Batal
              </button>
              <button
                onClick={() => handleRegenerateSingle(singleRegenModalItem, singleRegenFeedback)}
                disabled={regeneratingId === singleRegenModalItem.id}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-gray-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-600/20"
              >
                {regeneratingId === singleRegenModalItem.id ? '⏳ Merancang...' : 'Generate Revisi ➔'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <div className="flex items-center justify-between gap-3 pt-4 border-t border-gray-800">
        {onBackToAudio && (
          <button
            onClick={onBackToAudio}
            className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-bold rounded-xl border border-gray-700 transition-all flex items-center gap-1.5"
          >
            <span>←</span> Kembali ke Step 2 (Audio & Transkrip)
          </button>
        )}

        <div className="flex items-center gap-2">
          {prompts.length > 0 && (
            <button
              onClick={() => handleSave()}
              disabled={isSaving}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-emerald-700/20 flex items-center gap-1.5"
            >
              <span>💾</span> Simpan Seluruh Visual Prompts
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FacelessVisualStep;
