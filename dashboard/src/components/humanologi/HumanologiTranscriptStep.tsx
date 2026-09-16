// dashboard/src/components/humanologi/HumanologiTranscriptStep.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import type {
  HumanologiAudioItem,
  HumanologiTranscriptEntry,
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

interface HumanologiTranscriptStepProps {
  onBackToAudio?: () => void;
  onGoToRender?: () => void;
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const HumanologiTranscriptStep: React.FC<HumanologiTranscriptStepProps> = ({
  onBackToAudio,
  onGoToRender,
}) => {
  const [narasiData, setNarasiData] = useState<HumanologiNarasiData | null>(null);
  const [audioList, setAudioList] = useState<HumanologiAudioItem[]>([]);
  const [transcripts, setTranscripts] = useState<Record<number, HumanologiTranscriptPartData>>({});
  const [activePart, setActivePart] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);

  // Faster-Whisper Alignment State
  const [isWhisperRunning, setIsWhisperRunning] = useState<boolean>(false);
  const [whisperProgress, setWhisperProgress] = useState<number>(0);
  const [whisperStatus, setWhisperStatus] = useState<string>('');

  // Audio Playback & Live Visual Mapping Sync
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const activeRowRef = useRef<HTMLDivElement | null>(null);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(
    null
  );

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Load initial data
  const loadData = async () => {
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
    } catch (err: any) {
      showToast(err.message || 'Gagal memuat data.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Listen to Faster-Whisper alignment progress
  useEffect(() => {
    if (api?.onHumanologiAlignmentProgress) {
      const cleanup = api.onHumanologiAlignmentProgress((data) => {
        if (data.progress !== undefined) setWhisperProgress(data.progress);
        if (data.log) setWhisperStatus(data.log);
      });
      return cleanup;
    }
  }, []);

  // Current audio & transcript for active part
  const currentAudio = useMemo(() => {
    return audioList.find((a) => a.part === activePart);
  }, [audioList, activePart]);

  const currentTranscript = useMemo(() => {
    return transcripts[activePart];
  }, [transcripts, activePart]);

  const entries: HumanologiTranscriptEntry[] = useMemo(() => {
    return currentTranscript?.entries || [];
  }, [currentTranscript]);

  const currentNarasiPart = useMemo(() => {
    return narasiData?.narasi.find((p) => p.part === activePart);
  }, [narasiData, activePart]);

  // Active entry during audio playback
  const activeEntry = useMemo(() => {
    if (!entries.length) return null;
    return (
      entries.find(
        (e) => currentTime >= e.start_seconds - 0.1 && currentTime < e.end_seconds
      ) || null
    );
  }, [entries, currentTime]);

  // Auto-scroll active row
  useEffect(() => {
    if (activeEntry && activeRowRef.current && isPlaying) {
      activeRowRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeEntry?.id, isPlaying]);

  // Run Faster-Whisper Alignment
  const handleRunFasterWhisper = async () => {
    if (!currentAudio) {
      showToast(`Audio Part #${activePart} belum di-upload di Step 2.`, 'error');
      return;
    }

    setIsWhisperRunning(true);
    setWhisperProgress(10);
    setWhisperStatus('Menyiapkan Faster-Whisper model...');

    try {
      if (api?.runHumanologiWhisperAlignment) {
        const res = await api.runHumanologiWhisperAlignment(activePart, 'medium');
        if (res.success && res.data) {
          setTranscripts((prev) => ({ ...prev, [activePart]: res.data! }));
          showToast(`✓ Faster-Whisper selesai! ${res.data.total_entries} adegan tersinkronisasi.`, 'success');
        } else {
          showToast(res.error || 'Gagal menjalankan Faster-Whisper alignment.', 'error');
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Terjadi kesalahan pada Faster-Whisper.', 'error');
    } finally {
      setIsWhisperRunning(false);
      setWhisperProgress(0);
      setWhisperStatus('');
    }
  };

  // Seek audio
  const handleSeek = (sec: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, sec);
      setCurrentTime(sec);
      if (!isPlaying) {
        audioRef.current.play().catch(() => {});
      }
    }
  };

  const parts = narasiData?.narasi || [{ part: 1, judul_bagian: 'Part 1' }];
  const audioDuration = currentAudio?.duration || currentTranscript?.audio_duration || 0;

  return (
    <div className="max-w-5xl mx-auto space-y-5 animate-fadeIn pb-16">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-6 right-6 z-50 px-4 py-2.5 rounded-2xl shadow-xl border text-xs font-bold transition-all ${
            toast.type === 'error'
              ? 'bg-red-950 text-red-200 border-red-700'
              : 'bg-emerald-950 text-emerald-200 border-emerald-600'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Hidden HTML5 Audio Tag */}
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

      {/* ─── TOP HEADER & SIMPLE CONTROLS ─────────────────────────────────── */}
      <div className="bg-gray-900/90 border border-gray-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">📝</span>
              <h2 className="text-base font-bold text-white">
                Audio Transcript & Alignment
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800">
                Step 3 of 4
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Alignment naskah kata per kata otomatis dengan Faster-Whisper. Transkrip ini menjadi patokan sinkronisasi durasi di Step 4.
            </p>
          </div>

          {/* Action Button: Run Faster-Whisper */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleRunFasterWhisper}
              disabled={isWhisperRunning || !currentAudio}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-lg ${
                isWhisperRunning
                  ? 'bg-gray-800 text-gray-400 cursor-wait'
                  : currentAudio
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30 cursor-pointer'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed'
              }`}
              title={!currentAudio ? 'Upload audio di Step 2 terlebih dahulu' : 'Jalankan Faster-Whisper alignment'}
            >
              <span>{isWhisperRunning ? '⏳' : '⚡'}</span>
              <span>
                {isWhisperRunning
                  ? 'Sedang Aligning...'
                  : entries.length > 0
                  ? 'Re-align Faster-Whisper'
                  : 'Jalankan Faster-Whisper'}
              </span>
            </button>
          </div>
        </div>

        {/* Faster-Whisper Live Progress Bar */}
        {isWhisperRunning && (
          <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/60 space-y-1.5 animate-fadeIn">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-emerald-300 truncate">{whisperStatus || 'Menjalankan Faster-Whisper...'}</span>
              <span className="text-emerald-400 font-bold">{whisperProgress}%</span>
            </div>
            <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                style={{ width: `${whisperProgress}%` }}
                className="h-full bg-emerald-500 transition-all duration-300"
              />
            </div>
          </div>
        )}

        {/* Part Tabs Selector */}
        <div className="flex items-center gap-2 pt-2 border-t border-gray-800 overflow-x-auto">
          {parts.map((p) => {
            const hasAudio = audioList.some((a) => a.part === p.part);
            const tr = transcripts[p.part];
            const count = tr?.entries?.length || 0;
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
                  ({count > 0 ? `${count} adegan` : 'kosong'})
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── LIVE VISUAL MAPPING STAGE (AKTIF SAAT AUDIO DI-PLAY) ──────────── */}
      <div className="bg-gray-950 border border-emerald-800/50 rounded-2xl overflow-hidden shadow-xl space-y-0">
        {/* Active Visual Screen (16:9 Viewport) */}
        <div className="relative aspect-video w-full bg-gradient-to-b from-gray-900 to-black p-5 sm:p-6 flex flex-col justify-between border-b border-gray-800">
          {/* Header Tag on Screen */}
          <div className="flex items-center justify-between text-xs relative z-10">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  isPlaying ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'
                }`}
              />
              <span className="font-mono text-[11px] font-bold text-gray-300">
                {isPlaying ? 'LIVE VISUAL MAPPING SYNC' : 'STANDBY (KLIK PLAY UNTUK PREVIEW)'}
              </span>
            </div>

            {activeEntry && (
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="px-2 py-0.5 rounded bg-black/60 text-emerald-400 border border-emerald-700/60 font-bold">
                  ⏱️ {activeEntry.timestamp_minute}
                </span>
                {activeEntry.camera_movement && (
                  <span className="px-2 py-0.5 rounded bg-black/60 text-cyan-300 border border-cyan-800/60">
                    🎥 {activeEntry.camera_movement}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Center: Active Spoken Word / Transcript Monitor */}
          <div className="my-auto text-center max-w-2xl mx-auto space-y-3 relative z-10">
            {activeEntry ? (
              <div className="p-5 rounded-2xl bg-black/60 backdrop-blur-md border border-emerald-500/30 space-y-2 shadow-xl">
                <div className="text-[10px] font-mono text-emerald-400 uppercase tracking-wider font-bold">
                  Kata Terdeteksi #{activeEntry.id} · Timestamp {activeEntry.timestamp_minute}
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-wide">
                  ❝ {activeEntry.text} ❞
                </div>
                <div className="text-[11px] text-emerald-300/80 font-mono pt-1">
                  ⏱️ Durasi Kata: {(activeEntry.end_seconds - activeEntry.start_seconds).toFixed(2)}s ({activeEntry.start_seconds}s - {activeEntry.end_seconds}s)
                </div>
              </div>
            ) : (
              <div className="text-gray-500 text-xs py-4">
                {entries.length > 0
                  ? 'Tekan tombol Play ▶ di bawah untuk memutar audio dan memantau sinkronisasi kata'
                  : 'Klik "Jalankan Faster-Whisper" di atas untuk membuat transkrip kata part ini'}
              </div>
            )}
          </div>

          {/* Bottom Subtitle Overlay */}
          <div className="text-center relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/70 border border-gray-800 text-[11px] font-mono text-gray-400">
              <span>💡</span>
              <span>Pemecahan adegan pendek & prompt gambar visual siap di</span>
              <span className="text-emerald-300 font-bold">Step 4: Visual Mapping & Prompts</span>
            </div>
          </div>
        </div>

        {/* Audio Player Controls */}
        <div className="p-3.5 bg-gray-900/90 flex flex-wrap items-center justify-between gap-3 text-xs">
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
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                isPlaying
                  ? 'bg-amber-600 hover:bg-amber-500 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              } disabled:bg-gray-800 disabled:text-gray-500 cursor-pointer`}
            >
              <span>{isPlaying ? '⏸️ Pause' : '▶ Play Audio'}</span>
            </button>

            <span className="font-mono text-xs text-gray-300">
              {formatDuration(currentTime)} / {formatDuration(audioDuration)}
            </span>
          </div>

          {/* Seekbar */}
          <div
            className="flex-1 min-w-[150px] max-w-md h-2 bg-gray-800 rounded-full overflow-hidden cursor-pointer relative"
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
        </div>
      </div>

      {/* ─── DAFTAR KALIMAT & TIMELINE TRANSCRIPT ──────────────────────────── */}
      <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-5 shadow-xl space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-gray-800 text-xs">
          <span className="font-bold text-white uppercase font-mono tracking-wider">
            Daftar Adegan ({entries.length})
          </span>
          <span className="text-gray-400 font-mono text-[11px]">
            Klik baris mana saja untuk loncat (seek) ke waktu tersebut
          </span>
        </div>

        {entries.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-500 border border-dashed border-gray-800 rounded-xl space-y-2">
            <div>Belum ada transcript untuk Part #{activePart}.</div>
            <div>Klik tombol <strong>"Jalankan Faster-Whisper"</strong> di bagian atas untuk memulai.</div>
          </div>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {entries.map((entry) => {
              const isActive = activeEntry?.id === entry.id;

              return (
                <div
                  key={entry.id}
                  ref={isActive ? activeRowRef : null}
                  onClick={() => handleSeek(entry.start_seconds)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                    isActive
                      ? 'bg-emerald-950/70 border-emerald-500 shadow-md ring-1 ring-emerald-400'
                      : 'bg-gray-950/60 border-gray-800 hover:border-gray-700'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 ${
                        isActive
                          ? 'bg-emerald-500 text-black'
                          : 'bg-gray-800 text-gray-400'
                      }`}
                    >
                      #{entry.id}
                    </span>

                    <div className="min-w-0 space-y-0.5">
                      <div
                        className={`text-xs ${
                          isActive ? 'text-emerald-200 font-bold' : 'text-gray-200'
                        }`}
                      >
                        {entry.text}
                      </div>
                      <div className="text-[11px] text-gray-400 truncate">
                        🎬 {entry.visual_description}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                    <span className="text-[10px] font-mono text-emerald-400 bg-gray-900 px-2 py-0.5 rounded border border-gray-800">
                      ⏱️ {entry.timestamp_minute}
                    </span>
                    {entry.camera_movement && (
                      <span className="text-[10px] font-mono text-cyan-300 bg-gray-900 px-1.5 py-0.5 rounded border border-gray-800 hidden sm:inline">
                        {entry.camera_movement}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── FOOTER NAVIGATION ────────────────────────────────────────────── */}
      <div className="p-4 rounded-2xl bg-gray-900/90 border border-gray-800 flex items-center justify-between text-xs">
        {onBackToAudio ? (
          <button
            type="button"
            onClick={onBackToAudio}
            className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-750 text-gray-200 font-bold transition-all"
          >
            ← Kembali ke Step 2: Upload Audio
          </button>
        ) : (
          <div />
        )}

        {onGoToRender && (
          <button
            type="button"
            onClick={onGoToRender}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold uppercase tracking-wider transition-all shadow-lg shadow-emerald-600/30"
          >
            Lanjut ke Step 4: Visual Mapping & Prompts →
          </button>
        )}
      </div>
    </div>
  );
};

export default HumanologiTranscriptStep;
