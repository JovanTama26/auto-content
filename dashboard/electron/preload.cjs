// dashboard/electron/preload.cjs
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // File open dialog
  selectFile: () => ipcRenderer.invoke('select-file'),

  // Get video metadata via ffprobe
  getVideoMeta: (filePath) => ipcRenderer.invoke('get-video-meta', filePath),

  // Upload & trim source video
  uploadSource: (filePath, start, end) =>
    ipcRenderer.invoke('upload-source', { filePath, start, end }),

  // List uploaded sources
  listSources: () => ipcRenderer.invoke('list-sources'),

  // Delete an uploaded source
  deleteSource: (fileName) => ipcRenderer.invoke('delete-source', fileName),

  // Audio file selection & upload
  selectAudio: () => ipcRenderer.invoke('select-audio'),
  uploadAudio: (filePath) => ipcRenderer.invoke('upload-audio', { filePath }),
  listAudio: () => ipcRenderer.invoke('list-audio'),
  listRenders: () => ipcRenderer.invoke('list-renders'),

  // Clipboard
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),

  // Render video via Remotion
  renderVideo: (mapping, videoPath, audioPath) => ipcRenderer.invoke('render-video', mapping, videoPath, audioPath),
  onRenderProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('render-progress', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('render-progress', handler);
  },

  // Alur Film Specific IPC Helpers
  uploadAlurfilmSource: (filePath) => ipcRenderer.invoke('upload-alurfilm-source', { filePath }),
  uploadAlurfilmMaster: (filePath) => ipcRenderer.invoke('upload-alurfilm-source', { filePath }),
  splitAlurfilmVideo: (masterPath, startTime, endTime) =>
    ipcRenderer.invoke('split-alurfilm-video', { masterPath, startTime, endTime }),
  splitAlurfilmMaster: (masterPath, intervalSeconds, startTime, endTime) =>
    ipcRenderer.invoke('split-alurfilm-master', { masterPath, intervalSeconds, startTime, endTime }),
  onAlurfilmSplitProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('alurfilm-split-progress', handler);
    return () => ipcRenderer.removeListener('alurfilm-split-progress', handler);
  },
  splitAlurfilmMasterRange: (masterPath, startSec, durationSec, partNum) =>
    ipcRenderer.invoke('split-alurfilm-master-range', { masterPath, startSec, durationSec, partNum }),
  generateAlurfilmAutoIntro: (contentId, clipDurationPerPart) =>
    ipcRenderer.invoke('generate-alurfilm-auto-intro', { contentId, clipDurationPerPart }),
  onAlurfilmAutoIntroProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('alurfilm:auto-intro-progress', handler);
    return () => ipcRenderer.removeListener('alurfilm:auto-intro-progress', handler);
  },
  listAlurfilmChunks: (modeContentId) => ipcRenderer.invoke('list-alurfilm-chunks', modeContentId),
  deleteAlurfilmChunk: (part) => ipcRenderer.invoke('delete-alurfilm-chunk', { part }),
  compressAlurfilmChunk: (opts) => ipcRenderer.invoke('compress-alurfilm-chunk', opts),
  analyzeAlurfilmChunk: (chunkPath, chunkPart, previousContext) =>
    ipcRenderer.invoke('analyze-alurfilm-chunk', { chunkPath, chunkPart, previousContext }),
  listAlurfilmAnalyses: (modeContentId) => ipcRenderer.invoke('list-alurfilm-analyses', modeContentId),
  syncAlurfilmAnalysesFromSupabase: (opts) => ipcRenderer.invoke('sync-alurfilm-analyses-from-supabase', opts),
  runAlurfilmGeminiScriptPipeline: (...args) => {
    let opts = {};
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      opts = args[0];
    } else {
      opts = {
        partNum: typeof args[0] !== 'undefined' && args[0] !== null ? Number(args[0]) : 1,
        totalChunks: Number(args[1]) || 4,
        previousContext: args[2] || null,
      };
    }
    return ipcRenderer.invoke('run-alurfilm-gemini-script-pipeline', opts);
  },
  getBrowserUserProfiles: () => ipcRenderer.invoke('get-browser-user-profiles'),
  onAlurfilmProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('alurfilm:progress', handler);
    return () => ipcRenderer.removeListener('alurfilm:progress', handler);
  },
  onAlurfilmLog: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('alurfilm:log', handler);
    return () => ipcRenderer.removeListener('alurfilm:log', handler);
  },
  getAlurfilmPrompt: (optsOrPartNum, totalChunks, previousContext) => {
    if (typeof optsOrPartNum === 'object' && optsOrPartNum !== null) {
      return ipcRenderer.invoke('get-alurfilm-prompt', optsOrPartNum);
    }
    return ipcRenderer.invoke('get-alurfilm-prompt', { chunkPart: optsOrPartNum, totalChunks, previousContext });
  },
  saveAlurfilmAnalysis: (...args) => {
    let chunkPart = 1;
    let jsonText = null;
    if (args.length >= 3) {
      chunkPart = args[1];
      jsonText = args[2];
    } else if (args.length === 2) {
      if (typeof args[0] === 'number' || !isNaN(Number(args[0]))) {
        chunkPart = Number(args[0]);
        jsonText = args[1];
      } else {
        chunkPart = typeof args[1] !== 'undefined' && args[1] !== null ? Number(args[1]) : 1;
        jsonText = args[0] || args[2];
      }
    } else if (args.length === 1) {
      jsonText = args[0];
    }
    return ipcRenderer.invoke('save-alurfilm-analysis', { chunkPart, jsonText });
  },
  uploadAlurfilmAudio: (contentId, parts, filePath) =>
    ipcRenderer.invoke('upload-alurfilm-audio', { parts, filePath }),
  listAlurfilmAudios: (modeContentId) =>
    ipcRenderer.invoke('list-alurfilm-audios', modeContentId),
  deleteAlurfilmAudio: (id) =>
    ipcRenderer.invoke('delete-alurfilm-audio', { id }),
  getAlurfilmTranscriptPrompt: (chunkPart, totalChunks) =>
    ipcRenderer.invoke('get-alurfilm-transcript-prompt', { chunkPart, totalChunks }),
  saveAlurfilmTranscript: (...args) => {
    let chunkPart = 1;
    let jsonText = null;
    if (args.length >= 3) {
      chunkPart = args[1];
      jsonText = args[2];
    } else if (args.length === 2) {
      if (typeof args[0] === 'number' || !isNaN(Number(args[0]))) {
        chunkPart = Number(args[0]);
        jsonText = args[1];
      } else {
        chunkPart = typeof args[1] !== 'undefined' && args[1] !== null ? Number(args[1]) : 1;
        jsonText = args[0];
      }
    } else if (args.length === 1) {
      jsonText = args[0];
    }
    return ipcRenderer.invoke('save-alurfilm-transcript', { chunkPart, jsonText });
  },
  listAlurfilmTranscripts: (modeContentId) =>
    ipcRenderer.invoke('list-alurfilm-transcripts', modeContentId),
  runAlurfilmWhisperXAlignment: (parts, audioPath) =>
    ipcRenderer.invoke('run-alurfilm-whisperx-alignment', { parts, audioPath }),
  processAlurfilmManualTranscript: (part, rawTranscriptText) =>
    ipcRenderer.invoke('process-alurfilm-manual-transcript', { part, rawTranscriptText }),
  onAlurfilmAlignmentProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('alurfilm-alignment-progress', handler);
    return () => ipcRenderer.removeListener('alurfilm-alignment-progress', handler);
  },
  getAlurfilmMappingPrompt: (chunkPart, totalChunks, contentId) =>
    ipcRenderer.invoke('get-alurfilm-mapping-prompt', { chunkPart, totalChunks, contentId }),
  getAllAlurfilmMappingPrompts: (contentId) =>
    ipcRenderer.invoke('get-all-alurfilm-mapping-prompts', { contentId }),
  syncAlurfilmMappingPrompts: (contentId, prompts) =>
    ipcRenderer.invoke('sync-alurfilm-mapping-prompts-to-supabase', { contentId, prompts }),
  runAlurfilmMappingPipeline: (opts) =>
    ipcRenderer.invoke('run-alurfilm-mapping-pipeline', opts || {}),
  saveAlurfilmMapping: (...args) => {
    let chunkPart = 1;
    let jsonText = null;
    if (args.length >= 3) {
      chunkPart = args[1];
      jsonText = args[2];
    } else if (args.length === 2) {
      if (typeof args[0] === 'number' || !isNaN(Number(args[0]))) {
        chunkPart = Number(args[0]);
        jsonText = args[1];
      } else {
        chunkPart = typeof args[1] !== 'undefined' && args[1] !== null ? Number(args[1]) : 1;
        jsonText = args[0];
      }
    } else if (args.length === 1) {
      jsonText = args[0];
    }
    return ipcRenderer.invoke('save-alurfilm-mapping', { chunkPart, jsonText });
  },
  listAlurfilmMappings: (modeContentId) =>
    ipcRenderer.invoke('list-alurfilm-mappings', modeContentId),
  syncAlurfilmMappingsFromSupabase: (modeContentId) =>
    ipcRenderer.invoke('sync-alurfilm-mappings-from-supabase', modeContentId),
  listAlurfilmRenders: (modeContentId) =>
    ipcRenderer.invoke('list-alurfilm-renders', modeContentId),
  renderAlurfilmPart: (part, videoPath, audioPath, mappingData, opts = {}) =>
    ipcRenderer.invoke('render-alurfilm-video', { part, chunkPart: part, mapping: mappingData, mappingData, videoPath, audioPath, ...opts }),
  renderAlurfilmVideo: (part, mapping, videoPath, audioPath, opts = {}) =>
    ipcRenderer.invoke('render-alurfilm-video', { part, chunkPart: part, mapping, mappingData: mapping, videoPath, audioPath, ...opts }),
  listProjectAssets: () =>
    ipcRenderer.invoke('list-project-assets'),
  getRenderSettings: () =>
    ipcRenderer.invoke('get-render-settings'),
  saveRenderSettings: (settings) =>
    ipcRenderer.invoke('save-render-settings', settings),
  concatAlurfilmFinalVideo: (parts, opts) =>
    ipcRenderer.invoke('concat-alurfilm-final-video', { parts, ...opts }),
  getAlurfilmImageReadyPrompt: (opts) =>
    ipcRenderer.invoke('get-alurfilm-image-ready-prompt', opts || {}),
  generateAlurfilmMetadata: (opts) =>
    ipcRenderer.invoke('generate-alurfilm-metadata', opts || {}),
  saveAlurfilmMetadata: (opts) =>
    ipcRenderer.invoke('save-alurfilm-metadata', opts || {}),
  getAlurfilmMetadata: (modeContentId) =>
    ipcRenderer.invoke('get-alurfilm-metadata', modeContentId),
  onAlurfilmMetadataChunk: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('alurfilm-metadata-chunk', handler);
    return () => ipcRenderer.removeListener('alurfilm-metadata-chunk', handler);
  },
  renderAlurfilmIntroTest: (options) =>
    ipcRenderer.invoke('alurfilm:render-intro-test', options),
  getAlurfilmIntro: (modeContentId) =>
    ipcRenderer.invoke('get-alurfilm-intro', modeContentId),
  onAlurfilmIntroProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('alurfilm:render-intro-progress', handler);
    return () => ipcRenderer.removeListener('alurfilm:render-intro-progress', handler);
  },
  generateAlurfilmTestTtsWithSilence: (scriptText) =>
    ipcRenderer.invoke('generate-alurfilm-test-tts-with-silence', { scriptText }),
  runAlurfilmTestWhisperAlignment: (audioPath, scriptText) =>
    ipcRenderer.invoke('run-alurfilm-test-whisper-alignment', { audioPath, scriptText }),
  onAlurfilmTestWhisperProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('alurfilm-test-whisper-progress', handler);
    return () => ipcRenderer.removeListener('alurfilm-test-whisper-progress', handler);
  },


  getMediaUrl: (filePath) => `media://content-auto/${encodeURIComponent(filePath)}`,

  // Generic project file helpers
  getContentId: (mode) => ipcRenderer.invoke('get-content-id', mode),
  resetProject: (mode) => ipcRenderer.invoke('reset-project', mode),

  // Generic file helpers
  openInFolder: (filePath) => ipcRenderer.invoke('open-in-folder', filePath),

  // Faceless Idea Agent & Project State Helpers
  facelessAgentChat: (opts) => ipcRenderer.invoke('faceless-agent-chat', opts),
  getFacelessState: (opts) => ipcRenderer.invoke('get-faceless-state', opts),
  saveFacelessState: (data, opts) => ipcRenderer.invoke('save-faceless-state', { data, ...opts }),
  resetFacelessState: (opts) => ipcRenderer.invoke('reset-faceless-state', opts),
  lockFacelessProject: (opts) => ipcRenderer.invoke('lock-faceless-project', opts),
  unlockFacelessProject: (opts) => ipcRenderer.invoke('unlock-faceless-project', opts),
  createFacelessTopic: (opts) => ipcRenderer.invoke('create-faceless-topic', opts),
  createFacelessEpisode: (opts) => ipcRenderer.invoke('create-faceless-episode', opts),
  setFacelessActiveSession: (opts) => ipcRenderer.invoke('set-faceless-active-session', opts),
  listFacelessAudios: (opts) => ipcRenderer.invoke('list-faceless-audios', opts),
  uploadFacelessAudio: (opts) => ipcRenderer.invoke('upload-faceless-audio', opts),
  deleteFacelessAudio: (audioId, opts) => ipcRenderer.invoke('delete-faceless-audio', { audioId, ...opts }),
  getFacelessAudioDir: (opts) => ipcRenderer.invoke('get-faceless-audio-dir', opts),
  saveFacelessTranscript: (opts) => ipcRenderer.invoke('save-faceless-transcript', opts),
  getFacelessTranscript: (opts) => ipcRenderer.invoke('get-faceless-transcript', opts),
  generateFacelessVisualPrompts: (opts) => ipcRenderer.invoke('generate-faceless-visual-prompts', opts),
  getFacelessVisualPrompts: (opts) => ipcRenderer.invoke('get-faceless-visual-prompts', opts),
  saveFacelessVisualPrompts: (prompts, opts) => ipcRenderer.invoke('save-faceless-visual-prompts', prompts, opts),
  regenerateSingleFacelessVisualPrompt: (opts) => ipcRenderer.invoke('regenerate-single-faceless-visual-prompt', opts),
  onFacelessVisualStreamProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('faceless-visual-stream-progress', handler);
    return () => ipcRenderer.removeListener('faceless-visual-stream-progress', handler);
  },
  cancelFacelessVisualStream: () => ipcRenderer.invoke('cancel-faceless-visual-stream'),
  listCamoufoxProfiles: () => ipcRenderer.invoke('list-faceless-flow-profiles'),
  startFacelessFlowGeneration: (opts) => ipcRenderer.invoke('start-faceless-flow-generation', opts),
  stopFacelessFlowGeneration: () => ipcRenderer.invoke('stop-faceless-flow-generation'),
  getFacelessFlowStatus: () => ipcRenderer.invoke('get-faceless-flow-status'),
  onFacelessFlowProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('faceless-flow-progress', handler);
    return () => ipcRenderer.removeListener('faceless-flow-progress', handler);
  },
  listFacelessTopicsAndEpisodes: () => ipcRenderer.invoke('list-faceless-topics-episodes'),
  getFacelessEpisodeDetails: (opts) => ipcRenderer.invoke('get-faceless-episode-details', opts),
  renderFacelessEpisode: (opts) => ipcRenderer.invoke('render-faceless-episode', opts),
  renderFacelessShort: (opts) => ipcRenderer.invoke('render-faceless-short', opts),
  onFacelessRenderProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('faceless-render-progress', handler);
    return () => ipcRenderer.removeListener('faceless-render-progress', handler);
  },

  // Humanologi Helpers (Prompt, Narration JSON, Audio, and Transcript Mapping)
  getHumanologiPrompt: () => ipcRenderer.invoke('get-humanologi-prompt'),
  getLatestHumanologiNarasi: () => ipcRenderer.invoke('get-latest-humanologi-narasi'),
  saveHumanologiNarasi: (data) => ipcRenderer.invoke('save-humanologi-narasi', { data }),
  listHumanologiAudios: () => ipcRenderer.invoke('list-humanologi-audios'),
  uploadHumanologiAudio: (part, filePath) =>
    ipcRenderer.invoke('upload-humanologi-audio', { part, filePath }),
  deleteHumanologiAudio: (part) =>
    ipcRenderer.invoke('delete-humanologi-audio', { part }),
  getHumanologiAudioDir: () => ipcRenderer.invoke('get-humanologi-audio-dir'),
  getHumanologiTranscriptPrompt: () =>
    ipcRenderer.invoke('get-humanologi-transcript-prompt'),
  getHumanologiTranscript: (part) =>
    ipcRenderer.invoke('get-humanologi-transcript', { part }),
  saveHumanologiTranscript: (part, data) =>
    ipcRenderer.invoke('save-humanologi-transcript', { part, data }),
  listHumanologiTranscripts: () =>
    ipcRenderer.invoke('list-humanologi-transcripts'),
  runHumanologiWhisperAlignment: (part, model) =>
    ipcRenderer.invoke('run-humanologi-whisper-alignment', { part, model }),
  getHumanologiVisualScenesPrompt: () =>
    ipcRenderer.invoke('get-humanologi-visual-scenes-prompt'),
  generateHumanologiScenes9Router: (part, model) =>
    ipcRenderer.invoke('generate-humanologi-scenes-9router', { part, model }),
  getHumanologiScenes: (part) =>
    ipcRenderer.invoke('get-humanologi-scenes', { part }),
  saveHumanologiScenes: (part, data) =>
    ipcRenderer.invoke('save-humanologi-scenes', { part, data }),
  onHumanologiAlignmentProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('humanologi-alignment-progress', handler);
    return () => ipcRenderer.removeListener('humanologi-alignment-progress', handler);
  },
  onHumanologiScenesStreamProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('humanologi-scenes-stream-progress', handler);
    return () => ipcRenderer.removeListener('humanologi-scenes-stream-progress', handler);
  },
  generateHumanologiFlowImages: (options) =>
    ipcRenderer.invoke('generate-humanologi-flow-images', options),
  cancelHumanologiFlowImages: () =>
    ipcRenderer.invoke('cancel-humanologi-flow-images'),
  getHumanologiImages: (part) =>
    ipcRenderer.invoke('get-humanologi-images', { part }),
  onHumanologiImageStart: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('humanologi-image-chunk-start', handler);
    return () => ipcRenderer.removeListener('humanologi-image-chunk-start', handler);
  },
  onHumanologiImageLog: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('humanologi-image-log', handler);
    return () => ipcRenderer.removeListener('humanologi-image-log', handler);
  },
  onHumanologiImageProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('humanologi-image-progress', handler);
    return () => ipcRenderer.removeListener('humanologi-image-progress', handler);
  },
  getHumanologiRenderReadiness: () =>
    ipcRenderer.invoke('get-humanologi-render-readiness'),
  renderHumanologiPart: (options) =>
    ipcRenderer.invoke('render-humanologi-part', options),
  mergeHumanologiFull: () =>
    ipcRenderer.invoke('merge-humanologi-full'),
  onHumanologiRenderProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('humanologi-render-progress', handler);
    return () => ipcRenderer.removeListener('humanologi-render-progress', handler);
  },
});

