// dashboard/src/components/faceless/FacelessAudioStep.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import type {
  FacelessAudioItem,
  FacelessProjectState,
  FacelessTranscriptData,
} from '../../electron-api';
import { cleanVoiceoverScript } from '../../utils/cleanScript';
import { parseAndFormatTimecodedTranscript } from '../../utils/transcriptParser';

const api = window.electronAPI;

interface FacelessAudioStepProps {
  onBackToIdea?: () => void;
  onGoToNext?: () => void;
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export const FacelessAudioStep: React.FC<FacelessAudioStepProps> = ({
  onBackToIdea,
  onGoToNext,
}) => {
  const [state, setState] = useState<FacelessProjectState | null>(null);
  const [audioList, setAudioList] = useState<FacelessAudioItem[]>([]);
  const [inputDir, setInputDir] = useState<string>('');
  const [audioDir, setAudioDir] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [uploading, setUploading] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedScript, setCopiedScript] = useState<boolean>(false);
  const [isScriptExpanded, setIsScriptExpanded] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(
    null
  );

  // Transcript state
  const [rawTranscript, setRawTranscript] = useState<string>('');
  const [savedTranscript, setSavedTranscript] = useState<FacelessTranscriptData | null>(null);
  const [isSavingTranscript, setIsSavingTranscript] = useState<boolean>(false);
  const [copiedTranscript, setCopiedTranscript] = useState<boolean>(false);
  const [transcriptViewMode, setTranscriptViewMode] = useState<'split' | 'formatted' | 'raw'>('split');
  const [transcriptSearch, setTranscriptSearch] = useState<string>('');
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptFileInputRef = useRef<HTMLInputElement>(null);
  const audioPlayerRef = useRef<HTMLAudioElement>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Load faceless project state
      if (api?.getFacelessState) {
        const stateRes = await api.getFacelessState();
        if (stateRes?.success && stateRes.data) {
          setState(stateRes.data);
        }
      }

      // 2. Load audio files
      if (api?.listFacelessAudios) {
        const aRes = await api.listFacelessAudios();
        if (aRes?.success && aRes.audios) {
          setAudioList(aRes.audios);
          if (aRes.inputDir) setInputDir(aRes.inputDir);
          if (aRes.audioDir) setAudioDir(aRes.audioDir);
        }
      }

      // 3. Audio directory path
      if (api?.getFacelessAudioDir) {
        const dRes = await api.getFacelessAudioDir();
        if (dRes?.success) {
          if (dRes.dir) setInputDir(dRes.dir);
          if (dRes.audioDir) setAudioDir(dRes.audioDir);
        }
      }

      // 4. Load saved transcript
      if (api?.getFacelessTranscript) {
        const tRes = await api.getFacelessTranscript();
        if (tRes?.success && tRes.data) {
          setSavedTranscript(tRes.data);
          if (tRes.data.rawText || tRes.data.formattedText) {
            setRawTranscript(tRes.data.rawText || tRes.data.formattedText);
          }
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Gagal memuat data audio.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const draftScript = state?.narration?.draft_script || state?.memory?.draft_script || '';
  const cleanScript = useMemo(() => {
    return cleanVoiceoverScript(draftScript);
  }, [draftScript]);

  const cleanWordCount = useMemo(() => {
    return cleanScript.split(/\s+/).filter(Boolean).length;
  }, [cleanScript]);

  // Estimated speech duration in seconds (~140 words/min = 2.33 words/sec)
  const estimatedSeconds = Math.round((cleanWordCount / 140) * 60);

  // Single Long Form Voiceover audio item
  const mainAudio = useMemo(() => {
    return audioList.find((a) => a.part === null || a.name.startsWith('voiceover')) || audioList[0] || null;
  }, [audioList]);

  // Parsed transcript memo (1 line per timecode)
  const parsedTranscript = useMemo(() => {
    return parseAndFormatTimecodedTranscript(rawTranscript);
  }, [rawTranscript]);

  const filteredSegments = useMemo(() => {
    if (!transcriptSearch.trim()) return parsedTranscript.segments;
    const query = transcriptSearch.toLowerCase();
    return parsedTranscript.segments.filter(
      (seg) => seg.text.toLowerCase().includes(query) || seg.timecode.toLowerCase().includes(query)
    );
  }, [parsedTranscript.segments, transcriptSearch]);

  // Audio seeking / playback sync
  const handleAudioTimeUpdate = () => {
    if (audioPlayerRef.current) {
      setCurrentPlaybackTime(audioPlayerRef.current.currentTime);
    }
  };

  const handleSeekAudio = (sec: number) => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.currentTime = sec;
      audioPlayerRef.current.play().catch(() => {});
      showToast(`⏱️ Audio diputar dari ${formatDuration(sec)}`, 'info');
    } else {
      showToast(`Timecode: ${formatDuration(sec)} (Upload audio untuk mendengarkan langsung)`, 'info');
    }
  };

  // Handle upload via electron selectAudio dialog (Direct Long Form Audio)
  const handleSelectAndUploadAudio = async () => {
    try {
      if (!api?.selectAudio) {
        showToast('Fitur dialog file tidak tersedia.', 'error');
        return;
      }

      const file = await api.selectAudio();
      if (!file || !file.path) return;

      setUploading(true);

      if (api?.uploadFacelessAudio) {
        const res = await api.uploadFacelessAudio({
          filePath: file.path,
          part: null, // Always single full long-form audio
        });

        if (res?.success && res.audio) {
          showToast(
            `🎉 Audio Long Form berhasil disimpan ke input/faceless (${res.audio.name})!`,
            'success'
          );
          await loadData();
        } else {
          showToast(res?.error || 'Gagal mengupload file audio.', 'error');
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Terjadi kesalahan saat upload audio.', 'error');
    } finally {
      setUploading(false);
    }
  };

  // Handle drop or file input fallback for audio
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const filePath = (file as any).path;

    if (!filePath) {
      showToast('Path file lokal tidak terdeteksi dari browser.', 'error');
      return;
    }

    try {
      setUploading(true);

      if (api?.uploadFacelessAudio) {
        const res = await api.uploadFacelessAudio({
          filePath,
          part: null,
        });

        if (res?.success && res.audio) {
          showToast(
            `🎉 Audio Long Form berhasil disimpan ke input/faceless (${res.audio.name})!`,
            'success'
          );
          await loadData();
        } else {
          showToast(res?.error || 'Gagal mengupload file audio.', 'error');
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Gagal mengupload file audio.', 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteAudio = async (audioId: string) => {
    if (!window.confirm('Hapus file audio voiceover ini dari input/faceless?')) return;
    setDeletingId(audioId);
    try {
      if (api?.deleteFacelessAudio) {
        const res = await api.deleteFacelessAudio(audioId);
        if (res?.success) {
          showToast('🗑️ File audio berhasil dihapus dari input/faceless.', 'info');
          await loadData();
        } else {
          showToast(res?.error || 'Gagal menghapus file audio.', 'error');
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Gagal menghapus audio.', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenFolder = () => {
    const targetFolder = audioDir || inputDir;
    if (targetFolder && api?.openInFolder) {
      api.openInFolder(targetFolder);
    } else {
      showToast('Folder belum terdeteksi.', 'info');
    }
  };

  const handleCopyCleanScript = () => {
    if (!cleanScript) return;
    navigator.clipboard.writeText(cleanScript);
    setCopiedScript(true);
    showToast('📋 Naskah bersih berhasil disalin ke clipboard!', 'success');
    setTimeout(() => setCopiedScript(false), 2000);
  };

  // Transcript Handlers
  const handleSaveTranscript = async () => {
    if (!rawTranscript.trim()) {
      showToast('Transkrip masih kosong. Masukkan teks transkrip terlebih dahulu.', 'info');
      return;
    }

    setIsSavingTranscript(true);
    try {
      if (api?.saveFacelessTranscript) {
        const res = await api.saveFacelessTranscript({
          rawText: rawTranscript,
          formattedText: parsedTranscript.formattedText,
          segments: parsedTranscript.segments,
          part: null,
        });

        if (res?.success && res.data) {
          setSavedTranscript(res.data);
          showToast(
            `🎉 Transkrip (${res.data.segments?.length || 0} baris) berhasil disimpan ke input/faceless/transcript.txt!`,
            'success'
          );
        } else {
          showToast(res?.error || 'Gagal menyimpan transkrip.', 'error');
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Terjadi kesalahan saat menyimpan transkrip.', 'error');
    } finally {
      setIsSavingTranscript(false);
    }
  };

  const handleCopyFormattedTranscript = () => {
    if (!parsedTranscript.formattedText) {
      showToast('Belum ada transkrip yang diformat.', 'info');
      return;
    }
    navigator.clipboard.writeText(parsedTranscript.formattedText);
    setCopiedTranscript(true);
    showToast('📋 Transkrip ber-timecode (per baris) berhasil disalin!', 'success');
    setTimeout(() => setCopiedTranscript(false), 2500);
  };

  const handleTranscriptFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];

    try {
      const text = await file.text();
      if (!text.trim()) {
        showToast('File transkrip kosong.', 'error');
        return;
      }
      setRawTranscript(text);
      showToast(`📄 File "${file.name}" berhasil diunggah & otomatis diformat!`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Gagal membaca file transkrip.', 'error');
    } finally {
      if (transcriptFileInputRef.current) transcriptFileInputRef.current.value = '';
    }
  };

  const handleLoadSampleTranscript = () => {
    const sample =
      '(0:00) Semua orang di luar kota panik berebut jalan tol. (0:03) Sementara aku berhasil mengunci diri di dalam supermarket grocery (0:06) dua lantai seluas 3.000 meter persegi. (0:11) Pintu rolling door setebal 5 cm terkunci mati dengan 3 gembok baja.';
    setRawTranscript(sample);
    showToast('✨ Contoh transkrip dimasukkan dan otomatis dirapikan per baris timecode!', 'info');
  };

  const handleClearTranscript = () => {
    if (rawTranscript && !window.confirm('Kosongkan input transkrip?')) return;
    setRawTranscript('');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      {/* Toast Notification */}
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

      {/* Hidden file inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
        className="hidden"
      />
      <input
        type="file"
        ref={transcriptFileInputRef}
        onChange={handleTranscriptFileChange}
        accept=".txt,.srt,.vtt,.json"
        className="hidden"
      />

      {/* Header Banner */}
      <div className="bg-gray-900/90 border border-gray-800 rounded-3xl p-6 shadow-2xl backdrop-blur-md relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 rounded-full bg-amber-950/80 text-amber-300 border border-amber-700/50 text-[11px] font-mono font-bold tracking-wider uppercase">
                🎯 Step 2: Voice Over & Transcribe Studio
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-950/80 text-indigo-300 text-[10px] font-mono border border-indigo-700/60 font-bold">
                🎬 Fokus Long Form (Shorts tinggal di-cut)
              </span>
              {state?.duration && (
                <span className="px-2.5 py-0.5 rounded-full bg-sky-950/60 text-sky-300 text-[10px] font-mono border border-sky-800/60">
                  ⏱️ Target: {state.duration.label}
                </span>
              )}
              {mainAudio ? (
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 text-[10px] font-mono border border-emerald-700/60 flex items-center gap-1 font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  ✓ Audio Siap ({formatDuration(mainAudio.duration)})
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full bg-gray-800 text-gray-400 text-[10px] font-mono border border-gray-700">
                  Menunggu Upload Audio
                </span>
              )}
              {savedTranscript && (
                <span className="px-2.5 py-0.5 rounded-full bg-amber-950/80 text-amber-300 text-[10px] font-mono border border-amber-700/60 flex items-center gap-1 font-bold">
                  ✓ Transkrip Tersimpan ({savedTranscript.segments?.length || 0} baris)
                </span>
              )}
            </div>

            <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <span>🎙️</span> Voice Over Audio & Transkrip (Long Form)
            </h1>
            <p className="text-xs text-gray-400 leading-relaxed max-w-3xl">
              Upload 1 file audio hasil voiceover lengkap (Long Form) dan hasil transcribe timecode-nya. Seluruh file otomatis disimpan langsung di folder{' '}
              <code className="text-amber-300 bg-gray-950 px-1.5 py-0.5 rounded border border-gray-800 font-mono text-[11px]">
                input/faceless/audio/voiceover.mp3
              </code>{' '}
              dan{' '}
              <code className="text-amber-300 bg-gray-950 px-1.5 py-0.5 rounded border border-gray-800 font-mono text-[11px]">
                input/faceless/transcript.txt
              </code>.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleOpenFolder}
              className="px-3.5 py-2 bg-gray-800/90 hover:bg-gray-700 text-amber-300 hover:text-amber-200 text-xs font-bold rounded-xl border border-gray-700 hover:border-amber-500/50 transition-all flex items-center gap-1.5 shadow-md"
              title="Buka folder input faceless di file manager"
            >
              <span>📁</span> Buka Folder Faceless
            </button>
            {onBackToIdea && (
              <button
                onClick={onBackToIdea}
                className="px-3.5 py-2 bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-semibold rounded-xl border border-gray-700 transition-all flex items-center gap-1.5"
              >
                <span>←</span> Step 1 (Ide & Naskah)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Script Reference Card (Collapsible) */}
      {draftScript && (
        <div className="bg-gray-900/70 border border-gray-800 rounded-2xl p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-base">📝</span>
              <div>
                <h3 className="text-xs font-bold text-amber-300 flex items-center gap-2">
                  <span>Referensi Naskah Voiceover (Step 1)</span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800/60 text-[10px] font-mono">
                    {cleanWordCount} kata narasi · Estimasi ~{formatDuration(estimatedSeconds)}
                  </span>
                </h3>
                <p className="text-[10px] text-gray-400">
                  Naskah narasi bersih lengkap untuk digenerate sekali jalan di ElevenLabs atau software audio pilihanmu.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyCleanScript}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-gray-950 text-xs font-black rounded-xl transition-all shadow-md flex items-center gap-1.5"
              >
                <span>{copiedScript ? '✓ Tersalin!' : '📋 Salin Naskah Bersih'}</span>
              </button>
              <button
                onClick={() => setIsScriptExpanded(!isScriptExpanded)}
                className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium rounded-xl border border-gray-700 transition-all flex items-center gap-1"
              >
                <span>{isScriptExpanded ? '▲ Ciutkan' : '▼ Lihat Naskah'}</span>
              </button>
            </div>
          </div>

          {isScriptExpanded && (
            <div className="bg-gray-950/80 border border-gray-800 rounded-xl p-3.5 text-xs font-mono text-gray-300 leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto selection:bg-amber-500 selection:text-black">
              {cleanScript}
            </div>
          )}
        </div>
      )}

      {/* SECTION 1: SINGLE LONG FORM AUDIO UPLOAD & PLAYER */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎙️</span>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Voice Over Audio (Long Form Penuh)</span>
                <span className="px-2 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-800/60 text-[10px] font-mono">
                  1 File Langsung Penuh
                </span>
              </h2>
              <p className="text-[11px] text-gray-400">
                Audio voiceover digenerate langsung penuh sekaligus. Untuk shorts nantinya tinggal dipotong (cut) dari file audio ini.
              </p>
            </div>
          </div>
        </div>

        {mainAudio ? (
          /* Card Audio yang Sudah Ter-upload */
          <div className="bg-gray-900/90 border border-emerald-500/40 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-950 border border-emerald-500/50 flex items-center justify-center text-2xl shadow-inner">
                  🎙️
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/50 text-[10px] font-mono font-bold">
                      ✓ Audio Utama Ter-upload
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 text-[10px] font-mono">
                      {formatBytes(mainAudio.size)}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800/60 text-[10px] font-mono font-bold">
                      ⏱️ Durasi: {formatDuration(mainAudio.duration)}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-white mt-1 break-all">
                    {mainAudio.name}
                  </h3>
                  <p className="text-[11px] text-gray-400 font-mono mt-0.5">
                    Tersimpan di: <span className="text-gray-300">{mainAudio.filePath}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSelectAndUploadAudio}
                  disabled={uploading}
                  className="px-3.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-amber-300 text-xs font-bold rounded-xl border border-gray-700 transition-all flex items-center gap-1.5 shadow-sm"
                >
                  <span>🔄</span> Ganti Audio
                </button>
                <button
                  onClick={() => handleDeleteAudio(mainAudio.id)}
                  disabled={deletingId === mainAudio.id}
                  className="px-3.5 py-1.5 bg-red-950/80 hover:bg-red-900 text-red-300 text-xs font-bold rounded-xl border border-red-800/60 transition-all flex items-center gap-1.5 shadow-sm"
                >
                  <span>🗑️</span> Hapus
                </button>
              </div>
            </div>

            {/* Audio Player Controls */}
            {mainAudio.url && (
              <div className="bg-gray-950/80 border border-gray-800 rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span className="font-semibold text-gray-300 flex items-center gap-1">
                    <span>▶️</span> Audio Player Preview
                  </span>
                  <span className="font-mono text-emerald-400 font-bold">
                    {formatDuration(currentPlaybackTime)} / {formatDuration(mainAudio.duration)}
                  </span>
                </div>
                <audio
                  ref={audioPlayerRef}
                  onTimeUpdate={handleAudioTimeUpdate}
                  src={mainAudio.url}
                  controls
                  className="w-full h-11 accent-amber-500 rounded-xl outline-none"
                />
              </div>
            )}
          </div>
        ) : (
          /* Upload Dropzone untuk Single Audio */
          <div
            onClick={handleSelectAndUploadAudio}
            className="border-2 border-dashed border-gray-700 hover:border-amber-500/80 bg-gray-900/40 hover:bg-gray-900/80 rounded-3xl p-10 text-center cursor-pointer transition-all space-y-3 group shadow-xl"
          >
            <div className="w-16 h-16 rounded-3xl bg-amber-500/10 text-amber-400 border border-amber-500/30 mx-auto flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
              🎙️
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white group-hover:text-amber-300 transition-colors">
                Klik untuk Pilih & Upload Voice Over (Long Form)
              </h3>
              <p className="text-xs text-gray-400 max-w-md mx-auto">
                Format yang didukung: <span className="text-gray-300 font-mono">.mp3, .wav, .m4a, .aac, .ogg</span>. File otomatis disimpan di <span className="text-amber-300 font-mono">input/faceless/audio/voiceover.mp3</span>.
              </p>
            </div>
            <div>
              <button
                type="button"
                disabled={uploading}
                className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-gray-950 text-xs font-black shadow-lg shadow-amber-600/30 transition-all inline-flex items-center gap-2"
              >
                <span>{uploading ? '⏳ Mengupload & Menganalisis...' : '📂 Pilih File Audio Voiceover'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 2: TRANSKRIP VOICEOVER TIMECODE STUDIO */}
      <div className="bg-gray-900/90 border border-gray-800 rounded-3xl p-6 shadow-2xl backdrop-blur-md space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap border-b border-gray-800/80 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-700/60 text-[10px] font-mono font-bold uppercase tracking-wider">
                📝 Transkrip Voiceover Timecode
              </span>
              {parsedTranscript.segments.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700/50 text-[10px] font-mono font-bold">
                  ✓ {parsedTranscript.segments.length} Baris Timecode Terdeteksi
                </span>
              )}
              {savedTranscript && (
                <span className="px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 text-[10px] font-mono">
                  💾 input/faceless/transcript.txt
                </span>
              )}
            </div>
            <h2 className="text-lg font-black text-white flex items-center gap-2">
              <span>⚡</span> Upload & Auto-Format Transkrip Timecode
            </h2>
            <p className="text-xs text-gray-400 max-w-2xl leading-relaxed">
              Paste teks hasil transcribe dari Whisper / ElevenLabs dalam format apa saja (misal:{' '}
              <span className="text-amber-300 font-mono text-[11px]">(0:00) teks... (0:03) teks...</span>). Sistem otomatis merapikan menjadi{' '}
              <strong className="text-white">1 baris per timecode</strong> dan menyimpannya di{' '}
              <code className="text-amber-300 bg-gray-950 px-1 py-0.5 rounded border border-gray-800 font-mono text-[10px]">
                input/faceless/transcript.txt
              </code>.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleLoadSampleTranscript}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-sky-300 hover:text-sky-200 text-xs font-bold rounded-xl border border-sky-800/50 transition-all flex items-center gap-1.5 shadow-sm"
              title="Isi dengan contoh format naskah timecode"
            >
              <span>✨</span> Contoh Input
            </button>
            <button
              onClick={() => transcriptFileInputRef.current?.click()}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-amber-300 hover:text-amber-200 text-xs font-bold rounded-xl border border-gray-700 hover:border-amber-500/50 transition-all flex items-center gap-1.5 shadow-sm"
            >
              <span>📂</span> Upload File (.txt / .srt)
            </button>
            <button
              onClick={handleCopyFormattedTranscript}
              disabled={!parsedTranscript.formattedText}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 text-xs font-black rounded-xl transition-all shadow-md flex items-center gap-1.5"
            >
              <span>{copiedTranscript ? '✓ Tersalin!' : '📋 Salin Transkrip Rapi'}</span>
            </button>
            <button
              onClick={handleSaveTranscript}
              disabled={isSavingTranscript || !rawTranscript.trim()}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-emerald-700/20 flex items-center gap-1.5"
            >
              <span>{isSavingTranscript ? '⏳ Menyimpan...' : '💾 Simpan Transkrip'}</span>
            </button>
          </div>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 bg-gray-950/80 border border-gray-800 rounded-xl p-1">
            <button
              onClick={() => setTranscriptViewMode('split')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                transcriptViewMode === 'split'
                  ? 'bg-amber-500 text-gray-950 shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Berdampingan (Input + Hasil)
            </button>
            <button
              onClick={() => setTranscriptViewMode('formatted')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                transcriptViewMode === 'formatted'
                  ? 'bg-amber-500 text-gray-950 shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Hasil Rapi ({parsedTranscript.segments.length} Baris)
            </button>
            <button
              onClick={() => setTranscriptViewMode('raw')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                transcriptViewMode === 'raw'
                  ? 'bg-amber-500 text-gray-950 shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Input Mentah
            </button>
          </div>

          {rawTranscript && (
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={handleClearTranscript}
                className="text-gray-500 hover:text-red-400 text-[11px] underline transition-colors"
              >
                Kosongkan Input
              </button>
            </div>
          )}
        </div>

        {/* Studio Content according to transcriptViewMode */}
        {transcriptViewMode === 'split' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left: Input Textarea */}
            <div className="space-y-2 flex flex-col">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span className="font-bold text-gray-300 flex items-center gap-1.5">
                  <span>📥</span> Paste Hasil Transkrip Mentah
                </span>
                <span className="text-[11px] font-mono text-gray-500">
                  {rawTranscript.length} karakter
                </span>
              </div>
              <textarea
                value={rawTranscript}
                onChange={(e) => setRawTranscript(e.target.value)}
                placeholder="Contoh format input:&#10;(0:00) Semua orang di luar kota panik berebut jalan tol. (0:03) Sementara aku berhasil mengunci diri di dalam supermarket grocery (0:06) dua lantai seluas 3.000 meter persegi. (0:11) Pintu rolling door setebal 5 cm terkunci mati dengan 3 gembok baja."
                rows={12}
                className="w-full bg-gray-950 border border-gray-800 rounded-2xl p-4 text-xs font-mono text-gray-200 focus:outline-none focus:border-amber-500/80 transition-all resize-y leading-relaxed placeholder:text-gray-600 selection:bg-amber-500 selection:text-black shadow-inner flex-1 min-h-[260px]"
              />
              <p className="text-[10px] text-gray-500 italic">
                💡 Tip: Kamu bisa paste seluruh paragraf transkrip sekaligus. Sistem otomatis memecah setiap timecode <span className="font-mono text-gray-400">(0:00), (0:03)...</span> menjadi 1 baris tersendiri.
              </p>
            </div>

            {/* Right: Formatted Per-Line Output & Interactive Segment Cards */}
            <div className="space-y-2 flex flex-col">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                  <span>✨</span> Hasil Rapi (1 Baris Per Timecode)
                </span>
                <span className="text-[11px] font-mono text-amber-300 font-bold">
                  {parsedTranscript.segments.length} Baris
                </span>
              </div>

              {parsedTranscript.segments.length > 0 ? (
                <div className="bg-gray-950 border border-gray-800 rounded-2xl p-3 flex-1 flex flex-col min-h-[260px] max-h-[360px] overflow-hidden">
                  <div className="overflow-y-auto space-y-2 pr-1 flex-1">
                    {parsedTranscript.segments.map((seg, idx) => {
                      // Check if this segment is actively playing in audio
                      const isPlayingThis =
                        mainAudio?.url &&
                        currentPlaybackTime >= seg.seconds &&
                        (idx === parsedTranscript.segments.length - 1 ||
                          currentPlaybackTime < parsedTranscript.segments[idx + 1].seconds);

                      return (
                        <div
                          key={idx}
                          className={`p-2.5 rounded-xl border text-xs transition-all flex items-start gap-2.5 ${
                            isPlayingThis
                              ? 'bg-amber-500/15 border-amber-500 text-white shadow-md'
                              : 'bg-gray-900/60 border-gray-800/80 text-gray-300 hover:border-gray-700 hover:bg-gray-900'
                          }`}
                        >
                          <button
                            onClick={() => handleSeekAudio(seg.seconds)}
                            className={`px-2 py-0.5 rounded-lg text-[11px] font-mono font-bold transition-all shrink-0 flex items-center gap-1 ${
                              isPlayingThis
                                ? 'bg-amber-500 text-gray-950 shadow-sm'
                                : 'bg-gray-800 hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 border border-gray-700'
                            }`}
                            title={`Putar audio dari ${seg.timecode}`}
                          >
                            <span>▶</span>
                            <span>{seg.timecode}</span>
                          </button>
                          <span className="leading-relaxed flex-1 select-text">
                            {seg.text}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-2.5 border-t border-gray-800/80 flex items-center justify-between text-[11px] text-gray-400">
                    <span>Klik badge timecode untuk melompat di audio player.</span>
                    <button
                      onClick={handleCopyFormattedTranscript}
                      className="text-amber-400 hover:text-amber-300 font-bold underline"
                    >
                      Salin Semua ({parsedTranscript.segments.length} Baris)
                    </button>
                  </div>
                </div>
              ) : (
                <div className="border border-dashed border-gray-800 rounded-2xl p-8 text-center flex-1 flex flex-col items-center justify-center space-y-2 text-gray-500 min-h-[260px]">
                  <span className="text-3xl">📝</span>
                  <p className="text-xs">
                    Belum ada teks transkrip. Paste di sebelah kiri atau klik{' '}
                    <strong
                      onClick={handleLoadSampleTranscript}
                      className="text-amber-400 hover:underline cursor-pointer"
                    >
                      Contoh Input
                    </strong>.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* View Mode: FORMATTED FULL LIST */}
        {transcriptViewMode === 'formatted' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <input
                type="text"
                placeholder="🔍 Cari kata dalam transkrip..."
                value={transcriptSearch}
                onChange={(e) => setTranscriptSearch(e.target.value)}
                className="bg-gray-950 border border-gray-800 rounded-xl px-3 py-1.5 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-amber-500/80 w-64"
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 font-mono">
                  Menampilkan {filteredSegments.length} dari {parsedTranscript.segments.length} baris
                </span>
              </div>
            </div>

            <div className="bg-gray-950 border border-gray-800 rounded-2xl p-4 max-h-[450px] overflow-y-auto space-y-2">
              {filteredSegments.length > 0 ? (
                filteredSegments.map((seg, idx) => {
                  const isPlayingThis =
                    mainAudio?.url &&
                    currentPlaybackTime >= seg.seconds &&
                    (idx === parsedTranscript.segments.length - 1 ||
                      currentPlaybackTime < parsedTranscript.segments[idx + 1].seconds);

                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded-xl border text-xs transition-all flex items-start gap-3 ${
                        isPlayingThis
                          ? 'bg-amber-500/15 border-amber-500 text-white shadow-md'
                          : 'bg-gray-900/60 border-gray-800/80 text-gray-300 hover:border-gray-700'
                      }`}
                    >
                      <button
                        onClick={() => handleSeekAudio(seg.seconds)}
                        className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-amber-500/20 text-amber-300 font-mono text-xs font-bold border border-gray-700 transition-all shrink-0 flex items-center gap-1.5"
                        title="Dengarkan dari timecode ini"
                      >
                        <span>▶</span>
                        <span>{seg.timecode}</span>
                      </button>
                      <p className="leading-relaxed flex-1 select-text pt-0.5">
                        {seg.text}
                      </p>
                    </div>
                  );
                })
              ) : (
                <div className="py-12 text-center text-xs text-gray-500">
                  Tidak ada baris yang cocok dengan kata kunci pencarian.
                </div>
              )}
            </div>

            {/* Formatted Text Box (Clean Export View) */}
            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span className="font-semibold text-gray-300">
                  📄 Teks Output Bersih (Sesuai Format File transcript.txt)
                </span>
                <button
                  onClick={handleCopyFormattedTranscript}
                  className="text-amber-400 hover:text-amber-300 font-bold underline"
                >
                  Salin Teks Bersih
                </button>
              </div>
              <div className="bg-gray-950 border border-gray-800 rounded-xl p-3 text-xs font-mono text-gray-300 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto selection:bg-amber-500 selection:text-black">
                {parsedTranscript.formattedText || '// Belum ada transkrip terformat'}
              </div>
            </div>
          </div>
        )}

        {/* View Mode: RAW INPUT ONLY */}
        {transcriptViewMode === 'raw' && (
          <div className="space-y-2">
            <textarea
              value={rawTranscript}
              onChange={(e) => setRawTranscript(e.target.value)}
              placeholder="Paste teks hasil transcribe di sini..."
              rows={14}
              className="w-full bg-gray-950 border border-gray-800 rounded-2xl p-4 text-xs font-mono text-gray-200 focus:outline-none focus:border-amber-500/80 transition-all resize-y leading-relaxed"
            />
          </div>
        )}
      </div>

      {/* Directory Storage Path Info Card */}
      <div className="bg-gray-950/60 border border-gray-800/80 rounded-2xl p-4 flex items-center justify-between gap-3 text-xs text-gray-400">
        <div className="flex items-center gap-2 truncate">
          <span>💾</span>
          <span className="truncate">
            Lokasi Simpan: <code className="text-gray-300 font-mono">{inputDir || 'input/faceless'}</code>{' '}
            <span className="text-gray-500">
              (audio/voiceover.mp3 & transcript.txt)
            </span>
          </span>
        </div>
        <button
          onClick={handleOpenFolder}
          className="text-amber-400 hover:text-amber-300 font-bold shrink-0 underline"
        >
          Buka di File Manager ➔
        </button>
      </div>

      {/* Bottom Navigation */}
      <div className="flex items-center justify-between gap-3 pt-4 border-t border-gray-800">
        {onBackToIdea && (
          <button
            onClick={onBackToIdea}
            className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-bold rounded-xl border border-gray-700 transition-all flex items-center gap-1.5"
          >
            <span>←</span> Kembali ke Step 1 (Ide & Naskah)
          </button>
        )}

        <div className="flex items-center gap-3">
          {mainAudio && parsedTranscript.segments.length > 0 && (
            <div className="text-right hidden sm:block">
              <span className="text-[11px] text-emerald-400 font-bold block">
                ✓ Audio & Transkrip Siap
              </span>
              <span className="text-[10px] text-gray-500 font-mono">
                Durasi: {formatDuration(mainAudio.duration)} · {parsedTranscript.segments.length} Baris Timecode
              </span>
            </div>
          )}

          <button
            onClick={handleSaveTranscript}
            disabled={isSavingTranscript || !rawTranscript.trim()}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-emerald-700/20 flex items-center gap-1.5"
          >
            <span>💾</span> Simpan Seluruh Data
          </button>

          {onGoToNext && (
            <button
              onClick={onGoToNext}
              className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-gray-950 text-xs font-black rounded-xl transition-all shadow-lg shadow-amber-600/30 flex items-center gap-1.5"
            >
              <span>🎨 Lanjut ke Step 3 (Visual Prompt)</span>
              <span>➔</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FacelessAudioStep;
