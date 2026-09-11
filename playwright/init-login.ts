// playwright/init-login.ts
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

async function initLogin() {
  const userDataDir = path.resolve(__dirname, 'user_data/user_1');
  const extensionPath = path.resolve(__dirname, '../extension');

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  console.log('====================================================');
  console.log('🚀 INITIALIZING PLAYWRIGHT GOOGLE AI STUDIO SESSION');
  console.log('====================================================');
  console.log(`📁 User Data Dir : ${userDataDir}`);
  console.log(`🧩 Extension Path: ${extensionPath}`);
  console.log('🌐 Membuka Google Chrome dengan sesi login permanen...');

  // Launch persistent context menggunakan Google Chrome resmi di sistem
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
    viewport: { width: 1440, height: 900 },
  });

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  console.log('\n🧭 Mengarahkan ke https://aistudio.google.com...');
  await page.goto('https://aistudio.google.com', { waitUntil: 'domcontentloaded' });

  console.log('\n----------------------------------------------------');
  console.log('👉 SILAKAN LOGIN KE AKUN GOOGLE KAMU DI JENDELA CHROME');
  console.log('👉 Sesi login, cookies, dan 2FA akan otomatis tersimpan permanen!');
  console.log('----------------------------------------------------\n');

  // Loop memantau apakah login sudah berhasil
  let loggedIn = false;
  while (!loggedIn) {
    try {
      const currentUrl = page.url();

      // Cek apakah sudah berada di dashboard AI Studio dan bukan di halaman login accounts.google.com
      if (
        currentUrl.includes('aistudio.google.com') &&
        !currentUrl.includes('accounts.google.com')
      ) {
        // Cek elemen khas AI Studio yang menandakan sudah masuk
        const hasPromptBox = await page.$('textarea, [contenteditable="true"], .prompt-editor, .model-selector').catch(() => null);
        const hasGetStarted = await page.$('button, a').catch(() => null);

        // Jika URL stabil di AI Studio selama beberapa detik
        if (hasPromptBox || (currentUrl.includes('/prompts') || currentUrl.includes('/app'))) {
          loggedIn = true;
          break;
        }
      }
    } catch {
      // Browser mungkin sedang navigasi atau redirect
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log('\n====================================================');
  console.log('🎉 SELAMAT! LOGIN GOOGLE AI STUDIO BERHASIL TERDETEKSI!');
  console.log('📁 Sesi login kamu telah tersimpan secara permanen.');
  console.log('🧩 Ekstensi Content Auto Bridge juga sudah terpasang otomatis.');
  console.log('====================================================');
  console.log('\n💡 Tekan Ctrl + C di terminal ini kapan saja jika sudah selesai.');

  // Jaga proses tetap hidup agar browser tidak langsung tertutup
  await new Promise(() => {});
}

initLogin().catch((err) => {
  console.error('[Playwright Login Error]:', err);
  process.exit(1);
});
