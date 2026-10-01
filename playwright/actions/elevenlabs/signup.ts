// playwright/actions/elevenlabs/signup.ts
import { Page } from 'playwright';

export interface SignupOptions {
  email: string;
  password?: string;
  onLog?: (msg: string) => void;
}

export interface SignupResult {
  success: boolean;
  email: string;
  password: string;
  message: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes ElevenLabs Sign Up flow with React controlled component setter
 */
export async function executeElevenLabsSignup(
  page: Page,
  options: SignupOptions
): Promise<SignupResult> {
  const { email } = options;
  const password = options.password || 'Jovan@1224';
  const log = options.onLog || ((msg: string) => console.log(`[ElevenLabs Signup] ${msg}`));

  log(`Menyiapkan sesi pendaftaran bersih untuk ElevenLabs...`);
  try {
    await page.context().clearCookies({ domain: /elevenlabs/ });
    await page.goto('https://elevenlabs.io', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.evaluate(async () => {
      localStorage.clear();
      sessionStorage.clear();
      try {
        const dbs = await window.indexedDB.databases();
        for (const db of dbs) {
          if (db.name) window.indexedDB.deleteDatabase(db.name);
        }
      } catch {}
    });
    await page.context().clearCookies({ domain: /elevenlabs/ });
  } catch {}

  log(`Membuka halaman pendaftaran ElevenLabs: https://elevenlabs.io/app/sign-up...`);
  await page.goto('https://elevenlabs.io/app/sign-up', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);

  // Tunggu input email & password
  log(`Menunggu form pendaftaran ter-render...`);
  await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 25000 });

  // Isi form menggunakan React prototype setter agar terdeteksi oleh React internal state
  log(`Mengisi kredensial target: ${email}...`);
  await page.evaluate(`
    (function(eVal, pVal) {
      function setVal(input, val) {
        if (!input) return;
        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (nativeSetter && nativeSetter.set) {
          nativeSetter.set.call(input, val);
        } else {
          input.value = val;
        }
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: val.slice(-1) }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: val.slice(-1) }));
      }
      var eInput = document.querySelector('input[name="email"], input[type="email"]');
      var pInput = document.querySelector('input[name="password"], input[type="password"]');
      setVal(eInput, eVal);
      setVal(pInput, pVal);
    })(${JSON.stringify(email)}, ${JSON.stringify(password)})
  `);

  await sleep(800);

  // Centang checkbox jika ada
  try {
    const checkboxes = await page.$$('input[type="checkbox"]:not(:checked), [role="checkbox"][aria-checked="false"]');
    for (const cb of checkboxes) {
      await cb.click().catch(() => {});
      await sleep(200);
    }
  } catch {}

  // Pastikan tombol Sign up terdeteksi & enabled
  log(`Memeriksa tombol 'Sign up'...`);
  const submitBtn = page.locator('button:has-text("Sign up"):not(:has-text("Google"))').first();
  await submitBtn.waitFor({ state: 'visible', timeout: 10000 });

  // Pastikan tombol tidak disabled
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find((b) => {
      const txt = (b.innerText || '').toLowerCase();
      return txt.includes('sign up') && !txt.includes('google');
    });
    if (btn && btn.disabled) {
      btn.disabled = false;
    }
  });

  log(`Mengklik tombol Sign up...`);
  // Gunakan force: true untuk menghindari blokade overlay actionability
  await submitBtn.click({ force: true });
  await sleep(2000);

  // Pantau konfirmasi pengiriman email atau captcha challenge
  log(`Menunggu respons dari ElevenLabs...`);
  const monitorStart = Date.now();
  let verifiedScreen = false;

  while (Date.now() - monitorStart < 60000) {
    const pageText = (await page.evaluate(() => document.body.innerText || '')).toLowerCase();
    const currentUrl = page.url();

    // Cek error khusus
    const errorEl = await page.$('[role="alert"], .text-danger, .error-message');
    if (errorEl) {
      const errText = (await errorEl.innerText().catch(() => '')).trim();
      if (errText && !errText.toLowerCase().includes('password')) {
        throw new Error(`ElevenLabs Signup Error: ${errText}`);
      }
    }

    // Cek jika halaman berganti ke verifikasi email
    if (
      pageText.includes('verify your email') ||
      pageText.includes('check your inbox') ||
      pageText.includes('sent an email') ||
      pageText.includes('we sent a verification') ||
      pageText.includes("we've sent a verification link") ||
      currentUrl.includes('verify') ||
      currentUrl.includes('confirm')
    ) {
      log(`✅ Konfirmasi pengiriman link verifikasi ElevenLabs terdeteksi!`);
      verifiedScreen = true;
      break;
    }

    // Cek apakah ada challenge captcha iframe yang terlihat
    const visibleCaptcha = await page.$$eval('iframe', (els) => {
      return els.some((e) => {
        const src = e.src || '';
        return (src.includes('hcaptcha') || src.includes('recaptcha') || src.includes('turnstile')) && e.offsetHeight > 80;
      });
    });

    if (visibleCaptcha) {
      log(`🧩 Terdeteksi captcha puzzle di layar. Menunggu verifikasi captcha selesai...`);
    }

    await sleep(2000);
  }

  return {
    success: true,
    email,
    password,
    message: verifiedScreen
      ? `Berhasil mendaftar! Permintaan verifikasi dikirim ke ${email}.`
      : `Tombol Sign up diklik untuk ${email}.`,
  };
}
