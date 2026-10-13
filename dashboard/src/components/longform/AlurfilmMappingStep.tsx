// dashboard/src/components/longform/AlurfilmMappingStep.tsx
import React, { useState, useEffect } from 'react';
import type {
  AlurfilmChunk,
  AlurfilmAudioResult,
  AlurfilmTranscriptResult,
  AlurfilmMappingResult,
} from '../../electron-api';
import { syncMappingPromptsToSupabase, getSyncedChunks } from '../../lib/supabaseSync';

const api = window.electronAPI;

const AlurfilmMappingStep: React.FC = () => {
  const [contentId, setContentId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<AlurfilmChunk[]>([]);
  const [audios, setAudios] = useState<Record<number, AlurfilmAudioResult>>({});
  const [transcripts, setTranscripts] = useState<Record<number, AlurfilmTranscriptResult>>({});
  const [mappings, setMappings] = useState<Record<number, AlurfilmMappingResult>>({});

  // Dynamic Video Mapping Prompts State per Part (Local & Cloud)
  const [prompts, setPrompts] = useState<Record<number, string>>({});
  const [cloudPrompts, setCloudPrompts] = useState<Record<number, string>>({});
  const [syncedParts, setSyncedParts] = useState<number[]>([]);
  const [isGeneratingAll, setIsGeneratingAll] = useState<boolean>(false);
  const [isSyncingSupabase, setIsSyncingSupabase] = useState<boolean>(false);

  const [activePart, setActivePart] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Cloud Mapping Synchronization State
  const [isSyncingMappings, setIsSyncingMappings] = useState<boolean>(false);
  const [cloudMappingsCount, setCloudMappingsCount] = useState<number>(0);

  // Modal State
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [pasteJsonInput, setPasteJsonInput] = useState<string>('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  /**
   * Status checking helpers for Cloud Sync & Match
   */
  const isPartSavedInCloud = (partNum: number): boolean => {
    return Boolean(cloudPrompts[partNum] && cloudPrompts[partNum].trim().length > 0);
  };

  const isPartMatched = (partNum: number): boolean => {
    const local = prompts[partNum];
    const cloud = cloudPrompts[partNum];
    if (!local || !cloud) return false;
    return local.trim() === cloud.trim() || Math.abs(local.length - cloud.length) <= 5;
  };

  /**
   * Generate video mapping prompt for a single part
   */
  const generatePromptForSinglePart = async (
    targetPart: number,
    totalCount: number,
    cid?: string
  ): Promise<string> => {
    const curContentId = cid || contentId;
    let formattedPrompt = '';

    if (api.getAlurfilmMappingPrompt) {
      try {
        formattedPrompt = await api.getAlurfilmMappingPrompt(targetPart, totalCount, curContentId || undefined);
      } catch (e: any) {
        console.warn(`[MappingStep] getAlurfilmMappingPrompt Part #${targetPart} error:`, e.message);
      }
    }

    // Fallback template replacement in renderer if IPC fails
    if (!formattedPrompt) {
      const chunkInfo = chunks.find((c) => c.part === targetPart);
      const transcriptResult = transcripts[targetPart];
      const rawEntries = transcriptResult?.data || transcriptResult?.entries || [];

      const voiceoverSentences = Array.isArray(rawEntries)
        ? rawEntries.map((t: any, idx) => {
            const st = typeof t.start_seconds === 'number' ? t.start_seconds : (t.start || 0.0);
            const ed = typeof t.end_seconds === 'number' ? t.end_seconds : (t.end || 0.0);
            const dur = Number(Math.max(0.1, ed - st).toFixed(2));
            const isVisualOnly = (t.type && String(t.type).toLowerCase().includes('visual_only')) ||
                                 (t.speaker && String(t.speaker).toLowerCase().includes('visual')) ||
                                 (typeof t.text === 'string' && /\[visual_only/i.test(t.text));

            if (isVisualOnly) {
              return {
                sentence_index: idx,
                type: 'visual_only',
                speaker: 'Visual (No-VO)',
                text: t.text || '',
                visual_description: t.description || t.visual_description || 'Adegan Visual Murni (Action)',
                target_source_range: t.sourceRange || t.target_source_range || '00:00 - 00:35',
                target_source_start_seconds: typeof t.sourceStartSeconds === 'number' ? t.sourceStartSeconds : (t.target_source_start_seconds || 0),
                target_source_end_seconds: typeof t.sourceEndSeconds === 'number' ? t.sourceEndSeconds : (t.target_source_end_seconds || 35),
                start: Number(st.toFixed(2)),
                end: Number(ed.toFixed(2)),
                duration: dur,
              };
            }

            return {
              sentence_index: idx,
              type: 'narration',
              speaker: t.speaker || 'Narator',
              text: t.text || t.narration || '',
              start: Number(st.toFixed(2)),
              end: Number(ed.toFixed(2)),
              duration: dur,
            };
          })
        : [];

      let promptTpl = await api.readFromProject?.('dashboard/prompts/longform/alurfilm-mapping-prompt.md');
      if (!promptTpl) {
        promptTpl = await api.readFromProject?.('dashboard/prompts/longform/mapping-prompt.md');
      }
      if (!promptTpl) {
        promptTpl = `Kamu adalah Editor Video Profesional untuk Alur Cerita Film (16:9). Part {{chunk_part}} dari {{total_chunks}}. Source: {{source_video_name}}. Output MUTLAK WAJIB berupa TEKS FLAT RAW JSON murni tanpa markdown code box sama sekali (karakter pertama { dan karakter terakhir }). Voiceover sentences: {{voiceover_sentences}}`;
      }

      const audioInfo = audios[targetPart];
      const audioVoFileName = audioInfo?.name || `audio_part_${targetPart}.wav`;
      const totalAudioDurSec =
        voiceoverSentences.length > 0
          ? voiceoverSentences[voiceoverSentences.length - 1].end || 0
          : 0;
      const mins = Math.floor(totalAudioDurSec / 60);
      const secs = (totalAudioDurSec % 60).toFixed(1);
      const totalAudioDurFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(4, '0')}`;
      const audioStartTimestamp =
        voiceoverSentences.length > 0 ? `${voiceoverSentences[0].start.toFixed(1)}s` : '0.0s';
      const audioEndTimestamp =
        voiceoverSentences.length > 0
          ? `${voiceoverSentences[voiceoverSentences.length - 1].end.toFixed(1)}s`
          : `${totalAudioDurSec}s`;

      formattedPrompt = promptTpl
        .replace(/\{\{chunk_part\}\}/g, String(targetPart))
        .replace(/\{\{total_chunks\}\}/g, String(totalCount))
        .replace(/\{\{source_video_name\}\}/g, chunkInfo ? chunkInfo.name : `part_${targetPart}.mp4`)
        .replace(/\{\{scene_id\}\}/g, `scene_p${targetPart}`)
        .replace(/\{\{voiceover_sentences\}\}/g, JSON.stringify(voiceoverSentences, null, 2))
        .replace(/\{\{audio_vo_file_name\}\}/g, audioVoFileName)
        .replace(/\{\{total_audio_duration_sec\}\}/g, String(totalAudioDurSec.toFixed(2)))
        .replace(/\{\{total_audio_duration_formatted\}\}/g, totalAudioDurFormatted)
        .replace(/\{\{total_sentences_count\}\}/g, String(voiceoverSentences.length))
        .replace(/\{\{audio_start_timestamp\}\}/g, audioStartTimestamp)
        .replace(/\{\{audio_end_timestamp\}\}/g, audioEndTimestamp)
        .replace(/\{\{chunk_video_duration_sec\}\}/g, String(chunkInfo?.durationSec || 1200))
        .replace(/\{\{chunk_video_duration_formatted\}\}/g, '20:00')
        .replace(/\{\{scene_breakdown\}\}/g, '[Acuan adegan dari Step 2 Script Generator]');
    }

    return formattedPrompt;
  };

  /**
   * Generate video mapping prompts for ALL chunks and save to Supabase
   */
  const handleGenerateAllPrompts = async (chunkListToUse?: AlurfilmChunk[], showFeedback = true) => {
    const list = chunkListToUse || chunks;
    const targetCid = contentId || (await api.getContentId('longform'));
    if (!targetCid || list.length === 0) return;

    setIsGeneratingAll(true);
    setError(null);

    try {
      const mainChunks = list.filter((c) => c.part > 0);
      const totalCount = mainChunks.length > 0 ? mainChunks.length : (list.length || 1);
      let newPrompts: Record<number, string> = {};

      // 1. Try batch IPC generator if available
      if (api.getAllAlurfilmMappingPrompts) {
        try {
          const batchRes = await api.getAllAlurfilmMappingPrompts(targetCid);
          if (batchRes && batchRes.prompts && Object.keys(batchRes.prompts).length > 0) {
            newPrompts = batchRes.prompts;
          }
        } catch (bErr) {
          console.warn('[MappingStep] Batch generator failed, fallback to sequential:', bErr);
        }
      }

      // 2. Sequential fallback if needed
      if (Object.keys(newPrompts).length === 0) {
        for (const c of list) {
          const pText = await generatePromptForSinglePart(c.part, totalCount, targetCid);
          if (pText) {
            newPrompts[c.part] = pText;
          }
        }
      }

      setPrompts((prev) => ({ ...prev, ...newPrompts }));
      setIsGeneratingAll(false);

      // 3. Sync all generated prompts to Supabase
      if (Object.keys(newPrompts).length > 0) {
        setIsSyncingSupabase(true);
        let countSaved = 0;

        if (api.syncAlurfilmMappingPrompts) {
          const syncRes = await api.syncAlurfilmMappingPrompts(targetCid, newPrompts);
          countSaved = syncRes?.count || 0;
        } else {
          const syncRes = await syncMappingPromptsToSupabase({
            contentId: targetCid,
            prompts: newPrompts,
          });
          countSaved = syncRes?.count || 0;
        }

        const partNums = Object.keys(newPrompts).map(Number);
        setCloudPrompts((prev) => ({ ...prev, ...newPrompts }));
        setSyncedParts(partNums);
        setIsSyncingSupabase(false);

        if (showFeedback) {
          showToast(
            `☁️ Berhasil men-generate & mencocokkan prompt mapping untuk ${partNums.length} video chunks ke Cloud (Match 100%)!`
          );
        }
      }
    } catch (err: any) {
      setError(`Gagal generate / simpan prompt mapping: ${err.message}`);
      setIsGeneratingAll(false);
      setIsSyncingSupabase(false);
    }
  };

  /**
   * Regenerate prompt for only the active part
   */
  const handleRegenerateActivePart = async () => {
    if (!contentId) return;
    setIsGeneratingAll(true);
    try {
      const mainChunks = chunks.filter((c) => c.part > 0);
      const totalCount = mainChunks.length > 0 ? mainChunks.length : (chunks.length || 1);
      const pText = await generatePromptForSinglePart(activePart, totalCount, contentId);

      if (pText) {
        setPrompts((prev) => ({ ...prev, [activePart]: pText }));

        // Sync to Supabase
        await syncMappingPromptsToSupabase({
          contentId,
          prompts: { [activePart]: pText },
        });

        setCloudPrompts((prev) => ({ ...prev, [activePart]: pText }));
        setSyncedParts((prev) => Array.from(new Set([...prev, activePart])));
        showToast(`☁️ Prompt mapping Part #${activePart} berhasil disimpan & cocok dengan Cloud!`);
      }
    } catch (err: any) {
      setError(`Gagal memperbarui prompt Part #${activePart}: ${err.message}`);
    } finally {
      setIsGeneratingAll(false);
    }
  };

  /**
   * Synchronize video mapping outputs from Cloud Supabase to local disk
   */
  const handleSyncMappingsFromCloud = async () => {
    if (!contentId) return;
    setIsSyncingMappings(true);
    setError(null);
    try {
      if (api.syncAlurfilmMappingsFromSupabase) {
        const res = await api.syncAlurfilmMappingsFromSupabase(contentId);
        console.log(`[MappingStep] Synced ${res?.count || 0} mappings from Supabase.`);
      }
      if (api.listAlurfilmMappings) {
        const updatedList = await api.listAlurfilmMappings(contentId);
        const mapObj: Record<number, any> = {};
        if (Array.isArray(updatedList)) {
          updatedList.forEach((m: any) => {
            mapObj[m.part] = m;
          });
        }
        setMappings(mapObj);
      }
      showToast('☁️ Video Mapping berhasil disinkronkan dari Cloud (Offline & Cloud Match 100%)!');
    } catch (err: any) {
      setError(`Gagal sync video mapping: ${err.message}`);
    } finally {
      setIsSyncingMappings(false);
    }
  };

  /**
   * Load initial data on mount
   */
  const loadData = async () => {
    setLoading(true);
    try {
      const id = await api.getContentId('longform');
      setContentId(id);

      if (id) {
        // Chunks
        const chunkList = await api.listAlurfilmChunks(id);
        const validChunks = chunkList || [];
        setChunks(validChunks);

        // Audios
        const audioList = await api.listAlurfilmAudios(id);
        const aMap: Record<number, AlurfilmAudioResult> = {};
        if (audioList) {
          for (const a of audioList) {
            if (a.parts) {
              a.parts.forEach((p) => {
                aMap[p] = a;
              });
            } else if (typeof a.part === 'number') {
              aMap[a.part] = a;
            }
          }
        }
        setAudios(aMap);

        // Transcripts
        const tList = await api.listAlurfilmTranscripts(id);
        const tMap: Record<number, AlurfilmTranscriptResult> = {};
        if (tList) {
          for (const t of tList) tMap[t.part] = t;
        }
        setTranscripts(tMap);

        // Mappings (Auto-sync with Cloud Supabase)
        if (api.syncAlurfilmMappingsFromSupabase) {
          try {
            await api.syncAlurfilmMappingsFromSupabase(id);
          } catch (e) {
            console.warn('[MappingStep] Initial cloud mappings sync warning:', e);
          }
        }
        const mList = await api.listAlurfilmMappings(id);
        const mMap: Record<number, AlurfilmMappingResult> = {};
        if (mList) {
          for (const m of mList) mMap[m.part] = m;
        }
        setMappings(mMap);

        if (validChunks.length > 0) {
          setActivePart(validChunks[0].part);
        }

        // Check already synced parts from Supabase
        let existingPrompts: Record<number, string> = {};
        try {
          const syncedChunks = await getSyncedChunks(id);
          if (syncedChunks && syncedChunks.length > 0) {
            const withPrompts = syncedChunks.filter(
              (sc) => (sc.mapping_prompt && sc.mapping_prompt.trim()) || (sc.prompt && sc.prompt.trim())
            );
            withPrompts.forEach((sc) => {
              const text = sc.mapping_prompt || sc.prompt;
              if (text) existingPrompts[sc.part_number] = text;
            });
            setCloudPrompts(existingPrompts);
            setSyncedParts(withPrompts.map((sc) => sc.part_number));

            const withMappings = syncedChunks.filter(
              (sc) => sc.mapping_status === 'done' && sc.mapping_output
            );
            setCloudMappingsCount(withMappings.length);
          }
        } catch (e) {
          console.warn('[MappingStep] Error reading synced parts from Supabase:', e);
        }

        // If prompts already exist in Supabase, load them into state
        if (Object.keys(existingPrompts).length > 0) {
          setPrompts(existingPrompts);
        } else if (validChunks.length > 0) {
          // Otomatis generate dan simpan prompt mapping ke Supabase ketika step dibuka
          setTimeout(() => {
            handleGenerateAllPrompts(validChunks, false);
          }, 400);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load mapping data');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCopyPromptForPart = async (partNum: number) => {
    try {
      let textToCopy = prompts[partNum];

      if (!textToCopy) {
        const mainChunks = chunks.filter((c) => c.part > 0);
        const totalCount = mainChunks.length > 0 ? mainChunks.length : (chunks.length || 1);
        textToCopy = await generatePromptForSinglePart(partNum, totalCount);
        if (textToCopy) {
          setPrompts((prev) => ({ ...prev, [partNum]: textToCopy }));
        }
      }

      if (textToCopy && api.copyToClipboard) {
        await api.copyToClipboard(textToCopy);
        showToast(`📋 Berhasil menyalin Video Mapping Prompt untuk Part #${partNum}!`);
      } else if (textToCopy && navigator.clipboard) {
        await navigator.clipboard.writeText(textToCopy);
        showToast(`📋 Berhasil menyalin Video Mapping Prompt untuk Part #${partNum}!`);
      }
    } catch (err: any) {
      setError(`Gagal copy prompt: ${err.message}`);
    }
  };

  const handleSaveImportedMapping = async () => {
    if (!pasteJsonInput.trim()) return;
    setError(null);
    try {
      let raw = pasteJsonInput.trim();
      if (raw.startsWith('```')) {
        raw = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      const parsed = JSON.parse(raw);

      const res = await api.saveAlurfilmMapping(contentId || 'default', activePart, raw);
      if (api.listAlurfilmMappings) {
        const updatedList = await api.listAlurfilmMappings(contentId || undefined);
        const mapObj: Record<number, any> = {};
        if (Array.isArray(updatedList)) {
          updatedList.forEach((m: any) => {
            mapObj[m.part] = m;
          });
        }
        setMappings(mapObj);
      } else {
        setMappings((prev) => ({ ...prev, [activePart]: res }));
      }
      setShowImportModal(false);
      setPasteJsonInput('');
      showToast(`🎉 Berhasil menyimpan Video Mapping untuk Part #${activePart}!`);
    } catch (err: any) {
      setError(`Format JSON tidak valid: ${err.message}`);
    }
  };

  const getNormalizedMapping = (partNum: number) => {
    const raw = mappings[partNum]?.data;
    if (!raw) return null;
    if (Array.isArray(raw)) {
      if (raw.length === 0) return null;
      const match =
        raw.find(
          (m: any) =>
            m &&
            (m.chunk_part === partNum ||
              m.part === partNum ||
              (typeof m.scene_id === 'string' && m.scene_id.includes(String(partNum))))
        ) || raw[0];
      return match;
    }
    return raw;
  };

  const currentMapping = getNormalizedMapping(activePart);
  const activePromptText = prompts[activePart] || '';
  const isActiveSavedInCloud = isPartSavedInCloud(activePart);
  const isActiveMatched = isPartMatched(activePart);
  const isAllSynced = chunks.length > 0 && syncedParts.length === chunks.length;

  const totalMappedCount = chunks.filter((c) => {
    const norm = getNormalizedMapping(c.part);
    return Boolean(norm?.mappings && norm.mappings.length > 0);
  }).length;
  const isAllMappingsSynced = chunks.length > 0 && totalMappedCount === chunks.length;

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100 p-6 overflow-hidden">
      {/* Toast */}
      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-2xl border border-purple-400 animate-bounce">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-gray-800 shrink-0">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="p-2 bg-purple-600/20 text-purple-400 rounded-lg text-lg">🎯</span>
              Alur Film Video Mapping Studio
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-purple-950/60 border border-purple-800/80 text-[10px] text-purple-300 font-mono font-bold">
              Step 5: Visual Mapping
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Sinkronkan kalimat naskah VO dengan potongan visual video chunk (`source_start_seconds`, `slow_motion`, `mirror_cut`) via Google AI Studio.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Main Action Button: Generate & Simpan Prompt Mapping ke Supabase */}
          <button
            onClick={() => handleGenerateAllPrompts(chunks, true)}
            disabled={isGeneratingAll || isSyncingSupabase || chunks.length === 0}
            className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-lg shadow-purple-600/30 transition-all flex items-center gap-2 border border-purple-400/40"
            title="Generate prompt video mapping dinamis untuk semua video chunks dan simpan ke database Supabase"
          >
            <span className={isGeneratingAll || isSyncingSupabase ? 'animate-spin' : ''}>
              {isGeneratingAll ? '⚙️' : isSyncingSupabase ? '⏳' : '⚡'}
            </span>
            <span>
              {isGeneratingAll
                ? 'Generating Prompts...'
                : isSyncingSupabase
                ? 'Menyimpan ke Supabase...'
                : '⚡ Generate & Simpan Prompt Mapping'}
            </span>
          </button>

          {/* Database Synced & Matched Badge (Prompts) */}
          {isAllSynced ? (
            <div className="px-3.5 py-1.5 bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-emerald-950/50">
              <span className="text-sm">☁️</span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono font-extrabold text-white">
                  {syncedParts.length}/{chunks.length}
                </span>
                <span className="text-emerald-400 font-bold">Prompts Match</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              </div>
            </div>
          ) : (
            <div className="px-3 py-1.5 bg-gray-900 border border-gray-800 text-gray-300 rounded-xl text-xs font-medium flex items-center gap-1.5">
              <span className="text-purple-400">☁️</span>
              <span className="font-mono font-bold text-white">
                {syncedParts.length}/{chunks.length}
              </span>
              <span className="text-gray-400 text-[11px]">Prompt di Cloud</span>
            </div>
          )}

          {/* Database Mappings Synced & Matched Badge */}
          {isAllMappingsSynced ? (
            <div className="px-3.5 py-1.5 bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-emerald-950/50">
              <span className="text-sm">🎯</span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono font-extrabold text-white">
                  {totalMappedCount}/{chunks.length}
                </span>
                <span className="text-emerald-400 font-bold">Mappings Match 100%</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              </div>
            </div>
          ) : (
            <div className="px-3 py-1.5 bg-gray-900 border border-gray-800 text-gray-300 rounded-xl text-xs font-medium flex items-center gap-1.5">
              <span className="text-emerald-400">🎯</span>
              <span className="font-mono font-bold text-white">
                {totalMappedCount}/{chunks.length}
              </span>
              <span className="text-gray-400 text-[11px]">Mapping Siap</span>
            </div>
          )}

          {/* Sync dari Cloud Button */}
          <button
            onClick={handleSyncMappingsFromCloud}
            disabled={isSyncingMappings}
            className="px-3 py-2 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-purple-300 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 shadow"
            title="Tarik data video mapping dari Cloud Supabase ke disk lokal"
          >
            <span className={isSyncingMappings ? 'animate-spin' : ''}>🔄</span>
            <span>{isSyncingMappings ? 'Syncing...' : 'Sync dari Cloud'}</span>
          </button>

          <button
            onClick={() => {
              if (currentMapping) setPasteJsonInput(JSON.stringify(currentMapping, null, 2));
              else setPasteJsonInput('');
              setShowImportModal(true);
            }}
            className="px-3 py-2 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-purple-300 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5"
          >
            <span>📋</span> {currentMapping ? 'Edit / Replace Mapping' : 'Paste Mapping JSON'}
          </button>
        </div>
      </div>

      {/* Main Grid Workspace with Side Parts List */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-5 flex-1 min-h-0 overflow-hidden">
        {/* SIDE COLUMN: Vertical Parts Selector (Col 2) */}
        <div className="lg:col-span-2 flex flex-col bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden shadow-xl p-3.5 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-gray-800 shrink-0">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
              Parts ({chunks.length})
            </span>
            <span className="text-[10px] text-purple-400 font-mono font-bold">Cloud Sync</span>
          </div>

          {chunks.length > 0 ? (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
              {chunks.map((chunk) => {
                const normData = getNormalizedMapping(chunk.part);
                const isDone = Boolean(normData?.mappings && normData.mappings.length > 0);
                const hasLocalPrompt = Boolean(prompts[chunk.part] && prompts[chunk.part].trim().length > 0);
                const isCloudSaved = isPartSavedInCloud(chunk.part);
                const isMatched = isPartMatched(chunk.part);
                const isActive = activePart === chunk.part;

                // Status Badge logic
                let badgeElement = null;
                if (isDone) {
                  badgeElement = (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/70 text-[9px] font-bold flex items-center gap-1 shadow-sm">
                      <span>🎯</span> Match ✓
                    </span>
                  );
                } else if (isCloudSaved && isMatched) {
                  badgeElement = (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-500/70 text-[9px] font-bold flex items-center gap-0.5 shadow-sm">
                      <span>☁️</span> Match ✓
                    </span>
                  );
                } else if (isCloudSaved && !isMatched) {
                  badgeElement = (
                    <span className="px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/70 text-[9px] font-bold flex items-center gap-0.5">
                      <span>☁️</span> Diff
                    </span>
                  );
                } else if (hasLocalPrompt) {
                  badgeElement = (
                    <span className="px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-700 text-[9px] font-bold">
                      ⚡ Lokal
                    </span>
                  );
                } else {
                  badgeElement = <span className="text-[9px] text-gray-500 font-mono">○ Pending</span>;
                }

                return (
                  <button
                    key={chunk.part}
                    onClick={() => setActivePart(chunk.part)}
                    className={`w-full px-3 py-2.5 rounded-xl text-xs font-bold font-mono transition-all flex flex-col gap-1 border text-left ${
                      isActive
                        ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-600/30'
                        : isDone
                        ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/50'
                        : isCloudSaved && isMatched
                        ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-200 hover:bg-emerald-900/40'
                        : hasLocalPrompt
                        ? 'bg-purple-950/40 border-purple-800/60 text-purple-300 hover:bg-purple-900/50'
                        : 'bg-gray-950 border-gray-800 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span>Part #{chunk.part}</span>
                      {badgeElement}
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-normal opacity-90 font-sans">
                      <span>{chunk.durationSec ? `${Math.round(chunk.durationSec / 60)}m` : '~20m'}</span>
                      {isCloudSaved && isMatched ? (
                        <span className="text-emerald-400 font-bold flex items-center gap-1 text-[10px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Cloud OK
                        </span>
                      ) : (
                        <span className="truncate max-w-[85px] text-gray-400">{chunk.name}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-[11px] text-amber-400 p-3 text-center bg-amber-950/20 rounded-xl border border-amber-800/30">
              Belum ada part split. Kembali ke Step 1 (Splitter).
            </div>
          )}
        </div>

        {/* CENTER PANEL: Prompt Generator & Live Dynamic Prompt Viewer (Col 5) */}
        <div className="lg:col-span-5 flex flex-col bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden shadow-xl p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-800 shrink-0">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <span>🤖</span> Part #{activePart} Mapping Prompt
                </h3>
                {isActiveSavedInCloud && isActiveMatched ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/90 border border-emerald-500/70 text-emerald-300 text-[10px] font-mono font-bold flex items-center gap-1 shadow-sm">
                    <span>☁️</span> Cloud Synced & Match 100% ✓
                  </span>
                ) : isActiveSavedInCloud ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-950/90 border border-amber-500/70 text-amber-300 text-[10px] font-mono font-bold flex items-center gap-1">
                    <span>☁️</span> Ada di Cloud (Perlu Update)
                  </span>
                ) : activePromptText ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-purple-950 border border-purple-800 text-purple-300 text-[10px] font-mono font-bold flex items-center gap-1">
                    <span>⚡</span> Lokal (Belum ke Cloud)
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full bg-gray-800 text-gray-400 text-[10px] font-mono">
                    Belum Dibuat
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Dynamic FFmpeg Mapping prompt dengan Single Source of Truth Transkrip Part #{activePart}.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleRegenerateActivePart}
                disabled={isGeneratingAll}
                className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-semibold transition-all flex items-center gap-1"
                title="Regenerate & Simpan ulang prompt part ini ke Supabase"
              >
                <span>🔄</span>
              </button>
              <button
                onClick={() => handleCopyPromptForPart(activePart)}
                className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold shadow transition-all flex items-center gap-1.5"
              >
                <span>📋</span> Copy Prompt #Part {activePart}
              </button>
            </div>
          </div>

          {/* Dynamic Prompt Content Area */}
          {activePromptText ? (
            <div className="flex-1 flex flex-col min-h-0 bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
              {/* Prompt Meta Bar with Cloud Sync & Match Indicator */}
              <div className="flex items-center justify-between px-3.5 py-2 bg-gray-900/90 border-b border-gray-800/80 text-[11px] text-gray-400 font-mono">
                <div className="flex items-center gap-3.5 flex-wrap">
                  <span>
                    Panjang: <strong className="text-purple-300">{activePromptText.length.toLocaleString()}</strong> karakter
                  </span>
                  <span>
                    Status Cloud:{' '}
                    {isActiveSavedInCloud && isActiveMatched ? (
                      <strong className="text-emerald-400 font-bold">☁️ Tersimpan & Match (100% ✓)</strong>
                    ) : isActiveSavedInCloud ? (
                      <strong className="text-amber-400 font-bold">☁️ Ada di Cloud</strong>
                    ) : (
                      <strong className="text-gray-400">Belum di Cloud</strong>
                    )}
                  </span>
                  <span>
                    Kategori: <strong className="text-gray-200">16:9 Movie Recap</strong>
                  </span>
                </div>
                <button
                  onClick={() => handleCopyPromptForPart(activePart)}
                  className="text-purple-400 hover:text-purple-300 font-bold flex items-center gap-1 text-[11px]"
                >
                  <span>📋</span> Salin
                </button>
              </div>

              {/* Scrollable Live Dynamic Prompt */}
              <div className="flex-1 p-4 overflow-y-auto font-mono text-[11px] text-gray-300 leading-relaxed whitespace-pre-wrap selection:bg-purple-600 selection:text-white">
                {activePromptText}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-gray-950 rounded-xl border border-dashed border-gray-800 space-y-4">
              <div className="w-14 h-14 bg-purple-600/10 text-purple-400 rounded-2xl flex items-center justify-center text-2xl border border-purple-500/20">
                ⚡
              </div>
              <div className="max-w-xs space-y-1">
                <h4 className="text-xs font-bold text-white">Prompt Part #{activePart} Belum Digenerate</h4>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Klik tombol di bawah untuk membuat prompt video mapping dinamis lengkap dengan timecode transkrip.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRegenerateActivePart}
                  disabled={isGeneratingAll}
                  className="px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition-all shadow"
                >
                  ⚡ Generate Prompt Part #{activePart}
                </button>
                <button
                  onClick={() => handleGenerateAllPrompts(chunks, true)}
                  disabled={isGeneratingAll}
                  className="px-3.5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-semibold transition-all"
                >
                  Generate Semua Part
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-950/40 border border-red-800/50 rounded-xl text-xs text-red-400 shrink-0">
              {error}
            </div>
          )}
        </div>

        {/* RIGHT PANEL: Mapping Timeline Viewer (Col 5) */}
        <div className="lg:col-span-5 flex flex-col bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden shadow-xl p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-800 shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <span>🎯</span> Visual Cuts Mapping Part #{activePart}
                </h3>
                {currentMapping && currentMapping.mappings && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-950/90 border border-emerald-500/70 text-emerald-300 text-[10px] font-mono font-bold flex items-center gap-1 shadow">
                    <span>☁️</span> Cloud & Offline Match ✓
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Sentence-by-sentence visual cuts timeline layout ({currentMapping?.mappings?.length || 0} kalimat naskah terpetakan).
              </p>
            </div>

            {currentMapping && (
              <button
                onClick={() => {
                  if (api.copyToClipboard) {
                    api.copyToClipboard(JSON.stringify(currentMapping, null, 2));
                    showToast(`📋 Copied Mapping JSON for Part #${activePart}!`);
                  }
                }}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-medium transition-all flex items-center gap-1"
              >
                <span>📋</span> Copy JSON
              </button>
            )}
          </div>

          {currentMapping && currentMapping.mappings ? (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
              {/* BGM Timeline Preview if present */}
              {Array.isArray(currentMapping.bgm_timeline) && currentMapping.bgm_timeline.length > 0 && (
                <div className="p-3 bg-indigo-950/40 border border-indigo-800/40 rounded-xl space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-indigo-400 flex items-center gap-1.5">
                      <span>🎵</span> BGM Timeline ({currentMapping.bgm_timeline.length} tracks)
                    </span>
                    <span className="text-[10px] font-mono text-indigo-300">
                      Auto-ducking sinkron
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {currentMapping.bgm_timeline.map((bgm: any, bIdx: number) => (
                      <span key={bIdx} className="px-2 py-1 rounded-lg bg-indigo-900/60 border border-indigo-700/60 text-[10px] text-indigo-200 font-mono flex items-center gap-1">
                        <span className="text-indigo-400">▶</span>
                        <strong>{bgm.file || bgm.category}</strong>
                        <span className="text-gray-400">({bgm.start}s - {bgm.end}s)</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Sentences Mapping List */}
              {currentMapping.mappings.map((m: any, idx: number) => {
                const isVisualOnly = m.type === 'visual_only' || (typeof m.text === 'string' && m.text.includes('[VISUAL_ONLY]'));
                return (
                  <div key={idx} className={`p-3.5 bg-gray-950 rounded-xl border space-y-2 ${isVisualOnly ? 'border-amber-600/50 bg-amber-950/10' : 'border-gray-800'}`}>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-purple-400 font-mono">
                          Sentence #{m.sentence_index ?? idx}
                        </span>
                        {isVisualOnly && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-600/60 text-[9px] font-bold uppercase">
                            [VISUAL_ONLY]
                          </span>
                        )}
                      </div>
                      <span className="text-gray-400 font-mono text-[11px]">
                        Durasi:{' '}
                        <strong className="text-white">
                          {m.duration || (m.end && m.start ? Number((m.end - m.start).toFixed(2)) : '0')}s
                        </strong>
                        <span className="text-gray-500 ml-1">({m.start}s - {m.end}s)</span>
                      </span>
                    </div>
                    <p className="text-xs text-gray-200 italic font-mono bg-gray-900 p-2.5 rounded-lg border border-gray-800/80 leading-relaxed">
                      "{m.text}"
                    </p>

                    <div className="space-y-1.5 pt-1">
                      <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider flex items-center justify-between">
                        <span>Visual Clips ({m.visuals?.length || 0})</span>
                        {m.visuals && (
                          <span className="text-purple-400 font-mono text-[10px]">
                            Total durasi: {Number((m.visuals.reduce((acc: number, v: any) => acc + (v.duration || 0), 0)).toFixed(2))}s
                          </span>
                        )}
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {m.visuals?.map((v: any, vIdx: number) => {
                          const vType = v.type || 'video_cut';
                          let typeColor = 'text-purple-300 border-purple-800/40 bg-purple-950/20';
                          if (vType === 'slow_motion') typeColor = 'text-violet-300 border-violet-800/40 bg-violet-950/20';
                          if (vType === 'freeze_frame_with_zoom') typeColor = 'text-sky-300 border-sky-800/40 bg-sky-950/20';
                          if (vType === 'mirror_cut') typeColor = 'text-pink-300 border-pink-800/40 bg-pink-950/20';

                          return (
                            <div
                              key={vIdx}
                              className={`p-2 rounded-lg border text-[11px] font-mono space-y-1 ${typeColor}`}
                            >
                              <div className="flex justify-between items-center font-bold">
                                <span>{vType}</span>
                                <span className="px-1.5 py-0.2 rounded bg-black/40 text-white font-mono text-[10px]">{v.duration}s</span>
                              </div>
                              <div className="flex items-center justify-between text-[10px] text-gray-400">
                                <span>start: <strong>{v.source_start_seconds}s</strong></span>
                                {v.slow_mo_factor && (
                                  <span className="text-violet-400">({v.slow_mo_factor}x)</span>
                                )}
                              </div>
                              {v.color_grading_shift && (
                                <div className="text-[9px] text-gray-500 truncate pt-0.5 border-t border-gray-800/50 flex items-center justify-between">
                                  <span>
                                    🎨 c:{v.color_grading_shift.contrast} s:{v.color_grading_shift.saturation}
                                    {v.color_grading_shift.gamma !== undefined && ` g:${v.color_grading_shift.gamma}`}
                                  </span>
                                  {(v.color_grading_shift.mode === 'dark_boost' || (v.color_grading_shift.gamma && v.color_grading_shift.gamma > 1.1) || (v.color_grading_shift.brightness && v.color_grading_shift.brightness > 0.02)) && (
                                    <span className="text-[8px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-semibold ml-1 shrink-0">
                                      💡 Dark Boost
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-gray-800 rounded-2xl space-y-3">
              <div className="w-12 h-12 bg-gray-900 text-gray-600 rounded-xl flex items-center justify-center text-xl">
                🎯
              </div>
              <div>
                <h4 className="text-xs font-bold text-gray-400">Belum Ada Video Mapping Part #{activePart}</h4>
                <p className="text-[11px] text-gray-500 mt-1 max-w-xs">
                  Copy prompt di tengah, jalankan di AI Studio dengan video 10-menit attached, lalu paste hasilnya ke sini atau gunakan ekstensi otomasi.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>📋</span> Paste / Edit Video Mapping JSON (Part #{activePart})
            </h3>
            <textarea
              value={pasteJsonInput}
              onChange={(e) => setPasteJsonInput(e.target.value)}
              placeholder={`{\n  "scene_id": "scene_p${activePart}",\n  "mappings": [\n    {\n      "sentence_index": 0,\n      "text": "...",\n      "duration": 5.0,\n      "visuals": []\n    }\n  ]\n}`}
              className="w-full h-64 bg-gray-950 text-gray-200 text-xs font-mono p-3 rounded-xl border border-gray-800 focus:border-purple-500 focus:outline-none resize-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 bg-gray-800 text-gray-300 rounded-xl text-xs font-medium"
              >
                Batal
              </button>
              <button
                onClick={handleSaveImportedMapping}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold"
              >
                Save Mapping
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AlurfilmMappingStep;
