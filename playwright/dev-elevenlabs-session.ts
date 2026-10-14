import { launchBrowser } from './actions/launch-browser';
import {
  saveElevenLabsSession,
  isElevenLabsSessionActive,
  ELEVENLABS_SESSION_PATH,
} from './actions/elevenlabs/session';
import fs from 'fs';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const args = process.argv.slice(2);
  let profileName = 'user_1';
  let isSaveOnly = false;
  let isHeadless = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) {
      profileName = args[i + 1];
    }
    if (args[i] === '--save-only') {
      isSaveOnly = true;
    }
    if (args[i] === '--headless') {
      isHeadless = true;
    }
  }

  console.log('====================================================');
  console.log('🚀 ELEVENLABS DEV RUNNER (DIRECT DASHBOARD ENTRY)');
  console.log('====================================================');
  console.log(`👤 Profile     : ${profileName}`);
  console.log(`📂 Session File: ${ELEVENLABS_SESSION_PATH}`);
  console.log(`🖥️ Mode        : ${isHeadless ? 'Headless' : 'Headed'}`);
  console.log('====================================================\n');

  const session = await launchBrowser({
    profileName,
    headed: !isHeadless,
    storageStatePath: fs.existsSync(ELEVENLABS_SESSION_PATH) ? ELEVENLABS_SESSION_PATH : undefined,
  });

  const { context, page } = session;

  try {
    console.log('[Dev] Membuka Dashboard Text-to-Speech ElevenLabs...');
    await page.goto('https://elevenlabs.io/app/speech-synthesis/text-to-speech', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(2500);

    // Tutup popup tutorial atau onboarding modal jika ada
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(500);

    // Cek status sesi
    const isActive = await isElevenLabsSessionActive(page);

    if (isActive) {
      console.log('✅ [Dev] Sesi ElevenLabs aktif & terautentikasi!');
      // Simpan / perbarui session state agar token tetap segar
      await saveElevenLabsSession(context);

      console.log('\n====================================================');
      console.log('🎉 DASHBOARD SIAP UNTUK DEVELOPMENT MODUL TTS');
      console.log('====================================================');
      console.log(`🌐 URL         : ${page.url()}`);
      console.log('⚡ Status      : LOGIN ACTIVE (Tanpa perlu signup)');
      console.log('====================================================\n');

      if (isSaveOnly) {
        console.log('[Dev] Mode --save-only: Sesi berhasil disimpan, menutup browser.');
        await context.close();
        return;
      }
    } else {
      console.warn('\n⚠️ [Dev Warning] Sesi ElevenLabs belum login atau sudah expired.');
      console.warn(`Halaman saat ini: ${page.url()}`);
      console.warn('👉 Silakan jalankan: npm run elevenlabs:signup untuk membuat sesi baru.\n');
    }
  } catch (err: any) {
    console.error('❌ [Dev Error]:', err?.message || err);
  } finally {
    if (isSaveOnly) {
      await context.close().catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
