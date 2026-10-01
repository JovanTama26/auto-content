// playwright/tests/test-onboarding-steps.ts
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runOnboardingValidation() {
  console.log('\n===============================================================');
  console.log('🧪 VALIDASI LENGKAP ONBOARDING ELEVENLABS MULTI-STEP (HEADLESS)');
  console.log('===============================================================\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const modulePath = path.resolve(process.cwd(), 'extension', 'modules', 'elevenlabs-signup.js');
  const moduleCode = fs.readFileSync(modulePath, 'utf-8');

  try {
    // -------------------------------------------------------------
    // TEST KASUS 1: Layar "Choose your platform" (Step 1)
    // -------------------------------------------------------------
    console.log('1. Menguji Layar "Choose your platform" (ElevenCreative & Continue)...');
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>ElevenLabs Onboarding</title></head>
        <body>
          <h1>Choose your platform</h1>
          <p>Switch between platforms at any time</p>
          <div id="creative-card" style="border: 1px solid gray; padding: 20px; width: 200px; height: 120px; cursor: pointer;">
            <div>ElevenCreative</div>
            <div>Create, edit, and localize content with AI</div>
            <div>Text to Speech</div>
          </div>
          <div id="agents-card" style="border: 1px solid gray; padding: 20px; width: 200px; height: 120px;">
            <div>ElevenAgents</div>
            <div>Deploy and monitor conversational agents</div>
          </div>
          <button id="continue-btn" disabled style="margin-top: 20px;">Continue</button>
          <script>
            const creative = document.getElementById('creative-card');
            const btn = document.getElementById('continue-btn');
            creative.addEventListener('click', () => {
              creative.style.borderColor = 'black';
              btn.removeAttribute('disabled');
              window.__CREATIVE_CLICKED = true;
            });
            btn.addEventListener('click', () => {
              window.__CONTINUE_CLICKED = true;
            });
          </script>
        </body>
      </html>
    `);

    await page.addScriptTag({ content: moduleCode });

    const step1Handled = await page.evaluate(() => {
      const mod = (window as any).__ELEVENLABS_SIGNUP_MODULE__ || ((window as any).ContentAuto && (window as any).ContentAuto.modules && (window as any).ContentAuto.modules.elevenlabsSignup);
      return mod.handleChoosePlatformOnboarding();
    });

    const creativeClicked = await page.evaluate(() => (window as any).__CREATIVE_CLICKED);
    const continueClicked = await page.evaluate(() => (window as any).__CONTINUE_CLICKED);

    console.log(`   - Creative Card Clicked: ${creativeClicked ? '✅ YA' : '❌ TIDAK'}`);
    console.log(`   - Continue Button Clicked: ${continueClicked ? '✅ YA' : '❌ TIDAK'}`);

    if (!creativeClicked || !continueClicked) {
      throw new Error('Gagal validasi Step 1 Choose Platform!');
    }

    // -------------------------------------------------------------
    // TEST KASUS 2: Layar "Help us personalize your experience" (Step 2 - Checkbox 18 Tahun)
    // -------------------------------------------------------------
    console.log('\n2. Menguji Layar "Help us personalize your experience" (Checkbox 18yo & Next)...');
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>ElevenLabs Onboarding</title></head>
        <body>
          <h1>Help us personalize your experience</h1>
          <div>
            <label>What's your name? (optional)</label>
            <input type="text" value="Elizabeth" />
          </div>
          <div>
            <label>What's your preferred language?</label>
            <select><option>English</option></select>
          </div>
          <div style="margin-top: 15px;">
            <label id="checkbox-label" style="display: flex; align-items: center; cursor: pointer;">
              <input id="age-checkbox" type="checkbox" style="margin-right: 8px;" />
              <span>By checking this box, you confirm you have reached the age of 18 years old (or the age of legal majority where you live).</span>
            </label>
          </div>
          <button id="next-btn" disabled style="margin-top: 20px;">Next</button>
          <script>
            const cb = document.getElementById('age-checkbox');
            const nextBtn = document.getElementById('next-btn');
            cb.addEventListener('change', () => {
              if (cb.checked) {
                nextBtn.removeAttribute('disabled');
              } else {
                nextBtn.setAttribute('disabled', 'true');
              }
            });
            nextBtn.addEventListener('click', () => {
              window.__NEXT_CLICKED = true;
            });
          </script>
        </body>
      </html>
    `);

    await page.addScriptTag({ content: moduleCode });

    const step2Handled = await page.evaluate(() => {
      const mod = (window as any).__ELEVENLABS_SIGNUP_MODULE__ || ((window as any).ContentAuto && (window as any).ContentAuto.modules && (window as any).ContentAuto.modules.elevenlabsSignup);
      if (typeof mod.handlePersonalizeExperienceOnboarding === 'function') {
        return mod.handlePersonalizeExperienceOnboarding();
      }
      mod.clickAllUncheckedCheckboxes();
      const btn = mod.findNextOrContinueButton();
      if (btn) btn.click();
      return true;
    });

    const checkboxChecked = await page.evaluate(() => (document.getElementById('age-checkbox') as HTMLInputElement).checked);
    const nextClicked = await page.evaluate(() => (window as any).__NEXT_CLICKED);

    console.log(`   - 18yo Checkbox Checked: ${checkboxChecked ? '✅ YA' : '❌ TIDAK'}`);
    console.log(`   - Next Button Clicked: ${nextClicked ? '✅ YA' : '❌ TIDAK'}`);

    if (!checkboxChecked || !nextClicked) {
      throw new Error('Gagal validasi Step 2 Personalize Experience!');
    }

    // -------------------------------------------------------------
    // TEST KASUS 3: Layar Survey Kuesioner (Skip Button / Radio Options)
    // -------------------------------------------------------------
    console.log('\n3. Menguji Layar Survey (Skip / Radio Option)...');
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>ElevenLabs Onboarding</title></head>
        <body>
          <h1>What will you use ElevenLabs for?</h1>
          <button id="skip-btn" style="float: right;">Skip</button>
          <div style="margin-top: 40px;">
            <button role="radio" data-state="unchecked">Social Media Videos</button>
            <button role="radio" data-state="unchecked">Voiceovers</button>
          </div>
          <button id="continue-btn" disabled>Continue</button>
          <script>
            document.getElementById('skip-btn').addEventListener('click', () => {
              window.__SKIP_CLICKED = true;
            });
          </script>
        </body>
      </html>
    `);

    await page.addScriptTag({ content: moduleCode });

    await page.evaluate(() => {
      const mod = (window as any).__ELEVENLABS_SIGNUP_MODULE__ || ((window as any).ContentAuto && (window as any).ContentAuto.modules && (window as any).ContentAuto.modules.elevenlabsSignup);
      const skipBtn = mod.findSkipButton();
      if (skipBtn) {
        skipBtn.click();
      }
    });

    const skipClicked = await page.evaluate(() => (window as any).__SKIP_CLICKED);
    console.log(`   - Skip Button Clicked: ${skipClicked ? '✅ YA' : '❌ TIDAK'}`);

    if (!skipClicked) {
      throw new Error('Gagal validasi Step 3 Skip Button!');
    }

    console.log('\n🎉 SEMUA PENGUJIAN PLAYWRIGHT ONBOARDING ELEVENLABS 100% SUKSES!');
  } finally {
    await browser.close();
  }
}

runOnboardingValidation().catch((err) => {
  console.error('\n❌ ERROR TEST:', err.message);
  process.exit(1);
});
