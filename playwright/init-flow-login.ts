// playwright/init-flow-login.ts
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

async function initFlowLogin() {
  const userDataDir = path.resolve(__dirname, 'user_data/user_1');
  const extensionCandidates = [
    path.resolve(__dirname, '../extension'),
    path.resolve(__dirname, 'extension'),
  ];
  const extensionPath = extensionCandidates.find((p) => fs.existsSync(p) && fs.existsSync(path.join(p, 'manifest.json')));

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  // Remove stale SingletonLock files if present
  const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
  for (const lockFile of lockFiles) {
    const lockPath = path.join(userDataDir, lockFile);
    if (fs.existsSync(lockPath)) {
      try { fs.unlinkSync(lockPath); } catch {}
    }
  }

  console.log('====================================================');
  console.log('🚀 INITIALIZING PLAYWRIGHT GOOGLE FLOW SESSION');
  console.log('====================================================');
  console.log(`📁 User Data Dir : ${userDataDir}`);
  console.log('🌐 Membuka Google Chrome dengan sesi login permanen...');

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
  ];

  if (extensionPath) {
    launchArgs.push(
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    );
  }

  const launchOptions: any = {
    channel: 'chrome',
    headless: false,
    args: launchArgs,
    viewport: { width: 1440, height: 900 },
  };

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  } catch (err: any) {
    delete launchOptions.channel;
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  }

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  console.log('\n🧭 Mengarahkan ke https://labs.google/fx/id/tools/flow...');
  await page.goto('https://labs.google/fx/id/tools/flow', { waitUntil: 'domcontentloaded' });

  console.log('\n----------------------------------------------------');
  console.log('👉 SILAKAN LOGIN / TERIMA KETENTUAN GOOGLE FLOW DI CHROME');
  console.log('👉 Setelah masuk dashboard Flow, sesi tersimpan permanen!');
  console.log('👉 Tekan Ctrl + C di terminal ini jika sudah selesai.');
  console.log('----------------------------------------------------\n');

  // Keep alive until user closes or presses Ctrl+C
  await new Promise(() => {});
}

initFlowLogin().catch((err) => {
  console.error('[Flow Login Error]:', err);
  process.exit(1);
});
