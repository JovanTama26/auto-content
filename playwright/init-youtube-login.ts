import { launchBrowser } from './actions/launch-browser';
import fs from 'fs';
import path from 'path';

async function initYouTubeLogin() {
  const args = process.argv.slice(2);
  let profileName = 'user_2';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) {
      profileName = args[i + 1];
    }
  }

  const userDataDir = path.join(process.cwd(), 'playwright', 'user_data', profileName);
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  console.log('====================================================');
  console.log('🔐 LOGIN YOUTUBE PROFILE BARU');
  console.log('====================================================');
  console.log(`📁 Profile Name : ${profileName}`);
  console.log(`📂 Folder Data  : ${userDataDir}`);
  console.log('🌐 Membuka Google Chrome...');
  console.log('----------------------------------------------------');
  console.log('👉 Silakan LOGIN ke akun Google / YouTube di jendela browser.');
  console.log('👉 Sesi login & cookies akan otomatis tersimpan permanen!');
  console.log('====================================================\n');

  const { page, context } = await launchBrowser({ headed: true, profileName });

  // Navigasi ke halaman login YouTube
  await page.goto('https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/account', {
    waitUntil: 'domcontentloaded',
  });

  // Pantau status login
  let loggedIn = false;
  while (!loggedIn) {
    try {
      const url = page.url();
      // Jika sudah dialihkan ke youtube.com dan bukan di accounts.google.com
      if (url.includes('youtube.com') && !url.includes('accounts.google.com')) {
        const hasAvatar = await page.$('#avatar-btn, button[aria-label*="akun"], ytd-topbar-menu-button-renderer').catch(() => null);
        if (hasAvatar || url.includes('/account')) {
          loggedIn = true;
          break;
        }
      }
    } catch {
      // browser sedang redirect
    }
    await page.waitForTimeout(2000);
  }

  console.log('\n====================================================');
  console.log(`🎉 LOGIN BERHASIL TERDETEKSI UNTUK PROFILE: ${profileName}!`);
  console.log('📁 Sesi login telah tersimpan permanen di folder user data.');
  console.log('====================================================\n');
  console.log('💡 Kamu bisa menutup browser atau membiarkannya terbuka.');

  // Jaga proses tetap hidup agar browser tidak langsung tertutup sebelum user selesai
  await new Promise(() => {});
}

initYouTubeLogin().catch((err) => {
  console.error('Error saat inisialisasi login:', err);
  process.exit(1);
});
