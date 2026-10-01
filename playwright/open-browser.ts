import { launchBrowser } from './actions/launch-browser';

async function openBrowserForVerification() {
  console.log('====================================================');
  console.log('🔓 MEMBUKA BROWSER UNTUK VERIFIKASI YOUTUBE STUDIO');
  console.log('====================================================');
  console.log('Jendela Chrome telah terbuka di https://www.youtube.com/channel_switcher');
  console.log('👉 Silakan klik tombol "Verifikasi" dan ikuti petunjuk verifikasi satu kali dari YouTube.');
  console.log('👉 Setelah selesai verifikasi, biarkan browser ini atau tekan Ctrl+C di terminal.');
  console.log('====================================================\n');

  const { page, context } = await launchBrowser({ headed: true, profileName: 'user_1' });

  await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded' });

  // Coba klik tombol buat channel agar modal "Dapatkan fitur lanjutan" langsung muncul
  await page.waitForTimeout(2000);
  const createBtn = page.locator(
    'a[href*="create_channel"], ytd-button-renderer:has-text("Buat channel"), [aria-label*="Buat channel"], button:has-text("Buat channel")'
  ).first();

  if (await createBtn.isVisible().catch(() => false)) {
    console.log('Memunculkan modal pembuatan channel / verifikasi...');
    await createBtn.click().catch(() => {});
  }

  // Jaga proses tetap hidup agar browser tidak tertutup
  await new Promise(() => {});
}

openBrowserForVerification().catch(console.error);
