// dashboard/src/components/humanologi/HumanologiVisualMappingStep.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import type {
  HumanologiAudioItem,
  HumanologiScenesData,
  HumanologiScene,
  HumanologiTranscriptPartData,
} from '../../electron-api';

const api = window.electronAPI;

interface HumanologiNarasiPart {
  part: number;
  judul_bagian?: string;
  total_karakter?: number;
  teks?: string;
}

interface HumanologiNarasiData {
  judul_video?: string;
  total_part?: number;
  narasi: HumanologiNarasiPart[];
}

interface HumanologiVisualMappingStepProps {
  onBackToTranscript?: () => void;
}

function formatDuration(sec?: number): string {
  if (!sec || isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const HumanologiVisualMappingStep: React.FC<HumanologiVisualMappingStepProps> = ({
  onBackToTranscript,
}) => {
  const [activePart, setActivePart] = useState<number>(1);
  const [narasiData, setNarasiData] = useState<HumanologiNarasiData | null>(null);
  const [audioList, setAudioList] = useState<HumanologiAudioItem[]>([]);
  const [transcripts, setTranscripts] = useState<Record<number, HumanologiTranscriptPartData>>({});
  const [scenesData, setScenesData] = useState<Record<number, HumanologiScenesData>>({});
  const [loading, setLoading] = useState<boolean>(true);

  // 9router Generation & Real-time Streaming State
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>('ag/gemini-3-flash');
  const [streamProgress, setStreamProgress] = useState<{
    batchNum: number;
    totalBatches: number;
    percent: number;
    message: string;
    logText: string;
  }>({
    batchNum: 0,
    totalBatches: 0,
    percent: 0,
    message: '',
    logText: '',
  });
  const streamLogRef = useRef<HTMLPreElement | null>(null);

  // Google Flow Playwright Automation State
  const [isGeneratingImages, setIsGeneratingImages] = useState<boolean>(false);
  const [concurrency, setConcurrency] = useState<number>(5);
  const [headedMode, setHeadedMode] = useState<boolean>(true);
  const [activeGeneratingScenes, setActiveGeneratingScenes] = useState<number[]>([]);
  const [flowLogs, setFlowLogs] = useState<string>('');
  const [showFlowLogs, setShowFlowLogs] = useState<boolean>(false);
  const [flowProgress, setFlowProgress] = useState<{
    current: number;
    total: number;
    percent: number;
    lastScene: number;
    status: string;
  }>({
    current: 0,
    total: 0,
    percent: 0,
    lastScene: 0,
    status: '',
  });
  const flowLogRef = useRef<HTMLPreElement | null>(null);
  const [selectedImageForPreview, setSelectedImageForPreview] = useState<{
    url: string;
    sceneNumber: number;
    prompt: string;
  } | null>(null);

  // Master Prompt Modal
  const [showPromptModal, setShowPromptModal] = useState<boolean>(false);
  const [masterPromptText, setMasterPromptText] = useState<string>('');

  // Audio Playback
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const activeCardRef = useRef<HTMLDivElement | null>(null);

  // Search filter
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Copy feedback tracking
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Load initial data
  const loadAllData = async () => {
    setLoading(true);
    try {
      if (api?.getLatestHumanologiNarasi) {
        const nRes = await api.getLatestHumanologiNarasi();
        if (nRes?.success && nRes.data) setNarasiData(nRes.data);
      }
      if (api?.listHumanologiAudios) {
        const aRes = await api.listHumanologiAudios();
        if (aRes?.success && aRes.audios) setAudioList(aRes.audios);
      }
      if (api?.listHumanologiTranscripts) {
        const tRes = await api.listHumanologiTranscripts();
        if (tRes?.success && tRes.transcripts) setTranscripts(tRes.transcripts);
      }
      // Load scenes for all parts (1 to 3)
      if (api?.getHumanologiScenes) {
        const newScenesMap: Record<number, HumanologiScenesData> = {};
        for (let p = 1; p <= 3; p++) {
          const sRes = await api.getHumanologiScenes(p);
          if (sRes?.success && sRes.data) {
            newScenesMap[p] = sRes.data;
          }
        }
        setScenesData(newScenesMap);
      }
      // Load master prompt
      if (api?.getHumanologiVisualScenesPrompt) {
        const pRes = await api.getHumanologiVisualScenesPrompt();
        if (pRes?.success && pRes.prompt) {
          setMasterPromptText(pRes.prompt);
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Gagal memuat data.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // Listen to 9router streaming events
  useEffect(() => {
    if (api?.onHumanologiScenesStreamProgress) {
      const cleanup = api.onHumanologiScenesStreamProgress((data) => {
        if (data.type === 'start') {
          setIsGenerating(true);
          setStreamProgress({
            batchNum: 1,
            totalBatches: data.totalBatches || 1,
            percent: 0,
            message: data.message || 'Memulai...',
            logText: `[9router Stream] Memulai proses untuk ${data.totalScenes || 0} adegan...\n`,
          });
        } else if (data.type === 'batch-start') {
          setStreamProgress((prev) => ({
            ...prev,
            batchNum: data.batchNum || prev.batchNum,
            totalBatches: data.totalBatches || prev.totalBatches,
            percent: data.percent ?? prev.percent,
            message: data.message || `Memproses batch ${data.batchNum}...`,
            logText: prev.logText + `\n>>> [Batch ${data.batchNum}/${data.totalBatches}] ${data.message}\n`,
          }));
        } else if (data.type === 'chunk') {
          setStreamProgress((prev) => ({
            ...prev,
            logText: prev.logText + (data.delta || ''),
          }));
          // Auto scroll stream terminal
          if (streamLogRef.current) {
            streamLogRef.current.scrollTop = streamLogRef.current.scrollHeight;
          }
        } else if (data.type === 'batch-done') {
          setStreamProgress((prev) => ({
            ...prev,
            percent: data.percent ?? prev.percent,
            message: data.message || `Batch selesai.`,
            logText: prev.logText + `\n✓ ${data.message} (${data.newScenesCount || 0} adegan terurai sejauh ini)\n`,
          }));
        } else if (data.type === 'completed') {
          setIsGenerating(false);
          setStreamProgress((prev) => ({
            ...prev,
            percent: 100,
            message: data.message || 'Selesai!',
            logText: prev.logText + `\n\n🎉 [9router] Selesai! Semua adegan berhasil disimpan ke disk.\n`,
          }));
          if (data.data && data.part) {
            setScenesData((prev) => ({ ...prev, [data.part!]: data.data! }));
          }
          showToast(`Sukses! ${data.message || 'Visual scenes berhasil dibuat.'}`, 'success');
        } else if (data.type === 'error') {
          setIsGenerating(false);
          setStreamProgress((prev) => ({
            ...prev,
            message: `Error: ${data.message}`,
            logText: prev.logText + `\n\n❌ [Error] ${data.message}\n`,
          }));
          showToast(data.message || 'Terjadi kesalahan pada 9router streaming.', 'error');
        }
      });
      return cleanup;
    }
  }, []);

  // Listen to Google Flow Playwright Image Generation events
  useEffect(() => {
    if (!api) return;

    const unsubStart = api.onHumanologiImageStart?.((data) => {
      if (data.part === activePart) {
        setActiveGeneratingScenes((prev) => Array.from(new Set([...prev, data.sceneNumber])));
        setFlowLogs((prev) => prev + `\n[Scene #${data.sceneNumber}] 🚀 Dimulai di Google Flow slot...`);
        if (flowLogRef.current) {
          flowLogRef.current.scrollTop = flowLogRef.current.scrollHeight;
        }
      }
    });

    const unsubLog = api.onHumanologiImageLog?.((data) => {
      if (data.part === activePart) {
        setFlowLogs((prev) => prev + `\n[Scene #${data.sceneNumber}] ${data.text}`);
        if (flowLogRef.current) {
          flowLogRef.current.scrollTop = flowLogRef.current.scrollHeight;
        }
      }
    });

    const unsubProg = api.onHumanologiImageProgress?.((data) => {
      if (data.part === activePart) {
        setActiveGeneratingScenes((prev) => prev.filter((id) => id !== data.sceneNumber));
        if (data.status === 'success' && data.imageUrl) {
          setScenesData((prev) => {
            const partScenes = prev[activePart];
            if (!partScenes) return prev;
            const updated = partScenes.scenes.map((s) => {
              if (s.scene_number === data.sceneNumber) {
                return { ...s, image_url: data.imageUrl, image_path: data.filePath };
              }
              return s;
            });
            return { ...prev, [activePart]: { ...partScenes, scenes: updated } };
          });
          setFlowLogs((prev) => prev + `\n[Scene #${data.sceneNumber}] ✅ Berhasil disimpan ke disk: ${data.filePath || ''}`);
        } else if (data.status === 'error') {
          setFlowLogs((prev) => prev + `\n[Scene #${data.sceneNumber}] ❌ Gagal: ${data.error || 'Error'}`);
        }

        setFlowProgress({
          current: data.current,
          total: data.total,
          percent: Math.round((data.current / Math.max(1, data.total)) * 100),
          lastScene: data.sceneNumber,
          status: data.status,
        });

        if (flowLogRef.current) {
          flowLogRef.current.scrollTop = flowLogRef.current.scrollHeight;
        }
      }
    });

    return () => {
      unsubStart?.();
      unsubLog?.();
      unsubProg?.();
    };
  }, [activePart]);

  // Current audio, transcript, and scenes for active part
  const currentAudio = useMemo(() => {
    return audioList.find((a) => a.part === activePart);
  }, [audioList, activePart]);

  const currentTranscript = useMemo(() => {
    return transcripts[activePart];
  }, [transcripts, activePart]);

  const currentScenesData = useMemo(() => {
    return scenesData[activePart];
  }, [scenesData, activePart]);

  const scenesList: HumanologiScene[] = useMemo(() => {
    return currentScenesData?.scenes || [];
  }, [currentScenesData]);

  const audioDuration = useMemo(() => {
    return (
      currentScenesData?.audio_duration ||
      currentTranscript?.audio_duration ||
      currentAudio?.duration ||
      0
    );
  }, [currentScenesData, currentTranscript, currentAudio]);

  // Determine active scene based on audio currentTime
  const activeScene = useMemo(() => {
    if (!scenesList.length) return null;
    const found = scenesList.find((s) => {
      const start = s.start_seconds ?? 0;
      const end = s.end_seconds ?? start + (s.durasi_detik || 2);
      return currentTime >= start && currentTime < end;
    });
    return found || (currentTime === 0 ? scenesList[0] : null);
  }, [scenesList, currentTime]);

  // Scroll active scene card into view when playing
  useEffect(() => {
    if (isPlaying && activeCardRef.current) {
      activeCardRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeScene?.scene_number, isPlaying]);

  // Handle Seek Audio
  const handleSeek = (sec: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = sec;
      setCurrentTime(sec);
      if (!isPlaying) {
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    }
  };

  // Run 9router Scene Generation
  const handleGenerateScenes = async () => {
    if (!currentTranscript || !currentTranscript.entries || currentTranscript.entries.length === 0) {
      showToast(
        `Transkrip kata Part #${activePart} belum ada. Silakan jalankan Faster-Whisper di Step 3 terlebih dahulu.`,
        'error'
      );
      return;
    }

    setIsGenerating(true);
    setStreamProgress({
      batchNum: 0,
      totalBatches: 0,
      percent: 0,
      message: `Menghubungkan ke 9router (${selectedModel})...`,
      logText: `[Inisialisasi] Mempersiapkan naskah & transkrip Part #${activePart}...\n`,
    });

    try {
      if (api?.generateHumanologiScenes9Router) {
        const res = await api.generateHumanologiScenes9Router(activePart, selectedModel);
        if (res?.success && res.data) {
          setScenesData((prev) => ({ ...prev, [activePart]: res.data! }));
        } else if (res?.error) {
          showToast(res.error, 'error');
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Terjadi kesalahan saat memanggil 9router.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  // Copy single prompt
  const handleCopyPrompt = (scene: HumanologiScene) => {
    navigator.clipboard.writeText(scene.image_prompt);
    setCopiedId(scene.scene_number);
    showToast(`Prompt Scene #${scene.scene_number} tersalin ke clipboard!`, 'success');
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Copy all prompts in batch
  const handleCopyAllPrompts = () => {
    if (!scenesList.length) return;
    const formatted = scenesList
      .map(
        (s) =>
          `[SCENE #${s.scene_number}] (${s.durasi_detik}s) "${s.potongan_narasi}"\nPrompt: ${s.image_prompt}`
      )
      .join('\n\n---\n\n');

    navigator.clipboard.writeText(formatted);
    showToast(`Berhasil menyalin seluruh ${scenesList.length} prompt gambar Part #${activePart}!`, 'success');
  };

  const scenesWithImagesCount = useMemo(() => {
    return scenesList.filter((s) => Boolean(s.image_url)).length;
  }, [scenesList]);

  // Run Google Flow batch generation
  const handleStartFlowGeneration = async (specificSceneNumber?: number) => {
    if (!api?.generateHumanologiFlowImages) {
      showToast('API generateHumanologiFlowImages tidak tersedia.', 'error');
      return;
    }

    if (!scenesList.length) {
      showToast('Belum ada visual scenes. Silakan generate scenes terlebih dahulu.', 'error');
      return;
    }

    setIsGeneratingImages(true);
    setShowFlowLogs(true);
    setFlowLogs((prev) =>
      prev +
      (specificSceneNumber
        ? `\n\n========================================\n🚀 [Google Flow] Generate Tunggal Scene #${specificSceneNumber}...\n========================================\n`
        : `\n\n========================================\n🚀 [Google Flow] Memulai Batch Runner Part #${activePart} (Concurrency: ${concurrency}, Model: Nano Banana Pro)...\n========================================\n`)
    );

    try {
      const res = await api.generateHumanologiFlowImages({
        part: activePart,
        concurrency: concurrency,
        sceneNumbers: specificSceneNumber ? [specificSceneNumber] : undefined,
        overwriteExisting: specificSceneNumber ? true : false,
        headed: headedMode,
      });

      if (res.success) {
        showToast(`Selesai! Berhasil memproses ${res.completed || 0} gambar Google Flow.`, 'success');
      } else if (res.message) {
        showToast(res.message, 'info');
      } else {
        showToast(res.error || 'Gagal generate gambar.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Terjadi kesalahan saat generate gambar.', 'error');
    } finally {
      setIsGeneratingImages(false);
      if (api?.getHumanologiScenes) {
        const sRes = await api.getHumanologiScenes(activePart);
        if (sRes?.success && sRes.data) {
          setScenesData((prev) => ({ ...prev, [activePart]: sRes.data! }));
        }
      }
    }
  };

  const handleCancelFlowGeneration = async () => {
    if (!api?.cancelHumanologiFlowImages) return;
    try {
      await api.cancelHumanologiFlowImages();
      showToast('Perintah stop terkirim ke runner.', 'info');
      setIsGeneratingImages(false);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  // Filtered scenes
  const filteredScenes = useMemo(() => {
    if (!searchQuery.trim()) return scenesList;
    const q = searchQuery.toLowerCase();
    return scenesList.filter(
      (s) =>
        s.scene_number?.toString() === q ||
        (s.potongan_narasi || '').toLowerCase().includes(q) ||
        (s.deskripsi_visual_singkat || '').toLowerCase().includes(q) ||
        (s.image_prompt || '').toLowerCase().includes(q)
    );
  }, [scenesList, searchQuery]);

  const parts = useMemo(() => {
    return narasiData?.narasi || [{ part: 1 }, { part: 2 }, { part: 3 }];
  }, [narasiData]);

  return (
    <div className="space-y-5">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-2xl text-xs font-semibold flex items-center gap-2 border transition-all animate-slideDown ${
            toast.type === 'success'
              ? 'bg-emerald-950 border-emerald-500 text-emerald-200'
              : toast.type === 'error'
              ? 'bg-red-950 border-red-500 text-red-200'
              : 'bg-blue-950 border-blue-500 text-blue-200'
          }`}
        >
          <span>{toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Hidden HTML5 Audio */}
      {currentAudio?.url && (
        <audio
          ref={audioRef}
          src={currentAudio.url}
          preload="metadata"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            setCurrentTime(0);
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        />
      )}

      {/* ─── TOP HEADER & CONTROLS ─────────────────────────────────────────── */}
      <div className="bg-gray-900/90 border border-gray-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🎨</span>
              <h2 className="text-base font-bold text-white">
                Visual Mapping & Documentary Prompts Studio
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800">
                Step 4 of 4
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Potongan adegan visual pendek (3–6 kata), sinkronisasi durasi audio persis kata per kata, dan prompt gambar dokumenter (Stickman/Semi-Chibi) 16:9 via 9router.
            </p>
          </div>

          {/* Action Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Model Selector */}
            <div className="flex items-center gap-1.5 bg-gray-950 px-2.5 py-1.5 rounded-xl border border-gray-800 text-xs">
              <span className="text-gray-500 font-mono text-[10px]">Model:</span>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={isGenerating}
                className="bg-transparent text-emerald-300 font-mono text-xs focus:outline-none cursor-pointer"
              >
                <option value="ag/gemini-3-flash" className="bg-gray-900 text-white">
                  ag/gemini-3-flash (9router)
                </option>
                <option value="ag/gemini-2.5-flash" className="bg-gray-900 text-white">
                  ag/gemini-2.5-flash
                </option>
              </select>
            </div>

            {/* View Master Prompt Button */}
            <button
              type="button"
              onClick={() => setShowPromptModal(true)}
              className="px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-750 border border-gray-700 text-xs font-semibold text-gray-200 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>📜</span>
              <span>Master Prompt</span>
            </button>

            {/* Copy All Prompts Button */}
            {scenesList.length > 0 && (
              <button
                type="button"
                onClick={handleCopyAllPrompts}
                className="px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-750 border border-gray-700 text-xs font-semibold text-gray-200 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>📋</span>
                <span>Copy Semua Prompt ({scenesList.length})</span>
              </button>
            )}

            {/* Generate Scenes Button */}
            <button
              type="button"
              onClick={handleGenerateScenes}
              disabled={isGenerating || !currentTranscript}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-lg ${
                isGenerating
                  ? 'bg-gray-800 text-gray-400 cursor-wait'
                  : currentTranscript
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30 cursor-pointer'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed'
              }`}
              title={
                !currentTranscript
                  ? 'Jalankan transcript Faster-Whisper di Step 3 terlebih dahulu'
                  : 'Generate visual scenes & streaming prompt via 9router'
              }
            >
              <span>{isGenerating ? '⏳' : '⚡'}</span>
              <span>
                {isGenerating
                  ? 'Streaming 9router...'
                  : scenesList.length > 0
                  ? 'Re-generate Scenes (Streaming)'
                  : 'Generate Visual Scenes'}
              </span>
            </button>
          </div>
        </div>

        {/* Part Tabs Selector */}
        <div className="flex items-center gap-2 pt-2 border-t border-gray-800 overflow-x-auto">
          {parts.map((p) => {
            const sc = scenesData[p.part];
            const count = sc?.scenes?.length || 0;
            const hasAudio = audioList.some((a) => a.part === p.part);
            const isActive = activePart === p.part;

            return (
              <button
                key={p.part}
                onClick={() => {
                  if (audioRef.current) {
                    audioRef.current.pause();
                    setIsPlaying(false);
                    audioRef.current.currentTime = 0;
                    setCurrentTime(0);
                  }
                  setActivePart(p.part);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all border shrink-0 flex items-center gap-2 ${
                  isActive
                    ? 'bg-emerald-600 border-emerald-500 text-white shadow-md'
                    : 'bg-gray-950 border-gray-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                <span>Part #{p.part}</span>
                {hasAudio && <span className="text-[10px] text-emerald-300">🎙️</span>}
                <span className="text-[10px] font-mono opacity-80">
                  ({count > 0 ? `${count} scenes` : 'kosong'})
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── REAL-TIME STREAMING PROGRESS & TERMINAL BANNER ─────────────────── */}
      {isGenerating && (
        <div className="bg-gray-950 border border-emerald-500/40 rounded-2xl p-4 shadow-2xl space-y-3 animate-fadeIn">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
              <span className="font-bold text-white font-mono">
                Streaming 9router ({selectedModel})
              </span>
              {streamProgress.batchNum > 0 && (
                <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-mono">
                  Batch {streamProgress.batchNum} / {streamProgress.totalBatches}
                </span>
              )}
            </div>

            <span className="font-mono text-xs font-bold text-emerald-400">
              {streamProgress.percent}%
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              style={{ width: `${streamProgress.percent}%` }}
              className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
            />
          </div>

          <div className="text-[11px] text-gray-300 font-mono flex items-center justify-between">
            <span className="truncate">{streamProgress.message || 'Menerima streaming tokens...'}</span>
            <span className="text-gray-500 shrink-0 ml-2">Live Token Stream</span>
          </div>

          {/* Real-time Streaming Terminal Console */}
          <pre
            ref={streamLogRef}
            className="p-3 rounded-xl bg-black/90 border border-gray-800 font-mono text-[11px] text-emerald-400 max-h-36 overflow-y-auto whitespace-pre-wrap selection:bg-emerald-900 break-words leading-relaxed"
          >
            {streamProgress.logText || 'Menunggu respons awal dari 9router...'}
          </pre>
        </div>
      )}

      {/* ─── SIMPLE AUDIO PLAYER BAR (RINGKAS & NYAMAN) ─────────────────────── */}
      <div className="p-3.5 bg-gray-900/90 border border-gray-800 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (!audioRef.current) return;
              if (isPlaying) {
                audioRef.current.pause();
              } else {
                audioRef.current.play().catch(() => {});
              }
            }}
            disabled={!currentAudio}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              isPlaying
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            } disabled:bg-gray-800 disabled:text-gray-500`}
          >
            <span>{isPlaying ? '⏸ Pause' : '▶ Play Audio'}</span>
          </button>

          <span className="font-mono text-xs text-gray-300 shrink-0">
            {formatDuration(currentTime)} / {formatDuration(audioDuration)}
          </span>
        </div>

        {/* Seekbar */}
        <div
          className="flex-1 min-w-[180px] max-w-lg h-2.5 bg-gray-800 rounded-full overflow-hidden cursor-pointer relative"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            handleSeek(pos * audioDuration);
          }}
        >
          <div
            style={{
              width: `${audioDuration > 0 ? (currentTime / audioDuration) * 100 : 0}%`,
            }}
            className="h-full bg-emerald-500 transition-all rounded-full"
          />
        </div>

        {/* Active Scene Chip Indicator */}
        {activeScene && (
          <div
            onClick={() => handleSeek(activeScene.start_seconds || 0)}
            className="flex items-center gap-2 text-xs bg-gray-950 px-3 py-1.5 rounded-xl border border-emerald-800/70 font-mono text-emerald-300 cursor-pointer hover:border-emerald-500 transition-all"
            title="Klik untuk loncat ke awal adegan ini"
          >
            <span className="font-bold shrink-0">#{activeScene.scene_number}</span>
            <span className="text-gray-300 truncate max-w-[180px] sm:max-w-[280px]">
              "{activeScene.potongan_narasi}"
            </span>
            <span className="text-[10px] text-emerald-400 font-bold shrink-0">
              ({activeScene.durasi_detik}s)
            </span>
          </div>
        )}
      </div>

      {/* ─── GOOGLE FLOW PLAYWRIGHT BATCH IMAGE GENERATOR PANEL ───────────── */}
      <div className="bg-gradient-to-r from-gray-950 via-gray-900 to-gray-950 border border-emerald-900/60 rounded-2xl p-5 shadow-2xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl">🍌</span>
              <h3 className="text-base font-bold text-white">
                Google Flow Image Automation (Playwright)
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-950 text-amber-300 border border-amber-800">
                Nano Banana Pro & Banana 2
              </span>
            </div>
            <p className="text-xs text-gray-400">
              Otomasi browser headless/headed menginput prompt langsung ke Google Flow dengan rolling queue concurrent 5 slot, auto-download CDN fifeUrl, dan simpan permanen ke <code className="text-emerald-400 font-mono">input/humanologi/images/part_{activePart}/</code>.
            </p>
          </div>

          {/* Generator Controls */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Concurrency Selector */}
            <div className="flex items-center gap-1.5 bg-gray-900 px-3 py-1.5 rounded-xl border border-gray-800 text-xs">
              <span className="text-gray-400 text-[11px] font-mono">Batch Slot:</span>
              <select
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                disabled={isGeneratingImages}
                className="bg-transparent text-emerald-300 font-mono text-xs font-bold focus:outline-none cursor-pointer"
              >
                <option value={1} className="bg-gray-900 text-white">1 (Sequential)</option>
                <option value={3} className="bg-gray-900 text-white">3 Slot</option>
                <option value={5} className="bg-gray-900 text-white">5 Slot (Rekomendasi)</option>
                <option value={8} className="bg-gray-900 text-white">8 Slot (Cepat)</option>
              </select>
            </div>

            {/* Headed Mode Toggle */}
            <label className="flex items-center gap-2 text-xs text-gray-300 bg-gray-900 px-3 py-1.5 rounded-xl border border-gray-800 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={headedMode}
                onChange={(e) => setHeadedMode(e.target.checked)}
                disabled={isGeneratingImages}
                className="accent-emerald-500 rounded cursor-pointer"
              />
              <span className="font-mono text-[11px]">Buka Chrome Window</span>
            </label>

            {/* Log Console Toggle */}
            <button
              type="button"
              onClick={() => setShowFlowLogs((prev) => !prev)}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all border cursor-pointer ${
                showFlowLogs
                  ? 'bg-gray-800 border-gray-700 text-emerald-300'
                  : 'bg-gray-950 border-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              <span>{showFlowLogs ? '▼ Sembunyikan Log' : '▶ Buka Terminal Log'}</span>
            </button>

            {/* Cancel Button */}
            {isGeneratingImages && (
              <button
                type="button"
                onClick={handleCancelFlowGeneration}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-lg shadow-red-600/30 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <span>⏹️</span>
                <span>Stop</span>
              </button>
            )}

            {/* Start Button */}
            <button
              type="button"
              onClick={() => handleStartFlowGeneration()}
              disabled={isGeneratingImages || scenesList.length === 0}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 shadow-lg ${
                isGeneratingImages
                  ? 'bg-gray-800 text-gray-400 cursor-wait'
                  : scenesList.length === 0
                  ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/30 cursor-pointer active:scale-95'
              }`}
            >
              <span>{isGeneratingImages ? '⏳' : '🎨'}</span>
              <span>
                {isGeneratingImages
                  ? `Sedang Generate (${activeGeneratingScenes.length} Slot Aktif)...`
                  : scenesWithImagesCount === scenesList.length && scenesList.length > 0
                  ? 'Re-generate Semua Gambar'
                  : `Generate Semua Gambar (${scenesList.length - scenesWithImagesCount} Tersisa)`}
              </span>
            </button>
          </div>
        </div>

        {/* Status Metrics & Progress Bar */}
        <div className="space-y-2 bg-gray-950/80 p-3.5 rounded-xl border border-gray-800/80">
          <div className="flex flex-wrap items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-3">
              <span className="text-gray-400">Status Progress:</span>
              <span className="font-bold text-emerald-400">
                {scenesWithImagesCount} / {scenesList.length} Gambar Selesai ({Math.round((scenesWithImagesCount / Math.max(1, scenesList.length)) * 100)}%)
              </span>
              {activeGeneratingScenes.length > 0 && (
                <span className="text-amber-400 font-semibold animate-pulse">
                  • Slot Aktif: {activeGeneratingScenes.map((id) => `#${id}`).join(', ')}
                </span>
              )}
            </div>

            <div className="text-gray-500 text-[11px]">
              Tersimpan di: <code className="text-gray-300">input/humanologi/images/part_{activePart}/</code>
            </div>
          </div>

          <div className="w-full h-2.5 bg-gray-900 rounded-full overflow-hidden border border-gray-800">
            <div
              style={{
                width: `${Math.round((scenesWithImagesCount / Math.max(1, scenesList.length)) * 100)}%`,
              }}
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
            />
          </div>
        </div>

        {/* Real-time Flow Terminal Logs */}
        {showFlowLogs && (
          <div className="rounded-xl bg-black border border-gray-800 overflow-hidden shadow-inner">
            <div className="p-2.5 bg-gray-950 border-b border-gray-800 flex items-center justify-between text-[11px] font-mono text-gray-400">
              <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <span>💻</span> Playwright Google Flow Console Output
              </span>
              <button
                type="button"
                onClick={() => setFlowLogs('')}
                className="text-gray-500 hover:text-gray-300 text-[10px] cursor-pointer"
              >
                Clear Log
              </button>
            </div>
            <pre
              ref={flowLogRef}
              className="p-3 text-[11px] font-mono text-emerald-300/90 max-h-48 overflow-y-auto leading-relaxed whitespace-pre-wrap selection:bg-emerald-900"
            >
              {flowLogs || 'Menunggu eksekusi Google Flow generator...'}
            </pre>
          </div>
        )}
      </div>

      {/* ─── SCENES TIMELINE & PROMPT CARDS LIST ────────────────────────────── */}
      <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-800 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white uppercase font-mono tracking-wider">
              Daftar Adegan Visual ({scenesList.length} Scenes)
            </span>
            {scenesList.length > 0 && (
              <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-mono">
                Rata-rata 3–6 kata / adegan
              </span>
            )}
          </div>

          {/* Search Filter */}
          <div className="w-full sm:w-64">
            <input
              type="text"
              placeholder="Cari narasi atau nomor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {filteredScenes.length === 0 ? (
          <div className="py-12 text-center text-xs text-gray-500 border border-dashed border-gray-800 rounded-xl space-y-2">
            <div>
              {scenesList.length === 0
                ? `Belum ada visual scenes untuk Part #${activePart}.`
                : 'Tidak ada adegan yang sesuai dengan pencarian.'}
            </div>
            {scenesList.length === 0 && (
              <div>
                Klik tombol <strong>"Generate Visual Scenes"</strong> di atas untuk memecah adegan secara otomatis via 9router streaming.
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1.5">
            {filteredScenes.map((scene) => {
              const isActive = activeScene?.scene_number === scene.scene_number;
              const isCopied = copiedId === scene.scene_number;

              return (
                <div
                  key={scene.scene_number}
                  ref={isActive ? activeCardRef : null}
                  className={`p-4 rounded-xl border transition-all space-y-2.5 ${
                    isActive
                      ? 'bg-emerald-950/70 border-emerald-500 shadow-lg ring-1 ring-emerald-400'
                      : 'bg-gray-950/70 border-gray-800 hover:border-gray-700'
                  }`}
                >
                  {/* Card Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                          isActive
                            ? 'bg-emerald-500 text-black'
                            : 'bg-gray-800 text-gray-300'
                        }`}
                      >
                        #{scene.scene_number}
                      </span>

                      <span className="text-xs font-bold text-white">
                        "{scene.potongan_narasi}"
                      </span>
                    </div>

                    <div className="flex items-center gap-2 font-mono text-[10px]">
                      <span className="px-2 py-0.5 rounded bg-gray-900 border border-gray-800 text-emerald-400">
                        ⏱️ {scene.start_seconds}s - {scene.end_seconds}s
                      </span>
                      <span className="px-2 py-0.5 rounded bg-gray-900 border border-gray-800 text-cyan-300 font-bold">
                        Durasi: {scene.durasi_detik}s
                      </span>
                      {scene.durasi_kata_total !== undefined && (
                        <span className="px-2 py-0.5 rounded bg-gray-900 border border-gray-800 text-gray-400 hidden sm:inline">
                          Kata: {scene.durasi_kata_total}s
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Main Body: Left Prompt + Right Image Preview */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
                    {/* Left Column: Brief & Prompt Box */}
                    <div className="lg:col-span-8 space-y-2">
                      {/* Context & Sentence Reference */}
                      {scene.konteks_kalimat && (
                        <div className="text-[11px] text-gray-400 bg-gray-900/60 p-2 rounded-lg border border-gray-800/80 flex items-start gap-1.5 leading-relaxed">
                          <span className="text-amber-400 shrink-0 font-bold not-italic">📖 Konteks:</span>
                          <span className="italic text-gray-300">"{scene.konteks_kalimat}"</span>
                        </div>
                      )}

                      {/* Visual Brief Description */}
                      <div className="text-xs text-gray-300 flex items-start gap-1.5">
                        <span className="text-emerald-400 shrink-0">🎬</span>
                        <span>{scene.deskripsi_visual_singkat}</span>
                      </div>

                      {/* AI Image Prompt Box */}
                      <div className="p-3 rounded-xl bg-gray-900/90 border border-gray-800/90 space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-mono text-gray-400">
                          <span className="text-emerald-400 font-bold uppercase tracking-wider">
                            Prompt AI Image (Whiteboard Doodle 16:9):
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyPrompt(scene)}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer ${
                              isCopied
                                ? 'bg-emerald-600 text-white'
                                : 'bg-gray-800 hover:bg-gray-700 text-gray-200'
                            }`}
                          >
                            <span>{isCopied ? '✓' : '📋'}</span>
                            <span>{isCopied ? 'Tersalin!' : 'Copy Prompt'}</span>
                          </button>
                        </div>

                        <div className="text-[11px] font-mono text-gray-300 leading-relaxed break-words selection:bg-emerald-800">
                          {scene.image_prompt}
                        </div>
                      </div>

                      {/* Card Audio Actions */}
                      <div className="flex items-center gap-3 pt-1 text-xs">
                        <button
                          type="button"
                          onClick={() => handleSeek(scene.start_seconds || 0)}
                          className="text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <span>▶</span>
                          <span>Play Audio Adegan Ini ({scene.start_seconds}s)</span>
                        </button>
                      </div>
                    </div>

                    {/* Right Column: Image Preview Box */}
                    <div className="lg:col-span-4 bg-gray-900/90 border border-gray-800 rounded-xl overflow-hidden p-2.5 flex flex-col items-center justify-center min-h-[140px] relative">
                      {scene.image_url ? (
                        <div className="w-full space-y-2">
                          <div
                            className="w-full aspect-video rounded-lg overflow-hidden bg-black/60 border border-gray-800 relative group cursor-pointer shadow"
                            onClick={() =>
                              setSelectedImageForPreview({
                                url: scene.image_url!,
                                sceneNumber: scene.scene_number,
                                prompt: scene.image_prompt,
                              })
                            }
                          >
                            <img
                              src={scene.image_url}
                              alt={`Scene #${scene.scene_number}`}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                              <span className="text-white text-xs font-bold bg-black/70 px-2 py-1 rounded-md">
                                🔍 Perbesar
                              </span>
                            </div>
                            <div className="absolute top-1 right-1 bg-emerald-600/90 text-white text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shadow">
                              ✓ Ready
                            </div>
                          </div>
                          <div className="flex items-center justify-between w-full text-[10px] font-mono pt-0.5">
                            <span className="text-gray-400 truncate max-w-[130px]">
                              scene_{String(scene.scene_number).padStart(3, '0')}.png
                            </span>
                            <button
                              type="button"
                              onClick={() => handleStartFlowGeneration(scene.scene_number)}
                              disabled={isGeneratingImages}
                              className="text-emerald-400 hover:text-emerald-300 hover:underline cursor-pointer disabled:opacity-50 font-bold"
                            >
                              🔄 Re-generate
                            </button>
                          </div>
                        </div>
                      ) : activeGeneratingScenes.includes(scene.scene_number) ? (
                        <div className="w-full aspect-video rounded-lg bg-emerald-950/40 border border-emerald-500/50 flex flex-col items-center justify-center gap-2 p-3 text-center animate-pulse">
                          <span className="text-2xl animate-spin">⏳</span>
                          <span className="text-[11px] font-mono font-bold text-emerald-300">
                            Sedang Diproses...
                          </span>
                          <span className="text-[9px] text-gray-400">
                            Google Flow slot aktif
                          </span>
                        </div>
                      ) : (
                        <div className="w-full aspect-video rounded-lg bg-gray-950/60 border border-dashed border-gray-800 flex flex-col items-center justify-center gap-2 p-3 text-center">
                          <span className="text-xl text-gray-600">🖼️</span>
                          <span className="text-[10px] text-gray-400">Belum ada gambar</span>
                          <button
                            type="button"
                            onClick={() => handleStartFlowGeneration(scene.scene_number)}
                            disabled={isGeneratingImages}
                            className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-emerald-700 text-gray-200 hover:text-white text-[10px] font-bold border border-gray-700 transition-all cursor-pointer disabled:opacity-50"
                          >
                            ⚡ Generate Gambar
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── FOOTER NAVIGATION ────────────────────────────────────────────── */}
      <div className="p-4 rounded-2xl bg-gray-900/90 border border-gray-800 flex items-center justify-between text-xs">
        {onBackToTranscript && (
          <button
            type="button"
            onClick={onBackToTranscript}
            className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-750 text-gray-200 font-bold transition-all cursor-pointer"
          >
            ← Kembali ke Step 3: Audio Transcript
          </button>
        )}

        <div className="text-gray-400 font-mono text-[11px]">
          Target File: <span className="text-emerald-400">input/humanologi/scenes/part_{activePart}_scenes.json</span>
        </div>
      </div>

      {/* ─── MASTER PROMPT MODAL ───────────────────────────────────────────── */}
      {showPromptModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl animate-scaleUp">
            <div className="p-4 border-b border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">📜</span>
                <h3 className="text-sm font-bold text-white">Master Prompt Visual Scenes Humanologi</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPromptModal(false)}
                className="text-gray-400 hover:text-white text-lg p-1 rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto font-mono text-xs text-gray-300 leading-relaxed whitespace-pre-wrap selection:bg-emerald-800">
              {masterPromptText || 'Prompt master tidak ditemukan.'}
            </div>

            <div className="p-3.5 border-t border-gray-800 bg-gray-950 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(masterPromptText);
                  showToast('Master prompt tersalin ke clipboard!', 'success');
                }}
                className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-xs font-semibold text-gray-200 cursor-pointer"
              >
                📋 Copy Master Prompt
              </button>
              <button
                type="button"
                onClick={() => setShowPromptModal(false)}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── IMAGE ENLARGED PREVIEW MODAL ──────────────────────────────── */}
      {selectedImageForPreview && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-scaleUp">
            <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-950">
              <div className="flex items-center gap-2">
                <span className="text-lg">🖼️</span>
                <h3 className="text-sm font-bold text-white">
                  Preview Gambar Scene #{selectedImageForPreview.sceneNumber}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedImageForPreview(null)}
                className="text-gray-400 hover:text-white text-lg p-1.5 rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 flex flex-col items-center justify-center bg-black/60 overflow-y-auto space-y-4">
              <div className="w-full max-h-[60vh] flex items-center justify-center overflow-hidden rounded-xl bg-black border border-gray-800">
                <img
                  src={selectedImageForPreview.url}
                  alt={`Scene #${selectedImageForPreview.sceneNumber}`}
                  className="max-h-[60vh] max-w-full object-contain rounded-lg"
                />
              </div>

              <div className="w-full p-3 rounded-xl bg-gray-950 border border-gray-800 text-left space-y-1">
                <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase">
                  Image Prompt:
                </span>
                <p className="text-xs font-mono text-gray-300 leading-relaxed">
                  {selectedImageForPreview.prompt}
                </p>
              </div>
            </div>

            <div className="p-3.5 border-t border-gray-800 bg-gray-950 flex justify-end gap-2">
              <a
                href={selectedImageForPreview.url}
                download={`scene_${String(selectedImageForPreview.sceneNumber).padStart(3, '0')}.png`}
                className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-xs font-semibold text-gray-200 cursor-pointer flex items-center gap-1.5"
              >
                <span>⬇️</span> Download File PNG
              </a>
              <button
                type="button"
                onClick={() => setSelectedImageForPreview(null)}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HumanologiVisualMappingStep;
