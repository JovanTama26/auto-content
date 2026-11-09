// dashboard/src/components/faceless/FacelessPreviewStep.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import type {
  FacelessTopicItem,
  FacelessEpisodeSummary,
} from '../../electron-api';

const api = window.electronAPI;

interface FacelessPreviewStepProps {
  onBackToVisual?: () => void;
  onGoToIdea?: () => void;
}

function formatDurationMinSec(sec?: number): string {
  if (!sec || isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const FacelessPreviewStep: React.FC<FacelessPreviewStepProps> = ({
  onBackToVisual,
}) => {
  const [topics, setTopics] = useState<FacelessTopicItem[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string>('');
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'longform' | 'short'>('longform');
  const [selectedShortId, setSelectedShortId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  // Video ref
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Render progress
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [renderProgress, setRenderProgress] = useState<{
    stage: string;
    progress: number;
    message: string;
    currentFrame?: number;
    totalFrames?: number;
  } | null>(null);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Load topics & episodes
  const loadTopics = async () => {
    setLoading(true);
    try {
      if (api?.listFacelessTopicsAndEpisodes) {
        const res = await api.listFacelessTopicsAndEpisodes();
        if (res.success && res.topics && res.topics.length > 0) {
          setTopics(res.topics);
          const activeTopic = res.topics.find((t) => t.id === selectedTopicId) || res.topics[0];
          setSelectedTopicId(activeTopic.id);
          if (activeTopic.episodes.length > 0) {
            const activeEp = activeTopic.episodes.find((e) => e.id === selectedEpisodeId) || activeTopic.episodes[0];
            setSelectedEpisodeId(activeEp.id);
          }
          return;
        }
      }

      // Fallback if running outside Electron
      const defaultTopic: FacelessTopicItem = {
        id: 'supermarket_apocalypse',
        title: 'Supermarket Apocalypse Survival',
        description: 'Serial petualangan bertahan hidup stickman berkupluk kuning.',
        episodesCount: 1,
        renderedCount: 1,
        totalDuration: 455.56,
        episodes: [
          {
            id: 'ep_01',
            title: 'Supermarket Apocalypse - Episode 1: Panik & Evakuasi',
            totalDuration: 455.56,
            scenesCount: 175,
            fps: 30,
            resolution: { width: 1920, height: 1080 },
            isRendered: true,
            videoPath: '/home/jovan/project/content-auto/output/faceless/supermarket_apocalypse/ep_01_final_1080p.mp4',
            videoUrl: 'media://content-auto/%2Fhome%2Fjovan%2Fproject%2Fcontent-auto%2Foutput%2Ffaceless%2Fsupermarket_apocalypse%2Fep_01_final_1080p.mp4',
            videoSizeBytes: 330285260,
            videoSizeFormatted: '315.0 MB',
            renderedAt: new Date().toISOString(),
            imagesCount: 175,
            sfxCount: 14,
            typographyCount: 27,
            timelinePath: 'input/faceless/topics/supermarket_apocalypse/episodes/ep_01/timeline.json',
          },
        ],
      };
      setTopics([defaultTopic]);
      setSelectedTopicId(defaultTopic.id);
      setSelectedEpisodeId(defaultTopic.episodes[0].id);
    } catch (err: any) {
      console.error('Error loading topics:', err);
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTopics();
  }, []);

  // Listen to render progress
  useEffect(() => {
    if (!api?.onFacelessRenderProgress) return;
    const unsubscribe = api.onFacelessRenderProgress((data) => {
      setRenderProgress(data);
      if (data.stage === 'done') {
        setIsRendering(false);
        showToast('Video berhasil dirender!', 'success');
        loadTopics();
      } else if (data.stage === 'error') {
        setIsRendering(false);
        showToast(data.message || 'Render gagal.', 'error');
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [selectedTopicId, selectedEpisodeId]);

  const currentTopic = useMemo(() => {
    return topics.find((t) => t.id === selectedTopicId) || null;
  }, [topics, selectedTopicId]);

  const currentEpisode = useMemo(() => {
    return currentTopic?.episodes.find((e) => e.id === selectedEpisodeId) || null;
  }, [currentTopic, selectedEpisodeId]);

  const currentShort = useMemo(() => {
    if (!currentEpisode?.shortVideos || currentEpisode.shortVideos.length === 0) return null;
    return (
      currentEpisode.shortVideos.find((s) => s.id === selectedShortId) ||
      currentEpisode.shortVideos.find((s) => s.isRendered) ||
      currentEpisode.shortVideos[0]
    );
  }, [currentEpisode, selectedShortId]);

  const handleOpenFile = (filePath?: string) => {
    if (!filePath) return;
    if (api?.openInFolder) {
      api.openInFolder(filePath);
      showToast('Membuka folder lokasi video...', 'info');
    }
  };

  const handleCopyPath = (filePath?: string) => {
    if (!filePath) return;
    navigator.clipboard.writeText(filePath);
    showToast('Path file video disalin!', 'success');
  };

  const handleStartRender = async () => {
    if (!selectedTopicId || !selectedEpisodeId) return;
    if (!api?.renderFacelessEpisode) {
      showToast('Fungsi render tidak tersedia di environment ini.', 'error');
      return;
    }

    const confirm = window.confirm(
      `Render ulang video master ${currentEpisode?.title || selectedEpisodeId} (1080p 30fps)?`
    );
    if (!confirm) return;

    setIsRendering(true);
    setRenderProgress({
      stage: 'start',
      progress: 0,
      message: 'Menyiapkan rendering Hyperframes 16:9...',
    });

    try {
      const res = await api.renderFacelessEpisode({
        topicId: selectedTopicId,
        episodeId: selectedEpisodeId,
        overwrite: true,
      });

      if (res.success) {
        showToast('Render master sukses selesai!', 'success');
        loadTopics();
      } else {
        showToast(res.error || 'Render gagal.', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsRendering(false);
    }
  };

  const handleStartRenderShort = async (shortItem?: any) => {
    if (!selectedTopicId || !selectedEpisodeId) return;
    if (!api?.renderFacelessShort) {
      showToast('Fungsi render short tidak tersedia di environment ini.', 'error');
      return;
    }

    const target = shortItem || currentShort || currentEpisode?.shortVideos?.[0];
    const partNum = target?.partNumber || 1;
    const partTitle = target?.partTitle || `PART ${partNum} : HARI PERTAMA KIAMAT`;

    const confirm = window.confirm(
      `Render video Short ${target?.title || `Part ${partNum}`} (1080x1920 Vertikal 9:16)?`
    );
    if (!confirm) return;

    setIsRendering(true);
    setRenderProgress({
      stage: 'start',
      progress: 0,
      message: `Menyiapkan rendering Hyperframes Short Part ${partNum}...`,
    });

    try {
      const res = await api.renderFacelessShort({
        topicId: selectedTopicId,
        episodeId: selectedEpisodeId,
        partNumber: partNum,
        partStart: target?.partStart,
        partEnd: target?.partEnd,
        partTitle: partTitle,
      });

      if (res.success) {
        showToast(`Render Short Part ${partNum} sukses selesai!`, 'success');
        await loadTopics();
        setSelectedShortId(target?.id || `part_${String(partNum).padStart(2, '0')}`);
      } else {
        showToast(res.error || 'Render short gagal.', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsRendering(false);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-5 pb-16 text-gray-100 font-sans">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2.5 border text-xs font-bold backdrop-blur-md ${toast.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-200 border-emerald-700/60'
              : toast.type === 'error'
                ? 'bg-rose-950/90 text-rose-200 border-rose-700/60'
                : 'bg-amber-950/90 text-amber-200 border-amber-700/60'
            }`}
        >
          <span>{toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap pb-2 border-b border-gray-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🎬</span>
            <h1 className="text-lg font-black text-white tracking-tight">
              Preview Hasil Video
            </h1>
            <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[10px] font-bold">
              Step 4
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            Pilih topik dan episode untuk memutar video final.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadTopics}
            disabled={loading}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold rounded-lg border border-gray-700 transition flex items-center gap-1.5 cursor-pointer"
          >
            <span className={loading ? 'animate-spin' : ''}>🔄</span> Refresh
          </button>
          {onBackToVisual && (
            <button
              onClick={onBackToVisual}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-amber-300 hover:text-amber-200 text-xs font-bold rounded-lg border border-gray-700 transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>←</span> Step 3: Visual Prompt
            </button>
          )}
        </div>
      </div>

      {/* ─── GROUPING BAR: PILIH TOPIK ─── */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
          <span>📁</span> Topik Serial:
        </label>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {topics.map((t) => {
            const isSelected = t.id === selectedTopicId;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setSelectedTopicId(t.id);
                  if (t.episodes.length > 0) {
                    setSelectedEpisodeId(t.episodes[0].id);
                  }
                }}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${isSelected
                    ? 'bg-amber-500 text-gray-950 border-amber-400 shadow-md shadow-amber-500/20'
                    : 'bg-gray-900 text-gray-300 border-gray-800 hover:bg-gray-800 hover:border-gray-700'
                  }`}
              >
                <span>{isSelected ? '📂' : '📁'}</span>
                <span>{t.title}</span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${isSelected ? 'bg-black/20 text-gray-950 font-black' : 'bg-gray-800 text-gray-400'
                    }`}
                >
                  {t.episodesCount} Ep
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── GROUPING BAR: PILIH EPISODE ─── */}
      {currentTopic && (
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
            <span>🎞️</span> Episode:
          </label>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
            {currentTopic.episodes.map((ep) => {
              const isSelected = ep.id === selectedEpisodeId;
              return (
                <button
                  key={ep.id}
                  onClick={() => setSelectedEpisodeId(ep.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${isSelected
                      ? 'bg-gray-800 text-amber-300 border-amber-500/70 shadow-sm ring-1 ring-amber-500/30'
                      : 'bg-gray-950 text-gray-400 border-gray-850 hover:bg-gray-900 hover:text-gray-200'
                    }`}
                >
                  <span className="font-mono font-bold uppercase">{ep.id}:</span>
                  <span className="font-medium">{ep.title.replace(/^Supermarket Apocalypse - /i, '')}</span>
                  <span className="text-[10px] text-gray-400 font-mono">
                    ({formatDurationMinSec(ep.totalDuration)})
                  </span>
                  {ep.isRendered ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-400" title="Video sudah dirender" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-gray-600" title="Belum dirender" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── VIDEO PLAYER AREA (FOCUSED & CLEAN) ─── */}
      {currentEpisode && (
        <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-4 sm:p-5 shadow-2xl space-y-4">
          {/* Format Switcher Tabs & Top Info */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-gray-800/80">
            {/* Longform vs Short Tabs */}
            <div className="flex items-center gap-1.5 p-1 bg-gray-950/70 rounded-xl border border-gray-800/80">
              <button
                onClick={() => setViewMode('longform')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  viewMode === 'longform'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                }`}
              >
                <span>📺</span> Longform (16:9)
              </button>
              <button
                onClick={() => setViewMode('short')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  viewMode === 'short'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                }`}
              >
                <span>📱</span> Short Vertikal (9:16)
                {currentEpisode.shortVideos && currentEpisode.shortVideos.length > 0 && (
                  <span className="px-1.5 py-0.2 bg-amber-500/30 text-amber-300 text-[10px] rounded-full">
                    {currentEpisode.shortVideos.length}
                  </span>
                )}
              </button>
            </div>

            {/* Badges */}
            <div className="flex items-center gap-2 flex-wrap">
              {viewMode === 'longform' ? (
                <>
                  <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-300 text-[11px] font-mono font-bold border border-gray-700">
                    1080p • 30fps
                  </span>
                  <span className="px-2 py-0.5 rounded bg-gray-800 text-amber-300 text-[11px] font-mono font-bold border border-gray-700">
                    {formatDurationMinSec(currentEpisode.totalDuration)}
                  </span>
                  {currentEpisode.isRendered && currentEpisode.videoSizeFormatted && (
                    <span className="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 text-[11px] font-mono font-bold border border-emerald-800/60">
                      {currentEpisode.videoSizeFormatted}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="px-2 py-0.5 rounded bg-gray-800 text-amber-300 text-[11px] font-mono font-bold border border-gray-700">
                    9:16 Vertikal (1080x1920)
                  </span>
                  {currentShort && currentShort.sizeFormatted && (
                    <span className="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 text-[11px] font-mono font-bold border border-emerald-800/60">
                      {currentShort.sizeFormatted}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Sub-selector if Short mode and multiple shorts exist */}
          {viewMode === 'short' && currentEpisode.shortVideos && currentEpisode.shortVideos.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap p-2.5 bg-gray-950/40 rounded-xl border border-gray-800/60">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mr-1">
                Pilih Part:
              </span>
              {currentEpisode.shortVideos.map((sv) => {
                const isActive = (currentShort?.id || currentEpisode.shortVideos?.[0]?.id) === sv.id;
                return (
                  <button
                    key={sv.id}
                    onClick={() => setSelectedShortId(sv.id)}
                    className={`px-3 py-1.5 text-xs rounded-xl font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      isActive
                        ? 'bg-amber-500 text-gray-950 shadow-md shadow-amber-500/20'
                        : 'bg-gray-850 hover:bg-gray-800 text-gray-300 border border-gray-700/80'
                    }`}
                  >
                    <span>{sv.isRendered ? '🎬' : '⚡'}</span>
                    <span>{sv.title}</span>
                    {sv.isRendered ? (
                      <span className="w-2 h-2 rounded-full bg-emerald-400" title="Sudah dirender" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-amber-400/70" title="Belum dirender" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Active File Label */}
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <span>▶️</span>{' '}
              {viewMode === 'longform'
                ? currentEpisode.title
                : currentShort?.title || `${currentEpisode.title} (Short 9:16)`}
            </h2>
            <p className="text-[11px] text-gray-400 font-mono truncate max-w-xl mt-0.5">
              {viewMode === 'longform'
                ? currentEpisode.videoPath || 'Video master 16:9 belum dirender'
                : currentShort?.isRendered
                  ? currentShort.path
                  : `Part ${currentShort?.partNumber || 1} (${currentShort?.partStart || 0}s - ${currentShort?.partEnd || 53}s) — Belum dirender`}
            </p>
          </div>

          {/* Video Player Box (Adaptive 16:9 or 9:16) */}
          {viewMode === 'longform' ? (
            <div className="relative aspect-video w-full bg-black rounded-xl overflow-hidden border border-gray-800 shadow-2xl">
              {currentEpisode.isRendered && currentEpisode.videoUrl ? (
                <video
                  ref={videoRef}
                  src={currentEpisode.videoUrl}
                  controls
                  className="w-full h-full object-contain"
                  preload="metadata"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-3xl mb-3 text-amber-400">
                    🎬
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1">Video Master Belum Dirender</h3>
                  <p className="text-xs text-gray-400 max-w-sm mb-4 leading-relaxed">
                    Timeline dan transkrip sudah siap. Klik tombol di bawah untuk menjalankan proses render Hyperframes (1080p 30fps).
                  </p>
                  <button
                    onClick={handleStartRender}
                    disabled={isRendering}
                    className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-gray-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <span>🚀</span> Render Video Master (1080p 30fps)
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* 9:16 Vertical Smartphone View */
            <div className="py-2 flex flex-col items-center justify-center bg-gray-950/60 rounded-xl border border-gray-800/60">
              {currentShort && currentShort.isRendered && currentShort.url ? (
                <div className="w-full max-w-[340px] aspect-[9/16] bg-black rounded-3xl border-4 border-gray-800 shadow-2xl overflow-hidden relative">
                  <video
                    src={currentShort.url}
                    controls
                    className="w-full h-full object-cover"
                    preload="metadata"
                  />
                </div>
              ) : (
                <div className="p-8 text-center max-w-md mx-auto">
                  <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-3xl mx-auto mb-3 text-amber-400">
                    📱
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1">
                    {currentShort?.title || `Short Part ${currentShort?.partNumber || 1}`} Belum Dirender
                  </h3>
                  <p className="text-xs text-gray-400 leading-relaxed mb-5">
                    Render potongan part ini menjadi video vertikal 9:16 (1080x1920) dengan kamera 2.5D, tipografi kinetik, dan cliffhanger outro.
                  </p>
                  <button
                    onClick={() => handleStartRenderShort(currentShort)}
                    disabled={isRendering}
                    className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-gray-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center gap-2 mx-auto cursor-pointer"
                  >
                    <span>⚡</span> Render {currentShort?.title ? currentShort.title.split(' ')[0] + ' ' + (currentShort.title.split(' ')[1] || '') : 'Part Ini'} (9:16)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Bottom Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2 flex-wrap">
              {viewMode === 'longform' && currentEpisode.isRendered && currentEpisode.videoPath && (
                <>
                  <button
                    onClick={() => handleOpenFile(currentEpisode.videoPath)}
                    className="px-3.5 py-2 bg-gray-800 hover:bg-gray-700 text-amber-300 hover:text-amber-200 text-xs font-bold rounded-xl border border-gray-700 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <span>📁</span> Buka Folder Video
                  </button>
                  <button
                    onClick={() => handleCopyPath(currentEpisode.videoPath)}
                    className="px-3.5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-semibold rounded-xl border border-gray-700 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <span>📋</span> Salin Path File
                  </button>
                </>
              )}

              {viewMode === 'short' && currentShort && currentShort.isRendered && currentShort.path && (
                <>
                  <button
                    onClick={() => handleOpenFile(currentShort.path)}
                    className="px-3.5 py-2 bg-gray-800 hover:bg-gray-700 text-amber-300 hover:text-amber-200 text-xs font-bold rounded-xl border border-gray-700 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <span>📁</span> Buka Folder Short
                  </button>
                  <button
                    onClick={() => handleCopyPath(currentShort.path)}
                    className="px-3.5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-semibold rounded-xl border border-gray-700 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <span>📋</span> Salin Path Short
                  </button>
                </>
              )}
            </div>

            {viewMode === 'longform' ? (
              <button
                onClick={handleStartRender}
                disabled={isRendering}
                className="px-3.5 py-2 bg-gray-800/90 hover:bg-gray-700 text-rose-300 hover:text-rose-200 text-xs font-bold rounded-xl border border-gray-700 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <span>🔄</span> Re-Render Ulang Master (16:9)
              </button>
            ) : currentShort?.isRendered ? (
              <button
                onClick={() => handleStartRenderShort(currentShort)}
                disabled={isRendering}
                className="px-3.5 py-2 bg-gray-800/90 hover:bg-gray-700 text-amber-300 hover:text-amber-200 text-xs font-bold rounded-xl border border-gray-700 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <span>🔄</span> Re-Render Short ({currentShort?.title?.split(' ')[0] || 'Part'} {currentShort?.partNumber || 1})
              </button>
            ) : (
              <button
                onClick={() => handleStartRenderShort(currentShort)}
                disabled={isRendering}
                className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-gray-950 font-black text-xs rounded-xl shadow-md shadow-amber-500/20 transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>⚡</span> Render Short ({currentShort?.title?.split(' ')[0] || 'Part'} {currentShort?.partNumber || 1})
              </button>
            )}
          </div>

          {/* Real-time Render Progress */}
          {isRendering && renderProgress && (
            <div className="p-4 bg-amber-950/40 border border-amber-500/40 rounded-xl space-y-2 animate-pulse mt-3">
              <div className="flex items-center justify-between text-xs font-bold text-amber-300">
                <span>{renderProgress.message}</span>
                <span className="font-mono">{Math.round((renderProgress.progress || 0) * 100)}%</span>
              </div>
              <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all duration-300"
                  style={{ width: `${Math.round((renderProgress.progress || 0) * 100)}%` }}
                />
              </div>
              {renderProgress.currentFrame !== undefined && renderProgress.totalFrames !== undefined && (
                <p className="text-[10px] text-gray-400 font-mono text-right">
                  Frame: {renderProgress.currentFrame} / {renderProgress.totalFrames}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FacelessPreviewStep;
