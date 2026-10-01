// playwright/actions/elevenlabs/onboarding.ts
import { Page, BrowserContext } from 'playwright';

export interface OnboardingOptions {
  verifyUrl: string;
  email?: string;
  password?: string;
  maxWaitSeconds?: number;
  onLog?: (msg: string) => void;
}

export interface OnboardingResult {
  success: boolean;
  dashboardUrl: string;
  message: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getWorkingPage(context: BrowserContext, fallbackPage: Page): Page {
  if (!fallbackPage.isClosed()) return fallbackPage;
  const alivePages = context.pages().filter((p) => !p.isClosed());
  if (alivePages.length > 0) return alivePages[alivePages.length - 1];
  return fallbackPage;
}

/**
 * Handles verification URL, post-verification login if needed, skips onboarding,
 * and navigates to the Text to Speech dashboard.
 */
export async function executeElevenLabsOnboarding(
  page: Page,
  options: OnboardingOptions
): Promise<OnboardingResult> {
  const { verifyUrl, email } = options;
  const password = options.password || 'Jovan@1224';
  const maxWaitSeconds = options.maxWaitSeconds ?? 90;
  const log = options.onLog || ((msg: string) => console.log(`[ElevenLabs Onboarding] ${msg}`));
  const context = page.context();

  log(`Membuka URL verifikasi ElevenLabs: ${verifyUrl}...`);
  let curPage = getWorkingPage(context, page);
  await curPage.goto(verifyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3500);

  const startTime = Date.now();
  const maxWaitMs = maxWaitSeconds * 1000;

  while (Date.now() - startTime < maxWaitMs) {
    curPage = getWorkingPage(context, curPage);
    if (curPage.isClosed()) {
      log('Halaman tertutup, mencoba mengambil halaman aktif di context...');
      const openPages = context.pages().filter((p) => !p.isClosed());
      if (openPages.length > 0) {
        curPage = openPages[openPages.length - 1];
      } else {
        curPage = await context.newPage();
      }
    }

    const currentUrl = curPage.url();
    const currentPath = new URL(currentUrl).pathname;

    log(`[Monitoring] URL: ${currentUrl}`);

    // 1. Cek apakah sudah berada di dashboard Speech Synthesis
    if (currentPath.includes('/speech-synthesis') || currentPath.includes('/text-to-speech')) {
      const hasEditor = await curPage.$('[data-testid="tts-editor"], [data-testid="tts-generate"], [contenteditable="true"], textarea');
      if (hasEditor) {
        log(`🎉 Berhasil mencapai Dashboard Text-to-Speech ElevenLabs!`);
        await curPage.keyboard.press('Escape').catch(() => {});
        return {
          success: true,
          dashboardUrl: currentUrl,
          message: 'Berhasil verifikasi akun dan masuk ke Dashboard Text-to-Speech.',
        };
      }
    }

    // 2. Jika sudah terautentikasi di /app (misal /app/home, /app/overview) tapi belum di speech-synthesis
    const isAppLoggedIn =
      currentPath.startsWith('/app') &&
      !currentPath.includes('sign-in') &&
      !currentPath.includes('sign-up') &&
      !currentPath.includes('onboarding') &&
      !currentPath.includes('action');

    if (isAppLoggedIn && !currentPath.includes('/speech-synthesis')) {
      log(`🎯 Sesi akun aktif! Mengarahkan langsung ke https://elevenlabs.io/app/speech-synthesis/text-to-speech...`);
      await curPage.goto('https://elevenlabs.io/app/speech-synthesis/text-to-speech', { waitUntil: 'domcontentloaded' });
      await sleep(3000);
      continue;
    }

    // 3. Handle modal "Almost there! Please sign in once more..." atau modal verifikasi
    const pageText = (await curPage.evaluate(() => document.body.innerText || '').catch(() => '')).toLowerCase();
    if (pageText.includes('almost there') || pageText.includes('please sign in once more')) {
      log(`Modal 'Almost there' terdeteksi, mencoba klik Continue...`);
      const continueBtn = await curPage.$(
        'button:has-text("Continue"), button:has-text("Sign in"), button:has-text("Log in")'
      );
      if (continueBtn) {
        await continueBtn.click({ force: true }).catch(() => {});
        await sleep(1500);
      }
    }

    // 4. Handle layar Sign In ("Welcome back") jika diminta memasukkan password
    const passwordInput = await curPage.$('input[type="password"]');
    if (passwordInput && (currentPath.includes('sign-in') || pageText.includes('welcome back'))) {
      log(`Form Sign In terdeteksi, mengisi kredensial...`);
      const emailInput = await curPage.$('input[type="email"], input[name="email"]');
      if (emailInput && email) {
        const emailVal = await emailInput.inputValue().catch(() => '');
        if (!emailVal || emailVal !== email) {
          await emailInput.fill(email).catch(() => {});
        }
      }

      await passwordInput.fill(password).catch(() => {});
      await sleep(300);

      const buttons = await curPage.$$('button');
      let signInSubmit = null;
      for (const btn of buttons) {
        const txt = (await btn.innerText().catch(() => '')).trim().toLowerCase();
        if ((txt === 'sign in' || txt === 'log in') && !txt.includes('google') && !txt.includes('apple')) {
          signInSubmit = btn;
          break;
        }
      }

      if (signInSubmit) {
        log(`Mengklik tombol Sign In...`);
        await signInSubmit.click({ force: true }).catch(() => {});
        await sleep(3500);
        continue;
      }
    }

    // 5. Centang checkbox ketentuan jika ada di onboarding
    const uncheckedBoxes = await curPage.$$(
      'input[type="checkbox"]:not(:checked), [role="checkbox"][aria-checked="false"], [role="checkbox"][data-state="unchecked"]'
    );
    if (uncheckedBoxes.length > 0) {
      log(`Mencentang ${uncheckedBoxes.length} checkbox pada tahap onboarding...`);
      for (const box of uncheckedBoxes) {
        await box.click().catch(() => {});
        await sleep(200);
      }
    }

    // 6. Cari tombol Skip
    const skipBtn = await curPage.$(
      'button:has-text("Skip"), button:has-text("Skip for now"), button:has-text("Skip intro"), button:has-text("Skip onboarding"), a:has-text("Skip")'
    );
    if (skipBtn) {
      log(`Tombol Skip ditemukan, mengklik Skip...`);
      await skipBtn.click({ force: true }).catch(() => {});
      await sleep(1500);
      continue;
    }

    // 7. Cari tombol Continue / Next / Get Started
    const nextBtn = await curPage.$(
      'button:has-text("Continue"), button:has-text("Next"), button:has-text("Get started"), button:has-text("Done"), button:has-text("Finish"), button:has-text("Agree and continue")'
    );
    if (nextBtn) {
      const isDisabled = await nextBtn.isDisabled().catch(() => false);
      if (!isDisabled) {
        log(`Tombol Continue / Next ditemukan, mengklik...`);
        await nextBtn.click({ force: true }).catch(() => {});
        await sleep(1500);
        continue;
      } else {
        log(`Tombol Continue disabled, memilih opsi survei pertama...`);
        const optionEl = await curPage.$(
          'input[type="radio"], [role="radio"], [data-state="unchecked"], [role="option"]'
        );
        if (optionEl) {
          await optionEl.click().catch(() => {});
          await sleep(500);
          await nextBtn.click({ force: true }).catch(() => {});
          await sleep(1500);
          continue;
        }
      }
    }

    // 8. Tutup popup modal dismiss / close jika ada
    const closeBtn = await curPage.$(
      'button[aria-label*="Close" i], button[aria-label*="Dismiss" i], button.close'
    );
    if (closeBtn) {
      log(`Menutup modal popup...`);
      await closeBtn.click({ force: true }).catch(() => {});
      await sleep(1000);
      continue;
    }

    await sleep(2000);
  }

  // Fallback terakhir: navigasi langsung ke speech synthesis
  curPage = getWorkingPage(context, curPage);
  log(`Mencoba navigasi langsung ke https://elevenlabs.io/app/speech-synthesis/text-to-speech...`);
  await curPage.goto('https://elevenlabs.io/app/speech-synthesis/text-to-speech', { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  const hasEditorFinal = await curPage.$('[data-testid="tts-editor"], [data-testid="tts-generate"], [contenteditable="true"], textarea');
  if (hasEditorFinal) {
    return {
      success: true,
      dashboardUrl: curPage.url(),
      message: 'Berhasil verifikasi akun dan masuk ke Dashboard Text-to-Speech.',
    };
  }

  throw new Error(`Gagal menyelesaikan onboarding setelah ${maxWaitSeconds} detik.`);
}
