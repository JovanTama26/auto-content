import React, { useState } from 'react';
import type { StepId } from '../common/Sidebar';
import HumanologiResearchStep from './HumanologiResearchStep';
import HumanologiAudioStep from './HumanologiAudioStep';
import HumanologiTranscriptStep from './HumanologiTranscriptStep';
import HumanologiVisualMappingStep from './HumanologiVisualMappingStep';

interface HumanologiStepContainerProps {
  activeStep: StepId;
  onStepChange: (step: StepId) => void;
}

interface StepMeta {
  id: StepId;
  stepNumber: number;
  icon: string;
  title: string;
  category: string;
  badge: string;
  description: string;
  targetOutput: string;
  features: string[];
}

const HUMANOLOGI_STEPS_META: Record<string, StepMeta> = {
  topic: {
    id: 'topic',
    stepNumber: 1,
    icon: '✍️',
    title: 'Naskah & Prompt Studio',
    category: 'Pondasi Cerita & ElevenLabs Prompt',
    badge: 'Step 1 of 4',
    description:
      'Prompt generator khusus narasi Humanologi per part (4.500 - 5.000 chars) untuk ElevenLabs TTS, riset topik, sanitasi salam, dan ekspor JSON.',
    targetOutput: 'Naskah Narasi JSON Valid (input/humanologi/humanologi_narasi.json)',
    features: [
      'Prompt Generator Humanologi Khusus ElevenLabs',
      'Aturan Ketat 4.500 - 5.000 Karakter per Part',
      'Pembersihan Otomatis Salam Channel / Halo Penonton',
      'Format Output JSON Terstruktur & Auto-save ke Disk',
    ],
  },
  audio: {
    id: 'audio',
    stepNumber: 2,
    icon: '🎙️',
    title: 'Upload Audio Narator Hub',
    category: 'Voiceover & Audio Engineering',
    badge: 'Step 2 of 4',
    description:
      'Upload file audio voiceover hasil generate ElevenLabs per part narasi, verifikasi durasi rekaman, dan kelola file audio di sistem lokal.',
    targetOutput: 'Voiceover Audio Tracks (.mp3/.wav di input/humanologi/audio/)',
    features: [
      'Upload Voiceover Audio per Bagian Part Narasi',
      'Auto-probe Durasi & Metadata Audio via FFprobe',
      'HTML5 Audio Player untuk Preview & Verifikasi Hasil',
      'Penyimpanan Terstruktur di input/humanologi/audio/',
    ],
  },
  transcript: {
    id: 'transcript',
    stepNumber: 3,
    icon: '📝',
    title: 'Audio Transcript & Alignment',
    category: 'Word Alignment & Faster-Whisper',
    badge: 'Step 3 of 4',
    description:
      'Alignment naskah kata per kata dengan audio voiceover secara otomatis menggunakan Faster-Whisper.',
    targetOutput: 'Word-Level Transcript JSON (input/humanologi/transcripts/)',
    features: [
      'Word-Level Timestamping dari Faster-Whisper',
      'Penyelarasan Durasi Suara Otomatis',
      'Interactive Seek Player Kata per Kata',
      'Ekspor JSON Transkrip Part 1 - 3',
    ],
  },
  render: {
    id: 'render',
    stepNumber: 4,
    icon: '🎨',
    title: 'Visual Mapping & Documentary Prompts Studio',
    category: 'AI Visual Director & Image Prompts Hub',
    badge: 'Step 4 of 4',
    description:
      'Pemecahan naskah menjadi short scenes visual (3–6 kata), sinkronisasi durasi audio persis kata per kata, dan prompt gambar dokumenter (Stickman/Semi-Chibi) 16:9 via 9router.',
    targetOutput: 'Visual Scenes & Image Prompts JSON (input/humanologi/scenes/)',
    features: [
      'Generate Short Visual Scenes (3-6 Kata per Adegan Cepat & Dinamis)',
      'Sinkronisasi Durasi Persis dari Transkrip Kata per Kata',
      'Prompt AI Gambar Dokumenter (Stickman / Semi-Chibi Dewasa 16:9)',
      'Interactive 16:9 Live Sync Preview Stage',
      '1-Click Copy Prompt untuk Midjourney, DALL-E, & Ideogram',
      'Penyimpanan Otomatis ke input/humanologi/scenes/',
    ],
  },
};

const STEP_ORDER: StepId[] = ['topic', 'audio', 'transcript', 'render'];

export const HumanologiStepContainer: React.FC<HumanologiStepContainerProps> = ({
  activeStep,
  onStepChange,
}) => {
  const [notes, setNotes] = useState<Record<string, string>>({});

  const currentStepKey = STEP_ORDER.includes(activeStep) ? activeStep : 'topic';
  const meta = HUMANOLOGI_STEPS_META[currentStepKey] || HUMANOLOGI_STEPS_META.topic;

  const currentIndex = STEP_ORDER.indexOf(currentStepKey);
  const prevStep = currentIndex > 0 ? STEP_ORDER[currentIndex - 1] : null;
  const nextStep = currentIndex < STEP_ORDER.length - 1 ? STEP_ORDER[currentIndex + 1] : null;

  const handleNoteChange = (val: string) => {
    setNotes((prev) => ({ ...prev, [currentStepKey]: val }));
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fadeIn pb-12">
      {/* Top Banner Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-950/60 via-slate-900 to-teal-950/40 border border-emerald-800/40 p-6 shadow-2xl">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-900/60 border border-emerald-500/40 flex items-center justify-center text-3xl shadow-lg shadow-emerald-950/50">
              🧠
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold text-white tracking-tight">
                  Humanologi Studio
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  16:9 Longform
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-gray-800 text-gray-300 border border-gray-700">
                  Skeleton Nav
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Psychology & Human Behavior Narrative Video Production Pipeline
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="px-3 py-1.5 rounded-xl bg-gray-950/80 border border-gray-800 text-xs font-mono flex items-center gap-2 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Mode: Navigation Only</span>
            </div>
          </div>
        </div>

        {/* Stepper Navigation Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-6 pt-5 border-t border-emerald-900/30">
          {STEP_ORDER.map((sKey, idx) => {
            const stepItem = HUMANOLOGI_STEPS_META[sKey];
            const isActive = sKey === currentStepKey;
            const isPassed = idx < currentIndex;

            return (
              <button
                key={sKey}
                onClick={() => onStepChange(sKey)}
                className={`flex items-center gap-2.5 p-2.5 rounded-xl text-left transition-all border ${
                  isActive
                    ? 'bg-emerald-600/90 border-emerald-400 text-white shadow-lg shadow-emerald-600/30 font-bold'
                    : isPassed
                    ? 'bg-gray-900/80 border-emerald-900/50 text-emerald-300/80 hover:border-emerald-700'
                    : 'bg-gray-900/40 border-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
                }`}
              >
                <span className="text-base shrink-0">{stepItem.icon}</span>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase font-mono tracking-wider opacity-70">
                    Step {idx + 1}
                  </div>
                  <div className="text-xs font-semibold truncate">{stepItem.title.split(' ')[0]}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content per Step */}
      {currentStepKey === 'topic' ? (
        <HumanologiResearchStep onGoToAudio={() => onStepChange('audio')} />
      ) : currentStepKey === 'audio' ? (
        <HumanologiAudioStep
          onBackToTopic={() => onStepChange('topic')}
          onGoToTranscript={() => onStepChange('transcript')}
        />
      ) : currentStepKey === 'transcript' ? (
        <HumanologiTranscriptStep
          onBackToAudio={() => onStepChange('audio')}
          onGoToRender={() => onStepChange('render')}
        />
      ) : (
        <HumanologiVisualMappingStep
          onBackToTranscript={() => onStepChange('transcript')}
        />
      )}
    </div>
  );
};

export default HumanologiStepContainer;
