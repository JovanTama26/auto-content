// dashboard/src/components/faceless/FacelessVisualStep.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import type {
  FacelessVisualPromptItem,
  FacelessVisualPromptsData,
  FacelessTranscriptData,
  FacelessAudioItem,
  FacelessVisualStreamProgress,
  FacelessFlowGenerateOptions,
  FacelessFlowProgress,
  FacelessTopicItem,
  FacelessEpisodeSummary,
} from '../../electron-api';

const api = window.electronAPI;

interface FacelessVisualStepProps {
  onBackToAudio?: () => void;
  onGoToNext?: () => void;
}

const TEMPLATE_A_BASE = (scene: string, shot: string) =>
  `2D flat hand-drawn stickman cartoon, thick black outlines, NOT realistic, NOT 3D, NOT anime. Stickman: round white head, two round white eyes with small black dot pupils, tiny neutral mouth, thin black stick body and limbs (no clothes, no muscles, no realistic anatomy), mustard yellow beanie, army green sling bag. Scene: ${scene}. ${shot}. Muted dark color palette, no text, no labels, 16:9.`;

const TEMPLATE_B_BASE = (scene: string, shot: string) =>
  `2D flat hand-drawn stickman cartoon style, thick black outlines, NOT realistic, NOT 3D, NOT anime. Scene: ${scene}. ${shot}. Muted dark color palette, no text, no labels, 16:9.`;

const SHOT_OPTIONS = [
  { value: 'wide shot', label: 'Wide Shot (Lokasi / Pemandangan / Kerumunan)' },
  { value: 'medium shot', label: 'Medium Shot (Aksi Karakter / Interaksi)' },
  { value: 'close-up shot', label: 'Close-Up Shot (Benda / Ekspresi / Detail)' },
  { value: 'top-down shot', label: 'Top-Down Shot (Peta / Denah / Logistik)' },
];

const NINEROUTER_MODELS = [
  { id: 'ag/gemini-3.8-flash-high', label: 'ag/gemini-3.8-flash-high (9router Default - Cepat & Cerdas)' },
  { id: 'ag/gemini-3-flash-agent', label: 'ag/gemini-3-flash-agent (9router Stabil)' },
  { id: 'gemini/gemini-3.1-flash-lite-preview', label: 'gemini-3.1-flash-lite (9router Hemat)' },
  { id: 'ds/deepseek-chat', label: 'DeepSeek Chat (9router Kreatif)' },
  { id: 'cmc/Qwen/Qwen3.6-Plus', label: 'Qwen 3.6 Plus (9router)' },
];

export const FacelessVisualStep: React.FC<FacelessVisualStepProps> = ({ onBackToAudio, onGoToNext }) => {
  // Multi-topic & Multi-episode navigation
  const [topics, setTopics] = useState<FacelessTopicItem[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string>('');
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>('');
  const [loadingTopics, setLoadingTopics] = useState<boolean>(true);

  const [prompts, setPrompts] = useState<FacelessVisualPromptItem[]>([]);
  const [transcript, setTranscript] = useState<FacelessTranscriptData | null>(null);
  const [audioList, setAudioList] = useState<FacelessAudioItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedModel, setSelectedModel] = useState<string>('ag/gemini-3.8-flash-high');
  const [batchSize, setBatchSize] = useState<number>(5);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [streamProgress, setStreamProgress] = useState<{
    active: boolean;
    batchIndex: number;
    totalBatches: number;
    percent: number;
    message: string;
    startLineNum?: number;
    endLineNum?: number;
  } | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [customInstructions, setCustomInstructions] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [templateFilter, setTemplateFilter] = useState<'ALL' | 'A' | 'B'>('ALL');
  const [shotFilter, setShotFilter] = useState<string>('ALL');
  const [imageFilter, setImageFilter] = useState<'ALL' | 'HAS_IMAGE' | 'NO_IMAGE'>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const [isGuideExpanded, setIsGuideExpanded] = useState<boolean>(false);
  const [singleRegenModalItem, setSingleRegenModalItem] = useState<FacelessVisualPromptItem | null>(null);
  const [singleRegenFeedback, setSingleRegenFeedback] = useState<string>('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isFlowConfigOpen, setIsFlowConfigOpen] = useState<boolean>(false);

  // Google Flow (Camoufox) Automation states
  const [flowProfiles, setFlowProfiles] = useState<string[]>(['jovangithub@gmail.com', 'panjij0987@gmail.com']);
  const [selectedFlowEmail, setSelectedFlowEmail] = useState<string>('jovangithub@gmail.com');
  const [isFlowRunning, setIsFlowRunning] = useState<boolean>(false);
  const [flowHeadless, setFlowHeadless] = useState<boolean>(true);
  const [flowConcurrency, setFlowConcurrency] = useState<number>(5);
  const [flowOverwrite, setFlowOverwrite] = useState<boolean>(false);
  const [flowScope, setFlowScope] = useState<'missing' | 'all' | 'range'>('missing');
  const [flowRangeInput, setFlowRangeInput] = useState<string>('');
  const [flowProjectUrl, setFlowProjectUrl] = useState<string>('');
  const [singleFlowGeneratingId, setSingleFlowGeneratingId] = useState<number | null>(null);
  const [isFlowTerminalExpanded, setIsFlowTerminalExpanded] = useState<boolean>(false);
  const [flowProgress, setFlowProgress] = useState<{
    active: boolean;
    currentScene?: number;
    current?: number;
    total?: number;
    percent: number;
    message: string;
    lastImageUrl?: string;
    lastMediaUrl?: string;
    logs: string[];
  }>({
    active: false,
    percent: 0,
    message: '',
    logs: [],
  });

  // Modal Image Preview (Lightbox)
  const [previewModalItem, setPreviewModalItem] = useState<FacelessVisualPromptItem | null>(null);

  const audioPlayerRef = useRef<HTMLAudioElement>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Active topic & episode memo
  const currentTopic = useMemo(() => {
    return topics.find((t) => t.id === selectedTopicId) || topics[0] || null;
  }, [topics, selectedTopicId]);

  const currentEpisode = useMemo(() => {
    return currentTopic?.episodes.find((e) => e.id === selectedEpisodeId) || currentTopic?.episodes[0] || null;
  }, [currentTopic, selectedEpisodeId]);

  const loadData = async (topicId?: string, episodeId?: string) => {
    setLoading(true);
    // Explicitly reset episode data before loading
    setPrompts([]);
    setTranscript(null);
    setAudioList([]);

    const activeTopId = topicId || selectedTopicId;
    const activeEpId = episodeId || selectedEpisodeId;

    try {
      // 1. Load saved visual prompts for this episode
      if (api?.getFacelessVisualPrompts) {
        const vRes = await api.getFacelessVisualPrompts({ topicId: activeTopId, episodeId: activeEpId });
        if (vRes?.success && vRes.data?.prompts && vRes.data.prompts.length > 0) {
          setPrompts(vRes.data.prompts);
        } else {
          setPrompts([]);
        }
      }

      // 2. Load transcript segments from Step 2 for this episode
      if (api?.getFacelessTranscript) {
        const tRes = await api.getFacelessTranscript({ topicId: activeTopId, episodeId: activeEpId });
        if (tRes?.success && tRes.data) {
          setTranscript(tRes.data);
        } else {
          setTranscript(null);
        }
      }

      // 3. Load audio list for this episode
      if (api?.listFacelessAudios) {
        const aRes = await api.listFacelessAudios({ topicId: activeTopId, episodeId: activeEpId });
        if (aRes?.success && aRes.audios) {
          setAudioList(aRes.audios);
        } else {
          setAudioList([]);
        }
      }

      // 4. Load saved Camoufox browser profiles
      if (api?.listCamoufoxProfiles) {
        const pRes = await api.listCamoufoxProfiles();
        if (pRes?.success && Array.isArray(pRes.profiles) && pRes.profiles.length > 0) {
          setFlowProfiles(pRes.profiles);
          if (!pRes.profiles.includes(selectedFlowEmail)) {
            setSelectedFlowEmail(pRes.profiles[0]);
          }
        }
      }

      // 5. Check if Google Flow automation is currently running
      if (api?.getFacelessFlowStatus) {
        const sRes = await api.getFacelessFlowStatus();
        if (sRes?.isRunning) {
          setIsFlowRunning(true);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg || 'Gagal memuat data visual prompt.', 'error');
      setLoading(false);
    }
  };

  // Initial load of topics and active session
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

          await loadData(activeTopicId, activeEpId);
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
    await loadData(topicId, targetEpId);
  };

  // Switch Episode handler
  const handleSelectEpisode = async (episodeId: string) => {
    if (episodeId === selectedEpisodeId) return;
    setSelectedEpisodeId(episodeId);
    await api?.setFacelessActiveSession?.({ topicId: selectedTopicId, episodeId });
    await loadData(selectedTopicId, episodeId);
  };

  // Listen to real-time batch streaming progress from 9router AI (Prompt Generation)
  useEffect(() => {
    if (!api?.onFacelessVisualStreamProgress) return;
    const cleanup = api.onFacelessVisualStreamProgress((data: FacelessVisualStreamProgress) => {
      if (data.type === 'start') {
        setIsGenerating(true);
        setStreamProgress({
          active: true,
          batchIndex: 0,
          totalBatches: data.totalBatches || 1,
          percent: 0,
          message: data.message || `Memulai streaming per ${data.batchSize || batchSize} baris...`,
          startLineNum: 1,
          endLineNum: data.batchSize || batchSize,
        });
      } else if (data.type === 'batch-start') {
        setIsGenerating(true);
        setStreamProgress((prev) => ({
          active: true,
          batchIndex: data.batchIndex || 1,
          totalBatches: data.totalBatches || prev?.totalBatches || 1,
          percent: typeof data.percent === 'number' ? data.percent : (prev?.percent || 0),
          message: data.message || `Memproses batch ${data.batchIndex}...`,
          startLineNum: data.startLineNum,
          endLineNum: data.endLineNum,
        }));
      } else if (data.type === 'batch-complete') {
        if (Array.isArray(data.newPrompts) && data.newPrompts.length > 0) {
          setPrompts((prev) => {
            const map = new Map(prev.map((item) => [item.index, item]));
            for (const item of data.newPrompts!) {
              map.set(item.index, item);
            }
            return Array.from(map.values()).sort((a, b) => a.index - b.index);
          });
        }
        setStreamProgress((prev) => ({
          active: true,
          batchIndex: data.batchIndex || 1,
          totalBatches: data.totalBatches || prev?.totalBatches || 1,
          percent: typeof data.percent === 'number' ? data.percent : (prev?.percent || 100),
          message: data.message || `Batch ${data.batchIndex} selesai!`,
          startLineNum: data.startLineNum,
          endLineNum: data.endLineNum,
        }));
      } else if (data.type === 'batch-error') {
        showToast(data.message || data.error || 'Terjadi kendala pada batch streaming.', 'error');
      } else if (data.type === 'complete') {
        setIsGenerating(false);
        setStreamProgress((prev) =>
          prev ? { ...prev, active: false, percent: 100, message: data.message || 'Selesai!' } : null
        );
        showToast(
          `🎉 Streaming selesai! Total ${data.totalPromptsCount || prompts.length} visual prompt berhasil digenerate via 9router!`,
          'success'
        );
      } else if (data.type === 'cancelled') {
        setIsGenerating(false);
        setStreamProgress((prev) =>
          prev ? { ...prev, active: false, message: data.message || 'Streaming dihentikan.' } : null
        );
        showToast(data.message || 'Streaming dihentikan. Prompt yang sudah masuk tersimpan aman di disk.', 'info');
      }
    });

    return () => cleanup();
  }, [batchSize, prompts.length]);

  // Listen to real-time Google Flow Camoufox progress
  useEffect(() => {
    if (!api?.onFacelessFlowProgress) return;
    const cleanup = api.onFacelessFlowProgress((data: FacelessFlowProgress) => {
      setFlowProgress((prev) => {
        const line = data.message || '';
        const newLogs = line ? [...prev.logs, line].slice(-80) : prev.logs;
        return {
          active: true,
          currentScene: data.sceneId !== undefined ? data.sceneId : prev.currentScene,
          current: data.current !== undefined ? data.current : prev.current,
          total: data.total !== undefined ? data.total : prev.total,
          percent: data.percent !== undefined ? data.percent : prev.percent,
          message: data.message || prev.message,
          lastImageUrl: data.imageUrl || prev.lastImageUrl,
          lastMediaUrl: data.mediaUrl || prev.lastMediaUrl,
          logs: newLogs,
        };
      });

      if (data.type === 'item-success') {
        if (data.sceneId !== undefined) {
          setPrompts((prev) =>
            prev.map((p) => {
              if (p.index === data.sceneId) {
                return {
                  ...p,
                  has_image: true,
                  image_path: data.imagePath,
                  image_url: data.imageUrl,
                  media_url: data.mediaUrl,
                };
              }
              return p;
            })
          );
        }
        if (singleFlowGeneratingId === data.sceneId) {
          setSingleFlowGeneratingId(null);
        }
        showToast(`✓ Gambar adegan #${data.sceneId} berhasil diunduh!`, 'success');
      } else if (data.type === 'item-skip') {
        if (data.sceneId !== undefined && data.mediaUrl) {
          setPrompts((prev) =>
            prev.map((p) => {
              if (p.index === data.sceneId && !p.media_url) {
                return {
                  ...p,
                  has_image: true,
                  image_path: data.imagePath,
                  media_url: data.mediaUrl,
                };
              }
              return p;
            })
          );
        }
      } else if (data.type === 'batch-complete' || data.type === 'stopped') {
        setIsFlowRunning(false);
        setSingleFlowGeneratingId(null);
        showToast(data.message, data.type === 'batch-complete' ? 'success' : 'info');
      } else if (data.type === 'error') {
        setIsFlowRunning(false);
        setSingleFlowGeneratingId(null);
        showToast(data.error || data.message || 'Terjadi kesalahan pada Google Flow.', 'error');
      }
    });

    return () => cleanup();
  }, [singleFlowGeneratingId]);

  const mainAudio = useMemo(() => {
    return audioList.find((a) => a.part === null || a.name.startsWith('voiceover')) || audioList[0] || null;
  }, [audioList]);

  // Cancel ongoing 9router AI prompt streaming
  const handleCancelStream = async () => {
    try {
      if (api?.cancelFacelessVisualStream) {
        await api.cancelFacelessVisualStream();
        showToast('Mengirim permintaan pembatalan streaming prompt...', 'info');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg || 'Gagal membatalkan streaming prompt.', 'error');
    }
  };

  // Generate All Prompts in batches with real-time streaming
  const handleGenerateAll = async () => {
    setIsGenerating(true);
    try {
      if (!api?.generateFacelessVisualPrompts) {
        showToast('Fitur AI generate visual prompt tidak tersedia.', 'error');
        return;
      }

      const res = await api.generateFacelessVisualPrompts({
        lines: transcript?.segments || [],
        instructions: customInstructions.trim() || undefined,
        model: selectedModel,
        batchSize,
        topicId: selectedTopicId || undefined,
        episodeId: selectedEpisodeId || undefined,
      });

      if (res?.success && res.data?.prompts) {
        setPrompts(res.data.prompts);
        showToast(
          `🎉 Berhasil menyelesaikan ${res.data.prompts.length} prompt gambar sesuai DNA Visual Si Kupluk Kuning!`,
          'success'
        );
      } else if (!res?.success) {
        showToast(res?.error || 'Gagal membuat visual prompt.', 'error');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg || 'Terjadi kesalahan saat generate AI.', 'error');
      setIsGenerating(false);
    }
  };

  // Save Prompts
  const handleSave = async (promptsToSave = prompts) => {
    if (promptsToSave.length === 0) return;
    setIsSaving(true);
    try {
      if (api?.saveFacelessVisualPrompts) {
        const res = await api.saveFacelessVisualPrompts(promptsToSave, {
          topicId: selectedTopicId || undefined,
          episodeId: selectedEpisodeId || undefined,
        });
        if (res?.success) {
          showToast(`💾 Visual prompts berhasil disimpan untuk ${selectedEpisodeId ? selectedEpisodeId.toUpperCase() : 'Episode'}!`, 'success');
          showToast(res?.error || 'Gagal menyimpan.', 'error');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg || 'Gagal menyimpan.', 'error');
      setIsSaving(false);
    }
  };

  // Update a single item's field and auto-recalculate prompt
  const handleUpdateItem = (
    id: string,
    field: 'templateType' | 'shotType' | 'sceneDescription' | 'finalPrompt',
    value: string
  ) => {
    setPrompts((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        const updated = { ...item, [field]: value };

        // If user altered template, shot, or sceneDesc, recalculate finalPrompt
        if (field !== 'finalPrompt') {
          const t = updated.templateType;
          const s = updated.shotType;
          const sc = updated.sceneDescription;
          updated.finalPrompt = t === 'A' ? TEMPLATE_A_BASE(sc, s) : TEMPLATE_B_BASE(sc, s);
        }

        return updated;
      })
    );
  };

  // Regenerate single prompt
  const handleRegenerateSingle = async (item: FacelessVisualPromptItem, instruction?: string) => {
    setRegeneratingId(item.id);
    try {
      if (!api?.regenerateSingleFacelessVisualPrompt) return;

      const res = await api.regenerateSingleFacelessVisualPrompt({
        item,
        customInstruction: instruction,
        model: selectedModel,
      });

      if (res?.success && res.item) {
        setPrompts((prev) => prev.map((p) => (p.id === item.id ? res.item! : p)));
        showToast(`✨ Adegan #${item.index} berhasil diregenerate!`, 'success');
        setSingleRegenModalItem(null);
        setSingleRegenFeedback('');
      } else {
        showToast(res?.error || 'Gagal me-regenerate adegan.', 'error');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg || 'Gagal me-regenerate.', 'error');
      setRegeneratingId(null);
    }
  };

  // Start Google Flow Generation
  const handleStartFlow = async (scopeOverride?: 'missing' | 'all' | 'range', specificSceneId?: number) => {
    if (prompts.length === 0) {
      showToast('Belum ada prompt visual. Silakan generate prompt terlebih dahulu.', 'error');
      return;
    }

    const scopeToUse = scopeOverride || flowScope;
    let rangeArg: string | undefined = undefined;

    if (typeof specificSceneId === 'number') {
      rangeArg = String(specificSceneId);
      setSingleFlowGeneratingId(specificSceneId);
    } else if (scopeToUse === 'missing') {
      const missingIndexes = prompts
        .filter((p) => !p.has_image && !p.media_url)
        .map((p) => p.index);

      if (missingIndexes.length === 0) {
        showToast(
          'Semua adegan sudah memiliki file gambar di folder! Pilih mode Seluruh Adegan (Overwrite) jika ingin generate ulang.',
          'info'
        );
        return;
      }
      rangeArg = missingIndexes.join(',');
    } else if (scopeToUse === 'range') {
      if (!flowRangeInput.trim()) {
        showToast('Masukkan rentang adegan yang ingin diproses (contoh: 1-5 atau 1,2,3).', 'error');
        return;
      }
      rangeArg = flowRangeInput.trim();
    } else {
      // All scenes
      rangeArg = undefined;
    }

    setIsFlowRunning(true);
    setFlowProgress((prev) => ({
      ...prev,
      active: true,
      percent: 0,
      message: `Memulai Google Flow Camoufox (${selectedFlowEmail})...`,
    }));

    try {
      if (!api?.startFacelessFlowGeneration) {
        showToast('Fitur automasi Google Flow tidak tersedia.', 'error');
        setIsFlowRunning(false);
        setSingleFlowGeneratingId(null);
        return;
      }

      const res = await api.startFacelessFlowGeneration({
        email: selectedFlowEmail,
        headless: flowHeadless,
        concurrency: typeof specificSceneId === 'number' ? 1 : flowConcurrency,
        overwrite: scopeToUse === 'all' ? flowOverwrite : false,
        range: rangeArg,
        sceneId: typeof specificSceneId === 'number' ? specificSceneId : undefined,
        projectUrl: flowProjectUrl.trim() || undefined,
        topicId: selectedTopicId || undefined,
        episodeId: selectedEpisodeId || undefined,
      });

      if (res?.success) {
        showToast(`🚀 Automasi Google Flow dimulai (${selectedFlowEmail})!`, 'success');
      } else {
        showToast(res?.error || 'Gagal memulai automasi Google Flow.', 'error');
        setIsFlowRunning(false);
        setSingleFlowGeneratingId(null);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg || 'Terjadi kesalahan saat memanggil automasi Flow.', 'error');
      setSingleFlowGeneratingId(null);
    }
  };

  // Stop Google Flow Generation
  const handleStopFlow = async () => {
    try {
      if (api?.stopFacelessFlowGeneration) {
        const res = await api.stopFacelessFlowGeneration();
        showToast(res?.message || 'Permintaan penghentian automasi dikirim.', 'info');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg || 'Gagal menghentikan automasi.', 'error');
    }
  };

  const handleOpenImagesFolder = () => {
    if (api?.openInFolder) {
      if (selectedTopicId && selectedEpisodeId) {
        api.openInFolder(`input/faceless/topics/${selectedTopicId}/episodes/${selectedEpisodeId}/images`);
      } else {
        api.openInFolder('input/faceless/images');
      }
    }
  };

  const handleCopyPrompt = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    showToast('📋 Prompt disalin ke clipboard!', 'success');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyAllPrompts = () => {
    if (prompts.length === 0) return;
    const allText = prompts
      .map(
        (p, idx) =>
          `#${idx + 1} | ${p.timecode} (${p.shotType}) [Template ${p.templateType}]\nNarasi: "${p.narration}"\nPrompt: ${p.finalPrompt}\n`
      )
      .join('\n');
    navigator.clipboard.writeText(allText);
    setCopiedAll(true);
    showToast(`📋 Seluruh ${prompts.length} prompt berhasil disalin!`, 'success');
    setTimeout(() => setCopiedAll(false), 2500);
  };

  const handleSeekAudio = (sec: number) => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.currentTime = sec;
      audioPlayerRef.current.play().catch(() => {});
      showToast(`⏱️ Audio melompat ke detik ${sec}s`, 'info');
    }
  };

  const handleOpenFolder = () => {
    if (api?.openInFolder) {
      if (selectedTopicId && selectedEpisodeId) {
        api.openInFolder(`input/faceless/topics/${selectedTopicId}/episodes/${selectedEpisodeId}`);
      } else {
        api.openInFolder('input/faceless');
      }
    }
  };

  // Counts
  const countA = useMemo(() => prompts.filter((p) => p.templateType === 'A').length, [prompts]);
  const countB = useMemo(() => prompts.filter((p) => p.templateType === 'B').length, [prompts]);
  const countWithImages = useMemo(() => prompts.filter((p) => p.has_image || p.media_url).length, [prompts]);
  const countWithoutImages = useMemo(() => prompts.length - countWithImages, [prompts.length, countWithImages]);
  const percentReady = useMemo(
    () => (prompts.length > 0 ? Math.round((countWithImages / prompts.length) * 100) : 0),
    [prompts.length, countWithImages]
  );

  // Filtered prompts
  const filteredPrompts = useMemo(() => {
    return prompts.filter((p) => {
      if (templateFilter !== 'ALL' && p.templateType !== templateFilter) return false;
      if (shotFilter !== 'ALL' && p.shotType !== shotFilter) return false;
      if (imageFilter === 'HAS_IMAGE' && !p.has_image && !p.media_url) return false;
      if (imageFilter === 'NO_IMAGE' && (p.has_image || p.media_url)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesNarration = p.narration.toLowerCase().includes(q);
        const matchesScene = p.sceneDescription.toLowerCase().includes(q);
        const matchesTc = p.timecode.toLowerCase().includes(q);
        if (!matchesNarration && !matchesScene && !matchesTc) return false;
      }
      return true;
    });
  }, [prompts, templateFilter, shotFilter, imageFilter, searchQuery]);

  // Lightbox Modal Navigation
  const currentModalIndex = useMemo(() => {
    if (!previewModalItem) return -1;
    return filteredPrompts.findIndex((p) => p.id === previewModalItem.id);
  }, [previewModalItem, filteredPrompts]);

  const handlePrevModalItem = () => {
    if (currentModalIndex > 0) {
      setPreviewModalItem(filteredPrompts[currentModalIndex - 1]);
    }
  };

  const handleNextModalItem = () => {
    if (currentModalIndex >= 0 && currentModalIndex < filteredPrompts.length - 1) {
      setPreviewModalItem(filteredPrompts[currentModalIndex + 1]);
    }
  };

  useEffect(() => {
    if (!previewModalItem) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') handlePrevModalItem();
      if (e.key === 'ArrowRight') handleNextModalItem();
      if (e.key === 'Escape') setPreviewModalItem(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewModalItem, currentModalIndex, filteredPrompts]);
  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-24">
      {/* Toast */}
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

      {/* ─── COMPACT HEADER BANNER ─── */}
      <div className="bg-gray-900/90 border border-gray-800 rounded-2xl p-4 shadow-xl backdrop-blur-md relative overflow-hidden">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-700/50 text-[10px] font-mono font-bold tracking-wider uppercase">
                🎨 Step 3: Visual Storyboard & Gambar
              </span>
              {prompts.length > 0 && (
                <span className="px-2.5 py-0.5 rounded-full bg-sky-950/80 text-sky-300 text-[10px] font-mono border border-sky-700/60 font-bold">
                  ✓ {countWithImages}/{prompts.length} Gambar Siap ({percentReady}%)
                </span>
              )}
            </div>
            <h1 className="text-lg font-black text-white tracking-tight flex items-center gap-2">
              <span>🖼️</span> Studio Visual Si Kupluk Kuning & Google Flow
            </h1>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setIsGuideExpanded(!isGuideExpanded)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                isGuideExpanded
                  ? 'bg-amber-950 text-amber-300 border-amber-600/60'
                  : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
              }`}
            >
              <span>📖</span>
              <span>{isGuideExpanded ? 'Tutup Pedoman' : 'Pedoman Gaya Kupluk Kuning'}</span>
            </button>
            <button
              type="button"
              onClick={handleOpenImagesFolder}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-indigo-300 text-xs font-bold rounded-xl border border-gray-700 transition-all flex items-center gap-1.5 cursor-pointer"
              title="Buka folder images di file manager"
            >
              <span>🖼️</span> Folder Gambar
            </button>
            <button
              type="button"
              onClick={handleOpenFolder}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-amber-300 text-xs font-bold rounded-xl border border-gray-700 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>📁</span> Buka Folder
            </button>
            {onBackToAudio && (
              <button
                type="button"
                onClick={onBackToAudio}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-semibold rounded-xl border border-gray-700 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>←</span> Step 2
              </button>
            )}
            {onGoToNext && (
              <button
                type="button"
                onClick={onGoToNext}
                className="px-4 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-gray-950 text-xs font-black rounded-xl transition-all shadow-md shadow-amber-500/20 flex items-center gap-1.5 cursor-pointer"
              >
                <span>🎬 Step 4 (Render) →</span>
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
                    <span className="text-[10px] text-emerald-400 font-mono">🔒</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Hidden audio player for timecode clicks */}
      {mainAudio?.url && (
        <audio ref={audioPlayerRef} src={mainAudio.url} className="hidden" preload="metadata" />
      )}

      {/* DNA Visual & Character Guide Cards (Collapsible) */}
      <div className="bg-gray-900/70 border border-gray-800 rounded-2xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-lg">📖</span>
            <div>
              <h3 className="text-xs font-bold text-amber-300 flex items-center gap-2">
                <span>Panduan Karakter Si Kupluk Kuning & DNA Visual Nano Banana</span>
                <span className="px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800/60 text-[10px] font-mono font-bold">
                  Template A & Template B
                </span>
              </h3>
              <p className="text-[10px] text-gray-400">
                Paten visual resmi untuk menjaga konsistensi karakter stickman 2D di setiap adegan.
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsGuideExpanded(!isGuideExpanded)}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-semibold rounded-xl border border-gray-700 transition-all flex items-center gap-1 cursor-pointer"
          >
            <span>{isGuideExpanded ? '▲ Sembunyikan Pedoman' : '▼ Lihat Pedoman Karakter & DNA Visual'}</span>
          </button>
        </div>

        {isGuideExpanded && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-gray-800">
            {/* Karakter Card */}
            <div className="bg-gray-950/90 border border-gray-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <img
                  src="/assets/faceless/si_kupluk_kuning.png"
                  alt="Si Kupluk Kuning"
                  className="w-16 h-20 object-contain rounded-lg border border-amber-500/30 bg-gray-900"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <div>
                  <span className="text-[10px] uppercase font-bold text-amber-400 font-mono tracking-wider">
                    KARAKTER UTAMA
                  </span>
                  <h4 className="text-sm font-black text-white">Si Kupluk Kuning</h4>
                  <p className="text-[11px] text-gray-400">
                    Satu-satunya karakter protagonis. Di prompt selalu ditulis sebagai{' '}
                    <code className="text-amber-300 font-mono">the stickman</code>.
                  </p>
                </div>
              </div>
              <ul className="text-[11px] text-gray-300 space-y-1 font-mono list-disc list-inside">
                <li>Kepala bulat putih, mata bulat pupil titik kecil, mulut datar (deadpan).</li>
                <li>Badan & anggota tubuh garis hitam tipis (tanpa baju, tanpa otot).</li>
                <li>Beanie <strong className="text-amber-400">mustard kuning</strong> & tas selempang <strong className="text-emerald-400">hijau army</strong>.</li>
                <li>Zombie: stickman abu-abu pucat, mata kosong, bungkuk.</li>
              </ul>
            </div>

            {/* Template Paten Card */}
            <div className="bg-gray-950/90 border border-gray-800 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-sky-400 font-mono tracking-wider">
                  FORMULA PROMPT BAKU
                </span>
                <span className="text-[10px] font-mono text-gray-400">Rasio 16:9 · 2D Flat Cartoon</span>
              </div>
              <div className="space-y-1.5 text-[11px]">
                <div className="p-2 rounded bg-amber-950/30 border border-amber-800/40 text-gray-300 font-mono text-[10px] leading-relaxed">
                  <strong className="text-amber-300">TEMPLATE A (Ada Si Kupluk Kuning):</strong>
                  <br />
                  2D flat hand-drawn stickman cartoon, thick black outlines, NOT realistic, NOT 3D, NOT anime. Stickman: round white head, two round white eyes with small black dot pupils, tiny neutral mouth, thin black stick body and limbs (no clothes, no muscles, no realistic anatomy), mustard yellow beanie, army green sling bag. Scene: [SCENE]. [SHOT]. Muted dark color palette, no text, no labels, 16:9.
                </div>
                <div className="p-2 rounded bg-sky-950/30 border border-sky-800/40 text-gray-300 font-mono text-[10px] leading-relaxed">
                  <strong className="text-sky-300">TEMPLATE B (Benda / Lokasi / Zombie):</strong>
                  <br />
                  2D flat hand-drawn stickman cartoon style, thick black outlines, NOT realistic, NOT 3D, NOT anime. Scene: [SCENE]. [SHOT]. Muted dark color palette, no text, no labels, 16:9.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* GOOGLE FLOW AUTOMATION HUB CARD */}
      {/* ─── GOOGLE FLOW AUTOMATION CONTROL RIBBON ─── */}
      {prompts.length > 0 && (
        <div className="bg-gray-900/90 border border-gray-800 rounded-2xl p-4 shadow-xl backdrop-blur-md space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {/* Left: Status & Overview */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-indigo-950/90 text-indigo-300 border border-indigo-700/60 flex items-center justify-center text-base shadow-sm">
                  ⚡
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-white">Google Flow Generator (Camoufox)</span>
                    <span className="px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800 text-[10px] font-mono font-bold">
                      {selectedFlowEmail}
                    </span>
                    {isFlowRunning && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-500 text-[10px] font-mono font-bold animate-pulse flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        Generating...
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400">
                    {countWithImages} dari {prompts.length} adegan siap ({percentReady}%) · {flowConcurrency} Tab Paralel
                  </p>
                </div>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              {!isFlowRunning ? (
                <button
                  type="button"
                  onClick={() => handleStartFlow()}
                  disabled={prompts.length === 0}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-black text-xs shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <span>⚡</span>
                  <span>
                    {flowScope === 'missing'
                      ? `Mulai Generate (${countWithoutImages} Belum Ada)`
                      : `Mulai Generate (${prompts.length} Adegan)`}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStopFlow}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs shadow-md shadow-red-900/30 transition-all flex items-center gap-1.5 cursor-pointer animate-pulse"
                >
                  <span>⏹️</span>
                  <span>Hentikan Flow</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsFlowConfigOpen(!isFlowConfigOpen)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                  isFlowConfigOpen
                    ? 'bg-indigo-950/80 text-indigo-300 border-indigo-700/60'
                    : 'bg-gray-950 text-gray-300 border-gray-800 hover:bg-gray-800'
                }`}
                title="Buka opsi lanjutan Google Flow (akun, headless, multi-tab, dll)"
              >
                <span>⚙️</span>
                <span>{isFlowConfigOpen ? 'Tutup Opsi' : 'Opsi Flow'}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsFlowTerminalExpanded(!isFlowTerminalExpanded)}
                className={`px-3 py-2 rounded-xl text-xs font-mono border transition-all flex items-center gap-1.5 cursor-pointer ${
                  isFlowTerminalExpanded
                    ? 'bg-gray-800 text-white border-gray-700'
                    : 'bg-gray-950 text-gray-400 border-gray-800 hover:text-gray-200'
                }`}
                title="Lihat output log terminal Camoufox"
              >
                <span>📟</span>
                <span>Log</span>
                {flowProgress.logs.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-indigo-950 text-[10px] text-indigo-300 font-bold">
                    {flowProgress.logs.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-1">
            <div className="w-full h-2 bg-gray-950 rounded-full overflow-hidden border border-gray-800/80">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-amber-400 rounded-full transition-all duration-300"
                style={{ width: `${Math.max(3, percentReady)}%` }}
              />
            </div>
            {isFlowRunning && flowProgress.message && (
              <div className="flex items-center justify-between text-[10px] font-mono text-gray-400">
                <span className="truncate max-w-md">{flowProgress.message}</span>
                <span className="text-indigo-400 font-bold">{flowProgress.percent}%</span>
              </div>
            )}
          </div>

          {/* Collapsible Settings Grid */}
          {isFlowConfigOpen && (
            <div className="pt-3 border-t border-gray-800/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-gray-950/70 p-3.5 rounded-xl border border-gray-800/60 animate-in fade-in">
              {/* 1. Akun */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Akun Google:</label>
                <select
                  value={selectedFlowEmail}
                  onChange={(e) => setSelectedFlowEmail(e.target.value)}
                  disabled={isFlowRunning}
                  className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2.5 py-1.5 text-xs text-indigo-300 font-mono focus:outline-none focus:border-indigo-500"
                >
                  {flowProfiles.map((email) => (
                    <option key={email} value={email}>
                       {email}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Browser Window */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Tampilan Browser:</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setFlowHeadless(true)}
                    disabled={isFlowRunning}
                    className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition-all text-center ${
                      flowHeadless
                        ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm'
                        : 'bg-gray-900 text-gray-400 border-gray-800 hover:text-gray-200'
                    }`}
                  >
                    Headless
                  </button>
                  <button
                    type="button"
                    onClick={() => setFlowHeadless(false)}
                    disabled={isFlowRunning}
                    className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition-all text-center ${
                      !flowHeadless
                        ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm'
                        : 'bg-gray-900 text-gray-400 border-gray-800 hover:text-gray-200'
                    }`}
                  >
                    Buka Tab
                  </button>
                </div>
              </div>

              {/* 3. Concurrency Multi-tab */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Kecepatan Multi-Tab:</label>
                <div className="grid grid-cols-3 gap-1">
                  {[1, 3, 5].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setFlowConcurrency(count)}
                      disabled={isFlowRunning}
                      className={`py-1.5 rounded-lg text-[11px] font-bold border transition-all text-center ${
                        flowConcurrency === count
                          ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm'
                          : 'bg-gray-900 text-gray-400 border-gray-800 hover:text-gray-200'
                      }`}
                    >
                      {count} Tab {count === 5 ? '🚀' : ''}
                    </button>
                  ))}
                </div>
              </div>

              {/* 4. Cakupan / Scope */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Cakupan Adegan:</label>
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { id: 'missing', label: `Belum (${countWithoutImages})` },
                    { id: 'all', label: `Semua (${prompts.length})` },
                    { id: 'range', label: 'Range' },
                  ].map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setFlowScope(s.id as 'missing' | 'all' | 'range')}
                      disabled={isFlowRunning}
                      className={`py-1.5 px-1 rounded-lg text-[10px] font-bold border transition-all text-center truncate ${
                        flowScope === s.id
                          ? 'bg-amber-500 text-gray-950 border-amber-400'
                          : 'bg-gray-900 text-gray-400 border-gray-800 hover:text-gray-200'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                {flowScope === 'range' && (
                  <input
                    type="text"
                    value={flowRangeInput}
                    onChange={(e) => setFlowRangeInput(e.target.value)}
                    placeholder="Contoh: 1-5 atau 1,3,7..."
                    disabled={isFlowRunning}
                    className="w-full mt-1 bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-amber-200 font-mono"
                  />
                )}
              </div>
            </div>
          )}

          {/* Collapsible Terminal */}
          {isFlowTerminalExpanded && (
            <div className="pt-2 border-t border-gray-800/80 animate-in fade-in">
              <div className="bg-gray-950 border border-gray-800 rounded-xl p-3 font-mono text-[11px] text-gray-300 max-h-48 overflow-y-auto space-y-1 select-text">
                <div className="text-[10px] text-gray-500 pb-1 border-b border-gray-800 flex items-center justify-between">
                  <span>TERMINAL LOG (Camoufox & Google Flow)</span>
                  <span>{flowProgress.logs.length} baris</span>
                </div>
                {flowProgress.logs.length === 0 ? (
                  <div className="text-gray-600 italic">Belum ada aktivitas terminal...</div>
                ) : (
                  flowProgress.logs.map((log, idx) => (
                    <div key={idx} className="leading-relaxed break-all">
                      <span className="text-gray-600 mr-2">[{idx + 1}]</span>
                      <span
                        className={
                          log.includes('[ITEM_SUCCESS]') || log.includes('✓')
                            ? 'text-emerald-400 font-bold'
                            : log.includes('error') || log.includes('gagal') || log.includes('[ITEM_ERROR]')
                            ? 'text-red-400 font-bold'
                            : log.includes('[ITEM_GENERATING]')
                            ? 'text-amber-300'
                            : 'text-gray-300'
                        }
                      >
                        {log}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Streaming Live Progress Banner (9router AI Prompts) */}
      {(isGenerating || streamProgress?.active) && (
        <div className="bg-gradient-to-r from-gray-900 via-amber-950/40 to-gray-900 border-2 border-amber-500/60 rounded-3xl p-5 shadow-2xl backdrop-blur-md relative overflow-hidden animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b border-amber-500/20">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black text-white flex items-center gap-2">
                    <span>⚡ Streaming Real-Time (9router AI)</span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold border border-amber-500/40">
                      Batch per {batchSize} baris
                    </span>
                  </h3>
                </div>
                <p className="text-xs text-amber-200/90 font-medium">
                  {streamProgress?.message || `Sedang memproses naskah dalam kelompok ${batchSize} baris...`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xs font-mono font-bold text-amber-300">
                  Batch {streamProgress?.batchIndex || 1} dari{' '}
                  {streamProgress?.totalBatches || Math.ceil((transcript?.segments?.length || 1) / batchSize)}
                </div>
                <div className="text-[11px] text-gray-400 font-mono">
                  {prompts.length} / {transcript?.segments?.length || 0} Prompt Masuk
                </div>
              </div>

              <button
                onClick={handleCancelStream}
                className="px-3.5 py-2 bg-red-600/90 hover:bg-red-500 text-white font-bold text-xs rounded-xl border border-red-400/50 transition-all flex items-center gap-1.5 shadow-lg shadow-red-900/40 hover:scale-105 active:scale-95 cursor-pointer"
                title="Hentikan proses streaming prompt"
              >
                <span>⏹️</span>
                <span>Hentikan Streaming</span>
              </button>
            </div>
          </div>

          {/* Live Progress Bar */}
          <div className="pt-3 space-y-1.5">
            <div className="flex justify-between items-center text-[10px] font-mono text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                <span>Kartu prompt langsung muncul di bawah secara bertahap</span>
              </span>
              <span className="text-amber-300 font-bold">{streamProgress?.percent || 0}% Selesai</span>
            </div>
            <div className="w-full h-2.5 bg-gray-950 rounded-full overflow-hidden border border-gray-800 p-0.5 shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-amber-500 via-yellow-400 to-emerald-400 rounded-full transition-all duration-300 shadow-sm"
                style={{ width: `${Math.min(100, Math.max(2, streamProgress?.percent || 0))}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* MAIN STUDIO AREA */}
      {prompts.length === 0 ? (
        /* Empty State: Ready to generate */
        <div className="bg-gray-900/80 border border-gray-800 rounded-3xl p-8 shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 rounded-3xl bg-amber-500/10 text-amber-400 border border-amber-500/30 mx-auto flex items-center justify-center text-3xl shadow-inner">
            🎨
          </div>

          <div className="space-y-2 max-w-xl mx-auto">
            <h2 className="text-xl font-black text-white">Visual Prompts Belum Dibuat</h2>
            <p className="text-xs text-gray-400 leading-relaxed">
              {transcript?.segments?.length ? (
                <>
                  Ditemukan{' '}
                  <strong className="text-amber-300 font-mono">
                    {transcript.segments.length} baris transkrip timecode
                  </strong>{' '}
                  dari Step 2. AI akan menganalisis setiap baris naskah, menentukan apakah Si Kupluk Kuning hadir
                  (Template A) atau adegan lokasi/objek (Template B), serta menentukan shot sinematik terbaik.
                </>
              ) : (
                <>
                  Belum ada transkrip timecode dari Step 2. Kamu bisa kembali ke Step 2 untuk paste/upload transkrip
                  terlebih dahulu.
                </>
              )}
            </p>
          </div>

          {/* Optional instructions */}
          <div className="max-w-xl mx-auto text-left space-y-1.5">
            <label className="text-[11px] font-bold text-gray-400">
              Instruksi Tambahan untuk Visual (Opsional):
            </label>
            <input
              type="text"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="Contoh: Suasana malam berkabut, supermarket gelap hanya diterangi senter..."
              className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-amber-500/80 font-sans"
            />
          </div>

          {/* 9router Model Selector */}
          <div className="max-w-xl mx-auto text-left space-y-1.5">
            <label className="text-[11px] font-bold text-gray-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Pilih Model AI (9router API):</span>
              </span>
              <span className="text-[10px] text-emerald-400 font-mono font-normal">
                https://9router.riztama.my.id/v1
              </span>
            </label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-amber-300 font-mono font-medium focus:outline-none focus:border-amber-500/80 cursor-pointer shadow-inner"
            >
              {NINEROUTER_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Batch Size Selector */}
          <div className="max-w-xl mx-auto text-left space-y-1.5">
            <label className="text-[11px] font-bold text-gray-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span>⚡ Mode Batch Streaming:</span>
              </span>
              <span className="text-[10px] text-amber-400 font-mono font-bold">Streaming Real-Time per Batch</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { size: 3, label: '3 Baris (Cepat)' },
                { size: 5, label: '5 Baris (Optimal ⭐)' },
                { size: 10, label: '10 Baris' },
              ].map((b) => (
                <button
                  key={b.size}
                  type="button"
                  onClick={() => setBatchSize(b.size)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all text-center cursor-pointer ${
                    batchSize === b.size
                      ? 'bg-amber-500 text-gray-950 border-amber-400 shadow-md shadow-amber-500/20'
                      : 'bg-gray-950 text-gray-400 border-gray-800 hover:text-gray-200 hover:border-gray-700'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-500 italic">
              * AI akan memproses naskah per {batchSize} baris. Kartu visual prompt akan langsung streaming muncul di
              layar setiap {batchSize} baris selesai tanpa harus menunggu semuanya!
            </p>
          </div>

          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleGenerateAll}
              disabled={isGenerating || !transcript?.segments?.length}
              className="px-6 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-gray-950 font-black text-sm shadow-xl shadow-amber-600/30 transition-all inline-flex items-center gap-2 cursor-pointer"
            >
              <span>
                {isGenerating
                  ? '⏳ 9router Sedang Streaming Visual DNA...'
                  : `⚡ Generate Streaming (Batch per ${batchSize} Baris)`}
              </span>
            </button>
            {isGenerating && (
              <button
                onClick={handleCancelStream}
                className="px-4 py-3 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-lg shadow-red-900/40 transition-all inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>⏹️</span>
                <span>Hentikan</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Prompts List View */
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="bg-gray-900/90 border border-gray-800 rounded-2xl p-4 shadow-xl flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="🔍 Cari baris narasi atau scene..."
                className="bg-gray-950 border border-gray-800 rounded-xl px-3 py-1.5 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-amber-500/80 w-52"
              />

              {/* Image Filter (All / Has Image / No Image) */}
              <div className="flex items-center gap-1 bg-gray-950 border border-indigo-900/60 rounded-xl p-1">
                <button
                  onClick={() => setImageFilter('ALL')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    imageFilter === 'ALL'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  Semua ({prompts.length})
                </button>
                <button
                  onClick={() => setImageFilter('HAS_IMAGE')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    imageFilter === 'HAS_IMAGE'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  ✓ Ada Gambar ({countWithImages})
                </button>
                <button
                  onClick={() => setImageFilter('NO_IMAGE')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    imageFilter === 'NO_IMAGE'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  ⏳ Belum ({countWithoutImages})
                </button>
              </div>

              {/* Template filter */}
              <div className="flex items-center gap-1 bg-gray-950 border border-gray-800 rounded-xl p-1">
                <button
                  onClick={() => setTemplateFilter('ALL')}
                  className={`px-2 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    templateFilter === 'ALL'
                      ? 'bg-amber-500 text-gray-950 shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  Template Semua
                </button>
                <button
                  onClick={() => setTemplateFilter('A')}
                  className={`px-2 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    templateFilter === 'A'
                      ? 'bg-amber-500 text-gray-950 shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  🧢 Kupluk Kuning ({countA})
                </button>
                <button
                  onClick={() => setTemplateFilter('B')}
                  className={`px-2 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    templateFilter === 'B'
                      ? 'bg-amber-500 text-gray-950 shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  🏙️ Objek ({countB})
                </button>
              </div>

              {/* Shot filter */}
              <select
                value={shotFilter}
                onChange={(e) => setShotFilter(e.target.value)}
                className="bg-gray-950 border border-gray-800 rounded-xl px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-amber-500/80 cursor-pointer"
              >
                <option value="ALL">Semua Shot</option>
                <option value="wide shot">Wide Shot</option>
                <option value="medium shot">Medium Shot</option>
                <option value="close-up shot">Close-Up Shot</option>
                <option value="top-down shot">Top-Down Shot</option>
              </select>
            </div>

            {/* View Mode Toggle & Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 bg-gray-950 border border-gray-800 rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                    viewMode === 'grid'
                      ? 'bg-amber-500 text-gray-950 shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                  title="Tampilan Grid Storyboard 16:9 (Visual & Rapi)"
                >
                  <span>🖼️</span>
                  <span>Grid Storyboard</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                    viewMode === 'list'
                      ? 'bg-amber-500 text-gray-950 shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                  title="Tampilan Daftar Detail (Edit teks baris)"
                >
                  <span>📋</span>
                  <span>Detail List</span>
                </button>
              </div>
              {isGenerating ? (
                <button
                  onClick={handleCancelStream}
                  className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-red-900/30 flex items-center gap-1.5 cursor-pointer animate-pulse"
                  title="Hentikan streaming AI prompt"
                >
                  <span>⏹️</span>
                  <span>Hentikan Prompt AI</span>
                </button>
              ) : (
                <button
                  onClick={handleGenerateAll}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-amber-300 text-xs font-bold rounded-xl border border-gray-700 transition-all flex items-center gap-1.5 cursor-pointer"
                  title="Generate ulang seluruh adegan secara streaming dalam batch"
                >
                  <span>🔄 AI Prompts (Batch {batchSize})</span>
                </button>
              )}

              <button
                onClick={handleCopyAllPrompts}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-sky-300 text-xs font-bold rounded-xl border border-sky-800/50 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>{copiedAll ? '✓ Tersalin!' : '📋 Salin Semua Prompt'}</span>
              </button>

              <button
                onClick={() => handleSave()}
                disabled={isSaving}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-emerald-700/20 flex items-center gap-1.5 cursor-pointer"
              >
                <span>{isSaving ? '⏳ Menyimpan...' : '💾 Simpan Perubahan'}</span>
              </button>
            </div>
          </div>

          {/* Main Storyboard Display: Grid vs Detail List */}
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredPrompts.map((item) => {
                const isTemplateA = item.templateType === 'A';
                const hasImg = Boolean(item.has_image || item.media_url);
                const imgSrc = item.media_url || (api?.getMediaUrl && item.image_path ? api.getMediaUrl(item.image_path) : '');
                const isSingleGenerating = singleFlowGeneratingId === item.index;

                return (
                  <div
                    key={item.id}
                    onClick={() => setPreviewModalItem(item)}
                    className={`bg-gray-900/90 border rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all group cursor-pointer flex flex-col ${
                      hasImg
                        ? isTemplateA
                          ? 'border-amber-500/30 hover:border-amber-400'
                          : 'border-sky-500/30 hover:border-sky-400'
                        : 'border-gray-800 hover:border-gray-700'
                    }`}
                  >
                    {/* 16:9 Thumbnail Area */}
                    <div className="relative aspect-video w-full bg-gray-950 overflow-hidden">
                      {hasImg ? (
                        <img
                          src={imgSrc}
                          alt={`Scene #${item.index}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-gray-950/80">
                          <span className="text-2xl text-gray-700 mb-1">🖼️</span>
                          <span className="text-[10px] text-gray-500 font-mono">Belum ada gambar</span>
                          <span className="text-[9px] text-gray-600 font-mono mt-0.5 capitalize">{item.shotType}</span>
                        </div>
                      )}

                      {/* Overlaid Badges */}
                      <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-none">
                        <span className="px-2 py-0.5 rounded-lg bg-black/80 backdrop-blur-sm text-white text-[11px] font-mono font-bold border border-white/10 shadow-sm">
                          #{item.index}
                        </span>
                        <span className="px-1.5 py-0.5 rounded-lg bg-black/70 backdrop-blur-sm text-amber-300 text-[10px] font-mono font-semibold border border-amber-500/20">
                          {item.timecode}
                        </span>
                      </div>

                      <div className="absolute top-2 right-2 flex items-center gap-1 pointer-events-none">
                        <span
                          className={`px-1.5 py-0.5 rounded-lg text-[10px] font-mono font-bold backdrop-blur-sm border shadow-sm ${
                            isTemplateA
                              ? 'bg-amber-950/80 text-amber-300 border-amber-600/50'
                              : 'bg-sky-950/80 text-sky-300 border-sky-600/50'
                          }`}
                          title={isTemplateA ? 'Template A (Si Kupluk Kuning)' : 'Template B (Objek/Lokasi)'}
                        >
                          {isTemplateA ? '🧢 A' : '🏙️ B'}
                        </span>
                        {hasImg ? (
                          <span className="w-5 h-5 rounded-full bg-emerald-950/90 border border-emerald-500/60 text-emerald-300 flex items-center justify-center text-[10px] font-bold shadow-sm">
                            ✓
                          </span>
                        ) : (
                          <span className="w-5 h-5 rounded-full bg-amber-950/90 border border-amber-600/50 text-amber-400 flex items-center justify-center text-[10px] shadow-sm">
                            ⏳
                          </span>
                        )}
                      </div>

                      {/* Hover Actions Bar */}
                      <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewModalItem(item);
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold backdrop-blur-md flex items-center gap-1 transition-all"
                          title="Lihat besar & detail prompt"
                        >
                          <span>🔍</span>
                          <span>Detail</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartFlow('range', item.index);
                          }}
                          disabled={isFlowRunning}
                          className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md flex items-center gap-1 transition-all disabled:opacity-50"
                          title="Generate gambar adegan ini via Google Flow"
                        >
                          <span>⚡</span>
                          <span>{isSingleGenerating ? '...' : 'Flow'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyPrompt(item.id, item.finalPrompt);
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-amber-300 text-xs font-bold border border-gray-700 flex items-center gap-1 transition-all"
                          title="Salin Prompt"
                        >
                          <span>{copiedId === item.id ? '✓' : '📋'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Card Body: Clean Narration & Info */}
                    <div className="p-3 flex-1 flex flex-col justify-between space-y-2">
                      <p className="text-xs text-gray-300 line-clamp-2 leading-relaxed font-sans font-medium" title={item.narration}>
                        "{item.narration}"
                      </p>
                      <div className="flex items-center justify-between text-[10px] font-mono text-gray-500 pt-1.5 border-t border-gray-800/60">
                        <span className="capitalize text-gray-400">{item.shotType}</span>
                        <span className="text-amber-400 group-hover:underline">
                          Lihat Detail ➔
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
            {filteredPrompts.map((item) => {
              const isTemplateA = item.templateType === 'A';
              const isRegeneratingThis = regeneratingId === item.id;
              const hasImg = Boolean(item.has_image || item.media_url);
              const isSingleGenerating = singleFlowGeneratingId === item.index;

              return (
                <div
                  key={item.id}
                  className={`bg-gray-900/90 border rounded-2xl p-5 shadow-xl space-y-3.5 transition-all ${
                    hasImg
                      ? 'border-emerald-500/40 hover:border-emerald-500/70 shadow-emerald-950/20'
                      : isTemplateA
                      ? 'border-amber-500/40 hover:border-amber-500/70'
                      : 'border-sky-500/40 hover:border-sky-500/70'
                  }`}
                >
                  {/* Top line header */}
                  <div className="flex items-center justify-between gap-3 flex-wrap border-b border-gray-800/80 pb-3">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="w-7 h-7 rounded-lg bg-gray-800 text-amber-300 border border-gray-700 flex items-center justify-center text-xs font-mono font-bold">
                        #{item.index}
                      </span>

                      {/* Timecode seek badge */}
                      <button
                        onClick={() => handleSeekAudio(item.seconds)}
                        className="px-2.5 py-0.5 rounded-lg bg-gray-800 hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 border border-gray-700 font-mono text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                        title="Dengarkan narasi di detik ini"
                      >
                        <span>▶</span>
                        <span>{item.timecode}</span>
                      </button>

                      {/* Template Selector Button Group */}
                      <div className="flex items-center bg-gray-950 border border-gray-800 rounded-lg p-0.5">
                        <button
                          onClick={() => handleUpdateItem(item.id, 'templateType', 'A')}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all cursor-pointer ${
                            isTemplateA
                              ? 'bg-amber-500 text-gray-950 shadow-sm'
                              : 'text-gray-400 hover:text-gray-200'
                          }`}
                        >
                          🧢 Template A
                        </button>
                        <button
                          onClick={() => handleUpdateItem(item.id, 'templateType', 'B')}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all cursor-pointer ${
                            !isTemplateA
                              ? 'bg-sky-500 text-gray-950 shadow-sm'
                              : 'text-gray-400 hover:text-gray-200'
                          }`}
                        >
                          🏙️ Template B
                        </button>
                      </div>

                      {/* Shot Type Dropdown */}
                      <select
                        value={item.shotType}
                        onChange={(e) => handleUpdateItem(item.id, 'shotType', e.target.value)}
                        className="bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-0.5 text-[11px] text-gray-200 font-mono focus:outline-none focus:border-amber-500/80 cursor-pointer"
                      >
                        {SHOT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>

                      {/* Image status badge */}
                      {hasImg ? (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-300 border border-emerald-600/50 text-[10px] font-mono font-bold flex items-center gap-1">
                          <span>✓</span>
                          <span>Gambar Siap</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md bg-gray-950 text-gray-500 border border-gray-800 text-[10px] font-mono">
                          Belum Ada Gambar
                        </span>
                      )}
                    </div>

                    {/* Quick action buttons */}
                    <div className="flex items-center gap-1.5">
                      {/* Flow single generate button */}
                      <button
                        onClick={() => handleStartFlow('range', item.index)}
                        disabled={isFlowRunning}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                          hasImg
                            ? 'bg-gray-800 hover:bg-gray-700 text-indigo-300 border border-indigo-900/60'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-700/30'
                        }`}
                        title="Generate gambar adegan ini menggunakan Google Flow Camoufox"
                      >
                        <span>⚡</span>
                        <span>{isSingleGenerating ? 'Sedang Generate...' : hasImg ? 'Re-generate Flow' : 'Generate Gambar (Flow)'}</span>
                      </button>

                      <button
                        onClick={() => setSingleRegenModalItem(item)}
                        disabled={isRegeneratingThis}
                        className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-amber-300 text-xs font-semibold rounded-lg border border-gray-700 transition-all flex items-center gap-1 cursor-pointer"
                        title="Revisi atau regenerate scene ini dengan prompt khusus"
                      >
                        <span>🔄</span>
                        <span>Revisi AI</span>
                      </button>

                      <button
                        onClick={() => handleCopyPrompt(item.id, item.finalPrompt)}
                        className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-gray-950 text-xs font-bold rounded-lg transition-all shadow-sm flex items-center gap-1 cursor-pointer"
                      >
                        <span>{copiedId === item.id ? '✓ Tersalin!' : '📋 Salin Prompt'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Body: Thumbnail & Details Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                    {/* Thumbnail Image Preview Box (Col 3 or 4) */}
                    <div className="md:col-span-4 lg:col-span-3">
                      {hasImg ? (
                        <div
                          onClick={() => setPreviewModalItem(item)}
                          className="relative group w-full aspect-video rounded-xl overflow-hidden border border-emerald-500/40 bg-gray-950 shadow-lg cursor-pointer hover:border-emerald-400 transition-all"
                        >
                          <img
                            src={item.media_url || (api?.getMediaUrl && item.image_path ? api.getMediaUrl(item.image_path) : '')}
                            alt={`Adegan #${item.index}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <span className="px-2.5 py-1 bg-black/80 rounded-lg text-white text-[11px] font-bold flex items-center gap-1 shadow-md">
                              <span>🔍</span>
                              <span>Perbesar</span>
                            </span>
                          </div>
                          <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-[9px] font-mono font-bold text-emerald-300">
                            scene_{String(item.index).padStart(3, '0')}.jpg
                          </span>
                        </div>
                      ) : (
                        <div className="w-full aspect-video rounded-xl border-2 border-dashed border-gray-800 bg-gray-950/60 flex flex-col items-center justify-center gap-2 p-3 text-center">
                          <span className="text-gray-600 text-2xl">🖼️</span>
                          <div className="text-[10px] text-gray-500 font-mono">Belum ada gambar</div>
                          <button
                            onClick={() => handleStartFlow('range', item.index)}
                            disabled={isFlowRunning}
                            className="px-2.5 py-1 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white text-[10px] font-bold transition-all shadow-sm flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                          >
                            <span>⚡</span>
                            <span>{isSingleGenerating ? 'Memproses...' : 'Generate via Flow'}</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Narration, Scene Desc & Final Prompt (Col 8 or 9) */}
                    <div className="md:col-span-8 lg:col-span-9 space-y-3">
                      {/* Indonesian Narration Quote */}
                      <div className="text-xs text-gray-300 bg-gray-950/60 border border-gray-800/80 rounded-xl p-3 flex items-start gap-2">
                        <span className="text-amber-400 text-sm leading-none shrink-0">💬</span>
                        <p className="leading-relaxed font-sans font-medium">"{item.narration}"</p>
                      </div>

                      {/* Scene Description input */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-mono text-gray-400 uppercase font-bold tracking-wider flex items-center justify-between">
                          <span>Scene Description (Bahasa Inggris):</span>
                          <span className="text-gray-500 font-normal">Maksimal 3 elemen latar</span>
                        </label>
                        <input
                          type="text"
                          value={item.sceneDescription}
                          onChange={(e) => handleUpdateItem(item.id, 'sceneDescription', e.target.value)}
                          className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-1.5 text-xs text-amber-200 font-mono focus:outline-none focus:border-amber-500/80"
                        />
                      </div>

                      {/* Final Full Prompt Display */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono">
                          <span>FINAL AI PROMPT (NANO BANANA / GOOGLE FLOW):</span>
                          <button
                            onClick={() => handleCopyPrompt(item.id, item.finalPrompt)}
                            className="text-amber-400 hover:underline font-bold cursor-pointer"
                          >
                            Copy
                          </button>
                        </div>
                        <div className="p-3 rounded-xl bg-gray-950 border border-gray-800/80 text-[11px] font-mono text-gray-300 leading-relaxed break-words select-all selection:bg-amber-500 selection:text-black">
                          {item.finalPrompt}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </div>
      )}

      {/* Modal / Dialog for Single Line AI Revision */}
      {singleRegenModalItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6 max-w-lg w-full space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>🔄</span>
                <span>
                  Revisi Adegan #{singleRegenModalItem.index} ({singleRegenModalItem.timecode})
                </span>
              </h3>
              <button
                onClick={() => setSingleRegenModalItem(null)}
                className="text-gray-400 hover:text-white text-xs font-bold px-2 py-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-gray-300 bg-gray-950 p-3 rounded-xl border border-gray-800 font-sans">
              "{singleRegenModalItem.narration}"
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-gray-300">Instruksi Revisi Khusus:</label>
              <textarea
                value={singleRegenFeedback}
                onChange={(e) => setSingleRegenFeedback(e.target.value)}
                placeholder="Contoh: Ubah jadi close-up gembok baja berkarat, atau buat Si Kupluk Kuning memegang senter..."
                rows={3}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-amber-500/80 leading-relaxed font-sans"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setSingleRegenModalItem(null)}
                className="px-3.5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={() => handleRegenerateSingle(singleRegenModalItem, singleRegenFeedback)}
                disabled={regeneratingId === singleRegenModalItem.id}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-gray-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-600/20 cursor-pointer"
              >
                {regeneratingId === singleRegenModalItem.id ? '⏳ Merancang...' : 'Generate Revisi ➔'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox / Fullscreen Image Preview Modal */}
      {previewModalItem && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setPreviewModalItem(null)}
        >
          <div
            className="bg-gray-900 border border-gray-800 rounded-3xl max-w-4xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-800 flex items-center justify-between gap-3 bg-gray-950/80">
              <div className="flex items-center gap-2.5">
                <span className="px-2.5 py-1 rounded-lg bg-indigo-950 text-indigo-300 font-mono text-xs font-bold border border-indigo-800">
                  Adegan #{previewModalItem.index} ({previewModalItem.timecode})
                </span>
                <span className="text-xs font-mono text-gray-400">
                  {previewModalItem.templateType === 'A' ? '🧢 Template A (Kupluk Kuning)' : '🏙️ Template B'} ·{' '}
                  {previewModalItem.shotType}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* Prev / Next navigation */}
                <div className="flex items-center gap-1 bg-gray-950 border border-gray-800 rounded-xl p-0.5">
                  <button
                    type="button"
                    onClick={handlePrevModalItem}
                    disabled={currentModalIndex <= 0}
                    className="px-2.5 py-1 text-xs font-bold text-gray-300 hover:text-white rounded-lg hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
                    title="Adegan Sebelumnya (Keyboard: Panah Kiri)"
                  >
                    ← Prev
                  </button>
                  <span className="text-[10px] text-gray-500 font-mono px-1">
                    {currentModalIndex + 1}/{filteredPrompts.length}
                  </span>
                  <button
                    type="button"
                    onClick={handleNextModalItem}
                    disabled={currentModalIndex >= filteredPrompts.length - 1}
                    className="px-2.5 py-1 text-xs font-bold text-gray-300 hover:text-white rounded-lg hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
                    title="Adegan Berikutnya (Keyboard: Panah Kanan)"
                  >
                    Next →
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleStartFlow('range', previewModalItem.index)}
                  disabled={isFlowRunning}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <span>⚡</span>
                  <span>Generate (Flow)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSingleRegenModalItem(previewModalItem)}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-amber-300 text-xs font-bold rounded-xl border border-gray-700 transition-all flex items-center gap-1 cursor-pointer"
                >
                  <span>🔄</span>
                  <span>Revisi AI</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewModalItem(null)}
                  className="w-8 h-8 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white flex items-center justify-center font-bold text-sm cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body: Large Image */}
            <div className="p-4 flex-1 overflow-y-auto flex flex-col items-center justify-center bg-black/50">
              <img
                src={previewModalItem.media_url || (api?.getMediaUrl && previewModalItem.image_path ? api.getMediaUrl(previewModalItem.image_path) : '')}
                alt={`Scene ${previewModalItem.index}`}
                className="max-h-[62vh] max-w-full rounded-2xl object-contain border border-gray-800 shadow-2xl"
              />
            </div>

            {/* Modal Footer: Narration & Prompt info */}
            <div className="p-4 bg-gray-950 border-t border-gray-800 space-y-2">
              <div className="text-xs text-gray-300 flex items-start gap-2">
                <span className="text-amber-400 font-bold shrink-0">Narasi:</span>
                <span className="font-sans italic">"{previewModalItem.narration}"</span>
              </div>
              <div className="text-[11px] font-mono text-gray-400 bg-gray-900/80 p-2.5 rounded-xl border border-gray-800/80 select-all">
                {previewModalItem.finalPrompt}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <div className="flex items-center justify-between gap-3 pt-4 border-t border-gray-800">
        {onBackToAudio && (
          <button
            onClick={onBackToAudio}
            className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-bold rounded-xl border border-gray-700 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <span>←</span> Kembali ke Step 2 (Audio & Transkrip)
          </button>
        )}

        <div className="flex items-center gap-2">
          {prompts.length > 0 && (
            <button
              onClick={() => handleSave()}
              disabled={isSaving}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-emerald-700/20 flex items-center gap-1.5 cursor-pointer"
            >
              <span>💾</span> Simpan Seluruh Visual Prompts
            </button>
          )}

          {onGoToNext && (
            <button
              onClick={onGoToNext}
              className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-gray-950 text-xs font-black rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center gap-1.5 cursor-pointer"
            >
              <span>🎬</span> Lanjut ke Step 4 (Preview & Render) →
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FacelessVisualStep;
