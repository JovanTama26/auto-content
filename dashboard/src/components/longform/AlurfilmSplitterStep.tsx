// dashboard/src/components/longform/AlurfilmSplitterStep.tsx
import React, { useState, useEffect, useRef } from 'react';
import type { SourceInfo, AlurfilmChunk } from '../../electron-api';
import { syncChunksToSupabase, getSyncedChunks } from '../../lib/supabaseSync';

const api = window.electronAPI;

function formatSecondsToHHMMSS(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

function parseHHMMSS(str: string): number {
  const parts = str.trim().split(':').map((p) => parseFloat(p) || 0);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parseFloat(str) || 0;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const AlurfilmSplitterStep: React.FC = () => {
  const [uploadingMaster, setUploadingMaster] = useState<boolean>(false);
  const [contentId, setContentId] = useState<string | null>(null);
  const [masterSource, setMasterSource] = useState<SourceInfo | null>(null);
  const [selectedChunk, setSelectedChunk] = useState<AlurfilmChunk | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);

  // Custom Time Range inputs
  const [startTime, setStartTime] = useState<string>('00:00:00');
  const [endTime, setEndTime] = useState<string>('00:00:00');

  const [splitting, setSplitting] = useState<boolean>(false);
  const [compressingParts, setCompressingParts] = useState<Record<number, boolean>>({});
  const [splitProgress, setSplitProgress] = useState<{
    currentPart: number;
    totalParts: number;
    percentage: number;
    statusText: string;
  } | null>(null);
  const [chunks, setChunks] = useState<AlurfilmChunk[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [syncingSupabase, setSyncingSupabase] = useState<boolean>(false);
  const [syncedParts, setSyncedParts] = useState<number[]>([]);
  const [partsWithPrompt, setPartsWithPrompt] = useState<number[]>([]);

  const [toast, setToast] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    (async () => {
      try {
        const id = await api.getContentId('longform');
        setContentId(id);

        if (id) {
          const existingChunks = await api.listAlurfilmChunks(id);
          if (existingChunks && existingChunks.length > 0) {
            setChunks(existingChunks);
          }
          try {
            const synced = await getSyncedChunks(id);
            setSyncedParts(synced.map((s) => s.part_number));
            setPartsWithPrompt(synced.filter((s) => !!s.prompt).map((s) => s.part_number));
          } catch { }
        }
      } catch { }
    })();
  }, []);

  const generatePromptForChunk = async (partNum: number, total: number, chunkItem?: any): Promise<string> => {
    if (partNum !== 1) return '';

    const targetChunk = chunkItem || chunks.find((c) => c.part === partNum);
    const chunkDur = targetChunk?.durationSec || ('duration' in (targetChunk || {}) ? (targetChunk as any).duration : 0) || 1200;

    const savedTitle = (contentId && localStorage.getItem(`alurfilm_movie_title_${contentId}`)) || masterSource?.name?.replace(/\.[^/.]+$/, '') || '';
    const savedYear = (contentId && localStorage.getItem(`alurfilm_movie_year_${contentId}`)) || '';

    if (api.getAlurfilmPrompt) {
      try {
        const res = await api.getAlurfilmPrompt({
          chunkPart: partNum,
          totalChunks: total,
          chunks,
          durationSec: chunkDur,
          contentId,
          movieTitle: savedTitle,
          movieYear: savedYear,
        } as any);
        if (res) return res;
      } catch (err) {
        console.warn('[AlurfilmSplitterStep] getAlurfilmPrompt IPC error:', err);
      }
    }

    if (api.readFromProject) {
      try {
        const promptTpl = await api.readFromProject('dashboard/prompts/longform/alurfilm-singlepass-prompt.md');
        if (promptTpl) {
          const chunkDurText = chunkDur < 60
            ? `${Math.round(chunkDur)} Detik`
            : `${(chunkDur / 60).toFixed(1)} Menit`;
          const computedMinChars = Math.max(300, Math.round((chunkDur * 3000) / 1200));
          const computedMaxChars = Math.max(350, Math.round((chunkDur * 3400) / 1200));
          const computedMinWords = Math.max(45, Math.round((chunkDur * 450) / 1200));
          const computedMaxWords = Math.max(50, Math.round((chunkDur * 500) / 1200));
          const computedChars = `${computedMinChars} - ${computedMaxChars} Karakter`;
          const computedWords = `${computedMinWords} - ${computedMaxWords}`;
          const isFirstPartStr = 'YA (Chunk #1 / Part Pembuka Film Utama - Langsung masuk ke alur cerita tanpa intro formal. DILARANG menyebut nama/judul film!)';
          const isLastPartStr = total === 1 ? 'YA (Chunk Terakhir / Part Penutup Film - Akhiri tanpa menyebut judul film)' : 'TIDAK (Part Bukan Penutup)';
          const prevCtxStr = 'Tidak ada (Chunk #1 / Awal Film)';
          const styleExampleStr = 'Gaya pencerita alur cerita film YouTube Indonesia: lugas, santai, tenang, dan mengalir alami (seperti Saqahayang / Kamar Film). Buka langsung ke fokus karakter dan situasi awal tanpa intro formal. Fokus mutlak pada ALUR CERITA (krisis karakter, sebab-akibat, keputusan, dan perkembangan alur). DILARANG mendramatisir adegan, DILARANG menggunakan kata-kata/frasa penguat intensitas (hiperbola/superlatif) untuk visual yang sudah jelas di layar, DILARANG gaya sastra puitis melodramatis, DILARANG gaya CCTV yang mendiktekan gerak fisik mikro karakter, dan DILARANG menyebutkan nama/judul film!';

          return promptTpl
            .replace(/\{\{chunk_part\}\}/g, String(partNum))
            .replace(/\{\{total_chunks\}\}/g, String(total))
            .replace(/\{\{movie_title\}\}/g, savedTitle.trim() || 'Tidak disebutkan')
            .replace(/\{\{movie_year\}\}/g, savedYear.trim() ? `tahun ${savedYear.trim()}` : '')
            .replace(/\{\{is_first_part\}\}/g, isFirstPartStr)
            .replace(/\{\{is_last_part\}\}/g, isLastPartStr)
            .replace(/\{\{target_chars_per_chunk\}\}/g, computedChars)
            .replace(/\{\{target_min_chars\}\}/g, String(computedMinChars))
            .replace(/\{\{target_max_chars\}\}/g, String(computedMaxChars))
            .replace(/\{\{target_words_per_chunk\}\}/g, computedWords)
            .replace(/\{\{target_min_words\}\}/g, String(computedMinWords))
            .replace(/\{\{target_max_words\}\}/g, String(computedMaxWords))
            .replace(/\{\{chunk_duration_text\}\}/g, chunkDurText)
            .replace(/\{\{previous_context\}\}/g, prevCtxStr)
            .replace(/\{\{style_example\}\}/g, styleExampleStr);
        }
      } catch { }
    }

    return '';
  };

  const handleSyncToSupabase = async () => {
    if (!contentId || chunks.length === 0) return;
    setSyncingSupabase(true);
    setError(null);
    try {
      const res = await syncChunksToSupabase({
        contentId,
        chunks,
        onlyFirstPartPrompt: true,
        getPromptFn: generatePromptForChunk,
      });
      setSyncedParts(chunks.map((c) => c.part));
      setPartsWithPrompt([1]);
      showToast(`☁️ Berhasil menyimpan ${res.count} part ke Supabase (Prompt otomatis hanya untuk Part 1)!`);
    } catch (err: any) {
      setError(`Gagal menyimpan ke Supabase: ${err.message}`);
    } finally {
      setSyncingSupabase(false);
    }
  };

  const handleSyncSingleChunk = async (chunk: AlurfilmChunk) => {
    if (!contentId) return;
    setSyncingSupabase(true);
    try {
      await syncChunksToSupabase({
        contentId,
        chunks: [chunk],
        onlyFirstPartPrompt: chunk.part !== 1,
        getPromptFn: generatePromptForChunk,
      });
      setSyncedParts((prev) => Array.from(new Set([...prev, chunk.part])));
      if (chunk.part === 1) {
        setPartsWithPrompt((prev) => Array.from(new Set([...prev, 1])));
      }
      showToast(`☁️ Part #${chunk.part} berhasil disimpan ke Supabase${chunk.part === 1 ? ' (dengan Prompt awal)' : ''}!`);
    } catch (err: any) {
      setError(`Gagal menyimpan Part #${chunk.part} ke Supabase: ${err.message}`);
    } finally {
      setSyncingSupabase(false);
    }
  };

  const handleSelectMaster = async () => {
    try {
      const selected = await api.selectFile();
      if (!selected) return;

      setUploadingMaster(true);
      setError(null);

      const fnUpload = api.uploadAlurfilmMaster || api.uploadAlurfilmSource;
      const uploaded = await fnUpload(selected.path);
      setMasterSource(uploaded);

      const meta = await api.getVideoMeta(uploaded.filePath || '');
      if (meta && meta.duration) {
        setVideoDuration(meta.duration);
        setStartTime('00:00:00');
        setEndTime(formatSecondsToHHMMSS(meta.duration));
      }

      showToast(`🎬 Master movie "${uploaded.name}" loaded successfully.`);
    } catch (err: any) {
      setError(err.message || 'Failed to load master video');
    }
    setUploadingMaster(false);
  };

  // AUTO SPLIT ALL PARTS ACCORDING TO USER'S CUSTOM START AND END TIME RANGE
  const handleAutoCutWithTimeRange = async () => {
    if (!masterSource) return;

    const startSec = parseHHMMSS(startTime);
    const endSec = parseHHMMSS(endTime);

    if (endSec <= startSec) {
      setError('End Time (Waktu Selesai) harus lebih besar dari Start Time (Waktu Mulai).');
      return;
    }

    setSplitting(true);
    setError(null);

    const unsub = api.onAlurfilmSplitProgress ? api.onAlurfilmSplitProgress((data) => {
      if (data.status === 'start') {
        setChunks([]);
        setSplitProgress({
          currentPart: 0,
          totalParts: data.totalParts,
          percentage: 0,
          statusText: `Menyiapkan pemotongan ${data.totalParts} part...`
        });
      } else if (data.status === 'splitting') {
        const pct = Math.round(((data.currentPart - 1) / data.totalParts) * 100);
        setSplitProgress({
          currentPart: data.currentPart,
          totalParts: data.totalParts,
          percentage: pct,
          statusText: `Memotong & Mengompres Part #${data.currentPart} dari ${data.totalParts} (<400 MB)...`
        });
      } else if (data.status === 'chunk_completed' && data.chunk) {
        const completedChunk = data.chunk;
        setChunks((prev) => {
          const filtered = prev.filter((c) => c.part !== completedChunk.part);
          return [...filtered, completedChunk].sort((a, b) => a.part - b.part);
        });
        const pct = Math.round((data.currentPart / data.totalParts) * 100);
        setSplitProgress({
          currentPart: data.currentPart,
          totalParts: data.totalParts,
          percentage: pct,
          statusText: `Part #${data.currentPart} selesai dipotong & dikompres!`
        });
      } else if (data.status === 'done') {
        setSplitProgress(null);
      }
    }) : null;

    try {
      const fnSplit = api.splitAlurfilmMaster || api.splitAlurfilmVideo;
      const res = await fnSplit(masterSource.filePath || '', 1200, startTime, endTime);

      const chunkList = Array.isArray(res) ? res : res.chunks || [];
      if (chunkList.length > 0) {
        setChunks(chunkList);
      }
      if (res && 'content_id' in res && res.content_id) {
        setContentId(res.content_id);
      }

      showToast(`🎉 Sukses! Memotong video dari ${startTime} s/d ${endTime} menjadi ${chunkList.length} Part (skipping intro/outro)!`);
    } catch (err: any) {
      setError(err.message || 'Gagal memotong video dengan time range');
    } finally {
      if (unsub) unsub();
      setSplitting(false);
      setSplitProgress(null);
    }
  };

  const handleCopyChunkPath = async (chunk: AlurfilmChunk, index: number) => {
    if (api.copyToClipboard) {
      await api.copyToClipboard(chunk.filePath);
      setCopiedIndex(index);
      showToast(`📋 Copied Part #${chunk.part} path!`);
      setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  const handleDeleteChunk = async (chunk: AlurfilmChunk) => {
    try {
      if (api.deleteAlurfilmChunk) {
        await api.deleteAlurfilmChunk(chunk.part);
      }
      setChunks((prev) => prev.filter((c) => c.part !== chunk.part));
      if (selectedChunk?.part === chunk.part) {
        setSelectedChunk(null);
      }
      showToast(`🗑️ Part #${chunk.part} berhasil dihapus.`);
    } catch (err: any) {
      setError(`Gagal menghapus Part #${chunk.part}: ${err.message}`);
    }
  };

  const handleCompressChunk = async (chunk: AlurfilmChunk) => {
    try {
      setCompressingParts((prev) => ({ ...prev, [chunk.part]: true }));
      showToast(`🗜️ Mengompres Part #${chunk.part}... Mohon tunggu.`);

      const updated = await api.compressAlurfilmChunk({
        part: chunk.part,
        filePath: chunk.filePath,
      });

      setChunks((prev) =>
        prev.map((c) => (c.part === chunk.part ? { ...c, ...updated } : c))
      );
      if (selectedChunk?.part === chunk.part) {
        setSelectedChunk((prev) => (prev ? { ...prev, ...updated } : null));
      }
      showToast(`✅ Part #${chunk.part} berhasil dikompres (${formatBytes(updated.size)})!`);
    } catch (err: any) {
      setError(`Gagal mengompres Part #${chunk.part}: ${err.message}`);
    } finally {
      setCompressingParts((prev) => ({ ...prev, [chunk.part]: false }));
    }
  };

  const handleSetCurrentTimeAsStart = () => {
    if (videoRef.current) {
      setStartTime(formatSecondsToHHMMSS(videoRef.current.currentTime));
      showToast(`⏱️ Start Time set to ${formatSecondsToHHMMSS(videoRef.current.currentTime)}`);
    }
  };

  const handleSetCurrentTimeAsEnd = () => {
    if (videoRef.current) {
      setEndTime(formatSecondsToHHMMSS(videoRef.current.currentTime));
      showToast(`⏱️ End Time set to ${formatSecondsToHHMMSS(videoRef.current.currentTime)}`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100 p-6 overflow-hidden">
      {/* Toast notification */}
      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-purple-600 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-2xl border border-purple-400 animate-bounce">
          {toast}
        </div>
      )}

      {/* Top Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-gray-800 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="p-2 bg-purple-600/20 text-purple-400 rounded-lg text-lg">✂️</span>
            Alur Film Master Video Splitter
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Set custom Start & End time to skip intro/outro, then auto-split into 20-minute storytelling parts.
          </p>
        </div>

        {/* Content ID & Status */}
        <div className="flex items-center gap-2">
          {contentId && (
            <div className="px-3.5 py-1.5 rounded-lg border bg-purple-950/60 border-purple-700/50 text-purple-300 text-xs font-mono font-semibold flex items-center gap-2 shadow-lg shadow-purple-950/40">
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>
              <span>Content ID: {contentId}</span>
            </div>
          )}
          <div className={`px-3.5 py-1.5 rounded-lg border text-xs font-semibold ${splitting
            ? 'bg-purple-950/60 border-purple-700/50 text-purple-300 animate-pulse'
            : chunks.length > 0
              ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-300'
              : 'bg-gray-900 border-gray-800 text-gray-500'
            }`}>
            {splitting && splitProgress
              ? `⏳ Memotong ${splitProgress.currentPart}/${splitProgress.totalParts} Parts (${splitProgress.percentage}%)`
              : chunks.length > 0
                ? `✓ ${chunks.length} Parts Split`
                : 'Belum Ada Chunk'}
          </div>
        </div>
      </div>

      {/* Workspace 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-5 flex-1 min-h-0 overflow-hidden">
        {/* LEFT PANEL: Master Video Player & Custom Range Splitter (Col 7) */}
        <div className="lg:col-span-7 flex flex-col bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden shadow-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>📽️</span> Master Video Source
            </h3>
            <button
              onClick={handleSelectMaster}
              disabled={uploadingMaster || splitting}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-purple-600/30 transition-all flex items-center gap-1.5"
            >
              <span>📁</span>
              <span>{uploadingMaster ? 'Loading...' : masterSource ? 'Ganti Film Master' : 'Buka Film Master (1-2 Jam)'}</span>
            </button>
          </div>

          {/* Master Video Player Frame */}
          <div className="flex-1 bg-black rounded-xl overflow-hidden flex items-center justify-center border border-gray-800 min-h-0 relative">
            {masterSource ? (
              <video
                ref={videoRef}
                src={masterSource.url}
                controls
                onLoadedMetadata={() => {
                  if (videoRef.current) {
                    setVideoDuration(videoRef.current.duration);
                    if (endTime === '00:00:00') setEndTime(formatSecondsToHHMMSS(videoRef.current.duration));
                  }
                }}
                className="w-full h-full object-contain max-h-[360px]"
              />
            ) : selectedChunk ? (
              <video
                src={selectedChunk.mediaUrl || selectedChunk.url}
                controls
                className="w-full h-full object-contain max-h-[360px]"
              />
            ) : (
              <div className="text-center p-8 space-y-2">
                <div className="w-16 h-16 bg-purple-600/10 text-purple-400 rounded-2xl flex items-center justify-center mx-auto text-3xl border border-purple-500/20">
                  🍿
                </div>
                <h4 className="text-xs font-bold text-gray-300">Belum Ada Film Master Loaded</h4>
                <p className="text-[11px] text-gray-500 max-w-xs mx-auto">
                  Pilih file film master (MKV, MP4, MOV) untuk mulai mengatur Start/End Time dan memotong menjadi part-part 10m.
                </p>
              </div>
            )}
          </div>

          {/* Custom Time Range & Auto Split Control Box */}
          {masterSource && (
            <div className="bg-gray-950 p-4 rounded-xl border border-purple-900/50 space-y-3.5 shadow-inner">
              <div className="flex items-center justify-between text-xs pb-2 border-b border-gray-800">
                <span className="font-bold text-purple-300 flex items-center gap-1.5">
                  <span>⚙️</span> Setting Range Waktu Pemotongan Film (Wajib Digunakan)
                </span>
                <span className="font-mono text-purple-400 font-semibold">Durasi Film: {formatSecondsToHHMMSS(videoDuration)}</span>
              </div>

              {/* Start Time & End Time Inputs */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="font-bold text-white">Start Time (Skip Intro):</span>
                    <button onClick={handleSetCurrentTimeAsStart} className="text-purple-400 hover:underline text-[10px]">
                      📍 Gunakan Waktu Player
                    </button>
                  </div>
                  <input
                    type="text"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    placeholder="00:00:00"
                    className="w-full bg-gray-900 border border-gray-800 text-white text-xs font-mono px-3.5 py-2 rounded-xl focus:border-purple-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-gray-500 block">Detik awal pemotongan (contoh: 00:03:30)</span>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="font-bold text-white">End Time (Skip Outro):</span>
                    <button onClick={handleSetCurrentTimeAsEnd} className="text-purple-400 hover:underline text-[10px]">
                      📍 Gunakan Waktu Player
                    </button>
                  </div>
                  <input
                    type="text"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    placeholder="01:45:00"
                    className="w-full bg-gray-900 border border-gray-800 text-white text-xs font-mono px-3.5 py-2 rounded-xl focus:border-purple-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-gray-500 block">Detik akhir pemotongan (contoh: 01:45:00)</span>
                </div>
              </div>

              {/* Single Clear Action Button */}
              <button
                onClick={handleAutoCutWithTimeRange}
                disabled={splitting}
                className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-purple-600/30 transition-all flex items-center justify-center gap-2"
              >
                <span>{splitting ? '⏳' : '⚡'}</span>
                <span>
                  {splitting
                    ? `Sedang Memotong Video... (${splitProgress?.percentage || 0}%)`
                    : `Auto-Split Video (${startTime} s/d ${endTime}) Menjadi Part 10-Menit`}
                </span>
              </button>

              {/* Real-time Progress Bar */}
              {splitting && splitProgress && (
                <div className="space-y-1.5 pt-2 border-t border-purple-900/40">
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-purple-300 font-semibold">{splitProgress.statusText}</span>
                    <span className="text-purple-400 font-bold">{splitProgress.percentage}%</span>
                  </div>
                  <div className="w-full bg-gray-900 rounded-full h-2 overflow-hidden border border-purple-950">
                    <div
                      className="bg-gradient-to-r from-purple-600 to-indigo-500 h-full transition-all duration-300"
                      style={{ width: `${splitProgress.percentage}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-950/40 border border-red-800/50 rounded-xl text-xs text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* RIGHT PANEL: List of Cut Scene Chunks (Col 5) */}
        <div className="lg:col-span-5 flex flex-col bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden shadow-xl p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-800">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>📑</span> Hasil Part Scene Video ({chunks.length}{splitProgress?.totalParts ? ` / ${splitProgress.totalParts}` : ''})
              </h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Setiap part dipotong presisi dari {startTime} sampai {endTime}.
              </p>
            </div>
            {chunks.length > 0 && (
              <button
                onClick={handleSyncToSupabase}
                disabled={syncingSupabase}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold shadow-lg transition-all flex items-center gap-1.5 border ${syncedParts.length === chunks.length && chunks.length > 0
                  ? 'bg-emerald-950/60 hover:bg-emerald-900/70 border-emerald-700/60 text-emerald-300'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border-emerald-500/50 text-white shadow-emerald-600/30'
                  }`}
                title="Simpan daftar part video ke Supabase (schema: autocontent). Prompt diisi hanya untuk Part 1 by default."
              >
                <span>{syncingSupabase ? '⏳' : syncedParts.length === chunks.length ? '✓' : '☁️'}</span>
                <span>
                  {syncingSupabase
                    ? 'Menyimpan...'
                    : syncedParts.length === chunks.length
                      ? `Tersinkron (${syncedParts.length} Part)`
                      : 'Simpan ke Supabase'}
                </span>
              </button>
            )}
          </div>

          {chunks.length > 0 || (splitting && splitProgress) ? (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1">
              {chunks.map((chunk, idx) => (
                <div
                  key={chunk.part}
                  onClick={() => setSelectedChunk(chunk)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${selectedChunk?.part === chunk.part
                    ? 'bg-purple-950/50 border-purple-500 text-white shadow-lg'
                    : 'bg-gray-950 border-gray-800 hover:border-gray-700 text-gray-300'
                    }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-purple-600/20 border border-purple-500/30 text-purple-300 flex items-center justify-center font-bold text-xs font-mono shrink-0">
                      P{chunk.part}
                    </span>
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-white truncate font-mono">{chunk.name}</h4>
                      <p className="text-[11px] text-gray-400 font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span>Duration: <strong className="text-purple-400">{chunk.durationSec ? `${(chunk.durationSec / 60).toFixed(1)} min` : chunk.duration ? `${chunk.duration.toFixed(1)}s` : '~20 min'}</strong></span>
                        <span>•</span>
                        <span>Size: <strong className={chunk.size > 400 * 1024 * 1024 && !chunk.isCompressed ? 'text-amber-400 font-bold' : 'text-gray-200'}>{formatBytes(chunk.size)}</strong></span>
                        {chunk.isCompressed ? (
                          <span className="text-[10px] bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 px-1.5 py-0.5 rounded-md font-bold">
                            ✓ Compressed
                          </span>
                        ) : chunk.size > 400 * 1024 * 1024 ? (
                          <span className="text-[10px] bg-amber-950/80 text-amber-400 border border-amber-800/60 px-1.5 py-0.5 rounded-md font-bold">
                            &gt; 400MB
                          </span>
                        ) : null}
                        {syncedParts.includes(chunk.part) ? (
                          <span className="text-[10px] bg-sky-950/80 text-sky-400 border border-sky-800/60 px-1.5 py-0.5 rounded-md font-bold flex items-center gap-1">
                            <span>☁️</span> Supabase {partsWithPrompt.includes(chunk.part) ? '(Prompt ✓)' : '(Part Only)'}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSyncSingleChunk(chunk);
                      }}
                      disabled={syncingSupabase}
                      className={`px-2 py-1 text-[11px] font-mono rounded-lg border transition-all flex items-center gap-1 ${syncedParts.includes(chunk.part)
                        ? 'bg-sky-950/40 hover:bg-sky-900/80 text-sky-300 border-sky-800/60'
                        : 'bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-emerald-300 border-gray-800'
                        }`}
                      title={chunk.part === 1 ? 'Simpan Part #1 ke Supabase (dengan Prompt)' : 'Simpan part ini ke Supabase (tanpa prompt, menunggu analisis part sebelumnya)'}
                    >
                      <span>{syncedParts.includes(chunk.part) ? (partsWithPrompt.includes(chunk.part) ? '✓ DB (P)' : '✓ DB') : '☁️ DB'}</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCompressChunk(chunk);
                      }}
                      disabled={compressingParts[chunk.part]}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border font-mono transition-all flex items-center gap-1 ${chunk.isCompressed
                        ? 'bg-emerald-950/40 hover:bg-emerald-900/80 text-emerald-300 border-emerald-800/60'
                        : 'bg-purple-950/40 hover:bg-purple-900/80 text-purple-300 border-purple-800/60'
                        }`}
                      title="Kompres file part ini agar < 400 MB"
                    >
                      {compressingParts[chunk.part]
                        ? '⏳ Compressing...'
                        : chunk.isCompressed
                          ? '⚡ Re-compress'
                          : '🗜️ Compress'}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyChunkPath(chunk, idx);
                      }}
                      className="px-2.5 py-1 bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-purple-300 border border-gray-800 rounded-lg text-[11px] font-mono transition-all"
                      title="Copy absolute filepath for AI Studio"
                    >
                      {copiedIndex === idx ? '✓ Copied' : 'Copy Path'}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteChunk(chunk);
                      }}
                      className="p-1 px-2 bg-red-950/40 hover:bg-red-900/80 text-red-400 border border-red-800/50 rounded-lg text-[11px] font-bold transition-all"
                      title="Hapus part ini"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}

              {/* In-Progress Card Placeholder */}
              {splitting && splitProgress && splitProgress.currentPart > 0 && (
                <div className="p-3.5 rounded-xl border border-purple-500/50 bg-purple-950/30 animate-pulse flex items-center justify-between gap-3 shadow-lg">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-purple-600/30 border border-purple-500/40 text-purple-300 flex items-center justify-center font-bold text-xs font-mono shrink-0">
                      P{splitProgress.currentPart}
                    </span>
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-purple-200 truncate font-mono">
                        Sedang Memotong Part #{splitProgress.currentPart}...
                      </h4>
                      <p className="text-[11px] text-purple-400/80 font-mono mt-0.5">
                        Proses FFmpeg chunk {splitProgress.currentPart} dari {splitProgress.totalParts}
                      </p>
                    </div>
                  </div>
                  <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin shrink-0"></div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-gray-800 rounded-2xl space-y-3">
              <div className="w-12 h-12 bg-gray-900 text-gray-600 rounded-xl flex items-center justify-center text-xl">
                ✂️
              </div>
              <div>
                <h4 className="text-xs font-bold text-gray-400">Belum Ada Part Video</h4>
                <p className="text-[11px] text-gray-500 mt-1 max-w-xs">
                  Atur Waktu Mulai & Selesai di sebelah kiri (untuk skip intro/outro), lalu klik tombol "Auto-Split Video".
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AlurfilmSplitterStep;

