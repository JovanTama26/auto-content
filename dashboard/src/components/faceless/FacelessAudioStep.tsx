// dashboard/src/components/faceless/FacelessAudioStep.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import type {
  FacelessAudioItem,
  FacelessProjectState,
  FacelessTranscriptData,
  FacelessTopicItem,
  FacelessEpisodeSummary,
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
  // Multi-topic & Multi-episode navigation
  const [topics, setTopics] = useState<FacelessTopicItem[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string>('');
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>('');
  const [loadingTopics, setLoadingTopics] = useState<boolean>(true);

  // Episode-scoped data
  const [state, setState] = useState<FacelessProjectState | null>(null);
  const [audioList, setAudioList] = useState<FacelessAudioItem[]>([]);
  const [inputDir, setInputDir] = useState<string>('');
  const [audioDir, setAudioDir] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [uploading, setUploading] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Script Preview State
  const [copiedScript, setCopiedScript] = useState<boolean>(false);
  const [isScriptExpanded, setIsScriptExpanded] = useState<boolean>(false);

  // Transcript state
  const [rawTranscript, setRawTranscript] = useState<string>('');
  const [savedTranscript, setSavedTranscript] = useState<FacelessTranscriptData | null>(null);
  const [isSavingTranscript, setIsSavingTranscript] = useState<boolean>(false);
  const [copiedTranscript, setCopiedTranscript] = useState<boolean>(false);
  const [transcriptTab, setTranscriptTab] = useState<'input' | 'preview'>('input');
  const [transcriptSearch, setTranscriptSearch] = useState<string>('');
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState<number>(0);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptFileInputRef = useRef<HTMLInputElement>(null);
  const audioPlayerRef = useRef<HTMLAudioElement>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Active topic & episode memo
  const currentTopic = useMemo(() => {
    return topics.find((t) => t.id === selectedTopicId) || topics[0] || null;
  }, [topics, selectedTopicId]);

  const currentEpisode = useMemo(() => {
    return currentTopic?.episodes.find((e) => e.id === selectedEpisodeId) || currentTopic?.episodes[0] || null;
  }, [currentTopic, selectedEpisodeId]);

  // Load episode-scoped data (script, audio, transcript)
  const loadEpisodeData = async (topicId: string, episodeId: string) => {
    setLoading(true);
    // Explicitly reset all episode-specific state to prevent cross-episode data leak
    setState(null);
    setAudioList([]);
    setSavedTranscript(null);
    setRawTranscript('');
    setTranscriptTab('input');

    try {
      // 1. Load project state
      if (api?.getFacelessState) {
        const stateRes = await api.getFacelessState({ topicId, episodeId });
        if (stateRes?.success && stateRes.data) {
          setState(stateRes.data);
        } else {
          setState(null);
        }
      }

      // 2. Load audio files for this topic/episode
      if (api?.listFacelessAudios) {
        const aRes = await api.listFacelessAudios({ topicId, episodeId });
        if (aRes?.success && aRes.audios) {
          setAudioList(aRes.audios);
          if (aRes.inputDir) setInputDir(aRes.inputDir);
          if (aRes.audioDir) setAudioDir(aRes.audioDir);
        } else {
          setAudioList([]);
        }
      }

      // 3. Load saved transcript for this topic/episode
      if (api?.getFacelessTranscript) {
        const tRes = await api.getFacelessTranscript({ topicId, episodeId });
        if (tRes?.success && tRes.data) {
          setSavedTranscript(tRes.data);
          if (tRes.data.rawText || tRes.data.formattedText) {
            setRawTranscript(tRes.data.rawText || tRes.data.formattedText);
          }
          setTranscriptTab('preview');
        } else {
          setSavedTranscript(null);
          setRawTranscript('');
          setTranscriptTab('input');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Initial load of topics list and active session
  const initTopicsAndSession = async () => {
    setLoadingTopics(true);
    try {
      if (api?.listFacelessTopicsAndEpisodes) {
        const res = await api.listFacelessTopicsAndEpisodes();
        if (res.success && res.topics && res.topics.length > 0) {
          setTopics(res.topics);
          const activeTopicId = res.activeTopicId || res.topics[0].id;
          setSelectedTopicId(activeTopicId);

          const matchedTopic = res.topics.find((t) => t.id === activeTopicId) || res.topics[0];
          const activeEpId = res.activeEpisodeId || matchedTopic.episodes[0]?.id || 'ep_01';
          setSelectedEpisodeId(activeEpId);

          await loadEpisodeData(activeTopicId, activeEpId);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Gagal memuat topik: ${msg}`, 'error');
    } finally {
      setLoadingTopics(false);
    }
  };

  useEffect(() => {
    initTopicsAndSession();
  }, []);

  // Switch Topic handler
  const handleSelectTopic = async (topicId: string) => {
    if (topicId === selectedTopicId) return;
    setSelectedTopicId(topicId);
    const targetTopicObj = topics.find((t) => t.id === topicId);
    const targetEpId = targetTopicObj?.episodes[0]?.id || 'ep_01';
    setSelectedEpisodeId(targetEpId);
    await api?.setFacelessActiveSession?.({ topicId, episodeId: targetEpId });
    await loadEpisodeData(topicId, targetEpId);
  };

  // Switch Episode handler
  const handleSelectEpisode = async (episodeId: string) => {
    if (episodeId === selectedEpisodeId) return;
    setSelectedEpisodeId(episodeId);
    await api?.setFacelessActiveSession?.({ topicId: selectedTopicId, episodeId });
    await loadEpisodeData(selectedTopicId, episodeId);
  };

  // Script calculations
  const draftScript = state?.narration?.draft_script || state?.memory?.draft_script || '';
  const cleanScript = useMemo(() => {
    return cleanVoiceoverScript(draftScript);
  }, [draftScript]);

  const cleanWordCount = useMemo(() => {
    return cleanScript.split(/\s+/).filter(Boolean).length;
  }, [cleanScript]);

  // Estimated voiceover duration (~140 words per minute in Indonesian)
  const estimatedSeconds = useMemo(() => {
    return Math.round((cleanWordCount / 140) * 60);
  }, [cleanWordCount]);

  // Main voiceover audio
  const mainAudio = useMemo(() => {
    if (audioList.length === 0) return null;
    return audioList.find((a) => a.part === null || a.name.includes('voiceover')) || audioList[0];
  }, [audioList]);

  // Parsed transcript
  const parsedTranscript = useMemo(() => {
    return parseAndFormatTimecodedTranscript(rawTranscript);
  }, [rawTranscript]);

  // Search filtered segments
  const filteredSegments = useMemo(() => {
    if (!transcriptSearch.trim()) return parsedTranscript.segments;
    const q = transcriptSearch.toLowerCase();
    return parsedTranscript.segments.filter(
      (s) => s.text.toLowerCase().includes(q) || s.timecode.toLowerCase().includes(q)
    );
  }, [parsedTranscript.segments, transcriptSearch]);

  // Upload Audio Handler
  const handleSelectAndUploadAudio = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const filePath = (file as any).path;

    if (!filePath) {
      showToast('Path file audio tidak dapat dibaca di browser ini.', 'error');
      return;
    }

    setUploading(true);
    try {
      if (api?.uploadFacelessAudio) {
        const res = await api.uploadFacelessAudio({
          filePath,
          part: null,
          topicId: selectedTopicId,
          episodeId: selectedEpisodeId,
        });

        if (res?.success && res.audio) {
          showToast(`🎉 File "${res.audio.originalName || res.audio.name}" berhasil diunggah!`, 'success');
          await loadEpisodeData(selectedTopicId, selectedEpisodeId);
        } else {
          showToast(res?.error || 'Gagal mengupload file audio.', 'error');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg, 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Delete Audio Handler
  const handleDeleteAudio = async (audioId: string) => {
    if (!window.confirm('Hapus file audio voiceover ini dari episode aktif?')) return;
    setDeletingId(audioId);
    try {
      if (api?.deleteFacelessAudio) {
        const res = await api.deleteFacelessAudio(audioId, {
          topicId: selectedTopicId,
          episodeId: selectedEpisodeId,
        });
        if (res?.success) {
          showToast('🗑️ File audio berhasil dihapus.', 'info');
          await loadEpisodeData(selectedTopicId, selectedEpisodeId);
        } else {
          showToast(res?.error || 'Gagal menghapus file audio.', 'error');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg, 'error');
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
    showToast('📋 Naskah bersih berhasil disalin! Siap dipaste ke ElevenLabs / TTS.', 'success');
    setTimeout(() => setCopiedScript(false), 2000);
  };

  // Save Transcript Handler
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
          topicId: selectedTopicId,
          episodeId: selectedEpisodeId,
        });

        if (res?.success && res.data) {
          setSavedTranscript(res.data);
          setTranscriptTab('preview');
          showToast(
            `🎉 Transkrip (${res.data.segments?.length || 0} baris) berhasil disimpan untuk ${selectedEpisodeId.toUpperCase()}!`,
            'success'
          );
        } else {
          showToast(res?.error || 'Gagal menyimpan transkrip.', 'error');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg, 'error');
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
    setTimeout(() => setCopiedTranscript(false), 2000);
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
      setTranscriptTab('preview');
      showToast(`📄 File "${file.name}" berhasil diunggah & otomatis dirapikan!`, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg, 'error');
    } finally {
      if (transcriptFileInputRef.current) transcriptFileInputRef.current.value = '';
    }
  };

  const handleLoadSampleTranscript = () => {
    const sample =
      '(0:00) Semua orang di luar kota panik berebut jalan tol. (0:03) Sementara aku berhasil mengunci diri di dalam supermarket grocery (0:06) dua lantai seluas 3.000 meter persegi. (0:11) Pintu rolling door setebal 5 cm terkunci mati dengan 3 gembok baja.';
    setRawTranscript(sample);
    setTranscriptTab('preview');
    showToast('✨ Contoh transkrip dimasukkan dan otomatis diformat!', 'info');
  };

  const handleSeekAudio = (seconds: number) => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.currentTime = seconds;
      audioPlayerRef.current.play().catch(() => {});
    }
  };

  const handleAudioTimeUpdate = () => {
    if (audioPlayerRef.current) {
      setCurrentPlaybackTime(audioPlayerRef.current.currentTime);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4 pb-16">
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

      {/* Header Banner Ringkas & Elegan */}
      <div className="bg-gray-900/90 border border-gray-800 rounded-3xl p-5 shadow-xl backdrop-blur-md relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-700/50 text-[11px] font-mono font-bold tracking-wider uppercase">
                🎯 Step 2: Voice Over & Transkrip
              </span>
              {mainAudio ? (
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 text-[10px] font-mono border border-emerald-700/60 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  ✓ Audio Siap ({formatDuration(mainAudio.duration)})
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full bg-gray-800 text-gray-400 text-[10px] font-mono border border-gray-700">
                  Menunggu Upload Audio
                </span>
              )}
              {savedTranscript && (
                <span className="px-2.5 py-0.5 rounded-full bg-amber-950/80 text-amber-300 text-[10px] font-mono border border-amber-700/60 font-bold flex items-center gap-1">
                  ✓ Transkrip ({savedTranscript.segments?.length || 0} Baris)
                </span>
              )}
            </div>
            <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
              <span>🎙️</span> Studio Voice Over & Sinkronisasi Transkrip
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenFolder}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-amber-300 text-xs font-semibold rounded-xl border border-gray-700 transition-all flex items-center gap-1.5 shadow-sm"
              title="Buka folder episode di file manager"
            >
              <span>📁</span> Buka Folder
            </button>
            {onBackToIdea && (
              <button
                onClick={onBackToIdea}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-semibold rounded-xl border border-gray-700 transition-all flex items-center gap-1.5"
              >
                <span>←</span> Step 1
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── GROUPING BAR 1: PILIH TOPIK SERIAL ─── */}
      <div className="bg-gray-900/60 border border-gray-800/80 rounded-2xl p-3 shadow-md space-y-1.5">
        <label className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
          <span>📁</span> Topik Serial ({topics.length} Topik):
        </label>
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

      {/* ─── GROUPING BAR 2: PILIH EPISODE ─── */}
      {currentTopic && (
        <div className="bg-gray-900/60 border border-gray-800/80 rounded-2xl p-3 shadow-md space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
            <span>🎞️</span> Episode: <span className="text-white normal-case font-semibold">{currentTopic.title}</span>
          </label>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
            {(currentTopic.episodes || []).map((ep: FacelessEpisodeSummary) => {
              const isSelected = ep.id === selectedEpisodeId;
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
                  <span className="font-medium max-w-[200px] truncate">{ep.title.replace(/^Supermarket Apocalypse - /i, '')}</span>
                  {ep.isLocked && (
                    <span className="text-[10px]" title="Episode Terkunci">
                      🔒
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── WORKSPACE DUA KOLOM BERDAMPINGAN (2-COLUMN SPLIT STUDIO) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* KOLOM KIRI (5 Kolom): Naskah Voiceover & Audio File */}
        <div className="lg:col-span-5 space-y-4">
          {/* Card 1: Naskah Voiceover Acuan (Step 1) */}
          <div className="bg-gray-900/90 border border-gray-800 rounded-3xl p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                <span>📜</span> Naskah Voiceover {selectedEpisodeId.toUpperCase()}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800/60 text-[10px] font-mono">
                {cleanWordCount} kata · ~{formatDuration(estimatedSeconds)}
              </span>
            </div>

            <p className="text-[11px] text-gray-400 leading-relaxed">
              Salin naskah bersih di bawah ini untuk dibacakan di ElevenLabs atau software TTS favoritmu.
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyCleanScript}
                disabled={!cleanScript}
                className="flex-1 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-40 text-gray-950 text-xs font-black rounded-xl transition-all shadow-md shadow-amber-600/20 flex items-center justify-center gap-1.5"
              >
                <span>{copiedScript ? '✓ Naskah Tersalin!' : '📋 Salin Naskah Bersih'}</span>
              </button>
              <button
                onClick={() => setIsScriptExpanded(!isScriptExpanded)}
                className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold rounded-xl border border-gray-700 transition-all flex items-center gap-1"
                title={isScriptExpanded ? 'Ciutkan naskah' : 'Lihat isi naskah lengkap'}
              >
                <span>{isScriptExpanded ? '▲' : '▼'}</span>
              </button>
            </div>

            {/* Collapsible script view */}
            {isScriptExpanded && cleanScript && (
              <div className="bg-gray-950 border border-gray-800 rounded-2xl p-3.5 text-xs font-mono text-gray-300 leading-relaxed whitespace-pre-wrap max-h-56 overflow-y-auto selection:bg-amber-500 selection:text-black">
                {cleanScript}
              </div>
            )}
          </div>

          {/* Card 2: Upload / Audio Player */}
          <div className="bg-gray-900/90 border border-gray-800 rounded-3xl p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>🎙️</span> File Audio Voiceover
              </span>
              {mainAudio && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700/60 text-[10px] font-mono font-bold">
                  {formatDuration(mainAudio.duration)}
                </span>
              )}
            </div>

            {mainAudio ? (
              <div className="space-y-3">
                <div className="p-3 bg-gray-950 rounded-2xl border border-emerald-500/30 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-xl">🎵</span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">{mainAudio.name}</p>
                      <p className="text-[10px] text-gray-400 font-mono">
                        {formatBytes(mainAudio.size)} · Durasi: {formatDuration(mainAudio.duration)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={handleSelectAndUploadAudio}
                      disabled={uploading}
                      className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-amber-300 text-xs font-bold rounded-lg border border-gray-700 transition-all"
                      title="Ganti dengan file audio baru"
                    >
                      Ganti
                    </button>
                    <button
                      onClick={() => handleDeleteAudio(mainAudio.id)}
                      disabled={deletingId === mainAudio.id}
                      className="px-2.5 py-1 bg-red-950/80 hover:bg-red-900 text-red-300 text-xs font-bold rounded-lg border border-red-800/60 transition-all"
                      title="Hapus file audio ini"
                    >
                      Hapus
                    </button>
                  </div>
                </div>

                {/* Audio Player Controls */}
                {mainAudio.url && (
                  <div className="bg-gray-950 p-3 rounded-2xl border border-gray-800 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-gray-400 font-mono">
                      <span>▶️ Playback Preview</span>
                      <span className="text-emerald-400 font-bold">
                        {formatDuration(currentPlaybackTime)} / {formatDuration(mainAudio.duration)}
                      </span>
                    </div>
                    <audio
                      ref={audioPlayerRef}
                      onTimeUpdate={handleAudioTimeUpdate}
                      src={mainAudio.url}
                      controls
                      className="w-full h-9 accent-amber-500 rounded-lg outline-none"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div
                onClick={handleSelectAndUploadAudio}
                className="border-2 border-dashed border-gray-700 hover:border-amber-500/80 bg-gray-950/60 hover:bg-gray-950 rounded-2xl p-6 text-center cursor-pointer transition-all space-y-2 group shadow-inner"
              >
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/30 mx-auto flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                  🎙️
                </div>
                <div className="space-y-0.5">
                  <h4 className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors">
                    Klik untuk Pilih Audio (.mp3, .wav)
                  </h4>
                  <p className="text-[10px] text-gray-500">File otomatis disimpan untuk {selectedEpisodeId.toUpperCase()}</p>
                </div>
                <button
                  type="button"
                  disabled={uploading}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-gray-950 text-xs font-black shadow-md transition-all inline-flex items-center gap-1.5"
                >
                  <span>{uploading ? '⏳ Mengupload...' : '📂 Pilih File Audio'}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* KOLOM KANAN (7 Kolom): Transkrip Timecode Studio */}
        <div className="lg:col-span-7 bg-gray-900/90 border border-gray-800 rounded-3xl p-5 shadow-xl space-y-3.5">
          {/* Header Bar Transkrip & View Tabs */}
          <div className="flex items-center justify-between gap-3 flex-wrap pb-2 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                <span>⚡</span> Transkrip Timecode ({parsedTranscript.segments.length} Baris)
              </span>
            </div>

            {/* Tab Mode: Input vs Preview */}
            <div className="flex items-center gap-1 bg-gray-950 p-1 rounded-xl border border-gray-800">
              <button
                onClick={() => setTranscriptTab('input')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  transcriptTab === 'input'
                    ? 'bg-amber-500 text-gray-950 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                📥 Input / Edit
              </button>
              <button
                onClick={() => setTranscriptTab('preview')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  transcriptTab === 'preview'
                    ? 'bg-amber-500 text-gray-950 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                📋 Preview Baris ({parsedTranscript.segments.length})
              </button>
            </div>
          </div>

          {/* TAB 1: INPUT TRANSKRIP */}
          {transcriptTab === 'input' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[11px] text-gray-400 leading-relaxed">
                  Paste teks dari Whisper / ElevenLabs dengan timecode <code className="text-amber-300 font-mono">(0:00)... (0:03)...</code>
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleLoadSampleTranscript}
                    className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-sky-300 text-[10px] font-bold rounded-lg transition-all"
                  >
                    ✨ Contoh
                  </button>
                  <button
                    onClick={() => transcriptFileInputRef.current?.click()}
                    className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-amber-300 text-[10px] font-bold rounded-lg border border-gray-700 transition-all flex items-center gap-1"
                  >
                    <span>📂</span> Upload .txt / .srt
                  </button>
                </div>
              </div>

              <textarea
                value={rawTranscript}
                onChange={(e) => setRawTranscript(e.target.value)}
                placeholder="Contoh format:&#10;(0:00) Semua orang di luar kota panik berebut jalan tol. (0:03) Sementara aku berhasil mengunci diri di dalam supermarket grosir (0:06) dua lantai seluas 3.000 meter persegi. (0:11) Pintu rolling door setebal 5 cm terkunci mati."
                rows={10}
                className="w-full bg-gray-950 border border-gray-800 rounded-2xl p-3.5 text-xs font-mono text-gray-200 focus:outline-none focus:border-amber-500/80 transition-all resize-y leading-relaxed placeholder:text-gray-600 selection:bg-amber-500 selection:text-black shadow-inner min-h-[220px]"
              />

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[10px] text-gray-500 font-mono">
                  {rawTranscript.length} karakter · {parsedTranscript.segments.length} baris terdeteksi
                </span>
                <button
                  onClick={handleSaveTranscript}
                  disabled={isSavingTranscript || !rawTranscript.trim()}
                  className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-emerald-700/20 flex items-center gap-1.5"
                >
                  <span>{isSavingTranscript ? '⏳ Menyimpan...' : '💾 Simpan Transkrip'}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: PREVIEW BARIS & SINKRONISASI AUDIO */}
          {transcriptTab === 'preview' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <input
                  type="text"
                  placeholder="🔍 Cari kata dalam transkrip..."
                  value={transcriptSearch}
                  onChange={(e) => setTranscriptSearch(e.target.value)}
                  className="bg-gray-950 border border-gray-800 rounded-xl px-3 py-1.5 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-amber-500/80 w-56"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyFormattedTranscript}
                    disabled={!parsedTranscript.formattedText}
                    className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-gray-950 text-xs font-bold rounded-xl transition-all shadow-sm flex items-center gap-1"
                  >
                    <span>{copiedTranscript ? '✓ Tersalin' : '📋 Salin Rapi'}</span>
                  </button>
                  <button
                    onClick={handleSaveTranscript}
                    disabled={isSavingTranscript || !rawTranscript.trim()}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl transition-all shadow-sm flex items-center gap-1"
                  >
                    <span>💾 Simpan</span>
                  </button>
                </div>
              </div>

              {/* List of Timecoded Segments */}
              <div className="bg-gray-950 border border-gray-800 rounded-2xl p-2.5 max-h-[360px] overflow-y-auto space-y-1.5 scrollbar-thin">
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
                        className={`p-2 rounded-xl border text-xs transition-all flex items-start gap-2.5 ${
                          isPlayingThis
                            ? 'bg-amber-500/15 border-amber-500 text-white shadow-md'
                            : 'bg-gray-900/60 border-gray-800/80 text-gray-300 hover:border-gray-700'
                        }`}
                      >
                        <button
                          onClick={() => handleSeekAudio(seg.seconds)}
                          className="px-2 py-0.5 rounded-lg bg-gray-800 hover:bg-amber-500/30 text-amber-300 font-mono text-[11px] font-bold border border-gray-700 transition-all shrink-0 flex items-center gap-1 cursor-pointer"
                          title="Putar audio dari detik ini"
                        >
                          <span>▶</span>
                          <span>{seg.timecode}</span>
                        </button>
                        <p className="leading-relaxed flex-1 select-text pt-0.5 text-xs">{seg.text}</p>
                      </div>
                    );
                  })
                ) : (
                  <div className="py-12 text-center text-xs text-gray-500">
                    Belum ada transkrip ber-timecode. Beralih ke tab <strong>"Input / Edit"</strong> untuk memasukkan transkrip.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Navigation Ringkas */}
      <div className="flex items-center justify-between gap-3 pt-3 border-t border-gray-800 flex-wrap">
        {onBackToIdea && (
          <button
            onClick={onBackToIdea}
            className="px-3.5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-semibold rounded-xl border border-gray-700 transition-all flex items-center gap-1.5"
          >
            <span>←</span> Step 1 (Ide & Naskah)
          </button>
        )}

        <div className="flex items-center gap-3 ml-auto">
          {mainAudio && parsedTranscript.segments.length > 0 && (
            <span className="text-xs font-mono text-emerald-400 font-semibold hidden sm:inline">
              ✓ Audio: {formatDuration(mainAudio.duration)} · {parsedTranscript.segments.length} Baris Transkrip
            </span>
          )}

          {onGoToNext && (
            <button
              onClick={async () => {
                await api?.setFacelessActiveSession?.({ topicId: selectedTopicId, episodeId: selectedEpisodeId });
                onGoToNext();
              }}
              className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-gray-950 text-xs font-black rounded-xl transition-all shadow-lg shadow-amber-600/30 flex items-center gap-1.5"
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
