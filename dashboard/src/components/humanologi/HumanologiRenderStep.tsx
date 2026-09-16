// dashboard/src/components/humanologi/HumanologiRenderStep.tsx
import React, { useState, useEffect, useRef } from 'react';
import type {
  HumanologiPartReadiness,
  HumanologiRenderReadinessResult,
  HumanologiRenderProgressData,
} from '../../electron-api';

const api = window.electronAPI;

interface HumanologiRenderStepProps {
  onBackToVisual?: () => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDuration(sec?: number): string {
  if (!sec || isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const HumanologiRenderStep: React.FC<HumanologiRenderStepProps> = ({
  onBackToVisual,
}) => {
  const [activePart, setActivePart] = useState<number>(1);
  const [readiness, setReadiness] = useState<HumanologiRenderReadinessResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Settings
  const [enableSubtitles, setEnableSubtitles] = useState<boolean>(true);
  const [enableKenBurns, setEnableKenBurns] = useState<boolean>(true);
  const [concurrency, setConcurrency] = useState<number>(4);

  // Rendering state
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [renderingPart, setRenderingPart] = useState<number | null>(null);
  const [renderProgress, setRenderProgress] = useState<{
    percent: number;
    message: string;
    currentScene?: number;
    totalScenes?: number;
    stage?: string;
  }>({
    percent: 0,
    message: '',
  });

  // Merging state
  const [isMerging, setIsMerging] = useState<boolean>(false);
  const [mergeProgress, setMergeProgress] = useState<{
    percent: number;
    message: string;
  }>({
    percent: 0,
    message: '',
  });

  // Logs terminal
  const [logs, setLogs] = useState<Array<{ id: string; time: string; text: string; isError?: boolean }>>([
    {
      id: 'init',
      time: new Date().toLocaleTimeString('id-ID', { hour12: false }),
      text: 'Humanologi 16:9 Video Render Studio siap.',
    },
  ]);
  const [showTerminal, setShowTerminal] = useState<boolean>(true);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  // Video preview player
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>('');
  const videoPlayerRef = useRef<HTMLVideoElement | null>(null);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const addLog = (text: string, isError = false) => {
    const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
    const id = Math.random().toString(36).substring(2, 9);
    setLogs((prev) => [...prev.slice(-300), { id, time, text, isError }]);
  };

  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs]);

  // Fetch readiness data
  const loadReadiness = async () => {
    try {
      if (api?.getHumanologiRenderReadiness) {
        const res = await api.getHumanologiRenderReadiness();
        if (res?.success) {
          setReadiness(res);
          // Set initial video preview if active part is rendered
          const curr = res.parts.find((p) => p.part === activePart);
          if (curr?.isRendered && curr.videoUrl && !previewVideoUrl) {
            setPreviewVideoUrl(curr.videoUrl);
            setPreviewTitle(`Preview Video Part ${curr.part}`);
          }
        }
      }
    } catch (err: any) {
      console.error('Failed to load render readiness:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReadiness();
  }, []);

  // Update preview video when active part changes
  useEffect(() => {
    if (readiness) {
      const curr = readiness.parts.find((p) => p.part === activePart);
      if (curr?.isRendered && curr.videoUrl) {
        setPreviewVideoUrl(curr.videoUrl);
        setPreviewTitle(`Preview Video Part ${curr.part}`);
      }
    }
  }, [activePart, readiness]);

  // Subscribe to real-time render progress
  useEffect(() => {
    if (!api?.onHumanologiRenderProgress) return;
    const unsub = api.onHumanologiRenderProgress((data: HumanologiRenderProgressData) => {
      if (data.rawLine) {
        addLog(data.rawLine, data.isError);
      }

      if (data.stage === 'done') {
        if (data.part === 0) {
          // Merge done
          setIsMerging(false);
          setMergeProgress({ percent: 100, message: data.message });
          showToast('Full Video Humanologi berhasil digabungkan!', 'success');
          if (data.mediaUrl) {
            setPreviewVideoUrl(data.mediaUrl);
            setPreviewTitle('Preview Full Video Humanologi (16:9 Final)');
          }
          loadReadiness();
        } else {
          // Part done
          setIsRendering(false);
          setRenderingPart(null);
          setRenderProgress({ percent: 100, message: data.message });
          showToast(`Video Part ${data.part} sukses dirender!`, 'success');
          if (data.mediaUrl) {
            setPreviewVideoUrl(data.mediaUrl);
            setPreviewTitle(`Preview Video Part ${data.part}`);
          }
          loadReadiness();
        }
        return;
      }

      if (data.stage === 'error') {
        setIsRendering(false);
        setIsMerging(false);
        setRenderingPart(null);
        showToast(data.message || 'Proses render gagal', 'error');
        addLog(`❌ ERROR: ${data.message}`, true);
        return;
      }

      if (data.part === 0) {
        // Merge progress
        const pct = typeof data.progress === 'number' ? Math.round(data.progress * 100) : 50;
        setMergeProgress({ percent: pct, message: data.message });
      } else {
        // Part progress
        const pct = typeof data.progress === 'number' ? Math.round(data.progress * 100) : renderProgress.percent;
        setRenderProgress({
          percent: pct,
          message: data.message,
          currentScene: data.currentScene,
          totalScenes: data.totalScenes,
          stage: data.stage,
        });
      }
    });

    return () => {
      if (unsub) unsub();
    };
  }, [activePart, readiness]);

  // Start rendering active part
  const handleRenderPart = async () => {
    if (isRendering || isMerging) return;
    if (!api?.renderHumanologiPart) {
      showToast('API renderHumanologiPart tidak tersedia', 'error');
      return;
    }

    const currentStatus = readiness?.parts.find((p) => p.part === activePart);
    if (!currentStatus) return;

    if (!currentStatus.audioExists) {
      showToast(`Audio voiceover untuk Part ${activePart} belum diupload!`, 'error');
      return;
    }

    setIsRendering(true);
    setRenderingPart(activePart);
    setRenderProgress({
      percent: 0,
      message: `Memulai render Part ${activePart}...`,
      currentScene: 0,
      totalScenes: currentStatus.totalScenes,
    });
    addLog(`🎬 [Render Request] Memulai render Part ${activePart} (Subtitles: ${enableSubtitles}, Ken Burns: ${enableKenBurns})`);

    try {
      const res = await api.renderHumanologiPart({
        part: activePart,
        enableSubtitles,
        kenBurns: enableKenBurns,
        concurrency,
      });

      if (!res.success) {
        showToast(res.error || `Render Part ${activePart} gagal`, 'error');
        addLog(`❌ [Render Error] ${res.error}`, true);
        setIsRendering(false);
        setRenderingPart(null);
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
      addLog(`❌ Exception: ${err.message}`, true);
      setIsRendering(false);
      setRenderingPart(null);
    }
  };

  // Start merging all parts into full video
  const handleMergeFull = async () => {
    if (isRendering || isMerging) return;
    if (!api?.mergeHumanologiFull) {
      showToast('API mergeHumanologiFull tidak tersedia', 'error');
      return;
    }

    const renderedParts = readiness?.parts.filter((p) => p.isRendered) || [];
    if (renderedParts.length < 2) {
      showToast('Minimal 2 part video harus selesai dirender sebelum digabungkan!', 'error');
      return;
    }

    setIsMerging(true);
    setMergeProgress({ percent: 15, message: 'Menyiapkan penggabungan video full...' });
    addLog(`✨ [Merge Request] Menggabungkan ${renderedParts.length} video part menjadi satu full movie...`);

    try {
      const res = await api.mergeHumanologiFull();
      if (!res.success) {
        showToast(res.error || 'Penggabungan Full Video gagal', 'error');
        addLog(`❌ [Merge Error] ${res.error}`, true);
        setIsMerging(false);
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
      addLog(`❌ Exception: ${err.message}`, true);
      setIsMerging(false);
    }
  };

  const currentPartData = readiness?.parts.find((p) => p.part === activePart);
  const renderedCount = readiness?.parts.filter((p) => p.isRendered).length || 0;
  const totalParts = readiness?.parts.length || 3;
  const canMerge = renderedCount >= 2;

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-2xl text-xs font-bold border flex items-center gap-2 animate-slideUp ${
            toast.type === 'success'
              ? 'bg-emerald-950/95 border-emerald-500/60 text-emerald-200'
              : toast.type === 'error'
              ? 'bg-rose-950/95 border-rose-500/60 text-rose-200'
              : 'bg-gray-900/95 border-gray-700 text-gray-200'
          }`}
        >
          <span>{toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Top Banner Studio */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-emerald-950/40 to-slate-950 border border-emerald-800/40 p-6 shadow-2xl">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-900/70 border border-emerald-500/40 flex items-center justify-center text-3xl shadow-xl shadow-emerald-950/60 shrink-0">
              🎬
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-extrabold text-white tracking-tight">
                  Humanologi Video Render Studio
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  16:9 FFmpeg Engine
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30">
                  Dynamic Ken Burns
                </span>
              </div>
              <p className="text-xs text-gray-400 max-w-2xl leading-relaxed">
                Rangkai gambar adegan bergerak dinamis (slow zoom & pan), selaraskan audio narator voiceover presisi
                kata per kata, opsi subtitle dokumenter, dan gabungkan seluruh part menjadi video YouTube 16:9 siap publikasi.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={loadReadiness}
              disabled={loading || isRendering || isMerging}
              className="px-3.5 py-2 rounded-xl bg-gray-900/80 hover:bg-gray-800 border border-gray-700 text-xs font-semibold text-gray-300 hover:text-white transition-all flex items-center gap-1.5 cursor-pointer shadow"
            >
              <span>🔄</span> Refresh Status
            </button>
          </div>
        </div>

        {/* Part Selection Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-6 pt-5 border-t border-emerald-900/30">
          {readiness?.parts.map((pStatus) => {
            const isSelected = pStatus.part === activePart;
            const isCurrentlyRendering = isRendering && renderingPart === pStatus.part;

            return (
              <button
                key={pStatus.part}
                onClick={() => setActivePart(pStatus.part)}
                className={`flex flex-col p-3 rounded-xl border text-left transition-all relative overflow-hidden ${
                  isSelected
                    ? 'bg-emerald-950/80 border-emerald-400 text-white shadow-lg shadow-emerald-950/50'
                    : 'bg-gray-950/60 border-gray-800/80 text-gray-400 hover:border-gray-700 hover:bg-gray-900/60'
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>Part {pStatus.part}</span>
                    {isCurrentlyRendering && (
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                    )}
                  </span>
                  {pStatus.isRendered ? (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      ✅ Rendered
                    </span>
                  ) : pStatus.imagesPercent === 100 && pStatus.audioExists ? (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                      ⚡ Ready
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      ⚠️ Incomplete
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between text-[11px] text-gray-400 font-mono">
                  <span>🖼️ {pStatus.readyImages} / {pStatus.totalScenes}</span>
                  <span>🎙️ {formatDuration(pStatus.audioDuration)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Grid: Left Controls & Status, Right Video Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Readiness Audit & Render Controls */}
        <div className="lg:col-span-6 space-y-6">
          {/* Readiness Card for Active Part */}
          <div className="rounded-2xl bg-gray-900/90 border border-gray-800 p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <span>📋</span> Status Kesiapan Part {activePart}
              </h2>
              <span className="text-[11px] font-mono text-gray-400">
                {currentPartData?.totalScenes || 0} Adegan Total
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              {/* Audio Status */}
              <div className="p-3 rounded-xl bg-gray-950/80 border border-gray-800/80 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-mono text-gray-400 font-bold">Voiceover Audio</span>
                  <span className={currentPartData?.audioExists ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                    {currentPartData?.audioExists ? '✅ Ready' : '❌ Missing'}
                  </span>
                </div>
                <div className="text-white font-semibold truncate">
                  {currentPartData?.audioFileName || 'Belum diupload'}
                </div>
                <div className="text-[10px] font-mono text-gray-400">
                  Durasi: {formatDuration(currentPartData?.audioDuration)}
                </div>
              </div>

              {/* Images Status */}
              <div className="p-3 rounded-xl bg-gray-950/80 border border-gray-800/80 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-mono text-gray-400 font-bold">Gambar AI 16:9</span>
                  <span className={currentPartData?.imagesPercent === 100 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                    {currentPartData?.imagesPercent || 0}% Ready
                  </span>
                </div>
                <div className="text-white font-semibold">
                  {currentPartData?.readyImages || 0} / {currentPartData?.totalScenes || 0} File
                </div>
                <div className="text-[10px] font-mono text-gray-400">
                  Folder: images/part_{activePart}/
                </div>
              </div>
            </div>

            {/* Video File Status If Rendered */}
            {currentPartData?.isRendered && (
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/50 flex items-center justify-between text-xs">
                <div className="space-y-0.5">
                  <div className="text-emerald-300 font-bold flex items-center gap-1.5">
                    <span>🎬</span> File MP4 Part {activePart} Tersedia
                  </div>
                  <div className="text-[10px] font-mono text-gray-400">
                    Ukuran: {formatBytes(currentPartData.videoSize)} • output/humanologi/part_{activePart}.mp4
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (currentPartData.videoUrl) {
                      setPreviewVideoUrl(currentPartData.videoUrl);
                      setPreviewTitle(`Preview Video Part ${activePart}`);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs cursor-pointer shadow transition-all"
                >
                  Putar Preview ▶
                </button>
              </div>
            )}
          </div>

          {/* Render Settings & Triggers */}
          <div className="rounded-2xl bg-gray-900/90 border border-gray-800 p-5 space-y-5 shadow-xl">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <span>⚙️</span> Opsi & Pengaturan Render
            </h2>

            <div className="space-y-3">
              {/* Ken Burns Toggle */}
              <label className="flex items-center justify-between p-3 rounded-xl bg-gray-950/60 border border-gray-800/80 cursor-pointer hover:border-gray-700 transition-all">
                <div className="space-y-0.5 pr-4">
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>✨</span> Dynamic Ken Burns Motion
                  </div>
                  <p className="text-[11px] text-gray-400 leading-tight">
                    Animasi zoom-in, zoom-out, dan panning dinamis bergantian per adegan agar video sinematik dan tidak kaku.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={enableKenBurns}
                  onChange={(e) => setEnableKenBurns(e.target.checked)}
                  disabled={isRendering}
                  className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500 cursor-pointer accent-emerald-500"
                />
              </label>

              {/* Subtitles Toggle */}
              <label className="flex items-center justify-between p-3 rounded-xl bg-gray-950/60 border border-gray-800/80 cursor-pointer hover:border-gray-700 transition-all">
                <div className="space-y-0.5 pr-4">
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>📝</span> Clean Documentary Subtitles
                  </div>
                  <p className="text-[11px] text-gray-400 leading-tight">
                    Burn-in teks subtitle tipografi sans-serif bersih dengan outline halus di sepertiga bawah layar (16:9).
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={enableSubtitles}
                  onChange={(e) => setEnableSubtitles(e.target.checked)}
                  disabled={isRendering}
                  className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500 cursor-pointer accent-emerald-500"
                />
              </label>

              {/* Concurrency Selector */}
              <div className="p-3 rounded-xl bg-gray-950/60 border border-gray-800/80 flex items-center justify-between text-xs">
                <div className="space-y-0.5">
                  <span className="font-bold text-white">Parallel Workers:</span>
                  <p className="text-[11px] text-gray-400">Jumlah worker CPU untuk proses adegan secara simultan</p>
                </div>
                <select
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  disabled={isRendering}
                  className="px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-white text-xs font-mono font-bold focus:outline-none focus:border-emerald-500"
                >
                  <option value={2}>2 Workers (Hemat CPU)</option>
                  <option value={4}>4 Workers (Optimal)</option>
                  <option value={6}>6 Workers (Cepat)</option>
                  <option value={8}>8 Workers (Turbo Max)</option>
                </select>
              </div>
            </div>

            {/* Render Button & Live Progress */}
            <div className="pt-2 space-y-3">
              <button
                type="button"
                onClick={handleRenderPart}
                disabled={isRendering || isMerging || !currentPartData?.audioExists}
                className={`w-full py-3.5 px-4 rounded-xl font-extrabold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xl ${
                  isRendering && renderingPart === activePart
                    ? 'bg-amber-600 text-white animate-pulse'
                    : !currentPartData?.audioExists
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'
                    : 'bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-950/60'
                }`}
              >
                {isRendering && renderingPart === activePart ? (
                  <>
                    <span className="animate-spin text-base">⏳</span>
                    <span>Merender Part {activePart} ({renderProgress.percent}%)...</span>
                  </>
                ) : (
                  <>
                    <span className="text-base">🎬</span>
                    <span>
                      {currentPartData?.isRendered
                        ? `Render Ulang Video Part ${activePart} (16:9)`
                        : `Mulai Render Video Part ${activePart} (16:9)`}
                    </span>
                  </>
                )}
              </button>

              {/* Progress Bar */}
              {isRendering && renderingPart === activePart && (
                <div className="space-y-1.5 p-3 rounded-xl bg-gray-950 border border-emerald-900/60 animate-fadeIn">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-emerald-400 font-bold truncate max-w-[280px]">
                      {renderProgress.message || 'Memproses video...'}
                    </span>
                    <span className="text-white font-bold">{renderProgress.percent}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300 rounded-full"
                      style={{ width: `${Math.min(100, Math.max(0, renderProgress.percent))}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Merge Full Video Studio Card */}
          <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-teal-950/30 to-gray-900 border border-teal-800/40 p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">✨</span>
                <h2 className="text-sm font-bold text-white">Merge Full Video Studio</h2>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/30 font-bold">
                {renderedCount} / {totalParts} Part Ready
              </span>
            </div>

            <p className="text-xs text-gray-400 leading-relaxed">
              Gabungkan seluruh video part (Part 1, 2, dst.) yang sudah dirender menjadi satu video final utuh
              berdurasi panjang untuk YouTube 16:9 secara instan (lossless concat demuxer).
            </p>

            {readiness?.fullVideo?.isRendered && (
              <div className="p-3 rounded-xl bg-teal-950/40 border border-teal-800/50 flex items-center justify-between text-xs">
                <div className="space-y-0.5">
                  <span className="text-teal-300 font-bold flex items-center gap-1.5">
                    <span>🎉</span> Full Video Siap Publikasi!
                  </span>
                  <div className="text-[10px] font-mono text-gray-400">
                    Ukuran: {formatBytes(readiness.fullVideo.size)} • output/humanologi/humanologi_full_video.mp4
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (readiness.fullVideo.url) {
                      setPreviewVideoUrl(readiness.fullVideo.url);
                      setPreviewTitle('Preview Full Video Humanologi (Final 16:9)');
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs cursor-pointer shadow transition-all"
                >
                  Putar Full Video ▶
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleMergeFull}
              disabled={!canMerge || isRendering || isMerging}
              className={`w-full py-3 px-4 rounded-xl font-extrabold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg ${
                isMerging
                  ? 'bg-amber-600 text-white animate-pulse'
                  : canMerge
                  ? 'bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white shadow-teal-950/60'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'
              }`}
            >
              {isMerging ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>Menggabungkan Full Video ({mergeProgress.percent}%)...</span>
                </>
              ) : (
                <>
                  <span>✨</span>
                  <span>Merge Seluruh Part Menjadi Full Video (16:9)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Column: HTML5 Video Preview Player & Live Console Logs */}
        <div className="lg:col-span-6 space-y-6">
          {/* Video Player Card */}
          <div className="rounded-2xl bg-gray-900/90 border border-gray-800 overflow-hidden shadow-2xl space-y-0">
            <div className="p-4 border-b border-gray-800 bg-gray-950/80 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <h3 className="text-xs font-bold text-white truncate">
                  {previewTitle || '16:9 Video Live Preview Player'}
                </h3>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-gray-800 text-gray-300 font-bold shrink-0">
                1080p 16:9
              </span>
            </div>

            {/* HTML5 Video Screen */}
            <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden group">
              {previewVideoUrl ? (
                <video
                  ref={videoPlayerRef}
                  key={previewVideoUrl}
                  controls
                  className="w-full h-full object-contain"
                  src={previewVideoUrl}
                >
                  Browser Anda tidak mendukung HTML5 video.
                </video>
              ) : (
                <div className="text-center p-8 space-y-3">
                  <div className="w-16 h-16 rounded-2xl bg-gray-900 border border-gray-800 flex items-center justify-center text-3xl mx-auto shadow-inner text-gray-600">
                    🎬
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-gray-300">Belum ada video yang diputar</p>
                    <p className="text-[11px] text-gray-500 max-w-xs">
                      Tekan tombol &quot;Mulai Render Video Part {activePart}&quot; di samping kiri untuk membuat hasil video pertama Anda.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Video Footer Info */}
            {previewVideoUrl && (
              <div className="p-3 bg-gray-950/90 border-t border-gray-800 flex items-center justify-between text-[11px] font-mono text-gray-400">
                <span className="truncate max-w-xs">URL: {previewVideoUrl.split('?')[0]}</span>
                <a
                  href={previewVideoUrl}
                  download={`humanologi_preview.mp4`}
                  className="px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-emerald-400 font-bold hover:text-emerald-300 transition-all flex items-center gap-1"
                >
                  <span>⬇️</span> Download MP4
                </a>
              </div>
            )}
          </div>

          {/* Live Console Logs Terminal */}
          <div className="rounded-2xl bg-gray-950 border border-gray-800 overflow-hidden shadow-2xl flex flex-col">
            <div className="p-3 border-b border-gray-800/80 bg-gray-900/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                </div>
                <span className="text-xs font-mono font-bold text-gray-300 ml-1">
                  Render Terminal Output ({logs.length} baris)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLogs([])}
                  className="text-[10px] font-mono text-gray-500 hover:text-gray-300 px-2 py-0.5 rounded bg-gray-800/60"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setShowTerminal(!showTerminal)}
                  className="text-[10px] font-mono text-emerald-400 hover:underline"
                >
                  {showTerminal ? 'Sembunyikan' : 'Tampilkan'}
                </button>
              </div>
            </div>

            {showTerminal && (
              <div
                ref={logBoxRef}
                className="h-64 p-3.5 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-1 bg-black/70 text-gray-300 select-text"
              >
                {logs.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-start gap-2 ${
                      item.isError ? 'text-rose-400 bg-rose-950/20 px-1 rounded' : ''
                    }`}
                  >
                    <span className="text-gray-600 select-none shrink-0">[{item.time}]</span>
                    <span className="break-all">{item.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer Navigation */}
      <div className="p-4 rounded-2xl bg-gray-900/90 border border-gray-800 flex items-center justify-between text-xs">
        {onBackToVisual ? (
          <button
            type="button"
            onClick={onBackToVisual}
            className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-750 text-gray-200 font-bold transition-all cursor-pointer flex items-center gap-1.5"
          >
            <span>←</span> Kembali ke Step 4: Visual Mapping
          </button>
        ) : (
          <div />
        )}

        <div className="text-gray-400 font-mono text-[11px] hidden sm:block">
          Output Dir: <span className="text-emerald-400 font-bold">output/humanologi/</span>
        </div>
      </div>
    </div>
  );
};

export default HumanologiRenderStep;
