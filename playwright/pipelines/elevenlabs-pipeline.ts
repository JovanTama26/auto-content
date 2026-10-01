// playwright/pipelines/elevenlabs-pipeline.ts
import { BrowserSession, launchBrowser } from '../actions/launch-browser';
import { generateElevenLabsEmail, DEFAULT_PASSWORD } from '../actions/elevenlabs/generate-email';
import { executeElevenLabsSignup } from '../actions/elevenlabs/signup';
import { fetchVerificationLinkFromGmail } from '../actions/gmail/fetch-verification';
import { executeElevenLabsOnboarding } from '../actions/elevenlabs/onboarding';
import { configureElevenLabsTTS } from '../actions/elevenlabs/configure-tts';
import { downloadElevenLabsAudio, DownloadAudioResult } from '../actions/elevenlabs/download-audio';
import { supabase } from '../../lib/supabase';

export interface ElevenLabsPipelineOptions {
  email?: string;
  password?: string;
  skipSignup?: boolean;
  voiceName?: string;
  modelName?: string;
  stability?: 'robust' | 'creative' | number;
  text?: string;
  generateSpeech?: boolean;
  downloadAudio?: boolean;
  generationNumber?: number; // Default: 2
  outputDir?: string;
  profileName?: string;
  headed?: boolean;
  onLog?: (msg: string) => void;
}

export interface ElevenLabsPipelineResult {
  success: boolean;
  email?: string;
  password?: string;
  verificationLink?: string;
  voiceSelected?: string;
  modelSelected?: string;
  stabilitySet?: string;
  textLength?: number;
  generated?: boolean;
  downloadedFile?: string;
  fileSizeBytes?: number;
  error?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runElevenLabsPipeline(
  options: ElevenLabsPipelineOptions = {}
): Promise<ElevenLabsPipelineResult> {
  const log = options.onLog || ((msg: string) => console.log(`[ElevenLabs Pipeline] ${msg}`));
  const headed = options.headed ?? true;
  const profileName = options.profileName || 'user_1';
  const text = options.text || 'Di tengah guyuran hujan yang disambut suka cita oleh para warga, Nam-san, Ji-wan, dan Su-na akhirnya memutuskan untuk melangkah pulang.\n\n[pauses]\n\nSebelum memulai lembaran baru, mereka menyempatkan diri berziarah ke makam sang nenek saat senja tiba, di mana Su-na melepaskan kerinduannya dengan penuh haru di samping Nam-san dan Ji-wan yang setia mendampingi.\n\n[pauses]\n\nKini kedamaian pun kembali menyelimuti Distrik Bus, di mana Nam-san dan Ji-wan kembali membuka lapak daging mereka dengan ditemani canda tawa hangat bersama Su-na.\n\n[pauses]\n\nOke bro, jadi itu dia alur cerita lengkap dari film Badland Hunters. Sampai jumpa di ulasan film seru selanjutnya!';

  log('====================================================');
  log('🚀 MEMULAI PIPELINE OTOMATISASI ELEVENLABS & GMAIL');
  log('====================================================');

  let session: BrowserSession | null = null;
  let targetEmail = options.email;
  const targetPassword = options.password || DEFAULT_PASSWORD;
  let verifyUrl = '';

  try {
    // 1. Buka Browser Persistent Context
    log(`1/6 Membuka Google Chrome (Profile: ${profileName}, Headed: ${headed})...`);
    session = await launchBrowser({
      headed,
      profileName,
    });

    const { context } = session;
    let page = session.page;

    const getActivePage = () => {
      if (!page.isClosed()) return page;
      const alive = context.pages().filter((p) => !p.isClosed());
      if (alive.length > 0) return alive[alive.length - 1];
      return page;
    };

    if (!options.skipSignup) {
      // 2. Generate Email & Daftar ElevenLabs
      targetEmail = targetEmail || generateElevenLabsEmail();
      const signupStartedAt = Date.now();
      log(`2/6 Menyiapkan pendaftaran ElevenLabs dengan email: ${targetEmail}`);

      try {
        await supabase.from('elevenlabs_accounts').upsert(
          {
            email: targetEmail,
            password: targetPassword,
            status: 'pending_verification',
            credits_remaining: 10000,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'email' }
        );
      } catch {}

      page = getActivePage();
      await executeElevenLabsSignup(page, {
        email: targetEmail,
        password: targetPassword,
        onLog: (m) => log(`[Signup] ${m}`),
      });

      // 3. Ambil Link Verifikasi dari Gmail
      log(`3/6 Menunggu & Mengambil link verifikasi dari inbox Gmail...`);
      const gmailResult = await fetchVerificationLinkFromGmail(context, {
        targetEmail,
        startedAt: signupStartedAt,
        maxWaitSeconds: 90,
        pollIntervalMs: 3500,
        onLog: (m) => log(`[Gmail] ${m}`),
      });

      verifyUrl = gmailResult.verifyUrl;
      log(`✅ Link verifikasi didapat: ${verifyUrl}`);

      try {
        await supabase
          .from('elevenlabs_accounts')
          .update({
            verification_link: verifyUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('email', targetEmail);
      } catch {}

      // 4. Verifikasi Akun & Lewati Onboarding
      log(`4/6 Memproses verifikasi akun & melewati onboarding...`);
      page = getActivePage();
      await executeElevenLabsOnboarding(page, {
        verifyUrl,
        email: targetEmail,
        password: targetPassword,
        onLog: (m) => log(`[Onboarding] ${m}`),
      });

      try {
        await supabase
          .from('elevenlabs_accounts')
          .update({
            status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('email', targetEmail);
      } catch {}
    } else {
      log(`[Skip Signup] Mengakses langsung dashboard Text-to-Speech...`);
      page = getActivePage();
      await page.goto('https://elevenlabs.io/app/speech-synthesis/text-to-speech', {
        waitUntil: 'domcontentloaded',
      });
      await sleep(3000);
    }

    // 5 & 6. Konfigurasi TTS (Dany Saputra, Eleven v3, Stability Robust) & Generate Speech
    log(`5/6 Mengonfigurasi Voice (Dany Saputra), Model (Eleven v3), dan Stability (Robust)...`);
    page = getActivePage();
    const ttsResult = await configureElevenLabsTTS(page, {
      voiceName: options.voiceName || 'Dany Saputra',
      modelName: options.modelName || 'Eleven v3',
      stability: options.stability ?? 'robust',
      text,
      generateSpeech: options.generateSpeech ?? true,
      onLog: (m) => log(`[TTS Config] ${m}`),
    });

    let downloadResult: DownloadAudioResult | null = null;
    if (options.downloadAudio) {
      log(`6/6 Mengunduh hasil audio Generation ${options.generationNumber ?? 2}...`);
      page = getActivePage();
      downloadResult = await downloadElevenLabsAudio(page, {
        generationNumber: options.generationNumber ?? 2,
        outputDir: options.outputDir || 'downloads',
        onLog: (m) => log(`[Download] ${m}`),
      });
    }

    log('====================================================');
    log('🎉 PIPELINE ELEVENLABS BERHASIL DISELESAIKAN!');
    log(`📧 Akun         : ${targetEmail || 'Sesi Aktif'}`);
    log(`🗣️ Voice        : ${ttsResult.voiceSelected}`);
    log(`🤖 Model        : ${ttsResult.modelSelected}`);
    log(`🎚️ Stability    : ${ttsResult.stabilitySet}`);
    log(`📝 Panjang Teks : ${text.length} Karakter`);
    log(`⚡ Generate     : ${ttsResult.textGenerated ? 'Berhasil Dijalankan' : 'Selesai'}`);
    if (downloadResult) {
      log(`💾 Unduhan      : ${downloadResult.fileName} (${downloadResult.filePath})`);
    }
    log('====================================================');

    return {
      success: true,
      email: targetEmail,
      password: targetPassword,
      verificationLink: verifyUrl,
      voiceSelected: ttsResult.voiceSelected,
      modelSelected: ttsResult.modelSelected,
      stabilitySet: ttsResult.stabilitySet,
      textLength: text.length,
      generated: ttsResult.textGenerated,
      downloadedFile: downloadResult?.filePath,
      fileSizeBytes: downloadResult?.fileSizeBytes,
    };
  } catch (error: any) {
    log(`❌ Error pada pipeline: ${error.message}`);
    return {
      success: false,
      email: targetEmail,
      password: targetPassword,
      verificationLink: verifyUrl,
      error: error.message,
    };
  }
}
