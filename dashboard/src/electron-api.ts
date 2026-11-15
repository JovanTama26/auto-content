// dashboard/src/electron-api.ts

export interface SelectedFile {
  name: string;
  size: number;
  path: string;
}

export interface VideoMeta {
  duration: number;
  width: number;
  height: number;
  name: string;
  size: number;
  url: string;
}

export interface SourceInfo {
  name: string;
  size: number;
  url: string;
  createdAt?: string;
  filePath?: string;
}

export interface AudioInfo {
  name: string;
  size: number;
  url: string;
  createdAt?: string;
  filePath?: string;
}

export interface RenderProgress {
  stage: string;
  progress: number;
  message: string;
}

export interface RenderResult {
  outputPath: string;
  elapsed?: string;
}

export interface TiktokMetadata {
  captions: string[];
  description: string;
  hashtags: string[];
  recommended_caption: string;
  fyp_strategy_tip?: string;
}

export interface YoutubeMetadata {
  titles: string[];
  description: string;
  hashtags: string[];
  recommended_title: string;
}

export interface YoutubeTitleResult {
  titles?: string[];
  description?: string;
  hashtags?: string[];
  recommended_title?: string;
  youtube?: YoutubeMetadata;
  tiktok?: TiktokMetadata;
}

export interface RenderFileInfo {
  name: string;
  size: number;
  createdAt: string;
  filePath: string;
  fullPath: string;
  url: string;
}

export interface AlurfilmChunk {
  part: number;
  name: string;
  fileName?: string;
  size: number;
  startSec?: number;
  durationSec?: number;
  duration?: number;
  filePath: string;
  url: string;
  mediaUrl?: string;
  isCompressed?: boolean;
}

export interface AlurfilmSplitProgressPayload {
  status: 'start' | 'splitting' | 'chunk_completed' | 'done';
  currentPart: number;
  totalParts: number;
  chunk?: AlurfilmChunk;
}

export interface AlurfilmMetadataTitle {
  id: string;
  emotion_category: 'underdog' | 'balas_dendam' | 'aksi_nekat' | 'kaget' | 'misteri';
  emotion_label: string;
  title: string;
  thumbnail_text?: string;
  thumbnail_text_yellow?: string;
  thumbnail_text_red?: string;
  thumbnail_prompt?: string;
  thumbnail_composition_notes?: string;
}

export interface AlurfilmMetadataResult {
  contentId: string;
  titles: AlurfilmMetadataTitle[];
  description: string;
  tags: string[];
  hashtags: string[];
  createdAt: string;
  pinnedComment?: string;
  selectedTitle?: string;
  selectedThumbnailText?: string;
  selectedThumbnailPrompt?: string;
  updatedAt?: string;
}

export interface AlurfilmAlignmentProgressPayload {
  stage: 'preparing' | 'loading_model' | 'aligning' | 'mapping' | 'done' | 'error';
  progress: number;
  log: string;
}

export interface AlurfilmAnalysisData {
  chunk_part: number;
  naskah_voiceover: {
    word_count: number;
    script_text: string;
    macro_summary: string;
  };
  character_registry: Array<{
    visual_description: string;
    assigned_name: string;
  }>;
  timeline_edits: Array<{
    id: string;
    start_time: string;
    end_time: string;
    scene_label: string;
    narrative_focus: string;
  }>;
  status: string;
}

export interface AlurfilmAnalysisResult {
  part: number;
  name: string;
  filePath: string;
  data: AlurfilmAnalysisData;
}

export interface AlurfilmAudioResult {
  id?: string;
  part?: number;
  parts: number[];
  name: string;
  filePath: string;
  url: string;
  mediaUrl?: string;
  size: number;
  duration?: number;
  createdAt?: string;
}

export interface AlurfilmTranscriptEntry {
  id: number;
  start_seconds: number;
  end_seconds: number;
  timestamp_minute: string;
  text: string;
  speaker?: string;
}

export interface AlurfilmTranscriptResult {
  part: number;
  name?: string;
  filePath?: string;
  data?: AlurfilmTranscriptEntry[];
  entries?: AlurfilmTranscriptEntry[];
  multiPart?: boolean;
  savedResults?: AlurfilmTranscriptResult[];
}

export interface AlurfilmVisualClip {
  type: 'slow_motion' | 'mirror_cut' | 'freeze_frame' | 'freeze_frame_with_zoom' | 'freeze_zoom_outro' | 'video_cut' | 'pan_and_zoom_cut';
  duration: number;
  source_start_seconds?: number;
  source_timestamp_seconds?: number;
  slow_mo_factor?: number;
  mirror_mode?: 'horizontal' | 'vertical';
  pan_direction?: 'left' | 'right' | 'up' | 'down' | 'center';
  zoom_speed?: number;
  color_grading_shift?: {
    mode?: string;
    contrast?: number;
    brightness?: number;
    saturation?: number;
    gamma?: number;
  };
}

export interface AlurfilmSentenceMapping {
  sentence_index: number;
  text: string;
  type?: string;
  start: number;
  end: number;
  duration: number;
  visuals: AlurfilmVisualClip[];
}

export interface AlurfilmMappingData {
  scene_id?: string;
  bgm_timeline?: Array<{
    start: number;
    end: number;
    file: string;
    category?: string;
  }>;
  mappings: AlurfilmSentenceMapping[];
  status: string;
}

export interface AlurfilmMappingResult {
  part: number;
  name: string;
  filePath: string;
  data: AlurfilmMappingData;
}

export interface AlurfilmRenderResult {
  part: number;
  outputPath: string;
  elapsed: string;
  name: string;
  mediaUrl: string;
  error?: string;
}

export interface RenderSettings {
  narrationVolume: number;
  bgmVolume: number;
  bgmEnabled: boolean;
  bgmPath: string;
  logoEnabled: boolean;
  logoPath: string;
  logoOpacity: number;
  logoMargin: number;
  logoScale: number;
  introEnabled?: boolean;
  introType?: 'cinematic_title' | 'channel_video';
  introChannelPath?: string;
  introFadeInStory?: boolean;
  introFadeDuration?: number;
  introTitleText?: string;
  introSubtitleText?: string;
  introStylePreset?: 'cinematic_gold' | 'silver_epic' | 'neon_thriller';
  introDuration?: number;
  introImpactTimestamp?: number;
  introAudioPath?: string;
  zoomRate?: number;
}

export interface ElectronAPI {
  selectFile: () => Promise<SelectedFile | null>;
  getVideoMeta: (filePath: string) => Promise<VideoMeta | null>;
  uploadSource: (filePath: string, start: number, end: number) => Promise<SourceInfo>;
  listSources: () => Promise<SourceInfo[]>;
  deleteSource: (fileName: string) => Promise<boolean>;
  selectAudio: () => Promise<SelectedFile | null>;
  uploadAudio: (filePath: string) => Promise<AudioInfo>;
  listAudio: () => Promise<AudioInfo[]>;
  listRenders: () => Promise<RenderFileInfo[]>;
  uploadAlurfilmSource: (filePath: string) => Promise<SourceInfo>;
  uploadAlurfilmMaster: (filePath: string) => Promise<SourceInfo>;
  splitAlurfilmVideo: (masterPath: string, startTime: string | number, endTime: string | number) => Promise<AlurfilmChunk[]>;
  splitAlurfilmMaster: (masterPath: string, intervalSeconds?: number, startTime?: string | number, endTime?: string | number) => Promise<{ chunks: AlurfilmChunk[]; content_id?: string }>;
  onAlurfilmSplitProgress?: (callback: (data: AlurfilmSplitProgressPayload) => void) => () => void;
  generateAlurfilmAutoIntro?: (contentId?: string, clipDurationPerPart?: number) => Promise<{ success: boolean; chunk?: AlurfilmChunk; videoPath?: string; error?: string }>;
  onAlurfilmAutoIntroProgress?: (callback: (data: { step: number; totalSteps: number; percent: number; message: string }) => void) => () => void;
  listAlurfilmChunks: (modeContentId?: string) => Promise<AlurfilmChunk[]>;
  deleteAlurfilmChunk: (part: number) => Promise<boolean>;
  compressAlurfilmChunk: (opts: { part: number; filePath?: string }) => Promise<AlurfilmChunk>;
  analyzeAlurfilmChunk: (chunkPath: string, chunkPart: number, previousContext?: any) => Promise<AlurfilmAnalysisResult>;
  listAlurfilmAnalyses: (modeContentId?: string) => Promise<AlurfilmAnalysisResult[]>;
  syncAlurfilmAnalysesFromSupabase?: (opts?: string | { contentId?: string; modeContentId?: string; force?: boolean }) => Promise<{
    success: boolean;
    syncedCount: number;
    analyses: AlurfilmAnalysisResult[];
  }>;
  getAlurfilmPrompt: (optsOrPartNum: any, totalChunks?: number, previousContext?: any) => Promise<string>;
  saveAlurfilmAnalysis: (contentIdOrPart: string | number, partOrData?: number | any, jsonTextOrPart?: any) => Promise<AlurfilmAnalysisResult>;
  uploadAlurfilmAudio: (contentId: string, parts: number[], filePath: string) => Promise<AlurfilmAudioResult>;
  listAlurfilmAudios: (modeContentId?: string) => Promise<AlurfilmAudioResult[]>;
  deleteAlurfilmAudio: (id: string) => Promise<boolean>;
  getAlurfilmTranscriptPrompt: (chunkPart: number, totalChunks?: number) => Promise<string>;
  saveAlurfilmTranscript: (contentIdOrPart: string | number, partOrData?: number | any, jsonTextOrPart?: any) => Promise<AlurfilmTranscriptResult>;
  listAlurfilmTranscripts: (modeContentId?: string) => Promise<AlurfilmTranscriptResult[]>;
  runAlurfilmWhisperXAlignment?: (parts: number[], audioPath?: string) => Promise<{ success: boolean; savedResults?: any[]; multiPartMap?: any }>;
  processAlurfilmManualTranscript?: (part: number, rawTranscriptText: string) => Promise<{ success: boolean; part: number; entries: any[]; audioSpliced: boolean; splicedAudioPath?: string }>;
  onAlurfilmAlignmentProgress?: (callback: (data: AlurfilmAlignmentProgressPayload) => void) => () => void;
  getAlurfilmMappingPrompt: (chunkPart: number, totalChunks?: number, contentId?: string) => Promise<string>;
  getAllAlurfilmMappingPrompts?: (contentId?: string) => Promise<{
    contentId: string;
    parts: number[];
    totalChunks: number;
    prompts: Record<number, string>;
  }>;
  syncAlurfilmMappingPrompts?: (
    contentId: string,
    prompts: Record<number, string>
  ) => Promise<{ success: boolean; count: number; error?: string }>;
  saveAlurfilmMapping: (contentIdOrPart: string | number, partOrData?: number | any, jsonTextOrPart?: any) => Promise<AlurfilmMappingResult>;
  listAlurfilmMappings: (modeContentId?: string) => Promise<AlurfilmMappingResult[]>;
  syncAlurfilmMappingsFromSupabase?: (modeContentId?: string) => Promise<{ count: number; mappings: any[] }>;
  listAlurfilmRenders: (modeContentId?: string) => Promise<AlurfilmRenderResult[]>;
  renderAlurfilmPart: (
    part: number,
    videoPath: string,
    audioPath: string,
    mappingData: any,
    opts?: Partial<RenderSettings>
  ) => Promise<AlurfilmRenderResult>;
  renderAlurfilmVideo: (
    part: number,
    mapping: any,
    videoPath: string,
    audioPath?: string,
    opts?: {
      bgmPath?: string;
      bgmVolume?: number;
      logoPath?: string;
      logoOpacity?: number;
      logoMargin?: number;
    }
  ) => Promise<AlurfilmRenderResult>;
  listProjectAssets: () => Promise<{
    logos: Array<{ name: string; path: string; url: string }>;
    bgms: Array<{ name: string; path: string; url: string }>;
  }>;
  getRenderSettings?: () => Promise<RenderSettings>;
  saveRenderSettings?: (settings: Partial<RenderSettings>) => Promise<{ success: boolean; settings?: RenderSettings; error?: string }>;
  concatAlurfilmFinalVideo: (
    parts: number[],
    opts?: Partial<RenderSettings> & {
      introFilePath?: string;
      [key: string]: any;
    }
  ) => Promise<{
    filePath?: string;
    fileName?: string;
    mediaUrl?: string;
    error?: string;
  }>;
  getAlurfilmImageReadyPrompt: (opts?: { modeContentId?: string; customNotes?: string; promptType?: 'q5' | 'q5asia' }) => Promise<string>;
  generateAlurfilmMetadata: (opts?: { modeContentId?: string; model?: string; customNotes?: string; promptType?: 'q5' | 'q5asia' }) => Promise<AlurfilmMetadataResult>;
  saveAlurfilmMetadata: (opts: { modeContentId?: string; metadata: AlurfilmMetadataResult }) => Promise<{ success: boolean; filePath: string; metadata: AlurfilmMetadataResult }>;
  getAlurfilmMetadata: (modeContentId?: string) => Promise<AlurfilmMetadataResult | null>;
  getBrowserUserProfiles?: () => Promise<string[]>;
  runAlurfilmGeminiScriptPipeline?: (opts: { partNum: number; totalChunks?: number; previousContext?: any; profileName?: string }) => Promise<{ success: boolean; partNum: number; rawText: string; extractedJson?: any; source?: string; error?: string }>;
  onAlurfilmProgress?: (callback: (data: { percent: number; step: string; message: string; partNum: number }) => void) => () => void;
  onAlurfilmLog?: (callback: (data: { level: 'info' | 'warn' | 'error'; message: string; partNum: number }) => void) => () => void;
  onAlurfilmMetadataChunk?: (callback: (data: { chunk: string; fullText: string }) => void) => () => void;
  renderAlurfilmIntroTest?: (opts: {
    titleText: string;
    subtitleText: string;
    audioPath?: string;
    impactTimestamp?: number;
    duration?: number;
    stylePreset?: 'cinematic_gold' | 'silver_epic' | 'neon_thriller';
    outputPath?: string;
  }) => Promise<{ success: boolean; outputPath: string; error?: string }>;
  getAlurfilmIntro?: (modeContentId?: string) => Promise<{ filePath: string; mediaUrl: string; fileName: string } | null>;
  onAlurfilmIntroProgress?: (callback: (data: { percent?: number; percentage?: number; totalSize?: string; speed?: string; msg?: string }) => void) => () => void;
  generateAlurfilmTestTtsWithSilence?: (scriptText: string) => Promise<{
    success: boolean;
    audioPath: string;
    audioUrl: string;
    totalDurationSec: number;
    segments: Array<{
      index: number;
      type: 'narration' | 'visual_only';
      text?: string | null;
      description?: string | null;
      startSec: number;
      endSec: number;
      durationSec: number;
    }>;
    error?: string;
  }>;

  runAlurfilmTestWhisperAlignment?: (audioPath?: string, scriptText?: string) => Promise<{
    success: boolean;
    isFasterWhisperUsed: boolean;
    totalDurationSec: number;
    items: Array<{
      sentence_index: number;
      type: 'narration' | 'visual_only';
      text: string;
      description?: string;
      start: number;
      end: number;
      duration: number;
      visuals: Array<{
        type: string;
        duration: number;
        source_start_seconds: number;
        color_grading_shift?: { mode?: string; contrast: number; brightness: number; saturation: number; gamma?: number };
      }>;
    }>;
    error?: string;
  }>;
  onAlurfilmTestWhisperProgress?: (callback: (data: { stage: string; progress: number; message: string }) => void) => () => void;

  getMediaUrl?: (filePath: string) => string;
  // Generic project file helpers
  getContentId: (mode?: string) => Promise<string | null>;
  resetProject: (mode?: string) => Promise<{ success: boolean; content_id?: string; error?: string }>;
  copyToClipboard: (text: string) => Promise<boolean>;
  saveToProject: (subPath: string, data: string) => Promise<boolean>;
  readFromProject: (subPath: string) => Promise<string | null>;
  renderVideo: (mapping: object, videoPath: string, audioPath?: string) => Promise<RenderResult | { error: string }>;
  onRenderProgress: (callback: (data: RenderProgress) => void) => () => void;
  generateYoutubeTitles: (transcriptText: string) => Promise<YoutubeTitleResult>;

  // Generic file helpers
  openInFolder?: (filePath: string) => Promise<boolean>;

  // Faceless Idea Agent & Project State Helpers
  facelessAgentChat?: (opts: {
    messages: FacelessChatMessage[];
    model?: string;
    topicId?: string;
    episodeId?: string;
  }) => Promise<{ success: boolean; data?: FacelessAgentChatResult; error?: string }>;
  getFacelessState?: (opts?: {
    topicId?: string;
    episodeId?: string;
  }) => Promise<{
    success: boolean;
    data?: FacelessProjectState | null;
    activeTopicId?: string;
    activeEpisodeId?: string;
    error?: string;
  }>;
  saveFacelessState?: (
    data: FacelessProjectState,
    opts?: { topicId?: string; episodeId?: string }
  ) => Promise<{
    success: boolean;
    data?: FacelessProjectState;
    error?: string;
  }>;
  resetFacelessState?: (opts?: {
    topicId?: string;
    episodeId?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  lockFacelessProject?: (opts?: {
    topicId?: string;
    episodeId?: string;
  }) => Promise<{ success: boolean; data?: FacelessProjectState; error?: string }>;
  unlockFacelessProject?: (opts?: {
    topicId?: string;
    episodeId?: string;
  }) => Promise<{ success: boolean; data?: FacelessProjectState; error?: string }>;
  createFacelessTopic?: (opts: {
    title: string;
    category?: string;
    description?: string;
    characterName?: string;
    characterDesc?: string;
    vibe?: string;
  }) => Promise<{
    success: boolean;
    topicId?: string;
    episodeId?: string;
    topicMeta?: Record<string, unknown>;
    data?: FacelessProjectState;
    error?: string;
  }>;
  createFacelessEpisode?: (opts: {
    topicId: string;
    title?: string;
  }) => Promise<{
    success: boolean;
    topicId?: string;
    episodeId?: string;
    data?: FacelessProjectState;
    error?: string;
  }>;
  setFacelessActiveSession?: (opts: {
    topicId: string;
    episodeId?: string;
  }) => Promise<{
    success: boolean;
    activeTopicId?: string;
    activeEpisodeId?: string;
    error?: string;
  }>;
  listFacelessAudios?: (opts?: {
    topicId?: string;
    episodeId?: string;
  }) => Promise<{
    success: boolean;
    audios: FacelessAudioItem[];
    inputDir?: string;
    audioDir?: string;
    error?: string;
  }>;
  uploadFacelessAudio?: (opts: {
    filePath: string;
    part?: number | null;
    topicId?: string;
    episodeId?: string;
  }) => Promise<{ success: boolean; audio?: FacelessAudioItem; error?: string }>;
  deleteFacelessAudio?: (audioId: string, opts?: { topicId?: string; episodeId?: string }) => Promise<{ success: boolean; error?: string }>;
  getFacelessAudioDir?: (opts?: { topicId?: string; episodeId?: string }) => Promise<{ success: boolean; dir?: string; audioDir?: string; error?: string }>;
  saveFacelessTranscript?: (opts: {
    rawText: string;
    formattedText?: string;
    segments?: FacelessTranscriptSegment[];
    part?: number | null;
    topicId?: string;
    episodeId?: string;
  }) => Promise<{
    success: boolean;
    data?: FacelessTranscriptData;
    error?: string;
  }>;
  getFacelessTranscript?: (opts?: {
    part?: number | null;
    topicId?: string;
    episodeId?: string;
  }) => Promise<{
    success: boolean;
    data?: FacelessTranscriptData | null;
    error?: string;
  }>;
  generateFacelessVisualPrompts?: (opts?: {
    lines?: FacelessTranscriptSegment[];
    model?: string;
    instructions?: string;
    batchSize?: number;
    topicId?: string;
    episodeId?: string;
  }) => Promise<{
    success: boolean;
    data?: FacelessVisualPromptsData;
    error?: string;
  }>;
  getFacelessVisualPrompts?: (opts?: {
    topicId?: string;
    episodeId?: string;
  }) => Promise<{
    success: boolean;
    data?: FacelessVisualPromptsData | null;
    error?: string;
  }>;
  saveFacelessVisualPrompts?: (
    prompts: FacelessVisualPromptItem[],
    opts?: { topicId?: string; episodeId?: string }
  ) => Promise<{
    success: boolean;
    data?: FacelessVisualPromptsData;
    error?: string;
  }>;
  regenerateSingleFacelessVisualPrompt?: (opts: {
    item: FacelessVisualPromptItem;
    customInstruction?: string;
    model?: string;
  }) => Promise<{
    success: boolean;
    item?: FacelessVisualPromptItem;
    error?: string;
  }>;
  onFacelessVisualStreamProgress?: (
    callback: (data: FacelessVisualStreamProgress) => void
  ) => () => void;
  cancelFacelessVisualStream?: () => Promise<{ success: boolean; message?: string }>;
  listCamoufoxProfiles?: () => Promise<{ success: boolean; profiles: string[]; error?: string }>;
  startFacelessFlowGeneration?: (opts?: FacelessFlowGenerateOptions) => Promise<{ success: boolean; message?: string; error?: string }>;
  stopFacelessFlowGeneration?: () => Promise<{ success: boolean; message?: string; error?: string }>;
  getFacelessFlowStatus?: () => Promise<{ isRunning: boolean }>;
  onFacelessFlowProgress?: (callback: (data: FacelessFlowProgress) => void) => () => void;
  listFacelessTopicsAndEpisodes?: () => Promise<{
    success: boolean;
    topics: FacelessTopicItem[];
    activeTopicId?: string;
    activeEpisodeId?: string;
    error?: string;
  }>;
  getFacelessEpisodeDetails?: (opts: {
    topicId: string;
    episodeId: string;
  }) => Promise<{
    success: boolean;
    data?: FacelessEpisodeDetails;
    error?: string;
  }>;
  renderFacelessEpisode?: (opts: {
    topicId: string;
    episodeId: string;
    overwrite?: boolean;
  }) => Promise<{
    success: boolean;
    outputPath?: string;
    mediaUrl?: string;
    error?: string;
  }>;
  renderFacelessShort?: (opts: {
    topicId: string;
    episodeId: string;
    partNumber?: number;
    partStart?: number;
    partEnd?: number;
    partTitle?: string;
    outroLabel?: string;
  }) => Promise<{
    success: boolean;
    outputPath?: string;
    mediaUrl?: string;
    error?: string;
  }>;
  onFacelessRenderProgress?: (
    callback: (data: {
      topicId: string;
      episodeId: string;
      stage: string;
      progress: number;
      message: string;
      currentFrame?: number;
      totalFrames?: number;
    }) => void
  ) => () => void;

  // Humanologi Helpers (Prompt, Narration JSON, and Audio)
  getHumanologiPrompt?: () => Promise<{ success: boolean; prompt?: string; error?: string }>;
  getLatestHumanologiNarasi?: () => Promise<{ success: boolean; data?: any; error?: string }>;
  saveHumanologiNarasi?: (data: any) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  listHumanologiAudios?: () => Promise<{ success: boolean; audios: HumanologiAudioItem[]; error?: string }>;
  uploadHumanologiAudio?: (
    part: number,
    filePath: string
  ) => Promise<{ success: boolean; audio?: HumanologiAudioItem; error?: string }>;
  deleteHumanologiAudio?: (part: number) => Promise<{ success: boolean; error?: string }>;
  getHumanologiAudioDir?: () => Promise<{ success: boolean; dir?: string; error?: string }>;
  getHumanologiTranscriptPrompt?: () => Promise<{ success: boolean; prompt?: string; error?: string }>;
  getHumanologiTranscript?: (
    part: number
  ) => Promise<{ success: boolean; data?: HumanologiTranscriptPartData; error?: string }>;
  saveHumanologiTranscript?: (
    part: number,
    data: HumanologiTranscriptPartData
  ) => Promise<{ success: boolean; filePath?: string; data?: HumanologiTranscriptPartData; error?: string }>;
  listHumanologiTranscripts?: () => Promise<{
    success: boolean;
    transcripts: Record<number, HumanologiTranscriptPartData>;
    error?: string;
  }>;
  runHumanologiWhisperAlignment?: (
    part: number,
    model?: string
  ) => Promise<{ success: boolean; data?: HumanologiTranscriptPartData; filePath?: string; error?: string }>;
  getHumanologiVisualScenesPrompt?: () => Promise<{ success: boolean; prompt?: string; error?: string }>;
  generateHumanologiScenes9Router?: (
    part?: number,
    model?: string
  ) => Promise<{ success: boolean; data?: HumanologiScenesData; filePath?: string; error?: string }>;
  getHumanologiScenes?: (
    part?: number
  ) => Promise<{ success: boolean; data?: HumanologiScenesData; error?: string }>;
  saveHumanologiScenes?: (
    part: number,
    data: HumanologiScenesData
  ) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  onHumanologiAlignmentProgress?: (
    callback: (data: { stage?: string; progress?: number; log?: string; part?: number }) => void
  ) => () => void;
  onHumanologiScenesStreamProgress?: (
    callback: (data: {
      type?: 'start' | 'batch-start' | 'chunk' | 'batch-done' | 'completed' | 'error';
      part?: number;
      batchNum?: number;
      totalBatches?: number;
      percent?: number;
      message?: string;
      delta?: string;
      newScenesCount?: number;
      totalScenes?: number;
      data?: HumanologiScenesData;
    }) => void
  ) => () => void;
  generateHumanologiFlowImages?: (options: {
    part?: number;
    concurrency?: number;
    sceneNumbers?: number[];
    overwriteExisting?: boolean;
    headed?: boolean;
  }) => Promise<{ success: boolean; completed?: number; total?: number; error?: string; message?: string }>;
  cancelHumanologiFlowImages?: () => Promise<{ success: boolean; message?: string }>;
  getHumanologiImages?: (part?: number) => Promise<{
    success: boolean;
    images: Array<{ scene_number?: number; file_name: string; file_path: string; url: string; size: number }>;
    total: number;
    error?: string;
  }>;
  onHumanologiImageStart?: (
    callback: (data: { part: number; sceneNumber: number }) => void
  ) => () => void;
  onHumanologiImageLog?: (
    callback: (data: { part: number; sceneNumber: number; text: string }) => void
  ) => () => void;
  onHumanologiImageProgress?: (
    callback: (data: {
      part: number;
      current: number;
      total: number;
      sceneNumber: number;
      status: 'success' | 'error';
      imageUrl?: string;
      filePath?: string;
      error?: string;
    }) => void
  ) => () => void;
  getHumanologiRenderReadiness?: () => Promise<HumanologiRenderReadinessResult>;
  renderHumanologiPart?: (options: {
    part: number;
    enableSubtitles?: boolean;
    kenBurns?: boolean;
    concurrency?: number;
  }) => Promise<{
    success: boolean;
    part?: number;
    outputPath?: string;
    mediaUrl?: string;
    fileSize?: number;
    elapsed?: string;
    error?: string;
  }>;
  mergeHumanologiFull?: () => Promise<{
    success: boolean;
    outputPath?: string;
    mediaUrl?: string;
    fileSize?: number;
    elapsed?: string;
    error?: string;
  }>;
  onHumanologiRenderProgress?: (
    callback: (data: HumanologiRenderProgressData) => void
  ) => () => void;
}

export interface FacelessIdea {
  title: string;
  category: string;
  concept_hook: string;
  description: string;
  materials: string[];
  vibe: string;
}

export interface FacelessChatMessage {
  role: 'user' | 'assistant';
  content: string;
  at?: string;
}

export type FacelessStage =
  | 'idea_discussion'
  | 'duration_discussion'
  | 'outline_discussion'
  | 'narration_discussion';

export interface FacelessDuration {
  label: string;
  seconds: number;
  format: 'short' | 'long' | null;
}

export interface FacelessNarrationOutline {
  hook?: string;
  plan?: string;
  failure?: string;
  improvisation?: string;
  stakes?: string;
  twist?: string;
  cliffhanger?: string;
  notes?: string;
}

export interface FacelessMemory {
  summary: string;
  key_points: string[];
  user_preferences: string[];
  draft_script?: string;
  clean_script?: string;
  narration_outline: FacelessNarrationOutline;
}

export interface FacelessNarration {
  status: 'discussing' | 'ready' | null;
  draft_script?: string;
  clean_script?: string;
  outline?: FacelessNarrationOutline;
  updated_at?: string;
}

export interface FacelessAudioItem {
  id: string;
  part?: number | null;
  name: string;
  originalName: string;
  filePath: string;
  size: number;
  duration: number;
  uploadedAt: string;
  url?: string;
}

export interface FacelessAudioState {
  status: 'idle' | 'uploaded' | 'ready';
  total_duration: number;
  items_count: number;
  primary_file: string | null;
  updated_at: string;
}

export interface FacelessTranscriptSegment {
  timecode: string;
  seconds: number;
  text: string;
}

export interface FacelessTranscriptData {
  rawText: string;
  formattedText: string;
  segments: FacelessTranscriptSegment[];
  segments_count?: number;
  part?: number | null;
  filePath?: string;
  jsonPath?: string;
  updatedAt: string;
}

export interface FacelessVisualPromptItem {
  id: string;
  index: number;
  timecode: string;
  seconds: number;
  narration: string;
  templateType: 'A' | 'B';
  shotType: string;
  sceneDescription: string;
  finalPrompt: string;
  image_path?: string;
  image_url?: string;
  media_url?: string;
  has_image?: boolean;
  image_size?: number;
}

export interface FacelessVisualPromptsData {
  prompts: FacelessVisualPromptItem[];
  jsonPath?: string;
  txtPath?: string;
  updatedAt?: string;
}

export interface FacelessFlowGenerateOptions {
  email?: string;
  projectUrl?: string;
  range?: string;
  sceneId?: number;
  prompt?: string;
  headless?: boolean;
  overwrite?: boolean;
  outputDir?: string;
  concurrency?: number;
  topicId?: string;
  episodeId?: string;
}

export interface FacelessFlowProgress {
  type:
  | 'log'
  | 'item-start'
  | 'item-generating'
  | 'item-success'
  | 'item-error'
  | 'item-skip'
  | 'progress'
  | 'batch-complete'
  | 'stopped'
  | 'error';
  message: string;
  sceneId?: number;
  imageUrl?: string;
  mediaUrl?: string;
  imagePath?: string;
  percent?: number;
  current?: number;
  total?: number;
  error?: string;
}

export interface FacelessVisualStreamProgress {
  type: 'start' | 'batch-start' | 'batch-complete' | 'batch-error' | 'cancelled' | 'complete';
  totalLines?: number;
  totalBatches?: number;
  batchIndex?: number;
  batchSize?: number;
  startLineNum?: number;
  endLineNum?: number;
  newPrompts?: FacelessVisualPromptItem[];
  totalPromptsCount?: number;
  percent?: number;
  message?: string;
  error?: string;
}

export interface FacelessProjectState {
  version: number;
  stage: FacelessStage;
  topic_id?: string;
  episode_id?: string;
  continuation?: {
    is_continuation: boolean;
    previous_episode_id: string;
    previous_episode_number?: number;
    previous_summary?: string;
    previous_cliffhanger?: string;
    previous_ending_snippet?: string;
    previous_ending_notes?: string;
    topic_lore?: string;
    series_history?: Array<{
      episode_id: string;
      episode_number: number;
      title: string;
      summary: string;
      key_points?: string[];
      hook?: string;
      cliffhanger?: string;
      ending_script_snippet?: string;
    }>;
  } | null;
  is_locked?: boolean;
  locked_at?: string | null;
  idea_source: 'user' | 'agent' | null;
  idea: FacelessIdea | null;
  duration: FacelessDuration | null;
  narration: FacelessNarration | null;
  audio?: FacelessAudioState | null;
  transcript?: FacelessTranscriptData | null;
  visual_prompts?: FacelessVisualPromptItem[] | null;
  memory?: FacelessMemory;
  chat_history: FacelessChatMessage[];
  created_at: string;
  updated_at: string;
}

export interface FacelessAgentChatResult {
  reply: string;
  stage: FacelessStage;
  is_locked?: boolean;
  idea_ready: boolean;
  idea: FacelessIdea | null;
  duration_ready: boolean;
  duration: FacelessDuration | null;
  draft_script?: string;
  clean_script?: string;
  memory?: FacelessMemory;
  narration?: FacelessNarration | null;
  suggested_actions: string[];
  state: FacelessProjectState;
}

export interface FacelessEpisodeSummary {
  id: string;
  title: string;
  isLocked?: boolean;
  stage?: string;
  isContinuation?: boolean;
  prevEpisodeId?: string | null;
  statePath?: string;
  totalDuration: number;
  scenesCount: number;
  fps: number;
  resolution: { width: number; height: number };
  isRendered: boolean;
  videoPath?: string;
  videoUrl?: string;
  videoSizeBytes?: number;
  videoSizeFormatted?: string;
  renderedAt?: string;
  shortVideos?: Array<{
    id: string;
    fileName: string;
    title: string;
    partNumber?: number;
    partStart?: number;
    partEnd?: number;
    partTitle?: string;
    isRendered?: boolean;
    path?: string;
    url?: string;
    sizeBytes?: number;
    sizeFormatted?: string;
    modifiedAt?: string;
  }>;
  audioPath?: string;
  audioUrl?: string;
  imagesCount: number;
  sfxCount: number;
  typographyCount: number;
  cameraPresetsSummary?: Record<string, number>;
  timelinePath: string;
  transcriptPath?: string;
  visualPromptsPath?: string;
}

export interface FacelessTopicItem {
  id: string;
  title: string;
  description: string;
  character?: {
    name: string;
    description: string;
    dnaPrompt?: string;
  };
  visualTheme?: {
    style: string;
    environment?: string;
  };
  referenceImages?: {
    characterRefUrl?: string;
    dnaVisualRefUrl?: string;
  };
  created_at?: string;
  episodesCount: number;
  renderedCount: number;
  totalDuration: number;
  episodes: FacelessEpisodeSummary[];
}

export interface FacelessEpisodeSceneDetail {
  id: string;
  index: number;
  start: number;
  duration: number;
  end: number;
  label: string;
  camera?: {
    preset: string;
    from?: any;
    to?: any;
    whipOut?: any;
  } | null;
  typography?: {
    enabled: boolean;
    style?: 'typewriter' | 'kinetic_punch';
    text?: string;
  } | null;
  imagePath?: string | null;
  imageUrl?: string | null;
  prompt?: string;
  shotType?: string;
  characterDna?: string;
  hasSfx: boolean;
  sfxList: Array<{
    id: string;
    name: string;
    start: number;
    volume: number;
    src?: string;
  }>;
}

export interface FacelessEpisodeDetails {
  topicId: string;
  episodeId: string;
  topicMeta?: any;
  title: string;
  totalDuration: number;
  fps: number;
  resolution: { width: number; height: number };
  video: {
    exists: boolean;
    filePath?: string;
    mediaUrl?: string;
    sizeBytes?: number;
    sizeFormatted?: string;
    renderedAt?: string;
  };
  audio: {
    voiceoverUrl?: string | null;
    bgmUrl?: string | null;
    bgmSrc?: string;
    bgmVolume?: number;
    sfxCount: number;
    sfxList: any[];
  };
  scenes: FacelessEpisodeSceneDetail[];
  cameraPresetCounts: Record<string, number>;
  typographyCount: number;
  sfxCount: number;
}

export interface WatermarkTextConfig {
  enabled: boolean;
  text: string;
  fontFamily: string;
  fontSize: number;
  colorHex: string;
  opacity: number;
  position: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  offsetX: number;
  offsetY: number;
}

export interface CaptionConfig {
  enabled: boolean;
  fontName: string;
  fontSize: number;
  activeColorHex: string;
  inactiveColorHex: string;
  outlineColorHex: string;
  outlineWidth: number;
  shadowDistance: number;
  positionY: number;
  positionX: number;
  alignment: number;
  displayMode: 'single-word' | 'phrase' | 'sentence';
  timeOffsetSec: number;
}

export interface BgmConfig {
  enabled: boolean;
  path: string;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
}

export interface VignetteConfig {
  enabled: boolean;
  intensity: number;
  colorHex: string;
}

export interface VoiceOverConfig {
  enabled: boolean;
  volume: number;
}

export interface HumanologiAudioItem {
  id: string;
  part: number;
  name: string;
  originalName: string;
  filePath: string;
  size: number;
  duration: number;
  uploadedAt: string;
  url?: string;
}

export interface HumanologiTranscriptEntry {
  id: number;
  start_seconds: number;
  end_seconds: number;
  timestamp_minute: string;
  text: string;
  visual_description?: string;
  visual_prompt?: string;
  camera_movement?: string;
  visual_type?: string;
  broll_keyword?: string;
  image_url?: string;
}

export interface HumanologiTranscriptPartData {
  part: number;
  audio_duration: number;
  total_entries: number;
  entries: HumanologiTranscriptEntry[];
  updated_at?: string;
}

export interface HumanologiScene {
  scene_number: number;
  part_narasi: number;
  start_seconds?: number;
  end_seconds?: number;
  durasi_detik?: number;
  durasi_kata_total?: number;
  durasi_estimasi_detik?: number;
  word_count?: number;
  potongan_narasi: string;
  konteks_kalimat?: string;
  deskripsi_visual_singkat: string;
  image_prompt: string;
  image_url?: string;
  image_path?: string;
}

export interface HumanologiScenesData {
  judul_video: string;
  part?: number;
  total_scene: number;
  audio_duration?: number;
  total_parts?: number;
  gaya_visual_global: string;
  scenes: HumanologiScene[];
  updated_at?: string;
}

export interface HumanologiPartReadiness {
  part: number;
  totalScenes: number;
  readyImages: number;
  imagesPercent: number;
  audioExists: boolean;
  audioFileName?: string | null;
  audioDuration: number;
  isRendered: boolean;
  videoSize?: number;
  videoMtime?: number | null;
  videoUrl?: string | null;
  videoPath?: string;
}

export interface HumanologiRenderReadinessResult {
  success: boolean;
  parts: HumanologiPartReadiness[];
  fullVideo: {
    isRendered: boolean;
    size: number;
    mtime?: number | null;
    url?: string | null;
    filePath?: string;
  };
  error?: string;
}

export interface HumanologiRenderProgressData {
  part?: number;
  stage: string;
  progress: number | null;
  message: string;
  currentScene?: number;
  totalScenes?: number;
  rawLine?: string;
  isError?: boolean;
  outputPath?: string;
  mediaUrl?: string;
  elapsed?: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

