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
 * Tutup popup tidak diinginkan (seperti Apple Login popup jika sempat muncul)
 */
async function closeUnwantedPopups(context: BrowserContext, mainPage: Page) {
  try {
    for (const p of context.pages()) {
      if (p !== mainPage && !p.isClosed()) {
        const url = p.url().toLowerCase();
        if (url.includes('appleid.apple.com') || url.includes('accounts.google.com')) {
          await p.close().catch(() => {});
        }
      }
    }
  } catch {}
}

/**
 * Tutup modal "Email Verification / Almost there!" (contek persis dari dismissEmailVerificationModal di ekstensi)
 */
async function dismissEmailVerificationModal(page: Page, log: (m: string) => void): Promise<boolean> {
  try {
    const dismissed = await page.evaluate(() => {
      const bodyText = (document.body?.innerText || '').toLowerCase();
      const isAlmostThere =
        bodyText.includes('almost there') ||
        bodyText.includes('please sign in once more') ||
        bodyText.includes('email verification');

      const dialog = document.querySelector('[role="dialog"], [aria-modal="true"]');
      if (!isAlmostThere && !dialog) return false;

      const root = dialog || document;

      // 1. Klik tombol Continue di dalam dialog
      const buttons = Array.from(root.querySelectorAll('button, [role="button"]'));
      const continueBtn = buttons.find((b) => {
        const style = window.getComputedStyle(b);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const txt = (b.textContent || '').trim().toLowerCase();
        return txt === 'continue' || txt.startsWith('continue');
      });

      if (continueBtn) {
        (continueBtn as HTMLElement).click();
      }

      // 2. Klik tombol Close (✕) di dalam dialog jika masih ada
      const closeBtn = root.querySelector('button[aria-label*="close" i], button.close, button:has(svg)');
      if (closeBtn) {
        (closeBtn as HTMLElement).click();
      }

      // 3. Tekan tombol Escape
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
      );

      return true;
    });

    if (dismissed) {
      log(`Modal 'Email Verification (Almost there)' ditutup.`);
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(600);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Handle proses Sign In pada halaman /app/sign-in setelah verifikasi email
 * Contek persis dari handleSignInIfPresent & executeSignIn di ekstensi + aksi submit tangguh Playwright
 */
async function handleSignInIfPresent(
  page: Page,
  email: string | undefined,
  pass: string,
  log: (m: string) => void
): Promise<boolean> {
  try {
    const currentPath = new URL(page.url()).pathname;
    const isSignInPage = currentPath.includes('/sign-in') || currentPath.includes('/login');

    const hasForm = await page.evaluate(() => {
      const bodyText = (document.body?.innerText || '').toLowerCase();
      const hasWelcome = bodyText.includes('welcome back') || bodyText.includes('sign in to your account');
      const passInput = document.querySelector('input[type="password"]');
      return hasWelcome || Boolean(passInput);
    }).catch(() => false);

    if (!isSignInPage && !hasForm) {
      return false;
    }

    log(`Form Sign In post-verifikasi terdeteksi. Menutup modal & menyiapkan kredensial...`);
    await dismissEmailVerificationModal(page, log);

    // 1. Isi email target jika ada
    const emailField = page.locator('input[type="email"], input[name="email"], input[autocomplete="email"], input[autocomplete="username"]').first();
    if (email && (await emailField.isVisible().catch(() => false))) {
      const curVal = await emailField.inputValue().catch(() => '');
      if (curVal !== email) {
        log(`Mengisi email: ${email}...`);
        await emailField.fill(email);
        await sleep(200);
      }
    }

    // 2. Isi password target
    const passwordField = page.locator('input[type="password"], input[name="password"]').first();
    if (await passwordField.isVisible().catch(() => false)) {
      log(`Mengisi password Sign In...`);
      await passwordField.fill(pass);
      await sleep(300);
    }

    // 3. Multi-layer Submit Sign In:
    // Sesuai ekstensi: persis tombol 'Sign in' / submit spesifik dan bukan Google/Apple/SSO
    let clicked = false;

    // Strategi A: Playwright Native Locator
    const submitLocator = page.locator(
      'button[type="submit"], button:has-text("Sign in"):not(:has-text("Google")):not(:has-text("Apple")):not(:has-text("SSO")), button:has-text("Log in"):not(:has-text("Google")):not(:has-text("Apple")):not(:has-text("SSO"))'
    ).first();

    if (await submitLocator.isVisible().catch(() => false)) {
      try {
        await submitLocator.click({ timeout: 3000 });
        clicked = true;
      } catch {}
    }

    // Strategi B: Press Enter pada password field (standar web form submit paling andal)
    if (!clicked && (await passwordField.isVisible().catch(() => false))) {
      try {
        await passwordField.press('Enter');
        clicked = true;
      } catch {}
    }

    // Strategi C: In-page DOM fallback (persis ekstensi triggerNativeClick)
    if (!clicked) {
      clicked = await page.evaluate(() => {
        function isVisible(el: Element | null): boolean {
          if (!el) return false;
          const s = window.getComputedStyle(el);
          return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && (el as HTMLElement).offsetWidth > 0;
        }

        const buttons = Array.from(document.querySelectorAll('button'));
        const submitBtn = buttons.find((btn) => {
          if (!isVisible(btn)) return false;
          const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
          return (
            (txt === 'sign in' || txt === 'sign-in' || txt === 'log in' || txt === 'login' || txt.includes('sign in')) &&
            !txt.includes('google') &&
            !txt.includes('apple') &&
            !txt.includes('sso')
          );
        }) || document.querySelector('button[type="submit"]');

        if (submitBtn) {
          (submitBtn as HTMLButtonElement).disabled = false;
          (submitBtn as HTMLElement).focus();
          const opts = { bubbles: true, cancelable: true, view: window };
          submitBtn.dispatchEvent(new PointerEvent('pointerdown', opts));
          submitBtn.dispatchEvent(new MouseEvent('mousedown', opts));
          submitBtn.dispatchEvent(new PointerEvent('pointerup', opts));
          submitBtn.dispatchEvent(new MouseEvent('mouseup', opts));
          (submitBtn as HTMLElement).click();
          return true;
        }
        return false;
      }).catch(() => false);
    }

    if (clicked) {
      log(`Tombol Sign In berhasil diklik. Menunggu pengalihan sesi login...`);
      await sleep(3500);
      return true;
    }

    // Jika belum berhasil klik, tetap beri jeda agar tidak spamming loop
    await sleep(2000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Handle Step 1 Onboarding: Platform Selection ("Choose your platform" -> ElevenCreative)
 */
async function handleChoosePlatform(page: Page, log: (m: string) => void): Promise<boolean> {
  try {
    const handled = await page.evaluate(() => {
      const bodyText = (document.body?.innerText || '').toLowerCase();
      if (!bodyText.includes('choose your platform') && !bodyText.includes('elevencreative')) {
        return false;
      }

      const allDivs = Array.from(document.querySelectorAll('div, button, [role="button"]'));
      const creativeCard = allDivs.find((el) => {
        const txt = (el.textContent || '').toLowerCase();
        return txt.includes('elevencreative') && (txt.includes('create, edit') || txt.includes('text to speech') || txt.includes('content'));
      });

      if (creativeCard) {
        (creativeCard as HTMLElement).click();
      }

      const buttons = Array.from(document.querySelectorAll('button'));
      const continueBtn = buttons.find((b) => {
        const txt = (b.textContent || '').trim().toLowerCase();
        return txt === 'continue' || txt.startsWith('continue');
      });

      if (continueBtn) {
        continueBtn.disabled = false;
        continueBtn.click();
        return true;
      }
      return !!creativeCard;
    });

    if (handled) {
      log(`[Onboarding Step 1] Platform ElevenCreative dipilih & Continue diklik.`);
      await sleep(2000);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Handle Step 2 Onboarding: Personalize Experience (Checkbox 18+ & Next)
 */
async function handlePersonalizeExperience(page: Page, log: (m: string) => void): Promise<boolean> {
  try {
    const handled = await page.evaluate(() => {
      const bodyText = (document.body?.innerText || '').toLowerCase();
      if (
        !bodyText.includes('personalize your experience') &&
        !bodyText.includes('reached the age of 18') &&
        !bodyText.includes('18 years old')
      ) {
        return false;
      }

      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"], [role="checkbox"], button[role="checkbox"]'));
      for (const cb of checkboxes) {
        const ariaChecked = cb.getAttribute('aria-checked');
        const checked = (cb as HTMLInputElement).checked;
        if (ariaChecked !== 'true' && !checked) {
          (cb as HTMLElement).click();
          const parent = cb.closest('label');
          if (parent) parent.click();
        }
      }

      const buttons = Array.from(document.querySelectorAll('button'));
      const nextBtn = buttons.find((b) => {
        const txt = (b.textContent || '').trim().toLowerCase();
        return txt === 'next' || txt.startsWith('next');
      });

      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.click();
        return true;
      }
      return false;
    });

    if (handled) {
      log(`[Onboarding Step 2] Konfirmasi umur 18+ dicentang & Next diklik.`);
      await sleep(2000);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Handle Onboarding Steps: Tombol "Skip" (Persona, Interests, Pricing)
 */
async function handleSkipButtons(page: Page, log: (m: string) => void): Promise<boolean> {
  try {
    const clicked = await page.evaluate(() => {
      const allClickables = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      const skipBtn = allClickables.find((el) => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const txt = (el.textContent || '').trim().toLowerCase();
        return (txt === 'skip' || txt.startsWith('skip')) && !txt.includes('content');
      });

      if (skipBtn) {
        (skipBtn as HTMLElement).click();
        return true;
      }
      return false;
    });

    if (clicked) {
      log(`[Onboarding] Tombol Skip diklik.`);
      await sleep(2000);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Handles verification URL, post-verification login, skips onboarding,
 * and navigates to the Text to Speech dashboard.
 * 100% contek dan diselaraskan dari extension/modules/elevenlabs-signup.js
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
  await sleep(3000);

  const startTime = Date.now();
  const maxWaitMs = maxWaitSeconds * 1000;
  let lastSignInTime = 0;

  while (Date.now() - startTime < maxWaitMs) {
    // 0. Tutup popup yang tidak sengaja terbuka (Apple/Google)
    await closeUnwantedPopups(context, curPage);

    curPage = getWorkingPage(context, curPage);
    if (curPage.isClosed()) {
      const openPages = context.pages().filter((p) => !p.isClosed());
      if (openPages.length > 0) {
        curPage = openPages[openPages.length - 1];
      } else {
        throw new Error('Semua tab browser ditutup sebelum onboarding selesai.');
      }
    }

    const currentUrl = curPage.url();
    const currentPath = new URL(currentUrl).pathname;

    // 1. Cek apakah sudah sampai di Dashboard Text-to-Speech
    if (currentPath.includes('/speech-synthesis') || currentPath.includes('/text-to-speech')) {
      log(`🎉 Berhasil mencapai Dashboard Text-to-Speech ElevenLabs!`);
      return {
        success: true,
        dashboardUrl: currentUrl,
        message: 'Berhasil verifikasi akun dan masuk ke Dashboard Text-to-Speech.',
      };
    }

    // 1b. Jika sudah terautentikasi di dalam /app (misal /app/home, /app/overview) tapi belum di speech-synthesis
    const isAppPath = currentPath.startsWith('/app') &&
      !currentPath.includes('sign-in') &&
      !currentPath.includes('sign-up') &&
      !currentPath.includes('onboarding') &&
      !currentPath.includes('action');

    if (isAppPath && !currentPath.includes('/speech-synthesis')) {
      log(`🎯 Terautentikasi! Mengarahkan langsung ke Dashboard Text-to-Speech...`);
      await curPage.goto('https://elevenlabs.io/app/speech-synthesis/text-to-speech', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await sleep(2500);
      continue;
    }

    // 2. TAHAP SIGN IN: Jika berada di /app/sign-in atau Welcome back
    // (Flow ekstensi: setelah verifikasi email, ElevenLabs meminta sign in konfirmasi)
    const now = Date.now();
    if (now - lastSignInTime > 3500) {
      const didSignIn = await handleSignInIfPresent(curPage, email, password, log);
      if (didSignIn) {
        lastSignInTime = Date.now();
        continue;
      }
    }

    // 3. TAHAP ONBOARDING Step 1: Platform Selection ("Choose your platform" -> ElevenCreative)
    const didChoosePlatform = await handleChoosePlatform(curPage, log);
    if (didChoosePlatform) continue;

    // 4. TAHAP ONBOARDING Step 2: Personalize Experience (18+ Checkbox & Next)
    const didPersonalize = await handlePersonalizeExperience(curPage, log);
    if (didPersonalize) continue;

    // 5. TAHAP ONBOARDING Step 3+: Tombol Skip (Persona, Interests, Pricing)
    const didSkip = await handleSkipButtons(curPage, log);
    if (didSkip) continue;

    // 5b. Jika sudah >25 detik tertahan di rute /onboarding, bypass langsung ke speech-synthesis (persis seperti di ekstensi)
    const elapsedSec = (Date.now() - startTime) / 1000;
    if (elapsedSec > 25 && curPage.url().includes('/onboarding')) {
      log(`⏳ Tertahan di /onboarding >25s, mencoba bypass langsung ke speech-synthesis...`);
      await curPage.goto('https://elevenlabs.io/app/speech-synthesis/text-to-speech', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await sleep(2500);
      continue;
    }

    await sleep(1500);
  }

  // Fallback terakhir jika timeout: navigasi langsung ke speech-synthesis
  curPage = getWorkingPage(context, curPage);
  await curPage.goto('https://elevenlabs.io/app/speech-synthesis/text-to-speech', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(3000);

  if (curPage.url().includes('speech-synthesis') || curPage.url().includes('text-to-speech') || curPage.url().includes('/app')) {
    return {
      success: true,
      dashboardUrl: curPage.url(),
      message: 'Berhasil verifikasi akun dan masuk ke Dashboard Text-to-Speech.',
    };
  }

  throw new Error(`Gagal menyelesaikan onboarding setelah ${maxWaitSeconds} detik.`);
}
