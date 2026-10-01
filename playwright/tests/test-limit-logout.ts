// playwright/tests/test-limit-logout.ts
import { launchBrowser } from '../actions/launch-browser';
import { executeElevenLabsLogout } from '../actions/elevenlabs/logout';
import path from 'path';
import fs from 'fs';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runLimitAndLogoutTest() {
  console.log('===============================================================');
  console.log('🧪 TEST: ELEVENLABS LIMIT DETECTION & NATIVE AUTO-LOGOUT');
  console.log('===============================================================\n');

  const screenshotsDir = path.resolve(process.cwd(), 'playwright', 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // 1. Launch browser with user_1 profile
  console.log('1. Meluncurkan browser...');
  const session = await launchBrowser({
    headed: false,
    profileName: 'user_1',
  });

  const { page } = session;

  try {
    // 2. Buka ElevenLabs TTS
    console.log('2. Membuka ElevenLabs Text-to-Speech...');
    await page.goto('https://elevenlabs.io/app/speech-synthesis/text-to-speech', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await sleep(6000);

    const initialUrl = page.url();
    console.log(`   URL saat ini: ${initialUrl}`);

    // Jika sudah di sign-in (karena test sebelumnya), login dulu atau tes di halaman sign-in
    if (initialUrl.includes('/sign-in') || initialUrl.includes('/login')) {
      console.log('   ℹ️ Browser saat ini sudah dalam keadaan logout / sign-in.');
      console.log('   Melakukan login cepat untuk menguji alur limit -> logout...');
      
      const emailInput = page.locator('input[type="email"], input[name="email"]').first();
      const passInput = page.locator('input[type="password"], input[name="password"]').first();
      const submitBtn = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first();

      if (await emailInput.isVisible().catch(() => false)) {
        await emailInput.fill('jovankonten@gmail.com');
        await sleep(300);
        await passInput.fill('Jovan@1224');
        await sleep(300);
        await submitBtn.click({ force: true });
        await sleep(6000);
        console.log(`   URL setelah login: ${page.url()}`);
      }
    }

    // 3. Masukkan teks dan periksa limit kuota
    console.log('\n3. Menguji deteksi limit kuota...');
    
    // Cek sisa kredit di halaman
    const creditInfo = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const creditMatch = bodyText.match(/([\d,]+)\s+credits?\s+remaining/i);
      const remainingCredits = creditMatch ? parseInt(creditMatch[1].replace(/,/g, ''), 10) : null;
      return { remainingCredits, bodySnippet: bodyText.slice(0, 300) };
    });

    console.log(`   Sisa kredit terdeteksi: ${creditInfo.remainingCredits ?? 'Tidak terbaca'}`);

    // Masukkan teks panjang untuk memicu limit jika kredit kecil
    const editor = page.locator('[contenteditable="true"], .ProseMirror, textarea').first();
    if (await editor.isVisible().catch(() => false)) {
      console.log('   Memasukkan teks ke editor...');
      await editor.click();
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await editor.fill('Teks pengujian auto-logout limit ElevenLabs yang sangat panjang agar kuota terlampaui dan modal limit muncul.');
      await sleep(1500);
    }

    // Coba klik tombol Generate speech untuk memicu modal limit jika kuota habis
    const genBtn = page.locator('[data-testid="tts-generate"], button:has-text("Generate speech")').first();
    if (await genBtn.isVisible().catch(() => false)) {
      console.log('   Mengklik tombol Generate speech...');
      await genBtn.click({ force: true }).catch(() => {});
      await sleep(2500);
    }

    // Ambil screenshot kondisi limit / sebelum logout
    await page.screenshot({ path: path.join(screenshotsDir, 'test-limit-detected.png') });
    console.log('   📸 Screenshot kondisi limit tersimpan.');

    // 4. Jalankan executeElevenLabsLogout
    console.log('\n4. Menjalankan executeElevenLabsLogout (Bener-bener klik tombol logout)...');
    const logoutRes = await executeElevenLabsLogout(page, {
      onLog: (m) => console.log(`   [Action] ${m}`),
    });

    console.log('\n===============================================================');
    console.log('📊 HASIL TEST LOGOUT:');
    console.log(`   Sukses   : ${logoutRes.success}`);
    console.log(`   Metode   : ${logoutRes.method}`);
    console.log(`   Final URL: ${logoutRes.finalUrl}`);
    console.log('===============================================================\n');

    await page.screenshot({ path: path.join(screenshotsDir, 'test-logout-result.png') });

    if (!logoutRes.success || (!logoutRes.finalUrl.includes('sign-in') && !logoutRes.finalUrl.includes('login') && logoutRes.finalUrl !== 'https://elevenlabs.io/')) {
      throw new Error(`Logout gagal mengalihkan ke halaman sign-in (Final URL: ${logoutRes.finalUrl})`);
    }

    console.log('✅ TEST PLAYWRIGHT BERHASIL 100%!');
  } catch (err: any) {
    console.error('❌ Test Gagal:', err.message);
    process.exit(1);
  } finally {
    await session.context.close().catch(() => {});
  }
}

runLimitAndLogoutTest();
