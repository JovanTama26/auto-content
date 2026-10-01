// playwright/tests/test-onboarding-steps.spec.ts
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test('Memvalidasi penanganan otomatis onboarding ElevenLabs multi-step', async ({ page }) => {
  const modulePath = path.resolve(process.cwd(), 'extension', 'modules', 'elevenlabs-signup.js');
  const moduleCode = fs.readFileSync(modulePath, 'utf-8');

  // --- TEST KASUS 1: Layar "Choose your platform" ---
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

  // Eksekusi handleChoosePlatformOnboarding
  await page.evaluate(() => {
    const mod = (window as any).__ELEVENLABS_SIGNUP_MODULE__ || ((window as any).ContentAuto && (window as any).ContentAuto.modules && (window as any).ContentAuto.modules.elevenlabsSignup);
    return mod.handleChoosePlatformOnboarding();
  });

  const creativeClicked = await page.evaluate(() => (window as any).__CREATIVE_CLICKED);
  const continueClicked = await page.evaluate(() => (window as any).__CONTINUE_CLICKED);

  console.log('Step 1 (Choose Platform) - Creative Clicked:', creativeClicked);
  console.log('Step 1 (Choose Platform) - Continue Clicked:', continueClicked);
  expect(creativeClicked).toBe(true);
  expect(continueClicked).toBe(true);

  // --- TEST KASUS 2: Layar "Help us personalize your experience" (Checkbox 18 Tahun) ---
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

  await page.evaluate(() => {
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

  console.log('Step 2 (Personalize Experience) - Checkbox Checked:', checkboxChecked);
  console.log('Step 2 (Personalize Experience) - Next Clicked:', nextClicked);
  expect(checkboxChecked).toBe(true);
  expect(nextClicked).toBe(true);
});
