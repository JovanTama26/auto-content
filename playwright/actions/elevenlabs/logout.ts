// playwright/actions/elevenlabs/logout.ts
import { Page } from 'playwright';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface LogoutOptions {
  timeoutMs?: number;
  onLog?: (msg: string) => void;
}

export interface LogoutResult {
  success: boolean;
  method: 'ui_menu_click' | 'direct_redirect';
  finalUrl: string;
  error?: string;
}

/**
 * Dismisses any blocking upgrade, modal dialog, or overlay that might cover the user profile button.
 */
async function dismissBlockingOverlays(page: Page, log?: (m: string) => void) {
  try {
    // 1. Press Escape up to 2 times
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(200);
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(200);

    // 2. Click any visible close / dismiss / remind me later buttons
    const closeBtns = await page.$$(
      'button[aria-label*="close" i], button[aria-label*="dismiss" i], button:has-text("Remind Me Later"), button:has-text("Close"), button:has-text("✕")'
    );
    for (const btn of closeBtns) {
      if (await btn.isVisible().catch(() => false)) {
        log?.('Menutup dialog / overlay yang menghalangi...');
        await btn.click({ force: true }).catch(() => {});
        await sleep(250);
      }
    }

    // 3. Ensure body pointer events are enabled
    await page.evaluate(() => {
      document.body.style.pointerEvents = 'auto';
      const dialogs = document.querySelectorAll('[role="dialog"], .fixed.inset-0, [data-state="open"]');
      for (const d of Array.from(dialogs)) {
        const txt = (d.textContent || '').toLowerCase();
        if (txt.includes('upgrade') || txt.includes('first month 50% off') || txt.includes('credits remaining')) {
          (d as HTMLElement).style.pointerEvents = 'none';
        }
      }
    }).catch(() => {});
  } catch (e) {}
}

/**
 * Robust Native Logout: Bener-bener mengklik tombol avatar profil -> menu dropdown -> Sign out / Log out.
 */
export async function executeElevenLabsLogout(
  page: Page,
  options: LogoutOptions = {}
): Promise<LogoutResult> {
  const log = options.onLog || ((msg: string) => console.log(`[ElevenLabs Logout] ${msg}`));
  const timeoutMs = options.timeoutMs || 30000;
  const startTime = Date.now();

  log('🚪 Memulai proses Logout ElevenLabs (klik native UI)...');

  // Langkah 1: Pastikan berada di domain elevenlabs.io
  const currentUrl = page.url();
  if (!currentUrl.includes('elevenlabs.io')) {
    log(`Bukan halaman ElevenLabs (URL: ${currentUrl}). Lewati.`);
    return { success: true, method: 'direct_redirect', finalUrl: currentUrl };
  }

  // Jika sudah di halaman sign-in / login, akun sudah logout
  if (currentUrl.includes('/sign-in') || currentUrl.includes('/login') || currentUrl.includes('/sign-up')) {
    log(`Sudah berada di halaman login/signup (${currentUrl}). Logout selesai.`);
    return { success: true, method: 'ui_menu_click', finalUrl: currentUrl };
  }

  // Langkah 2: Tutup modal / popup yang mungkin menghalangi UI
  await dismissBlockingOverlays(page, log);
  await sleep(400);

  // Langkah 3: Cari tombol User Profile / Avatar
  log('Mencari tombol User Profile / Avatar...');
  const userButtonSelectors = [
    'button[data-testid="user-menu-button"]',
    'button[aria-label="Your profile"]',
    'button[aria-label*="profile" i]',
    'button[aria-label*="account" i]',
    'button[aria-label*="user" i]',
    '[data-testid="user-menu-button"]',
    'button:has([data-testid="user-menu-button"])',
  ];

  let userMenuBtn = null;
  for (const sel of userButtonSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) {
      userMenuBtn = loc;
      log(`✅ Tombol avatar ditemukan via selector: ${sel}`);
      break;
    }
  }

  // Fallback: cari tombol avatar di baris paling atas (header / top bar)
  if (!userMenuBtn) {
    log('Mencari fallback avatar tombol di topbar...');
    const topButtons = await page.$$('header button, [role="banner"] button, div.sticky button, nav button');
    for (const btn of topButtons.reverse()) { // Prioritaskan tombol paling kanan
      const isVis = await btn.isVisible().catch(() => false);
      if (isVis) {
        const aria = (await btn.getAttribute('aria-label').catch(() => '')) || '';
        const tid = (await btn.getAttribute('data-testid').catch(() => '')) || '';
        if (aria.toLowerCase().includes('profile') || tid.includes('user') || aria.toLowerCase().includes('account')) {
          userMenuBtn = btn;
          log('✅ Fallback tombol avatar ditemukan di topbar.');
          break;
        }
      }
    }
  }

  let clickedMenu = false;
  if (userMenuBtn) {
    log('🖱️ Mengklik tombol avatar untuk membuka menu dropdown...');
    await userMenuBtn.click({ force: true }).catch(() => {});
    clickedMenu = true;
    await sleep(1000);
  } else {
    log('⚠️ Tombol avatar tidak terdeteksi di DOM via selector standar.');
  }

  // Langkah 4: Cari dan klik tombol "Sign out" / "Log out" di menu dropdown
  log('Mencari opsi "Sign out" / "Log out" di menu dropdown...');
  const logoutSelectors = [
    '[role="menuitem"]:has-text("Sign out")',
    '[role="menuitem"]:has-text("Log out")',
    '[data-radix-collection-item]:has-text("Sign out")',
    '[data-radix-collection-item]:has-text("Log out")',
    'button:has-text("Sign out")',
    'button:has-text("Log out")',
    'a:has-text("Sign out")',
    'a:has-text("Log out")',
    'div[role="menu"] [role="menuitem"]',
  ];

  let clickedLogout = false;
  for (const sel of logoutSelectors) {
    const loc = page.locator(sel).filter({ hasText: /sign\s*out|log\s*out|keluar/i }).first();
    if (await loc.isVisible().catch(() => false)) {
      log(`🎯 Tombol Logout terdeteksi via: ${sel}! Mengklik tombol Logout...`);
      await loc.click({ force: true });
      clickedLogout = true;
      break;
    }
  }

  // Jika belum berhasil klik menu (misal menu belum terbuka), coba buka via script evaluate
  if (!clickedLogout) {
    log('Mencoba klik tombol avatar dan logout via in-page evaluate...');
    const evalRes = await page.evaluate(() => {
      // 1. Cari avatar button
      const avatar = document.querySelector('button[data-testid="user-menu-button"], button[aria-label="Your profile"]') ||
                     Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').toLowerCase().includes('profile'));
      if (avatar) {
        (avatar as HTMLElement).click();
      }

      // 2. Beri waktu sejenak lalu cari Sign out
      return !!avatar;
    });

    if (evalRes) {
      await sleep(1000);
      for (const sel of logoutSelectors) {
        const loc = page.locator(sel).filter({ hasText: /sign\s*out|log\s*out/i }).first();
        if (await loc.isVisible().catch(() => false)) {
          log(`🎯 Tombol Logout terdeteksi pasca evaluate! Mengklik...`);
          await loc.click({ force: true });
          clickedLogout = true;
          break;
        }
      }
    }
  }

  // Langkah 5: Tangani modal konfirmasi jika ada (misal "Are you sure you want to log out?")
  await sleep(1000);
  const confirmBtn = page.locator('[role="dialog"] button, div[aria-modal="true"] button').filter({ hasText: /log\s*out|sign\s*out|confirm|yes/i }).first();
  if (await confirmBtn.isVisible().catch(() => false)) {
    log('⚠️ Dialog konfirmasi logout muncul! Mengonfirmasi...');
    await confirmBtn.click({ force: true }).catch(() => {});
    await sleep(1500);
  }

  // Langkah 6: Tunggu hingga URL beralih ke sign-in / login
  log('Menunggu pengalihan ke halaman sign-in...');
  let isLoggedOut = false;
  for (let i = 0; i < 15; i++) {
    const url = page.url();
    if (url.includes('/sign-in') || url.includes('/login') || url.includes('/sign-up') || url === 'https://elevenlabs.io/') {
      isLoggedOut = true;
      log(`🎉 Berhasil Logout! URL sekarang: ${url}`);
      break;
    }
    await sleep(500);
  }

  if (isLoggedOut) {
    return {
      success: true,
      method: clickedLogout ? 'ui_menu_click' : 'direct_redirect',
      finalUrl: page.url(),
    };
  }

  // Fallback pengamanan jika klik UI tidak merespons (misal jaringan terputus)
  log('⚠️ UI click belum mengalihkan, mengarahkan ke https://elevenlabs.io/app/sign-out sebagai pengaman...');
  await page.goto('https://elevenlabs.io/app/sign-out', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await sleep(2000);

  return {
    success: page.url().includes('sign-in') || page.url().includes('login') || page.url() === 'https://elevenlabs.io/',
    method: 'direct_redirect',
    finalUrl: page.url(),
  };
}
