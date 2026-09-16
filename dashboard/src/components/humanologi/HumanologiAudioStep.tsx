// dashboard/src/components/humanologi/HumanologiAudioStep.tsx
import React, { useState, useEffect, useRef } from 'react';
import type { HumanologiAudioItem } from '../../electron-api';

const api = window.electronAPI;

interface HumanologiNarasiPart {
  part: number;
  judul_bagian?: string;
  total_karakter?: number;
  teks?: string;
}

interface HumanologiNarasiData {
  topik_pilihan?: string;
  judul_video?: string;
  estimasi_total_karakter?: number;
  total_part?: number;
  narasi: HumanologiNarasiPart[];
}

interface HumanologiAudioStepProps {
  onBackToTopic?: () => void;
  onGoToVisual?: () => void;
  onGoToTranscript?: () => void;
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

export const HumanologiAudioStep: React.FC<HumanologiAudioStepProps> = ({
  onBackToTopic,
  onGoToVisual,
  onGoToTranscript,
}) => {
  const [narasiData, setNarasiData] = useState<HumanologiNarasiData | null>(null);
  const [audioList, setAudioList] = useState<HumanologiAudioItem[]>([]);
  const [audioDir, setAudioDir] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [uploadingPart, setUploadingPart] = useState<number | null>(null);
  const [deletingPart, setDeletingPart] = useState<number | null>(null);
  const [copiedPart, setCopiedPart] = useState<number | null>(null);
  const [expandedPreviewPart, setExpandedPreviewPart] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(
    null
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [targetUploadPart, setTargetUploadPart] = useState<number | null>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Load latest narration
      if (api?.getLatestHumanologiNarasi) {
        const nRes = await api.getLatestHumanologiNarasi();
        if (nRes?.success && nRes.data) {
          setNarasiData(nRes.data);
        }
      }

      // 2. Load audio items
      if (api?.listHumanologiAudios) {
        const aRes = await api.listHumanologiAudios();
        if (aRes?.success && aRes.audios) {
          setAudioList(aRes.audios);
        }
      }

      // 3. Load audio dir path
      if (api?.getHumanologiAudioDir) {
        const dRes = await api.getHumanologiAudioDir();
        if (dRes?.success && dRes.dir) {
          setAudioDir(dRes.dir);
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

  // Handle upload via electron selectAudio
  const handleSelectAndUpload = async (partNum: number) => {
    try {
      if (!api?.selectAudio) {
        // Fallback to web input if in browser mock
        setTargetUploadPart(partNum);
        fileInputRef.current?.click();
        return;
      }

      const file = await api.selectAudio();
      if (!file) return;

      setUploadingPart(partNum);
      if (api?.uploadHumanologiAudio) {
        const res = await api.uploadHumanologiAudio(partNum, file.path);
        if (res.success && res.audio) {
          showToast(`✓ Berhasil mengupload audio Part #${partNum}!`, 'success');
          // Refresh list
          const listRes = await api.listHumanologiAudios?.();
          if (listRes?.success && listRes.audios) {
            setAudioList(listRes.audios);
          }
        } else {
          showToast(res.error || `Gagal mengupload audio Part #${partNum}`, 'error');
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Terjadi kesalahan saat upload audio.', 'error');
    } finally {
      setUploadingPart(null);
    }
  };

  // Handle delete
  const handleDeleteAudio = async (partNum: number) => {
    if (!confirm(`Yakin ingin menghapus file audio untuk Part #${partNum}?`)) {
      return;
    }

    setDeletingPart(partNum);
    try {
      if (api?.deleteHumanologiAudio) {
        const res = await api.deleteHumanologiAudio(partNum);
        if (res.success) {
          showToast(`File audio Part #${partNum} telah dihapus.`, 'info');
          const listRes = await api.listHumanologiAudios?.();
          if (listRes?.success && listRes.audios) {
            setAudioList(listRes.audios);
          }
        } else {
          showToast(res.error || 'Gagal menghapus audio.', 'error');
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Gagal menghapus audio.', 'error');
    } finally {
      setDeletingPart(null);
    }
  };

  // Copy text of part for ElevenLabs
  const handleCopyPartText = (partNum: number, text?: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedPart(partNum);
    showToast(`📋 Narasi Part #${partNum} (${text.length} char) disalin ke clipboard!`, 'success');
    setTimeout(() => setCopiedPart(null), 2500);
  };

  // Open audio storage folder
  const handleOpenFolder = () => {
    if (audioDir && api?.openInFolder) {
      api.openInFolder(audioDir);
    } else {
      showToast('Lokasi folder audio: input/humanologi/audio', 'info');
    }
  };

  // Compute summary metrics
  const parts = narasiData?.narasi || [];
  const totalPartsCount = parts.length;
  const audioMap = new Map<number, HumanologiAudioItem>();
  audioList.forEach((a) => audioMap.set(a.part, a));

  const uploadedCount = parts.filter((p) => audioMap.has(p.part)).length;
  const allUploaded = totalPartsCount > 0 && uploadedCount === totalPartsCount;
  const totalDurationSec = audioList.reduce((acc, a) => acc + (a.duration || 0), 0);
  const totalNarrationChars = parts.reduce((acc, p) => acc + (p.total_karakter || p.teks?.length || 0), 0);

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fadeIn pb-16">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-2xl border text-xs font-bold transition-all transform animate-bounce ${
            toast.type === 'error'
              ? 'bg-red-950 text-red-200 border-red-700'
              : toast.type === 'info'
              ? 'bg-blue-950 text-blue-200 border-blue-700'
              : 'bg-emerald-950 text-emerald-200 border-emerald-500'
          }`}
        >
          <span>{toast.type === 'error' ? '❌' : toast.type === 'info' ? 'ℹ️' : '✨'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Hidden file input for web fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file && targetUploadPart !== null && api?.uploadHumanologiAudio) {
            // Note: In Electron web fallback, file.path is available on File object
            const filePath = (file as any).path;
            if (filePath) {
              setUploadingPart(targetUploadPart);
              await api.uploadHumanologiAudio(targetUploadPart, filePath);
              const listRes = await api.listHumanologiAudios?.();
              if (listRes?.success && listRes.audios) setAudioList(listRes.audios);
              setUploadingPart(null);
            }
          }
        }}
      />

      {/* ─── SECTION 1: TOP HEADER & STATUS KPI ───────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-950/70 via-slate-900 to-gray-950 border border-emerald-800/40 p-6 shadow-2xl">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-900/70 border border-emerald-500/40 flex items-center justify-center text-3xl shadow-xl shadow-emerald-950/60">
              🎙️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold text-white tracking-tight">
                  Upload Audio Narator Voiceover
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Step 2 of 4
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
                  ElevenLabs TTS Ready
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Upload dan verifikasi file voiceover narasi per part yang telah digenerate dari ElevenLabs.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenFolder}
              className="px-3.5 py-2 rounded-xl bg-gray-900/90 hover:bg-gray-800 text-gray-300 border border-gray-700 text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm"
              title="Buka direktori penyimpanan file audio di file explorer"
            >
              <span>📁</span>
              <span>Buka Folder Audio</span>
            </button>
            <button
              onClick={loadData}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl bg-gray-900/90 hover:bg-gray-800 text-gray-300 border border-gray-700 text-xs font-semibold transition-all flex items-center gap-1.5"
              title="Muat ulang status audio"
            >
              <span className={loading ? 'animate-spin' : ''}>🔄</span>
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* KPI Metrics Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-emerald-900/30">
          <div className="p-3 rounded-2xl bg-gray-950/70 border border-gray-800/80">
            <div className="text-[10px] uppercase font-mono text-gray-400">Status Upload Part</div>
            <div className="text-base font-extrabold mt-0.5 flex items-center gap-1.5">
              <span
                className={
                  allUploaded
                    ? 'text-emerald-400'
                    : uploadedCount > 0
                    ? 'text-amber-400'
                    : 'text-gray-400'
                }
              >
                {uploadedCount} / {totalPartsCount} Parts
              </span>
              {allUploaded && <span className="text-xs">✅</span>}
            </div>
            <div className="text-[10px] text-gray-500 font-mono mt-0.5">
              {allUploaded ? 'Semua audio lengkap' : `${totalPartsCount - uploadedCount} part belum ada`}
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-gray-950/70 border border-gray-800/80">
            <div className="text-[10px] uppercase font-mono text-gray-400">Total Durasi Audio</div>
            <div className="text-base font-extrabold text-emerald-400 font-mono mt-0.5">
              ⏱️ {formatDuration(totalDurationSec)}
            </div>
            <div className="text-[10px] text-gray-500 font-mono mt-0.5">
              ~{(totalDurationSec / 60).toFixed(1)} menit total VO
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-gray-950/70 border border-gray-800/80">
            <div className="text-[10px] uppercase font-mono text-gray-400">Total Karakter Narasi</div>
            <div className="text-base font-extrabold text-gray-200 font-mono mt-0.5">
              {totalNarrationChars.toLocaleString('id-ID')} chars
            </div>
            <div className="text-[10px] text-gray-500 font-mono mt-0.5">
              {totalPartsCount} Bagian @ 4.5k - 5k
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-gray-950/70 border border-gray-800/80">
            <div className="text-[10px] uppercase font-mono text-gray-400">Format Rekomendasi</div>
            <div className="text-base font-extrabold text-gray-300 font-mono mt-0.5">
              MP3 / WAV
            </div>
            <div className="text-[10px] text-gray-500 font-mono mt-0.5">
              ElevenLabs 44.1kHz 128kbps+
            </div>
          </div>
        </div>
      </div>

      {/* ─── ELEVENLABS WORKFLOW TIPS BANNER ──────────────────────────────── */}
      <div className="p-4 rounded-2xl bg-gray-900/80 border border-gray-800 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs text-gray-300">
        <div className="flex items-start gap-3">
          <span className="text-xl p-2 rounded-xl bg-emerald-950 border border-emerald-800/50 text-emerald-400 shrink-0">
            💡
          </span>
          <div>
            <div className="font-bold text-white flex items-center gap-2">
              <span>Alur Kerja Cepat ElevenLabs TTS</span>
              <span className="px-2 py-0.2 rounded text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800">
                Efisiensi Waktu
              </span>
            </div>
            <p className="text-gray-400 mt-0.5 leading-relaxed">
              1. Klik tombol <strong>Copy Narasi</strong> di kartu part di bawah ➔ 2. Paste ke ElevenLabs (satu part pas ~4.500 - 5.000 chars) ➔ 3. Klik Generate ➔ 4. Download file audio & upload langsung ke part terkait.
            </p>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2">
          <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 px-3 py-1.5 rounded-xl border border-emerald-800/40">
            Target per render: 1 Part
          </span>
        </div>
      </div>

      {/* ─── EMPTY STATE: NO NARRATION FOUND ──────────────────────────────── */}
      {parts.length === 0 && !loading && (
        <div className="p-10 rounded-3xl bg-gray-900/60 border border-dashed border-gray-800 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-amber-950/50 border border-amber-800/60 text-3xl flex items-center justify-center mx-auto">
            ✍️
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Naskah Narasi Belum Tersedia</h3>
            <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">
              Anda belum menyimpan naskah narasi per part di Step 1 (Naskah & Prompt Studio). Silakan kembali ke Step 1 untuk mem-paste naskah terlebih dahulu.
            </p>
          </div>
          <div>
            {onBackToTopic && (
              <button
                onClick={onBackToTopic}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-lg shadow-emerald-600/30 cursor-pointer"
              >
                ← Kembali ke Step 1: Naskah & Prompt Studio
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── SECTION 2: AUDIO UPLOAD CARDS PER PART ───────────────────────── */}
      <div className="space-y-4">
        {parts.map((partItem) => {
          const partNum = partItem.part;
          const assignedAudio = audioMap.get(partNum);
          const isUploaded = !!assignedAudio;
          const isUploading = uploadingPart === partNum;
          const isDeleting = deletingPart === partNum;
          const isCopied = copiedPart === partNum;
          const isPreviewOpen = expandedPreviewPart === partNum;
          const textLength = partItem.total_karakter || partItem.teks?.length || 0;
          const estMinutes = Math.round((textLength / 1000) * 10) / 10;

          return (
            <div
              key={partNum}
              className={`rounded-3xl border transition-all duration-200 overflow-hidden shadow-xl ${
                isUploaded
                  ? 'bg-gray-900/85 border-emerald-800/50 shadow-emerald-950/20'
                  : 'bg-gray-900/60 border-gray-800 hover:border-gray-700'
              }`}
            >
              {/* Card Header */}
              <div className="p-5 border-b border-gray-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <span
                    className={`w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-black font-mono shadow-md ${
                      isUploaded
                        ? 'bg-emerald-900/80 text-emerald-300 border border-emerald-500/40 shadow-emerald-950/50'
                        : 'bg-gray-800 text-gray-400 border border-gray-700'
                    }`}
                  >
                    #{partNum}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-white">
                        {partItem.judul_bagian || `Part ${partNum}: Bagian Narasi`}
                      </h3>
                      {isUploaded ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-700 flex items-center gap-1">
                          <span>✓</span> Audio Siap
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-800/70 flex items-center gap-1">
                          <span>○</span> Menunggu Audio
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400 font-mono">
                      <span>{textLength.toLocaleString('id-ID')} Karakter</span>
                      <span>•</span>
                      <span>Est. ~{estMinutes} Menit VO</span>
                      <span>•</span>
                      <span className="text-emerald-400 font-semibold">
                        ElevenLabs Chunk OK
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right Header Action Buttons */}
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <button
                    onClick={() => handleCopyPartText(partNum, partItem.teks)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border ${
                      isCopied
                        ? 'bg-emerald-600 text-white border-emerald-400'
                        : 'bg-gray-800/80 hover:bg-gray-800 text-gray-200 border-gray-700'
                    }`}
                    title="Copy narasi part ini untuk di-paste ke ElevenLabs"
                  >
                    <span>{isCopied ? '✓' : '📋'}</span>
                    <span>{isCopied ? 'Tersalin!' : 'Copy Narasi'}</span>
                  </button>

                  <button
                    onClick={() => setExpandedPreviewPart(isPreviewOpen ? null : partNum)}
                    className="px-2.5 py-1.5 rounded-xl bg-gray-800/50 hover:bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700/60 text-xs transition-all"
                    title={isPreviewOpen ? 'Tutup intip teks' : 'Intip naskah part ini'}
                  >
                    <span>{isPreviewOpen ? '▲ Tutup' : '▼ Teks'}</span>
                  </button>
                </div>
              </div>

              {/* Collapsible Text Preview Drawer */}
              {isPreviewOpen && partItem.teks && (
                <div className="p-4 bg-gray-950/90 border-b border-gray-800/80 space-y-2 animate-fadeIn">
                  <div className="flex items-center justify-between text-[11px] font-mono text-gray-400">
                    <span>Naskah Narasi Part #{partNum}:</span>
                    <span className="text-emerald-400">{partItem.teks.length} karakter</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto p-3 rounded-xl bg-gray-900 border border-gray-800 text-xs text-gray-300 leading-relaxed font-sans whitespace-pre-wrap select-text">
                    {partItem.teks}
                  </div>
                </div>
              )}

              {/* Card Body: Upload Zone or Audio Player */}
              <div className="p-5">
                {isUploaded && assignedAudio ? (
                  /* ─── UPLOADED AUDIO STATE ─── */
                  <div className="space-y-4">
                    <div className="p-4 rounded-2xl bg-gray-950/80 border border-emerald-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-12 h-12 rounded-xl bg-emerald-950 border border-emerald-800/60 flex items-center justify-center text-2xl text-emerald-400 shrink-0">
                          🎵
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-white font-mono truncate">
                            {assignedAudio.originalName || assignedAudio.name}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-gray-400 font-mono">
                            <span className="text-emerald-400 font-bold">
                              ⏱️ Durasi: {formatDuration(assignedAudio.duration)}
                            </span>
                            <span>•</span>
                            <span>Ukuran: {formatBytes(assignedAudio.size)}</span>
                            {assignedAudio.uploadedAt && (
                              <>
                                <span>•</span>
                                <span className="text-gray-500">
                                  {new Date(assignedAudio.uploadedAt).toLocaleTimeString('id-ID', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                        <button
                          type="button"
                          onClick={() => handleSelectAndUpload(partNum)}
                          disabled={isUploading}
                          className="px-3 py-1.5 rounded-xl bg-gray-800 hover:bg-gray-750 text-gray-200 border border-gray-700 text-xs font-semibold transition-all flex items-center gap-1.5"
                          title="Ganti file audio dengan file baru"
                        >
                          <span>🔄</span>
                          <span>Ganti File</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAudio(partNum)}
                          disabled={isDeleting}
                          className="px-3 py-1.5 rounded-xl bg-red-950/70 hover:bg-red-900 text-red-300 border border-red-800/70 text-xs font-semibold transition-all flex items-center gap-1.5"
                          title="Hapus file audio ini"
                        >
                          <span>🗑️</span>
                          <span>Hapus</span>
                        </button>
                      </div>
                    </div>

                    {/* HTML5 Audio Player */}
                    <div className="bg-gray-950 p-3.5 rounded-2xl border border-gray-800/90 shadow-inner">
                      <audio
                        controls
                        src={assignedAudio.url}
                        className="w-full h-10 rounded-xl"
                        preload="metadata"
                      />
                    </div>
                  </div>
                ) : (
                  /* ─── MISSING AUDIO STATE: UPLOAD ACTION ─── */
                  <div className="border border-dashed border-gray-800 hover:border-emerald-700/60 rounded-2xl p-6 transition-all bg-gray-950/40 text-center flex flex-col items-center justify-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-gray-900 border border-gray-800 flex items-center justify-center text-2xl text-gray-400">
                      🎙️
                    </div>

                    <div>
                      <div className="text-xs font-bold text-gray-200">
                        Belum Ada File Audio Voiceover Part #{partNum}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        Generate audio di ElevenLabs menggunakan teks part ini, lalu upload file hasilnya di sini.
                      </div>
                    </div>

                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => handleSelectAndUpload(partNum)}
                        disabled={isUploading}
                        className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 text-white text-xs font-bold transition-all shadow-lg shadow-emerald-600/30 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                      >
                        {isUploading ? (
                          <>
                            <span className="animate-spin">⏳</span>
                            <span>Sedang Mengupload Part #{partNum}...</span>
                          </>
                        ) : (
                          <>
                            <span>📁</span>
                            <span>Pilih File Audio Part #{partNum} (.mp3 / .wav)</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="text-[10px] text-gray-400 font-mono">
                      File akan otomatis disimpan ke <code className="text-emerald-400/90">input/humanologi/audio/part_{partNum}_narration.mp3</code>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── BOTTOM NAVIGATION FOOTER BAR ─────────────────────────────────── */}
      <div className="p-5 rounded-3xl bg-gray-900/80 border border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
        <div>
          {onBackToTopic && (
            <button
              type="button"
              onClick={onBackToTopic}
              className="px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-750 text-gray-200 border border-gray-700 text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
            >
              <span>←</span>
              <span>Kembali ke Step 1: Naskah & Prompt</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {!allUploaded && totalPartsCount > 0 && (
            <span className="text-xs font-mono text-amber-400/90 hidden sm:inline">
              ⚠️ Masih ada {totalPartsCount - uploadedCount} part yang belum memiliki audio
            </span>
          )}

          {(onGoToTranscript || onGoToVisual) && (
            <button
              type="button"
              onClick={onGoToTranscript || onGoToVisual}
              className={`px-6 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all flex items-center gap-2 shadow-xl ${
                allUploaded
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400 shadow-emerald-600/40 cursor-pointer'
                  : 'bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-800/80 cursor-pointer'
              }`}
            >
              <span>Lanjut ke Step 3: Transcript & Visual Mapping</span>
              <span>📝 →</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default HumanologiAudioStep;
