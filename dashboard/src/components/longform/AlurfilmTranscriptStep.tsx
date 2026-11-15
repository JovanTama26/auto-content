// dashboard/src/components/longform/AlurfilmTranscriptStep.tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { AlurfilmChunk, AlurfilmAudioResult, AlurfilmTranscriptResult, AlurfilmTranscriptEntry } from '../../electron-api';
import {
  validateTranscript,
  autoFixTranscript,
  sanitizeTranscriptEntries,
  formatMinute,
  ValidationReport,
} from '../../utils/transcriptValidation';

const api = window.electronAPI;

function normalizeEntry(entry: any, index: number, prevEndSec: number = 0): AlurfilmTranscriptEntry {
  if (!entry || typeof entry !== 'object') {
    const strVal = String(entry || '').trim();
    const startSec = prevEndSec;
    const endSec = startSec + 3;
    const m1 = Math.floor(startSec / 60); const s1 = Math.floor(startSec % 60);
    const m2 = Math.floor(endSec / 60); const s2 = Math.floor(endSec % 60);
    const defaultTs = `${String(m1).padStart(2, '0')}:${String(s1).padStart(2, '0')} - ${String(m2).padStart(2, '0')}:${String(s2).padStart(2, '0')}`;

    return {
      id: index + 1,
      start_seconds: Number(startSec.toFixed(1)),
      end_seconds: Number(endSec.toFixed(1)),
      timestamp_minute: defaultTs,
      text: strVal,
      speaker: 'Narator',
    };
  }

  let textStr = entry.text || entry.narration || entry.speech || entry.content ||
                entry.dialogue || entry.sentence || entry.line || entry.naskah ||
                entry.script || entry.kalimat || entry.transcript || '';

  if (!textStr && typeof entry === 'object') {
    for (const [k, v] of Object.entries(entry)) {
      if (['id', 'start', 'end', 'start_seconds', 'end_seconds', 'timestamp', 'timestamp_minute', 'speaker', 'part', 'part_number'].includes(k.toLowerCase())) {
        continue;
      }
      if (typeof v === 'string' && v.trim().length > 0) {
        textStr = v;
        break;
      }
    }
  }

  let rawStart = entry.start_seconds !== undefined ? entry.start_seconds : (entry.start !== undefined ? entry.start : (entry.startTime !== undefined ? entry.startTime : entry.from));
  let rawEnd = entry.end_seconds !== undefined ? entry.end_seconds : (entry.end !== undefined ? entry.end : (entry.endTime !== undefined ? entry.endTime : entry.to));

  const timeStr = entry.timestamp_minute || entry.timestamp || entry.time || entry.time_range || entry.timeframe;
  if ((rawStart === undefined || rawEnd === undefined) && typeof timeStr === 'string') {
    const matches = timeStr.match(/(\d+:\d+(?::\d+)?|\d+(?:\.\d+)?)/g);
    if (matches && matches.length >= 2) {
      const parseSec = (s: string) => {
        if (s.includes(':')) {
          const parts = s.split(':').map(Number);
          if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
          if (parts.length === 2) return parts[0] * 60 + parts[1];
        }
        return parseFloat(s) || 0;
      };
      if (rawStart === undefined) rawStart = parseSec(matches[0]);
      if (rawEnd === undefined) rawEnd = parseSec(matches[1]);
    }
  }

  const startSec = typeof rawStart === 'number' && !isNaN(rawStart)
    ? rawStart
    : (parseFloat(String(rawStart)) || prevEndSec);

  const endSec = typeof rawEnd === 'number' && !isNaN(rawEnd)
    ? rawEnd
    : (parseFloat(String(rawEnd)) || (startSec + 3));

  const m1 = Math.floor(startSec / 60); const s1 = Math.floor(startSec % 60);
  const m2 = Math.floor(endSec / 60); const s2 = Math.floor(endSec % 60);
  const defaultTs = `${String(m1).padStart(2, '0')}:${String(s1).padStart(2, '0')} - ${String(m2).padStart(2, '0')}:${String(s2).padStart(2, '0')}`;

  const tsMin = timeStr && typeof timeStr === 'string' && timeStr.includes('-') ? timeStr : defaultTs;

  return {
    id: typeof entry.id === 'number' ? entry.id : (index + 1),
    start_seconds: Number(startSec.toFixed(1)),
    end_seconds: Number(endSec.toFixed(1)),
    timestamp_minute: String(tsMin),
    text: String(textStr || ''),
    speaker: entry.speaker || 'Narator',
  };
}

const AlurfilmTranscriptStep: React.FC = () => {
  const [contentId, setContentId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<AlurfilmChunk[]>([]);
  const [audios, setAudios] = useState<Record<number, AlurfilmAudioResult>>({});
  const [transcripts, setTranscripts] = useState<Record<number, AlurfilmTranscriptResult>>({});
  const [activePart, setActivePart] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Audio Durations per Part (cache for validation)
  const [audioDurations, setAudioDurations] = useState<Record<number, number>>({});

  // Player ref & Playback state for real-time segment highlighting
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [mediaMode, setMediaMode] = useState<'audio' | 'video'>('audio');
  const [currentTime, setCurrentTime] = useState<number>(0);
  const activeItemRef = useRef<HTMLDivElement | null>(null);

  // JSON Import & Edit Modal State
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [pasteJsonInput, setPasteJsonInput] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');

  // WhisperX Real-Time Alignment State
  const [isAligning, setIsAligning] = useState<boolean>(false);
  const [alignProgress, setAlignProgress] = useState<number>(0);
  const [alignStage, setAlignStage] = useState<string>('preparing');
  const [alignLogs, setAlignLogs] = useState<string[]>([]);
  const [showAlignModal, setShowAlignModal] = useState<boolean>(false);
  const [isProcessingManual, setIsProcessingManual] = useState<boolean>(false);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  // Batch Sequential Alignment State
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
  const [batchCurrentIndex, setBatchCurrentIndex] = useState<number>(0);
  const [batchTotalCount, setBatchTotalCount] = useState<number>(0);
  const [batchCurrentLabel, setBatchCurrentLabel] = useState<string>('');
  const batchCancelRef = useRef<boolean>(false);

  // Auto-scroll terminal log window
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [alignLogs]);

  // IPC Listener for real-time progress & terminal logs
  useEffect(() => {
    if (api.onAlurfilmAlignmentProgress) {
      const cleanup = api.onAlurfilmAlignmentProgress((data) => {
        if (data.progress !== undefined) setAlignProgress(data.progress);
        if (data.stage) setAlignStage(data.stage);
        if (data.log) {
          setAlignLogs((prev) => [...prev, data.log]);
        }
      });
      return cleanup;
    }
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = async (silent: boolean = false) => {
    if (!silent) setLoading(true);
    try {
      const id = await api.getContentId('longform');
      setContentId(id);

      if (id) {
        const chunkList = await api.listAlurfilmChunks(id);
        setChunks(chunkList || []);

        const audioList = await api.listAlurfilmAudios(id);
        const audioMap: Record<number, AlurfilmAudioResult> = {};
        const durMap: Record<number, number> = {};
        if (audioList) {
          for (const item of audioList) {
            const targetParts = item.parts || (typeof item.part === 'number' ? [item.part] : []);
            for (const pt of targetParts) {
              audioMap[pt] = item;
            }
            if (item.filePath) {
              try {
                const meta = await api.getVideoMeta(item.filePath);
                if (meta && meta.duration) {
                  for (const pt of targetParts) {
                    durMap[pt] = meta.duration;
                  }
                }
              } catch {}
            }
          }
        }
        setAudios(audioMap);
        setAudioDurations(durMap);

        const transcriptList = await api.listAlurfilmTranscripts(id);
        const transcriptMap: Record<number, AlurfilmTranscriptResult> = {};
        if (transcriptList) {
          for (const item of transcriptList) {
            transcriptMap[item.part] = item;
          }
        }
        setTranscripts(transcriptMap);

        if (!silent && chunkList && chunkList.length > 0 && activePart === 1) {
          setActivePart(chunkList[0].part);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load transcript files');
    }
    if (!silent) setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const getEntriesForPart = (pt: number): AlurfilmTranscriptEntry[] | null => {
    const t = transcripts[pt];
    if (!t) return null;
    const rawList = Array.isArray(t.data) && t.data.length > 0 ? t.data : (Array.isArray(t.entries) && t.entries.length > 0 ? t.entries : null);
    if (!rawList) return null;
    return sanitizeTranscriptEntries(rawList);
  };

  // Compute Part Groups (Combines parts sharing the same Voiceover Audio into 1 Group item)
  const partGroups = useMemo(() => {
    const result: Array<{
      id: string;
      label: string;
      parts: number[];
      primaryPart: number;
      audio?: AlurfilmAudioResult;
      isDone: boolean;
      hasSomeDone: boolean;
    }> = [];

    const processedParts = new Set<number>();

    for (const chunk of chunks) {
      if (processedParts.has(chunk.part)) continue;

      const audio = audios[chunk.part];
      if (audio && Array.isArray(audio.parts) && audio.parts.length > 0) {
        const sortedParts = [...audio.parts].sort((a, b) => a - b);
        sortedParts.forEach((p) => processedParts.add(p));

        const isDone = sortedParts.every((p) => !!getEntriesForPart(p)?.length);
        const hasSomeDone = sortedParts.some((p) => !!getEntriesForPart(p)?.length);

        const isGroup = sortedParts.length > 1;
        const minP = sortedParts[0];
        const maxP = sortedParts[sortedParts.length - 1];
        const label = isGroup ? `Group Parts #${minP} - #${maxP}` : `Part #${minP}`;

        result.push({
          id: audio.id || `group_${sortedParts.join('_')}`,
          label,
          parts: sortedParts,
          primaryPart: minP,
          audio,
          isDone,
          hasSomeDone,
        });
      } else {
        processedParts.add(chunk.part);
        const isDone = !!getEntriesForPart(chunk.part)?.length;
        result.push({
          id: `single_${chunk.part}`,
          label: `Part #${chunk.part}`,
          parts: [chunk.part],
          primaryPart: chunk.part,
          audio,
          isDone,
          hasSomeDone: isDone,
        });
      }
    }

    return result;
  }, [chunks, audios, transcripts]);

  const activeGroup = useMemo(() => {
    return partGroups.find((g) => g.parts.includes(activePart)) || {
      id: `fallback_${activePart}`,
      label: `Part #${activePart}`,
      parts: [activePart],
      primaryPart: activePart,
      audio: audios[activePart],
      isDone: !!getEntriesForPart(activePart)?.length,
      hasSomeDone: !!getEntriesForPart(activePart)?.length,
    };
  }, [partGroups, activePart, audios, transcripts]);

  // Groups that have audio file ready for alignment
  const groupsWithAudio = useMemo(() => {
    return partGroups.filter((g) => g.audio && g.audio.filePath);
  }, [partGroups]);

  // Count of completed groups
  const completedGroupsCount = useMemo(() => {
    return partGroups.filter((g) => g.isDone).length;
  }, [partGroups]);

  const totalTranscribedPartsCount = useMemo(() => {
    return chunks.filter((c) => !!getEntriesForPart(c.part)?.length).length;
  }, [chunks, transcripts]);

  const handleCopyPromptForPart = async (partNum: number) => {
    try {
      const mainChunks = chunks.filter((c) => c.part > 0);
      const totalChunks = mainChunks.length > 0 ? mainChunks.length : (chunks.length || 1);
      const formattedPrompt = await api.getAlurfilmTranscriptPrompt(partNum, totalChunks);

      if (api.copyToClipboard) {
        await api.copyToClipboard(formattedPrompt);
        showToast(`📋 Copied Audio Transcript Prompt for Part #${partNum}!`);
      }
    } catch (err: any) {
      setError(`Failed to format prompt: ${err.message}`);
    }
  };

  const handleSaveImportedJson = async () => {
    if (!pasteJsonInput.trim()) return;
    setError(null);
    try {
      let raw = pasteJsonInput.trim();
      if (raw.startsWith('```')) {
        raw = raw.replace(/^```(?:[a-z0-9_-]+)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
      }

      const res = await api.saveAlurfilmTranscript(contentId || 'default', activePart, raw);

      if (res && res.multiPart && Array.isArray(res.savedResults)) {
        const savedMap: Record<number, AlurfilmTranscriptResult> = {};
        const savedPartNums: number[] = [];
        for (const item of res.savedResults) {
          const rawData = item.data || item.entries || [];
          let prevEnd = 0;
          const normData = Array.isArray(rawData) ? rawData.map((e: any, idx: number) => {
            const r = normalizeEntry(e, idx, prevEnd);
            prevEnd = r.end_seconds;
            return r;
          }) : [];
          savedMap[item.part] = { ...item, data: normData, entries: normData };
          savedPartNums.push(item.part);
        }
        setTranscripts((prev) => ({ ...prev, ...savedMap }));
        setShowImportModal(false);
        setPasteJsonInput('');
        showToast(`🎉 Saved Transcripts (SRT/JSON) for Parts ${savedPartNums.map((p) => `#${p}`).join(', ')}!`);
      } else if (res) {
        const rawData = res.data || res.entries || [];
        let prevEnd = 0;
        const normData = Array.isArray(rawData) ? rawData.map((e: any, idx: number) => {
          const r = normalizeEntry(e, idx, prevEnd);
          prevEnd = r.end_seconds;
          return r;
        }) : [];
        const resNorm = { ...res, data: normData, entries: normData };
        setTranscripts((prev) => ({ ...prev, [activePart]: resNorm }));
        setShowImportModal(false);
        setPasteJsonInput('');
        showToast(`🎉 Saved Transcript (SRT/JSON) for Part #${activePart}!`);
      }
    } catch (err: any) {
      console.error('Save Transcript Error:', err);
      setError(`Failed to save transcript: ${err.message || String(err)}`);
    }
  };

  // Process Manual Raw Transcript & Auto-Splice Audio
  const handleProcessManualTranscript = async () => {
    if (!pasteJsonInput.trim()) return;
    setError(null);
    setIsProcessingManual(true);
    setIsAligning(true);
    setIsBatchRunning(false);
    setAlignProgress(10);
    setAlignStage('preparing');
    setAlignLogs([
      `🚀 MEMULAI PROSES MANUAL TRANSCRIPT & AUDIO SPLICING (Part #${activePart})`,
      `📄 Input text length: ${pasteJsonInput.length} karakter`,
      `⚙️ Engine: Exact Timestamp Follower + FFmpeg Lossless Audio Splicer`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    ]);
    setShowImportModal(false);
    setShowAlignModal(true);

    try {
      if (!api.processAlurfilmManualTranscript) {
        throw new Error('API processAlurfilmManualTranscript tidak tersedia di preload');
      }

      const res = await api.processAlurfilmManualTranscript(activePart, pasteJsonInput.trim());
      if (res && res.success) {
        setAlignLogs((prev) => [
          ...prev,
          `✅ SUKSES: Part #${activePart} berhasil diproses!`,
          `💬 Transkrip: ${res.entries?.length || 0} baris`,
          `🔊 Audio Spliced: ${res.audioSpliced ? 'Ya (jeda hening disisipkan)' : 'Tidak (tanpa tag visual only)'}`
        ]);
        setAlignStage('done');
        setAlignProgress(100);
        showToast(`🎉 Part #${activePart} transkrip & audio berhasil diproses!`);
        await loadData(true);
      }
    } catch (err: any) {
      console.error('Manual Transcript Process Error:', err);
      setAlignLogs((prev) => [...prev, `❌ ERROR: ${err.message || String(err)}`]);
      setAlignStage('error');
      setError(`Proses transkrip manual gagal: ${err.message || String(err)}`);
    } finally {
      setIsProcessingManual(false);
      setIsAligning(false);
    }
  };

  const handleOpenImportModal = () => {
    if (activeGroup.parts.length > 1) {
      const groupedObj: Record<string, AlurfilmTranscriptEntry[]> = {};
      for (const pt of activeGroup.parts) {
        const entries = getEntriesForPart(pt);
        if (entries && entries.length > 0) {
          groupedObj[String(pt)] = entries;
        }
      }
      if (Object.keys(groupedObj).length > 0) {
        setPasteJsonInput(JSON.stringify(groupedObj, null, 2));
      } else {
        setPasteJsonInput('');
      }
    } else {
      if (currentEntries && currentEntries.length > 0) {
        setPasteJsonInput(JSON.stringify(currentEntries, null, 2));
      } else {
        setPasteJsonInput('');
      }
    }
    setShowImportModal(true);
  };

  // Single Part Faster-Whisper Alignment
  const handleRunWhisperXAlignment = async () => {
    const targetParts = activeGroup.parts || [activePart];
    const targetAudio = currentAudio?.filePath;

    if (!targetAudio) {
      setError(`Audio voiceover untuk Part #${activePart} belum ada. Silakan upload audio terlebih dahulu di Step 3.`);
      showToast(`⚠️ Audio voiceover belum terupload untuk Part #${activePart}`);
      return;
    }

    setIsAligning(true);
    setIsBatchRunning(false);
    setBatchTotalCount(1);
    setBatchCurrentIndex(1);
    setBatchCurrentLabel(activeGroup.label);
    setAlignProgress(0);
    setAlignStage('preparing');
    setAlignLogs([
      `🚀 Memulai Faster-Whisper Voiceover Alignment untuk ${activeGroup.label}...`,
      `🎙️ Target Audio: ${currentAudio?.name || 'Voiceover Audio'}`
    ]);
    setShowAlignModal(true);

    try {
      if (!api.runAlurfilmWhisperXAlignment) {
        throw new Error('WhisperX Alignment API not available in Electron preload');
      }
      const result = await api.runAlurfilmWhisperXAlignment(targetParts, targetAudio);
      if (result && result.success) {
        showToast(`✨ Faster-Whisper alignment selesai untuk ${activeGroup.label}!`);
        await loadData(true);
      }
    } catch (err: any) {
      console.error('WhisperX Alignment Error:', err);
      setAlignLogs((prev) => [...prev, `❌ ERROR: ${err.message || String(err)}`]);
      setAlignStage('error');
      setError(`WhisperX alignment failed: ${err.message || String(err)}`);
    } finally {
      setIsAligning(false);
    }
  };

  // Sequential Batch Auto-Align for ALL Part Groups
  const handleRunBatchAlignment = async () => {
    if (isAligning || isBatchRunning) return;

    // Filter groups that have audio available
    const targets = partGroups.filter((g) => g.audio && g.audio.filePath);

    if (targets.length === 0) {
      setError('Tidak ada file audio voiceover yang ditemukan. Silakan upload audio di Step 3 terlebih dahulu.');
      showToast('⚠️ Belum ada audio voiceover yang siap.');
      return;
    }

    setIsBatchRunning(true);
    batchCancelRef.current = false;
    setBatchTotalCount(targets.length);
    setBatchCurrentIndex(1);
    setBatchCurrentLabel(targets[0].label);

    setIsAligning(true);
    setAlignProgress(0);
    setAlignStage('preparing');
    setAlignLogs([
      `🚀 MEMULAI SEQUENTIAL BATCH ALIGNMENT`,
      `📋 Total Antrean: ${targets.length} Audio Group (${targets.map((t) => t.label).join(', ')})`,
      `⚡ Engine: Faster-Whisper (Silero VAD + CTranslate2)`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    ]);
    setShowAlignModal(true);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < targets.length; i++) {
      if (batchCancelRef.current) {
        setAlignLogs((prev) => [
          ...prev,
          `⏹️ Antrean dihentikan oleh pengguna pada nomor #${i + 1}.`
        ]);
        break;
      }

      const group = targets[i];
      const targetParts = group.parts;
      const targetAudio = group.audio?.filePath;

      setBatchCurrentIndex(i + 1);
      setBatchCurrentLabel(group.label);
      setActivePart(group.primaryPart);

      setAlignStage('preparing');
      setAlignProgress(0);
      setAlignLogs((prev) => [
        ...prev,
        ``,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `▶️ [${i + 1}/${targets.length}] Memproses ${group.label} (Parts #${targetParts.join(', #')})...`,
        `🎙️ Audio: ${group.audio?.name || 'Voiceover Audio'}`
      ]);

      try {
        if (!api.runAlurfilmWhisperXAlignment) {
          throw new Error('WhisperX Alignment API not available in Electron preload');
        }

        const result = await api.runAlurfilmWhisperXAlignment(targetParts, targetAudio);
        if (result && result.success) {
          successCount++;
          setAlignLogs((prev) => [
            ...prev,
            `✅ Selesai: ${group.label} (${targetParts.length} Parts) tersinkronisasi!`
          ]);
          await loadData(true);
        } else {
          throw new Error('Hasil alignment tidak valid');
        }
      } catch (err: any) {
        console.error(`Batch Alignment Error on ${group.label}:`, err);
        failCount++;
        setAlignLogs((prev) => [
          ...prev,
          `❌ Gagal pada ${group.label}: ${err.message || String(err)}`
        ]);
      }
    }

    setIsAligning(false);
    setIsBatchRunning(false);
    setAlignStage('done');
    setAlignProgress(100);

    await loadData(true);

    if (failCount === 0 && !batchCancelRef.current) {
      showToast(`🎉 Semua ${successCount} Audio Group berhasil ditranskrip secara berurutan!`);
    } else if (batchCancelRef.current) {
      showToast(`⏹️ Antrean dihentikan. (${successCount} selesai, ${failCount} gagal)`);
    } else {
      showToast(`⚠️ Batch selesai: ${successCount} berhasil, ${failCount} gagal.`);
    }
  };

  const handleCancelBatch = () => {
    if (isBatchRunning) {
      batchCancelRef.current = true;
      setAlignLogs((prev) => [...prev, '⏳ Menghentikan antrean setelah part yang sedang berjalan selesai...']);
    }
  };

  const handleSeekToTime = (startSec: number) => {
    if (mediaRef.current) {
      let seekTarget = startSec;

      // In Video mode, video chunks start at 0s. Offset target time relative to chunk start if timestamps are master-based.
      if (mediaMode === 'video' && currentEntries && currentEntries.length > 0) {
        const firstEntryStart = currentEntries[0].start_seconds;
        if (firstEntryStart > 5) {
          seekTarget = Math.max(0, startSec - firstEntryStart);
        }
      }

      mediaRef.current.currentTime = seekTarget;
      mediaRef.current.play();
      showToast(`▶️ Playing from ${startSec.toFixed(1)}s`);
    }
  };

  const handleSeekOffset = (offsetSeconds: number) => {
    if (mediaRef.current) {
      const newTime = Math.max(0, mediaRef.current.currentTime + offsetSeconds);
      mediaRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const currentChunk = chunks.find((c) => c.part === activePart);
  const currentAudio = audios[activePart];
  const currentEntries: AlurfilmTranscriptEntry[] | null = getEntriesForPart(activePart);
  const currentAudioDuration = audioDurations[activePart] || null;

  // Auto-seek audio player to part start when activePart tab changes
  useEffect(() => {
    if (currentEntries && currentEntries.length > 0 && mediaRef.current) {
      if (mediaMode === 'audio') {
        const firstStart = currentEntries[0].start_seconds;
        if (mediaRef.current.currentTime < firstStart || mediaRef.current.currentTime > (currentEntries[currentEntries.length - 1].end_seconds + 5)) {
          mediaRef.current.currentTime = firstStart;
        }
      }
    }
  }, [activePart, mediaMode]);

  const activeEntryId = useMemo(() => {
    if (!currentEntries || currentEntries.length === 0) return null;

    let timeToMatch = currentTime;
    if (mediaMode === 'video' && currentEntries.length > 0) {
      const firstEntryStart = currentEntries[0].start_seconds;
      if (firstEntryStart > 5) {
        timeToMatch = currentTime + firstEntryStart;
      }
    }

    for (let i = 0; i < currentEntries.length; i++) {
      const curr = currentEntries[i];
      const next = currentEntries[i + 1];
      const activeUntil = next
        ? Math.max(curr.end_seconds, next.start_seconds)
        : curr.end_seconds + 3.0;

      if (timeToMatch >= (curr.start_seconds - 0.2) && timeToMatch < activeUntil) {
        return curr.id;
      }
    }

    return null;
  }, [currentEntries, currentTime, mediaMode]);

  useEffect(() => {
    if (activeEntryId && activeItemRef.current) {
      activeItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeEntryId]);

  const currentReport: ValidationReport = useMemo(() => {
    return validateTranscript(currentEntries, currentAudioDuration);
  }, [currentEntries, currentAudioDuration]);

  const handleAutoFixCurrentPart = async () => {
    if (!currentEntries || currentEntries.length === 0) return;
    const fixed = autoFixTranscript(currentEntries, currentAudioDuration);
    try {
      const res = await api.saveAlurfilmTranscript(contentId || 'default', activePart, fixed);
      setTranscripts((prev) => ({ ...prev, [activePart]: res }));
      showToast(`⚡ Auto-fixed timing issues for Part #${activePart}!`);
    } catch (err: any) {
      setError(`Failed auto-fix: ${err.message}`);
    }
  };

  const filteredEntries = currentEntries ? currentEntries.filter((e) => {
    if (!searchFilter.trim()) return true;
    const term = searchFilter.toLowerCase();
    return (
      e.text.toLowerCase().includes(term) ||
      (e.speaker || '').toLowerCase().includes(term) ||
      e.timestamp_minute.toLowerCase().includes(term)
    );
  }) : [];

  const totalTranscriptDuration = currentEntries && currentEntries.length > 0
    ? currentEntries[currentEntries.length - 1].end_seconds
    : 0;

  return (
    <div className="flex flex-col h-full bg-[#0b0f19] text-gray-100 p-5 overflow-hidden select-none">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-2xl border border-purple-400/50 animate-bounce flex items-center gap-2">
          <span>🔔</span>
          <span>{toast}</span>
        </div>
      )}

      {/* TOP HEADER: Title, Stats & Sequential Batch Action Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-gray-800/80 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-purple-600/30 to-indigo-600/20 text-purple-400 rounded-xl text-xl border border-purple-500/30 shadow-inner">
            🎙️
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-bold text-white tracking-tight">
                Alur Film Audio Transcript & Timestamp Studio
              </h1>
              <span className="px-2 py-0.5 bg-purple-950/60 border border-purple-800/60 text-purple-300 rounded-full text-[10px] font-mono font-semibold">
                Faster-Whisper Sync
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Sinkronisasi audio voiceover & transkrip per kalimat untuk auto-cut video mapping.
            </p>
          </div>
        </div>

        {/* Global Progress Indicators & Primary Batch Action Button */}
        <div className="flex items-center flex-wrap gap-2.5 shrink-0">
          {/* Stats Chips */}
          <div className="hidden sm:flex items-center gap-2 bg-gray-900/80 border border-gray-800 px-3 py-1.5 rounded-xl text-xs font-mono">
            <span className="text-gray-400">Transcribed:</span>
            <span className="text-emerald-400 font-bold">
              {totalTranscribedPartsCount}/{chunks.length || 0} Parts
            </span>
            <span className="text-gray-600">|</span>
            <span className="text-gray-400">Audio Ready:</span>
            <span className="text-purple-300 font-bold">
              {groupsWithAudio.length}/{partGroups.length || 0}
            </span>
          </div>

          {/* Sequential Batch Auto-Align Button */}
          <button
            onClick={handleRunBatchAlignment}
            disabled={isAligning || isBatchRunning || groupsWithAudio.length === 0}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-lg flex items-center gap-2 border ${
              isBatchRunning
                ? 'bg-amber-600/90 text-white border-amber-400 animate-pulse cursor-wait'
                : groupsWithAudio.length === 0
                ? 'bg-gray-800/60 text-gray-500 border-gray-700/50 cursor-not-allowed'
                : 'bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white border-emerald-400/40 shadow-emerald-600/20 hover:scale-[1.02] active:scale-[0.98]'
            }`}
            title="Transkrip semua file audio voiceover satu per satu secara berurutan dengan Faster-Whisper"
          >
            {isBatchRunning ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Memproses Antrean ({batchCurrentIndex}/{batchTotalCount})...</span>
              </>
            ) : (
              <>
                <span className="text-sm">⚡</span>
                <span>Auto-Align Semua Part (Sequential)</span>
                <span className="px-1.5 py-0.5 bg-black/40 rounded text-[10px] font-mono text-emerald-200">
                  {completedGroupsCount}/{partGroups.length}
                </span>
              </>
            )}
          </button>

          {/* Stop Batch Queue Button */}
          {isBatchRunning && (
            <button
              onClick={handleCancelBatch}
              className="px-3 py-2 bg-rose-950/80 hover:bg-rose-600 text-rose-200 hover:text-white rounded-xl text-xs font-bold border border-rose-800/60 transition-all flex items-center gap-1.5 shadow"
              title="Hentikan antrean setelah proses saat ini selesai"
            >
              <span>⏹️</span> Stop
            </button>
          )}
        </div>
      </div>

      {/* MAIN 3-COLUMN WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-4 flex-1 min-h-0 overflow-hidden">
        {/* LEFT COLUMN: Parts Selector (Col 3) */}
        <div className="lg:col-span-3 flex flex-col bg-gray-900/50 backdrop-blur-sm border border-gray-800/80 rounded-2xl overflow-hidden shadow-xl p-3.5 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-gray-800/70 shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-gray-200 uppercase tracking-wider">
                Parts ({chunks.length})
              </span>
            </div>
            <span className="px-2 py-0.5 bg-purple-950/70 text-purple-300 border border-purple-800/50 rounded-lg text-[10px] font-mono font-bold">
              {totalTranscribedPartsCount}/{chunks.length} Selesai
            </span>
          </div>

          {/* Progress Bar in Sidebar */}
          {chunks.length > 0 && (
            <div className="w-full bg-gray-800/60 h-1.5 rounded-full overflow-hidden shrink-0">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-emerald-400 transition-all duration-500"
                style={{ width: `${(totalTranscribedPartsCount / (chunks.length || 1)) * 100}%` }}
              />
            </div>
          )}

          {/* List of Part Groups */}
          {partGroups.length > 0 ? (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5 custom-scrollbar">
              {partGroups.map((group) => {
                const isGroupActive = group.parts.includes(activePart);
                const isMulti = group.parts.length > 1;
                const hasAudio = !!(group.audio && group.audio.filePath);

                return (
                  <div
                    key={group.id}
                    className={`rounded-xl transition-all border overflow-hidden ${
                      isGroupActive
                        ? 'bg-purple-950/40 border-purple-500/80 shadow-lg shadow-purple-600/15 ring-1 ring-purple-500/30'
                        : group.isDone
                        ? 'bg-gray-900/80 border-emerald-900/40 hover:border-emerald-700/50'
                        : hasAudio
                        ? 'bg-gray-900/60 border-gray-800 hover:border-purple-800/60'
                        : 'bg-gray-950/70 border-gray-800/60 opacity-80'
                    }`}
                  >
                    <button
                      onClick={() => setActivePart(group.primaryPart)}
                      className={`w-full px-3.5 py-2.5 text-left font-mono transition-all flex flex-col gap-1.5 ${
                        isGroupActive
                          ? 'bg-purple-600 text-white shadow'
                          : 'hover:bg-gray-800/50 text-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-xs font-bold tracking-tight">{group.label}</span>
                        {group.isDone ? (
                          <span className="px-1.5 py-0.5 bg-emerald-950/90 text-emerald-300 border border-emerald-700/60 rounded text-[9px] font-bold">
                            ✓ Transkrip
                          </span>
                        ) : hasAudio ? (
                          <span className="px-1.5 py-0.5 bg-indigo-950/80 text-indigo-300 border border-indigo-700/50 rounded text-[9px]">
                            🎙️ Audio Siap
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 bg-gray-800/80 text-gray-400 rounded text-[9px]">
                            ○ No Audio
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[10px] opacity-80 font-normal">
                        <span>
                          {isMulti ? `🎙️ ${group.parts.length} Parts (1 File)` : (group.audio?.name ? '🎙️ 1 File Audio' : 'Belum ada audio')}
                        </span>
                        <span>
                          {group.audio ? `${(group.audio.size / 1024 / 1024).toFixed(1)} MB` : ''}
                        </span>
                      </div>
                    </button>

                    {/* Sub-Part Tabs & Fast Actions for Multi-Part Groups */}
                    {isMulti && (
                      <div className="p-2 bg-gray-950/80 border-t border-purple-800/30 flex flex-col gap-2">
                        <div className="grid grid-cols-4 gap-1">
                          {group.parts.map((pt) => {
                            const isPartActive = activePart === pt;
                            const isPartDone = !!getEntriesForPart(pt)?.length;

                            return (
                              <button
                                key={pt}
                                onClick={() => setActivePart(pt)}
                                className={`py-1 text-[10px] font-mono font-bold rounded-lg transition-all flex items-center justify-center gap-0.5 border ${
                                  isPartActive
                                    ? 'bg-purple-600 border-purple-400 text-white shadow'
                                    : isPartDone
                                    ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/60'
                                    : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-white'
                                }`}
                              >
                                <span>#{pt}</span>
                                {isPartDone && <span className="text-[9px]">✓</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-amber-400/90 p-4 text-center bg-gray-950/60 border border-gray-800 rounded-xl">
              Belum ada part split. Silakan buat split video di Step 1.
            </div>
          )}
        </div>

        {/* CENTER COLUMN: Media Player, Toolbar & Studio Telemetry (Col 4) */}
        <div className="lg:col-span-4 flex flex-col bg-gray-900/50 backdrop-blur-sm border border-gray-800/80 rounded-2xl overflow-hidden shadow-xl p-4 space-y-3.5">
          {/* Section Header */}
          <div className="flex items-center justify-between pb-3 border-b border-gray-800/70 shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base">🤖</span>
                <h3 className="text-sm font-bold text-white tracking-tight">
                  {activeGroup.parts.length > 1
                    ? `Group Parts #${activeGroup.parts[0]} - #${activeGroup.parts[activeGroup.parts.length - 1]}`
                    : `Part #${activePart}`} Studio
                </h3>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Faster-Whisper Voiceover & Visual Script Sync
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              {currentEntries && currentEntries.length > 0 ? (
                <span className="px-2 py-0.5 bg-emerald-950/70 border border-emerald-800/60 text-emerald-300 rounded-lg text-[10px] font-mono font-bold">
                  ✓ {currentEntries.length} Lines
                </span>
              ) : (
                <span className="px-2 py-0.5 bg-amber-950/70 border border-amber-800/60 text-amber-300 rounded-lg text-[10px] font-mono font-bold">
                  Belum Ada Transkrip
                </span>
              )}
            </div>
          </div>

          {/* DEDICATED ACTION TOOLBAR (Spaced out, no crowding!) */}
          <div className="flex flex-col gap-2 shrink-0">
            {/* Primary Action Button */}
            <button
              onClick={handleRunWhisperXAlignment}
              disabled={isAligning || isBatchRunning || !currentAudio}
              className={`w-full py-2 px-3 rounded-xl text-xs font-bold shadow-md transition-all flex items-center justify-center gap-2 border ${
                !currentAudio
                  ? 'bg-gray-800/60 text-gray-500 border-gray-700/50 cursor-not-allowed'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white border-emerald-400/40 shadow-emerald-600/20 hover:scale-[1.01] active:scale-[0.99]'
              }`}
              title="Jalankan otomatis Faster-Whisper alignment pada audio Part ini"
            >
              <span>⚡</span>
              <span>{isAligning ? 'Sedang Menyelaraskan...' : 'Auto-Align Part Ini (Faster-Whisper)'}</span>
            </button>

            {/* Secondary Action Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleCopyPromptForPart(activePart)}
                className="py-1.5 px-3 bg-purple-900/50 hover:bg-purple-600 text-purple-200 hover:text-white rounded-xl text-xs font-bold border border-purple-700/50 shadow-sm transition-all flex items-center justify-center gap-1.5"
                title="Copy AI Prompt naskah untuk Google AI Studio jika ingin transkrip manual"
              >
                <span>📋</span> Copy Prompt
              </button>

              <button
                onClick={handleOpenImportModal}
                className="py-1.5 px-3 bg-indigo-900/50 hover:bg-indigo-600 text-indigo-200 hover:text-white rounded-xl text-xs font-bold border border-indigo-700/50 transition-all flex items-center justify-center gap-1.5 shadow-sm"
                title="Paste raw transcript audio, deteksi adegan [VISUAL_ONLY] & potong audio dengan jeda hening"
              >
                <span>📥</span> Paste & Auto-Splice
              </button>
            </div>
          </div>

          {/* Audio Grouping Banner Badge (if multi-part) */}
          {currentAudio?.parts && currentAudio.parts.length > 1 && (
            <div className="p-2.5 bg-purple-950/40 border border-purple-800/50 rounded-xl flex items-center justify-between text-xs text-purple-200 shrink-0">
              <span className="font-semibold flex items-center gap-1.5 text-[11px]">
                <span>🎙️</span> Multi-Part Voiceover Audio:
              </span>
              <span className="px-2 py-0.5 bg-purple-800 text-purple-100 rounded-lg text-[10px] font-mono font-bold">
                Parts #{currentAudio.parts.join(', #')}
              </span>
            </div>
          )}

          {/* Player Mode Switcher: Audio vs Video */}
          <div className="flex items-center gap-1.5 bg-gray-950/80 p-1 rounded-xl border border-gray-800/80 shrink-0">
            <button
              onClick={() => setMediaMode('audio')}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                mediaMode === 'audio'
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <span>🎙️</span> Voiceover Audio
            </button>
            <button
              onClick={() => setMediaMode('video')}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                mediaMode === 'video'
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <span>📹</span> Video Chunk
            </button>
          </div>

          {/* Sleek Media Player Container */}
          <div className="bg-black/80 rounded-xl p-3 border border-gray-800/80 flex flex-col justify-center min-h-[145px] shadow-inner shrink-0">
            {mediaMode === 'audio' ? (
              currentAudio ? (
                <div className="w-full space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 truncate pr-2">
                      <span className="p-1.5 bg-purple-600/20 text-purple-400 rounded-lg text-sm">🎙️</span>
                      <span className="font-mono font-bold text-gray-200 truncate text-[11px]">{currentAudio.name}</span>
                    </div>
                    {/* Quick Seek buttons */}
                    <div className="flex items-center gap-1 shrink-0 font-mono text-[10px]">
                      <button
                        onClick={() => handleSeekOffset(-5)}
                        className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded"
                        title="Mundur 5 detik"
                      >
                        -5s
                      </button>
                      <button
                        onClick={() => handleSeekOffset(5)}
                        className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded"
                        title="Maju 5 detik"
                      >
                        +5s
                      </button>
                    </div>
                  </div>

                  <audio
                    ref={mediaRef as React.RefObject<HTMLAudioElement>}
                    src={currentAudio.mediaUrl || currentAudio.url}
                    controls
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    className="w-full h-9 rounded-lg"
                  />

                  <div className="flex items-center justify-between text-[10px] font-mono text-gray-400 px-1">
                    <span>Posisi: {currentTime.toFixed(1)}s ({formatMinute(currentTime)})</span>
                    <span>Total: {currentAudioDuration ? `${currentAudioDuration.toFixed(1)}s (${formatMinute(currentAudioDuration)})` : 'Unknown'}</span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 space-y-1">
                  <span className="text-2xl opacity-40">🎙️</span>
                  <p className="text-xs text-gray-500 font-medium">No Audio uploaded for Part #{activePart}</p>
                  <p className="text-[10px] text-gray-600">Upload voiceover audio di Step 3 untuk mengaktifkan player</p>
                </div>
              )
            ) : (
              currentChunk ? (
                <video
                  ref={mediaRef as React.RefObject<HTMLVideoElement>}
                  src={currentChunk.mediaUrl || currentChunk.url}
                  controls
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  className="w-full h-40 object-contain rounded-lg bg-black"
                />
              ) : (
                <div className="text-center py-4 space-y-1">
                  <span className="text-2xl opacity-40">📹</span>
                  <p className="text-xs text-gray-500 font-medium">No Video Chunk for Part #{activePart}</p>
                </div>
              )
            )}
          </div>

          {/* TELEMETRY & STUDIO OVERVIEW (Replaces old raw monospace code block) */}
          <div className="flex-1 bg-gray-950/70 border border-gray-800/80 rounded-xl p-3 flex flex-col justify-between overflow-hidden min-h-0 space-y-2.5">
            <div className="text-[11px] font-bold text-gray-300 uppercase tracking-wider flex items-center justify-between border-b border-gray-800/60 pb-1.5">
              <span className="flex items-center gap-1 text-purple-400">
                <span>📊</span> Studio Telemetry
              </span>
              <span className="text-[10px] text-gray-500 font-mono">Part #{activePart} of {chunks.length || 1}</span>
            </div>

            {/* 4 Telemetry Metrics Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 bg-gray-900/60 border border-gray-800/60 rounded-lg space-y-0.5">
                <span className="text-[10px] text-gray-400 block font-medium">🎙️ File Audio</span>
                <span className="text-white font-mono text-[11px] truncate block font-bold" title={currentAudio?.name}>
                  {currentAudio ? currentAudio.name : 'Belum diunggah'}
                </span>
              </div>

              <div className="p-2 bg-gray-900/60 border border-gray-800/60 rounded-lg space-y-0.5">
                <span className="text-[10px] text-gray-400 block font-medium">⏱️ Durasi Audio</span>
                <span className="text-purple-300 font-mono text-[11px] block font-bold">
                  {currentAudioDuration ? `${currentAudioDuration.toFixed(1)}s (${formatMinute(currentAudioDuration)})` : '00:00'}
                </span>
              </div>

              <div className="p-2 bg-gray-900/60 border border-gray-800/60 rounded-lg space-y-0.5">
                <span className="text-[10px] text-gray-400 block font-medium">💬 Total Transkrip</span>
                <span className="text-emerald-400 font-mono text-[11px] block font-bold">
                  {currentEntries ? `${currentEntries.length} Kalimat (${totalTranscriptDuration.toFixed(1)}s)` : '0 Kalimat'}
                </span>
              </div>

              <div className="p-2 bg-gray-900/60 border border-gray-800/60 rounded-lg space-y-0.5">
                <span className="text-[10px] text-gray-400 block font-medium">⚙️ Mesin Alignment</span>
                <span className="text-cyan-300 font-mono text-[10px] block font-semibold truncate">
                  Faster-Whisper (VAD)
                </span>
              </div>
            </div>

            {/* Quick Tips */}
            <div className="p-2 bg-purple-950/30 border border-purple-900/40 rounded-lg text-[10px] text-purple-300 leading-relaxed">
              💡 <strong>Tip Cepat:</strong> Klik kalimat di kolom kanan untuk lompat ke audio. Jika audio mencakup banyak part, Faster-Whisper otomatis membaginya.
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-950/50 border border-red-800/60 rounded-xl text-xs text-red-300 flex items-center gap-2">
              <span>⚠️</span>
              <span className="flex-1 text-[11px]">{error}</span>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Interactive Speech Lines & Timestamp Table (Col 5) */}
        <div className="lg:col-span-5 flex flex-col bg-gray-900/50 backdrop-blur-sm border border-gray-800/80 rounded-2xl overflow-hidden shadow-xl p-4 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between pb-2.5 border-b border-gray-800/70 shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base">💬</span>
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Speech Lines ({filteredEntries.length})
                </h3>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Klik baris kalimat untuk seek & preview audio playback real-time.
              </p>
            </div>

            {currentEntries && currentEntries.length > 0 && (
              <button
                onClick={() => {
                  if (api.copyToClipboard) {
                    api.copyToClipboard(JSON.stringify(currentEntries, null, 2));
                    showToast(`📋 Copied JSON Transcript for Part #${activePart}!`);
                  }
                }}
                className="px-2.5 py-1 bg-gray-800/80 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-medium transition-all flex items-center gap-1 border border-gray-700/50"
                title="Copy seluruh transkrip JSON Part ini ke clipboard"
              >
                <span>📋</span> Copy JSON
              </button>
            )}
          </div>

          {currentEntries && currentEntries.length > 0 ? (
            <div className="flex-1 flex flex-col min-h-0 space-y-2.5">
              {/* Filter Search Bar */}
              <div className="flex items-center justify-between gap-3 bg-gray-950/80 px-3 py-2 rounded-xl border border-gray-800/80 shrink-0">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>🔍</span>
                  <span className="text-[11px]">
                    Total: <strong className="text-purple-400 font-mono">{currentEntries.length} baris</strong>
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Cari teks naskah..."
                    className="bg-gray-900 text-gray-200 text-xs rounded-lg pl-2.5 pr-6 py-1 border border-gray-800 focus:border-purple-500 focus:outline-none w-36 transition-all"
                  />
                  {searchFilter && (
                    <button
                      onClick={() => setSearchFilter('')}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Validation Report Banner (Auto-Fix) */}
              {currentReport.issues.length > 0 && (
                <div
                  className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs font-medium shrink-0 ${
                    currentReport.status === 'ERROR'
                      ? 'bg-rose-950/40 border-rose-800/50 text-rose-300'
                      : 'bg-amber-950/40 border-amber-800/50 text-amber-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                    <span>{currentReport.status === 'ERROR' ? '🔴' : '⚠️'}</span>
                    <span>{currentReport.summaryText}</span>
                  </div>

                  <button
                    onClick={handleAutoFixCurrentPart}
                    className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-[11px] font-bold shadow transition-all shrink-0 flex items-center gap-1"
                  >
                    <span>⚡</span> Auto-Fix
                  </button>
                </div>
              )}

              {/* Interactive Speech Lines List */}
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {filteredEntries.map((e, idx) => {
                  const isActive = (e.id || idx + 1) === activeEntryId;
                  const isVisualOnly = (e as any).type === 'visual_only' || e.text?.includes('VISUAL_ONLY') || (e.speaker && e.speaker.toLowerCase().includes('visual'));
                  return (
                    <div
                      key={e.id || idx}
                      ref={isActive ? activeItemRef : null}
                      onClick={() => handleSeekToTime(e.start_seconds)}
                      className={`p-3 rounded-xl space-y-1.5 transition-all cursor-pointer group border ${
                        isVisualOnly
                          ? isActive
                            ? 'bg-amber-950/70 border-amber-500 shadow-lg shadow-amber-600/30 scale-[1.01]'
                            : 'bg-amber-950/30 hover:bg-amber-950/50 border-amber-800/60 hover:border-amber-600'
                          : isActive
                            ? 'bg-purple-900/50 border-purple-500 shadow-lg shadow-purple-600/30 scale-[1.01] ring-1 ring-purple-400/40'
                            : 'bg-gray-950/70 hover:bg-purple-950/30 border-gray-800/80 hover:border-purple-600/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-mono font-bold ${isVisualOnly ? 'text-amber-400' : isActive ? 'text-purple-300' : 'text-gray-500'}`}>
                            #{e.id || idx + 1}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all border ${
                              isVisualOnly
                                ? 'bg-amber-900/80 text-amber-200 border-amber-600/60'
                                : isActive
                                  ? 'bg-purple-600 text-white border-purple-400 shadow animate-pulse flex items-center gap-1'
                                  : 'bg-purple-950/60 text-purple-300 border-purple-800/50 group-hover:bg-purple-600 group-hover:text-white'
                            }`}
                          >
                            {isVisualOnly ? '🎥 VISUAL ONLY | ' : isActive ? '🔊 PLAYING | ' : '▶️ '}{e.timestamp_minute}
                          </span>
                        </div>
                        <span className={`text-[10px] font-mono ${isVisualOnly ? 'text-amber-300 font-bold' : isActive ? 'text-purple-300 font-bold' : 'text-gray-500'}`}>
                          {(typeof e.start_seconds === 'number' && !isNaN(e.start_seconds) ? e.start_seconds : 0).toFixed(1)}s - {(typeof e.end_seconds === 'number' && !isNaN(e.end_seconds) ? e.end_seconds : 0).toFixed(1)}s
                        </span>
                      </div>

                      <p
                        className={`text-xs leading-relaxed font-normal p-2.5 rounded-lg border transition-all ${
                          isVisualOnly
                            ? 'bg-amber-950/50 text-amber-200 font-mono border-amber-800/60'
                            : isActive
                              ? 'bg-purple-950/80 text-white font-medium border-purple-500/60 shadow-inner'
                              : 'text-gray-200 bg-gray-900/80 border-gray-800/70 group-hover:border-purple-500/30'
                        }`}
                      >
                        {isVisualOnly ? `🎥 ${e.text}` : `"${e.text}"`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Redesigned Clean Empty State */
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-gray-800 rounded-2xl space-y-4">
              <div className="w-14 h-14 bg-gradient-to-br from-purple-900/40 to-gray-900 text-purple-400 rounded-2xl flex items-center justify-center text-2xl border border-purple-800/40 shadow-inner">
                📝
              </div>
              <div className="space-y-1.5 max-w-sm">
                <h4 className="text-xs font-bold text-gray-200">
                  Belum Ada Transkrip Part #{activePart}
                </h4>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Pilih salah satu metode di bawah untuk menghasilkan transkrip kalimat & sinkronisasi audio:
                </p>
              </div>

              {/* 2 Clear Action Choices */}
              <div className="grid grid-cols-1 gap-2 w-full max-w-sm text-left">
                <div
                  onClick={handleRunWhisperXAlignment}
                  className="p-3 bg-emerald-950/30 hover:bg-emerald-950/50 border border-emerald-800/50 rounded-xl cursor-pointer transition-all flex items-center gap-3 group"
                >
                  <span className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg text-lg group-hover:scale-110 transition-all">⚡</span>
                  <div>
                    <span className="text-xs font-bold text-emerald-300 block">Metode 1: Auto-Align (Otomatis)</span>
                    <span className="text-[10px] text-gray-400 block">Jalankan Faster-Whisper langsung dari audio voiceover lokal.</span>
                  </div>
                </div>

                <div
                  onClick={() => handleCopyPromptForPart(activePart)}
                  className="p-3 bg-purple-950/30 hover:bg-purple-950/50 border border-purple-800/50 rounded-xl cursor-pointer transition-all flex items-center gap-3 group"
                >
                  <span className="p-2 bg-purple-500/20 text-purple-400 rounded-lg text-lg group-hover:scale-110 transition-all">📋</span>
                  <div>
                    <span className="text-xs font-bold text-purple-300 block">Metode 2: AI Studio (Manual)</span>
                    <span className="text-[10px] text-gray-400 block">Copy Prompt, proses di Google AI Studio, lalu Paste JSON.</span>
                  </div>
                </div>

                <div
                  onClick={handleOpenImportModal}
                  className="p-3 bg-cyan-950/30 hover:bg-cyan-950/50 border border-cyan-800/50 rounded-xl cursor-pointer transition-all flex items-center gap-3 group"
                >
                  <span className="p-2 bg-cyan-500/20 text-cyan-400 rounded-lg text-lg group-hover:scale-110 transition-all">✂️</span>
                  <div>
                    <span className="text-xs font-bold text-cyan-300 block">Metode 3: Paste Raw Transcript & Audio Splicer (Manual Presisi)</span>
                    <span className="text-[10px] text-gray-400 block">Paste transkrip raw audio ([Speaker 0] atau format (0:00) teks...). Sistem otomatis mendeteksi posisi [VISUAL_ONLY], memotong audio raw, dan menyisipkan hening.</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Paste / Edit SRT or JSON Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-gray-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>📋</span> Paste Transcript & Audio Splicer Studio (Part #{activePart})
              </h3>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-gray-500 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {/* Smart Feature Callout */}
            <div className="p-3 bg-gradient-to-r from-emerald-950/40 to-teal-950/40 border border-emerald-800/50 rounded-xl text-[11px] text-emerald-200 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <span>⚡</span> Auto-Detect [VISUAL_ONLY] & Audio Splicer Aktif:
              </p>
              <p className="text-gray-300 text-[10px] leading-relaxed">
                Mendukung format <code>00:00:00,140 --&gt; 00:00:33,260 [Speaker 0]</code> maupun inline timestamp <code>(0:00) Teks... (0:03) Teks...</code>.
                Sistem otomatis mencocokkan naskah Step 2, memotong audio raw, menyisipkan jeda hening sesuai durasi visual, dan menyesuaikan timeline 100% presisi!
              </p>
            </div>

            {currentAudio?.parts && currentAudio.parts.length > 1 && (
              <div className="p-3 bg-purple-950/40 border border-purple-800/50 rounded-xl text-[11px] text-purple-300 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <span>💡</span> Fitur Multi-Part Audio Auto-Split Active:
                </p>
                <p className="text-gray-300 text-[10px]">
                  Kamu juga bisa paste format <strong>JSON Object</strong> untuk multi-part Parts #{currentAudio.parts.join(', #')}.
                </p>
              </div>
            )}

            <textarea
              value={pasteJsonInput}
              onChange={(e) => setPasteJsonInput(e.target.value)}
              placeholder={`Format Raw Transcript yang didukung:\n1) Inline Timestamp:\n(0:00) Cerita berawal saat seorang wanita bernama Amanda (0:03) tiba-tiba membawankan suaminya...\n\n2) Raw SRT / Speaker:\n00:00:00,140 --> 00:00:33,260 [Speaker 0]\nDemi mencari petunjuk sekaligus persenjataan...\n\n(Atau format SRT Subtitle / JSON standard)`}
              className="w-full h-64 bg-gray-950 text-gray-200 text-xs font-mono p-3 rounded-xl border border-gray-800 focus:border-purple-500 focus:outline-none resize-none custom-scrollbar"
            />

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-800 flex-wrap">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-3.5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-medium transition-all"
              >
                Batal
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveImportedJson}
                  className="px-3.5 py-2 bg-purple-900/50 hover:bg-purple-600 text-purple-200 hover:text-white rounded-xl text-xs font-semibold border border-purple-700/50 transition-all shadow-sm"
                  title="Simpan transkrip langsung tanpa memotong file audio"
                >
                  💾 Simpan Biasa
                </button>

                <button
                  onClick={handleProcessManualTranscript}
                  disabled={!pasteJsonInput.trim() || isProcessingManual}
                  className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold border border-emerald-400/40 shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-1.5 hover:scale-[1.02] active:scale-[0.98]"
                  title="Deteksi posisi [VISUAL_ONLY], potong audio raw & sisipkan audio hening via FFmpeg"
                >
                  <span>⚡</span>
                  <span>Proses & Potong Audio (Auto-Splice)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Real-time Faster-Whisper Log & Sequential Batch Progress Modal Overlay */}
      {showAlignModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-5 py-4 bg-gray-950 border-b border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl text-lg">⚡</span>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {isBatchRunning ? 'Sequential Batch Faster-Whisper Alignment' : 'Faster-Whisper Voiceover Alignment'}
                  </h3>
                  <p className="text-[11px] text-gray-400">
                    {isBatchRunning
                      ? `Memproses antrean Part ${batchCurrentIndex} dari ${batchTotalCount} (${batchCurrentLabel})`
                      : 'Automatic Audio Sync & Multi-Part Script Mapping'}
                  </p>
                </div>
              </div>

              {!isAligning && (
                <button
                  onClick={() => setShowAlignModal(false)}
                  className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-semibold transition-all"
                >
                  Tutup
                </button>
              )}
            </div>

            {/* Modal Body */}
            <div className="p-5 flex flex-col space-y-4 flex-1 overflow-hidden">
              {/* Batch Queue Progress Bar (if batch) */}
              {isBatchRunning && (
                <div className="p-3 bg-gray-950 border border-emerald-900/40 rounded-xl space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      Antrean: {batchCurrentLabel}
                    </span>
                    <span className="text-gray-300 font-bold">
                      {batchCurrentIndex} / {batchTotalCount} Audio Group
                    </span>
                  </div>
                  <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-300"
                      style={{ width: `${(batchCurrentIndex / (batchTotalCount || 1)) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Progress Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-400 capitalize">
                    {alignStage === 'preparing' && '⚙️ Stage 1: Mempersiapkan Script & Audio'}
                    {alignStage === 'loading_model' && '🧠 Stage 2: Memuat Model Faster-Whisper & Silero VAD'}
                    {alignStage === 'aligning' && '🎙️ Stage 3: Menyelaraskan Audio Voiceover'}
                    {alignStage === 'transcribing' && '🎙️ Stage 3: Faster-Whisper VAD & Speech Recognition'}
                    {alignStage === 'mapping' && '🧩 Stage 4: Pemetaan Part & Simpan JSON'}
                    {alignStage === 'done' && '🎉 Stage 5: Selesai Berhasil!'}
                    {alignStage === 'error' && '❌ Alignment Terkendala'}
                  </span>
                  <span className="font-mono text-gray-300 font-bold">{alignProgress}%</span>
                </div>

                <div className="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      alignStage === 'error'
                        ? 'bg-red-500'
                        : alignStage === 'done'
                        ? 'bg-emerald-500'
                        : 'bg-gradient-to-r from-emerald-500 to-teal-400 animate-pulse'
                    }`}
                    style={{ width: `${alignProgress}%` }}
                  />
                </div>
              </div>

              {/* Live Terminal Logs */}
              <div className="flex-1 min-h-[220px] flex flex-col bg-gray-950 border border-gray-800 rounded-xl p-3 font-mono text-xs overflow-hidden">
                <div className="flex items-center justify-between pb-2 border-b border-gray-800 mb-2 text-[10px] text-gray-400">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" /> Live Alignment Terminal
                  </span>
                  <span>{isBatchRunning ? `Batch Queue (${batchCurrentIndex}/${batchTotalCount})` : `Parts #${activeGroup.parts.join(', #')}`}</span>
                </div>

                <div ref={logContainerRef} className="flex-1 overflow-y-auto space-y-1 text-gray-300 text-[11px] leading-relaxed custom-scrollbar">
                  {alignLogs.map((log, i) => (
                    <div key={i} className={log.includes('ERROR') || log.includes('❌') ? 'text-red-400 font-bold' : log.includes('Selesai') || log.includes('✅') || log.includes('MEMULAI') ? 'text-emerald-400 font-bold' : ''}>
                      {log}
                    </div>
                  ))}
                  {isAligning && (
                    <div className="text-gray-500 animate-pulse">... memproses Faster-Whisper audio alignment ...</div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 bg-gray-950 border-t border-gray-800 flex items-center justify-between">
              <div>
                {isBatchRunning && (
                  <button
                    onClick={handleCancelBatch}
                    className="px-3 py-1.5 bg-rose-950/80 hover:bg-rose-600 text-rose-200 hover:text-white rounded-lg text-xs font-bold border border-rose-800/60 transition-all flex items-center gap-1"
                  >
                    <span>⏹️</span> Hentikan Sisa Antrean
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                {isAligning ? (
                  <span className="text-xs text-gray-400 flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Memproses... Mohon tunggu
                  </span>
                ) : (
                  <button
                    onClick={() => setShowAlignModal(false)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow transition-all"
                  >
                    Selesai
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AlurfilmTranscriptStep;
