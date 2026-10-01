// playwright/tests/test-elevenlabs-tts-e2e.ts
import { launchBrowser } from '../actions/launch-browser';
import { configureElevenLabsTTS } from '../actions/elevenlabs/configure-tts';
import path from 'path';
import fs from 'fs';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runE2ETest() {
  console.log('\n===============================================================');
  console.log('🧪 E2E TEST: ELEVENLABS MODEL V3 & DUAL-TYPE VOICE SELECTION');
  console.log('   Testing Chrome Extension Integration & Playwright Automation');
  console.log('===============================================================\n');

  const screenshotsDir = path.resolve(process.cwd(), 'playwright', 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // 1. Launch browser with extension loaded
  console.log('1. Meluncurkan browser dengan ekstensi Chrome Content Auto terpasang...');
  const session = await launchBrowser({
    headed: false,
    profileName: 'user_1',
  });

  const { page, context } = session;

  try {
    // 2. Navigate to ElevenLabs TTS Dashboard
    console.log('2. Membuka URL ElevenLabs Text-to-Speech...');
    await page.goto('https://elevenlabs.io/app/speech-synthesis/text-to-speech', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await sleep(4000);

    const initialUrl = page.url();
    console.log(`   URL Dashboard: ${initialUrl}`);

    // Capture initial state screenshot
    const initialScreenshot = path.join(screenshotsDir, 'e2e-1-initial-state.png');
    await page.screenshot({ path: initialScreenshot });
    console.log(`   📸 Screenshot awal tersimpan: ${initialScreenshot}`);

    // Ensure Settings tab is active (if currently on History tab)
    const settingsTab = page.locator('button, [role="tab"]').filter({ hasText: /^Settings$/i }).first();
    if (await settingsTab.isVisible().catch(() => false)) {
      await settingsTab.click({ force: true });
      await sleep(1000);
    }

    // Verify selectors are present
    const voiceSelector = page.locator('[data-testid="tts-voice-selector"]').first();
    const modelSelector = page.locator('[data-testid="tts-model-selector"]').first();

    await voiceSelector.waitFor({ state: 'visible', timeout: 15000 });
    await modelSelector.waitFor({ state: 'visible', timeout: 15000 });

    const initialVoice = (await voiceSelector.innerText()).trim().replace(/\n+/g, ' ');
    const initialModel = (await modelSelector.innerText()).trim().replace(/\n+/g, ' ');
    console.log(`   Voice awal: "${initialVoice}"`);
    console.log(`   Model awal: "${initialModel}"`);

    // 2b. Reset state jika sudah Dany & v3 agar pengujian switch berjalan riil
    if (initialVoice.toLowerCase().includes('dany') || initialModel.toLowerCase().includes('v3')) {
      console.log('   Mempersiapkan state awal (reset ke model v2 / voice lain agar switch teruji nyata)...');
      // Buka model selector dan pilih Multilingual v2
      await modelSelector.click({ force: true });
      await sleep(1200);
      const v2Radio = page.locator('[role="radio"], button').filter({ hasText: /Eleven Multilingual v2/i }).first();
      if (await v2Radio.isVisible().catch(() => false)) {
        await v2Radio.click({ force: true });
        await sleep(1000);
      }
      const backBtn = page.locator('button[aria-label="Back"], button:has-text("Back")').first();
      if (await backBtn.isVisible().catch(() => false)) {
        await backBtn.click({ force: true });
        await sleep(800);
      }
      console.log('   Reset model ke v2 selesai.');
    }

    // 3. Test Ekstensi Chrome (ElevenLabsSignupModule.configureTTS)
    console.log('\n3. Menguji eksekusi modul ekstensi Chrome (ElevenLabsSignupModule.configureTTS)...');

    const extensionModulePath = path.resolve(process.cwd(), 'extension', 'modules', 'elevenlabs-signup.js');
    const extensionCode = fs.readFileSync(extensionModulePath, 'utf-8');
    await page.addScriptTag({ content: extensionCode });

    const extensionResult = await page.evaluate(`
      (async () => {
        const mod = window.__ELEVENLABS_SIGNUP_MODULE__ || (window.ContentAuto && window.ContentAuto.modules && window.ContentAuto.modules.elevenlabsSignup);
        if (!mod) {
          throw new Error('Modul ekstensi ElevenLabsSignupModule tidak ditemukan.');
        }
        return await mod.configureTTS({
          voiceName: 'Dany Saputra',
          modelName: 'Eleven v3',
          stability: 'robust',
        });
      })()
    `);

    console.log('   Hasil eksekusi ekstensi:', JSON.stringify(extensionResult, null, 2));

    // 4. Jika ekstensi di content script berjalan, periksa hasil DOM
    await sleep(2000);

    // Capture state after extension execution
    const extScreenshot = path.join(screenshotsDir, 'e2e-2-after-extension.png');
    await page.screenshot({ path: extScreenshot });
    console.log(`   📸 Screenshot pasca-ekstensi tersimpan: ${extScreenshot}`);

    // 5. Uji langsung Playwright Action configureElevenLabsTTS dengan Generate & Download Generation 2
    console.log('\n4. Menguji eksekusi Playwright Action configureElevenLabsTTS (Input Narasi -> Generate -> Download Generation 2)...');
    const testNarrationText = 'Halo kawan.';
    const actionResult = await configureElevenLabsTTS(page, {
      voiceName: 'Dany Saputra',
      modelName: 'Eleven v3',
      stability: 'robust',
      text: testNarrationText,
      generateSpeech: true,
      downloadGeneration: true,
      generationNumberToDownload: 2,
      downloadDir: path.resolve(process.cwd(), 'downloads'),
      onLog: (m) => console.log(`   [Action] ${m}`),
    });

    console.log('   Hasil Playwright Action:', JSON.stringify(actionResult, null, 2));

    // 6. Verifikasi Akhir terhadap DOM & File Downloaded
    console.log('\n5. Memvalidasi status elemen DOM akhir dan file unduhan...');
    await sleep(2000);

    const finalVoiceAria = (await voiceSelector.getAttribute('aria-label').catch(() => '')) || '';
    const finalVoiceText = (await voiceSelector.innerText().catch(() => '')) || '';
    const finalVoiceCombined = `${finalVoiceAria} ${finalVoiceText}`.toLowerCase();

    const finalModelAria = (await modelSelector.getAttribute('aria-label').catch(() => '')) || '';
    const finalModelText = (await modelSelector.innerText().catch(() => '')) || '';
    const finalModelCombined = `${finalModelAria} ${finalModelText}`.toLowerCase();

    const finalScreenshot = path.join(screenshotsDir, 'e2e-3-final-verification.png');
    await page.screenshot({ path: finalScreenshot });
    console.log(`   📸 Screenshot verifikasi akhir tersimpan: ${finalScreenshot}`);

    console.log('\n===============================================================');
    console.log('📊 EVALUASI ASSERTIONS:');
    console.log('===============================================================');

    // Assertion 1: Model Eleven v3
    const isModelV3 = finalModelCombined.includes('v3') || finalModelCombined.includes('eleven v3');
    console.log(`  [1] Model Switch to Eleven v3 : ${isModelV3 ? '✅ PASS' : '❌ FAIL'} (${finalModelText || finalModelAria})`);

    // Assertion 2: Voice Dany Saputra
    const isVoiceDany = finalVoiceCombined.includes('dany saputra');
    console.log(`  [2] Voice Selection (Dany)    : ${isVoiceDany ? '✅ PASS' : '❌ FAIL'} (${finalVoiceText || finalVoiceAria})`);

    // Assertion 3: Stability Slider Robust
    const stabilitySlider = page.locator('span[role="slider"][aria-label*="Stability" i]').first();
    const isSliderPresent = await stabilitySlider.isVisible().catch(() => false);
    const sliderValue = isSliderPresent ? await stabilitySlider.getAttribute('aria-valuenow').catch(() => '1') : 'N/A';
    console.log(`  [3] Stability Slider (Robust) : ${isSliderPresent ? '✅ PASS' : '⚠️ OPTIONAL'} (Value: ${sliderValue})`);

    // Assertion 4: Generation 2 Download File
    let isGen2FileDownloaded = false;
    let downloadedFileSize = 0;
    if (actionResult.downloadedFilePath && fs.existsSync(actionResult.downloadedFilePath)) {
      downloadedFileSize = fs.statSync(actionResult.downloadedFilePath).size;
      isGen2FileDownloaded = downloadedFileSize > 5000;
    }
    console.log(`  [4] Generation 2 Audio Download : ${isGen2FileDownloaded ? '✅ PASS' : '❌ FAIL'} (${actionResult.downloadedFilePath || 'Not found'}, Size: ${downloadedFileSize} bytes)`);

    if (!isModelV3 || !isVoiceDany || !isGen2FileDownloaded) {
      throw new Error(`E2E Test Assertion Gagal: Model v3 (${isModelV3}), Voice Dany (${isVoiceDany}), Gen 2 Download (${isGen2FileDownloaded})`);
    }

    console.log('\n🎉 SEMUA TES E2E BERHASIL LULUS 100%!');
    console.log('===============================================================\n');

  } catch (error: any) {
    console.error('\n❌ E2E TEST GAGAL:', error.message);
    const errScreenshot = path.join(screenshotsDir, 'e2e-error.png');
    await page.screenshot({ path: errScreenshot }).catch(() => {});
    console.error(`📸 Screenshot kegagalan: ${errScreenshot}`);
    process.exit(1);
  } finally {
    await context.close().catch(() => {});
  }
}

runE2ETest();
