import { BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { executeElevenLabsOnboarding } from './onboarding';
import { fetchVerificationLinkFromGmail } from '../gmail/fetch-verification';
import { saveElevenLabsSession } from './session';

export interface AutoSignupConfig {
  domain?: string;
  password?: string;
  webmailUrl?: string;
  inboxPollIntervalMs?: number;
  inboxTimeoutSec?: number;
  maxResends?: number;
  maxStepRetries?: number;
  headed?: boolean;
}

export interface AutoSignupResult {
  email: string;
  status: 'SUCCESS' | 'FAILED_CAPTCHA' | 'FAILED_EMAIL_TIMEOUT' | 'FAILED_FORM_ERROR' | 'FAILED_ALREADY_EXISTS' | 'FAILED_UNKNOWN';
  timestamp: string;
  dashboardUrl?: string;
  error?: string;
  screenshotPath?: string;
}

/**
 * Generate string acak 10-12 karakter (huruf kecil + angka)
 * Pola: <random_10_12>@riztama.my.id
 */
export function generateSignupEmail(domain = 'riztama.my.id'): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const length = Math.floor(Math.random() * 3) + 10; // 10, 11, atau 12 karakter
  let rand = '';
  for (let i = 0; i < length; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${rand}@${domain}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Eksekusi dengan retry dan backoff eksponensial per langkah
 */
async function retryStep<T>(
  fn: () => Promise<T>,
  stepName: string,
  maxRetries = 3,
  delayMs = 1500
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      console.warn(`[Retry ${attempt}/${maxRetries}] Gagal pada langkah "${stepName}": ${err?.message || err}`);
      if (attempt < maxRetries) {
        await sleep(delayMs * attempt);
      }
    }
  }
  throw lastError;
}

/**
 * Tangkap screenshot saat terjadi error
 */
async function captureFailureScreenshot(page: Page, stepName: string): Promise<string> {
  const reportsDir = path.resolve(process.cwd(), 'playwright', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const filename = `failure_${Date.now()}_${stepName.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
  const filePath = path.join(reportsDir, filename);
  try {
    await page.screenshot({ path: filePath, fullPage: true });
    console.log(`📸 Screenshot kegagalan disimpan di: ${filePath}`);
    return filePath;
  } catch {
    return '';
  }
}

/**
 * Deteksi elemen khas dashboard ElevenLabs
 */
async function isDashboardLoaded(page: Page): Promise<boolean> {
  const currentUrl = page.url();
  const dashboardRoutes = ['/app/speech-synthesis', '/app/text-to-speech', '/app/home', '/app/voices', '/app'];

  const isMatchingUrl = dashboardRoutes.some((route) => currentUrl.includes(route)) &&
    !currentUrl.includes('/sign-in') &&
    !currentUrl.includes('/sign-up') &&
    !currentUrl.includes('verify') &&
    !currentUrl.includes('action');

  if (!isMatchingUrl) return false;

  // Cek keberadaan elemen khas dashboard (editor teks, navigasi speech-synthesis, atau avatar akun)
  try {
    const hasDashboardElement = await page.evaluate(() => {
      const hasTextarea = Boolean(document.querySelector('textarea, [contenteditable="true"]'));
      const hasNav = Boolean(document.querySelector('nav, aside, [role="navigation"]'));
      const hasVoiceSelector = Boolean(document.querySelector('[data-testid*="voice"], button[aria-haspopup="listbox"]'));
      return hasTextarea || hasNav || hasVoiceSelector;
    });
    return hasDashboardElement;
  } catch {
    return false;
  }
}

/**
 * Modul Auto-Signup ElevenLabs Utama
 */
export async function executeElevenLabsAutoSignup(
  context: BrowserContext,
  tab1: Page,
  config: AutoSignupConfig = {}
): Promise<AutoSignupResult> {
  const email = generateSignupEmail(config.domain || 'riztama.my.id');
  const password = config.password || process.env.SIGNUP_PASSWORD || 'Jovan@1224';
  const inboxTimeoutSec = config.inboxTimeoutSec || 120;
  const maxRetries = config.maxStepRetries ?? 3;

  console.log('====================================================');
  console.log('🚀 ELEVENLABS AUTO-SIGNUP (ROBUST RESILIENT ENGINE)');
  console.log('====================================================');
  console.log(`📧 Target Email : ${email}`);
  console.log(`🔑 Password     : [PROTECTED CONFIG]`);
  console.log(`⏱️ Inbox Timeout: ${inboxTimeoutSec}s (Refresh tiap 3 detik)`);
  console.log('====================================================\n');

  try {
    // ----------------------------------------------------
    // LANGKAH 1: Buka Halaman Sign-up ElevenLabs di Tab 1
    // ----------------------------------------------------
    console.log('[Step 1] Membuka halaman sign-up ElevenLabs...');
    await retryStep(async () => {
      await tab1.goto('https://elevenlabs.io/app/sign-up', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await tab1.waitForSelector('[data-testid="sign-up-email-input"], input[type="email"], input[name="email"]', { timeout: 20000 });
    }, 'Buka halaman sign-up', maxRetries);

    // ----------------------------------------------------
    // LANGKAH 2: Isi Form Signup (Email & Password)
    // ----------------------------------------------------
    console.log('[Step 2] Mengisi form pendaftaran via locator...');
    await retryStep(async () => {
      const emailField = tab1.locator('[data-testid="sign-up-email-input"], input[type="email"], input[name="email"]').first();
      const passwordField = tab1.locator('[data-testid="sign-up-password-input"], input[type="password"], input[name="password"]').first();

      await emailField.fill(email);
      await passwordField.fill(password);

      // Centang checkbox Terms/Policy jika ada
      const checkboxes = tab1.locator('input[type="checkbox"]:not(:checked), [role="checkbox"][aria-checked="false"]');
      const count = await checkboxes.count();
      for (let i = 0; i < count; i++) {
        await checkboxes.nth(i).click({ timeout: 2000 }).catch(() => {});
      }
    }, 'Isi form signup', maxRetries);

    // ----------------------------------------------------
    // LANGKAH 3: Submit Form Sign-up & Pantau Tab 1
    // REVISI 1 & 2:
    // - JANGAN langsung buka Gmail!
    // - Tunggu hCaptcha diselesaikan & layar konfirmasi muncul
    // ----------------------------------------------------
    console.log('[Step 3] Submit form sign-up & memantau respons server di Tab 1...');
    const submitBtn = tab1.locator('[data-testid="signup-signup-button-div"] button, button:has-text("Sign up"):not(:has-text("Google")):not(:has-text("Apple"))').first();
    await submitBtn.waitFor({ state: 'visible', timeout: 10000 });

    // Tunggu button ready (tidak disabled)
    await tab1.waitForFunction(() => {
      const btn = document.querySelector('[data-testid="signup-signup-button-div"] button, button[type="submit"]') as HTMLButtonElement | null;
      return btn && !btn.disabled;
    }, { timeout: 10000 }).catch(() => {});

    await submitBtn.click();

    // Masuki loop pemantau Tab 1 (maksimal 180 detik)
    const monitorStart = Date.now();
    const maxSignupWaitMs = 180000;
    let signupConfirmed = false;
    let lastCaptchaAlertTime = 0;

    console.log('⏳ Memantau respons halaman ElevenLabs (menunggu konfirmasi email terkirim)...');

    while (Date.now() - monitorStart < maxSignupWaitMs) {
      if (tab1.isClosed()) {
        return {
          email,
          status: 'FAILED_UNKNOWN',
          timestamp: new Date().toISOString(),
          error: 'Jendela browser ditutup selama proses sign-up.',
        };
      }

      // 1. Cek pesan error formulir
      const formError = await tab1.evaluate(() => {
        const alert = document.querySelector('[role="alert"], .tw-text-red-500, .text-danger, .error-message');
        const txt = (alert?.textContent || '').trim();
        return txt;
      }).catch(() => null);

      if (formError && !formError.toLowerCase().includes('password')) {
        if (formError.toLowerCase().includes('already exists') || formError.toLowerCase().includes('already registered')) {
          console.warn(`[ElevenLabs] Akun ${email} sudah terdaftar sebelumnya.`);
          return {
            email,
            status: 'FAILED_ALREADY_EXISTS',
            timestamp: new Date().toISOString(),
            error: formError,
          };
        }
        const screenshot = await captureFailureScreenshot(tab1, 'form_error');
        return {
          email,
          status: 'FAILED_FORM_ERROR',
          timestamp: new Date().toISOString(),
          error: formError,
          screenshotPath: screenshot,
        };
      }

      // 2. Cek apakah layar konfirmasi pengiriman email sudah muncul
      const pageState = await tab1.evaluate(() => {
        const bodyText = (document.body?.innerText || '').toLowerCase();
        const isVerify =
          bodyText.includes("we've sent a verification link") ||
          bodyText.includes("we sent a verification link") ||
          bodyText.includes("we've sent") ||
          bodyText.includes("verify your email") ||
          bodyText.includes("check your spam") ||
          bodyText.includes("check your inbox") ||
          bodyText.includes("resend email") ||
          Boolean(document.querySelector('button, [role="button"]')?.textContent?.toLowerCase().includes('resend'));

        const iframes = Array.from(document.querySelectorAll('iframe'));
        const hasVisibleCaptcha = iframes.some((f) => {
          const src = (f.src || '').toLowerCase();
          const isCaptcha = src.includes('hcaptcha') || src.includes('turnstile') || src.includes('recaptcha');
          const style = window.getComputedStyle(f);
          const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          return isCaptcha && isVisible && (f.offsetHeight > 80 || f.offsetWidth > 150);
        });

        return { isVerify, hasVisibleCaptcha };
      }).catch(() => ({ isVerify: false, hasVisibleCaptcha: false }));

      if (pageState.isVerify) {
        console.log('✅ Konfirmasi pengiriman link verifikasi ElevenLabs terdeteksi di Tab 1!');
        signupConfirmed = true;
        break;
      }

      if (pageState.hasVisibleCaptcha) {
        const now = Date.now();
        if (now - lastCaptchaAlertTime > 15000) {
          console.log('\n====================================================');
          console.log('🧩 [Anti-Bot] Tantangan hCaptcha terdeteksi di browser!');
          console.log('👉 Browser dalam mode HEADED. Silakan selesaikan puzzle hCaptcha di browser...');
          console.log('⏳ Script menunggu Anda menyelesaikan CAPTCHA...');
          console.log('====================================================\n');
          lastCaptchaAlertTime = now;
        }
      }

      await sleep(2000);
    }

    if (!signupConfirmed) {
      const screenshot = await captureFailureScreenshot(tab1, 'signup_timeout');
      return {
        email,
        status: 'FAILED_CAPTCHA',
        timestamp: new Date().toISOString(),
        error: 'Batas waktu menunggu verifikasi signup / CAPTCHA habis (180 detik).',
        screenshotPath: screenshot,
      };
    }

    // ----------------------------------------------------
    // REVISI 1: Jeda Waktu Setelah Submit Sebelum Buka Gmail
    // ----------------------------------------------------
    console.log('\n⏳ [Jeda Waktu] Memberikan jeda 5 detik agar email verifikasi tiba di server Gmail...');
    await sleep(5000);

    // ----------------------------------------------------
    // LANGKAH 4: Ambil Link Verifikasi dari Gmail (Tab 2)
    // REVISI 3: Contek query Gmail dari ekstensi & cegah link lama
    // ----------------------------------------------------
    console.log('[Step 4] Membuka Tab 2 untuk mengambil link verifikasi dari Gmail...');
    const gmailResult = await fetchVerificationLinkFromGmail(context, {
      targetEmail: email,
      maxWaitSeconds: inboxTimeoutSec,
      pollIntervalMs: config.inboxPollIntervalMs || 3000,
      onLog: (msg) => console.log(`[Gmail] ${msg}`),
    });

    const verifyUrl = gmailResult.verifyUrl;
    console.log(`🎉 Link verifikasi berhasil didapatkan: ${verifyUrl}`);

    // ----------------------------------------------------
    // LANGKAH 5: Verifikasi di Tab 1 & Selesaikan Onboarding
    // ----------------------------------------------------
    console.log('[Step 5] Melakukan verifikasi akun & onboarding di Tab 1...');
    await tab1.bringToFront();

    console.log(`Menjalankan proses onboarding dengan URL: ${verifyUrl}`);
    const onboardingRes = await executeElevenLabsOnboarding(tab1, {
      verifyUrl,
      email,
      password,
      maxWaitSeconds: 90,
      onLog: (msg) => console.log(`[Onboarding] ${msg}`),
    });
    console.log(`[Onboarding] ${onboardingRes.message}`);

    // ----------------------------------------------------
    // LANGKAH 6: Tunggu Sampai Dashboard Termuat Lalu STOP
    // ----------------------------------------------------
    console.log('[Step 6] Memverifikasi dashboard ElevenLabs aktif...');
    const dashboardWaitStart = Date.now();
    const dashboardMaxWaitMs = 30000;
    let dashboardReached = false;

    while (Date.now() - dashboardWaitStart < dashboardMaxWaitMs) {
      if (await isDashboardLoaded(tab1)) {
        dashboardReached = true;
        break;
      }
      await sleep(1500);
    }

    if (!dashboardReached) {
      const screenshot = await captureFailureScreenshot(tab1, 'dashboard_not_reached');
      return {
        email,
        status: 'FAILED_UNKNOWN',
        timestamp: new Date().toISOString(),
        error: 'Timeout menunggu dashboard ElevenLabs termuat setelah verifikasi.',
        screenshotPath: screenshot,
      };
    }

    // Simpan session storage state untuk dev
    try {
      await saveElevenLabsSession(context);
    } catch (saveErr: any) {
      console.warn('⚠️ Gagal menyimpan session state ElevenLabs:', saveErr?.message);
    }

    const finalUrl = tab1.url();

    // ----------------------------------------------------
    // KONDISI SUKSES - LOG & STOP
    // ----------------------------------------------------
    console.log('\n====================================================');
    console.log('✅ SUCCESS');
    console.log(`📧 Email     : ${email}`);
    console.log(`📊 Status    : SUCCESS`);
    console.log(`⏰ Timestamp : ${new Date().toISOString()}`);
    console.log(`🌐 Dashboard : ${finalUrl}`);
    console.log('🛑 Berhenti tepat di dashboard. Tidak ada aksi lanjutan.');
    console.log('====================================================\n');

    return {
      email,
      status: 'SUCCESS',
      timestamp: new Date().toISOString(),
      dashboardUrl: finalUrl,
    };
  } catch (error: any) {
    const screenshot = await captureFailureScreenshot(tab1, 'fatal_error');
    return {
      email,
      status: 'FAILED_UNKNOWN',
      timestamp: new Date().toISOString(),
      error: error?.message || String(error),
      screenshotPath: screenshot,
    };
  }
}
