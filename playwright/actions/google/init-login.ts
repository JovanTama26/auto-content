import path from 'path';
import fs from 'fs';
import { launchBrowser, BrowserSession } from '../launch-browser';

export interface InitGoogleLoginOptions {
  profileName?: string;
  headed?: boolean;
  loginUrl?: string;
  timeoutMs?: number;
  autoClose?: boolean;
}

export interface GoogleLoginResult {
  success: boolean;
  profileName: string;
  userDataDir: string;
  storageStatePath?: string;
  userEmail?: string;
  context?: any;
  page?: any;
}

/**
 * Mendeteksi apakah sesi Google saat ini sudah dalam keadaan login aktif.
 */
async function checkLoginStatus(page: any): Promise<{ isLoggedIn: boolean; email?: string }> {
  try {
    const url = page.url();

    // 1. Cek dari URL tujuan akhir setelah login
    const isMyAccount = url.includes('myaccount.google.com') || url.includes('mail.google.com/mail');
    const isNotOnSignInPage = 
      !url.includes('accounts.google.com/v3/signin') &&
      !url.includes('accounts.google.com/signin') &&
      !url.includes('accounts.google.com/ServiceLogin') &&
      !url.includes('accounts.google.com/interactive/signin');

    // 2. Cek elemen tombol avatar profil / SignOutOptions Google
    const avatarInfo = await page.evaluate(() => {
      // Cari elemen avatar yang biasanya memuat email / akun
      const signOutLink = document.querySelector('a[href*="SignOutOptions"], a[href*="accounts.google.com/SignOutOptions"]');
      const ariaElements = Array.from(document.querySelectorAll('[aria-label]'));
      
      let detectedEmail: string | undefined;

      // Cari elemen yang aria-label nya mengandung pola email
      for (const el of ariaElements) {
        const label = el.getAttribute('aria-label') || '';
        const emailMatch = label.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
        if (emailMatch && (label.toLowerCase().includes('google') || label.toLowerCase().includes('account') || label.toLowerCase().includes('akun'))) {
          detectedEmail = emailMatch[0];
          break;
        }
      }

      const hasAvatar = Boolean(signOutLink || detectedEmail);
      return { hasAvatar, detectedEmail };
    });

    if ((isMyAccount && isNotOnSignInPage) || avatarInfo.hasAvatar) {
      return { isLoggedIn: true, email: avatarInfo.detectedEmail };
    }
  } catch {
    // Abaikan error saat halaman sedang reload / navigasi
  }

  return { isLoggedIn: false };
}

/**
 * Modul untuk inisialisasi dan login akun Google ke dalam user_data Playwright.
 */
export async function initGoogleLogin(options: InitGoogleLoginOptions = {}): Promise<GoogleLoginResult> {
  const profileName = options.profileName || 'user_1';
  const headed = options.headed ?? true;
  const loginUrl = options.loginUrl || 'https://mail.google.com/';
  const timeoutMs = options.timeoutMs ?? 0; // 0 = tunggu tanpa batas sampai user selesai login
  const autoClose = options.autoClose ?? false;

  const userDataDir = path.resolve(process.cwd(), 'playwright', 'user_data', profileName);
  const storageStatePath = path.resolve(userDataDir, 'storage_state.json');

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  console.log('====================================================');
  console.log('🔐 GOOGLE ACCOUNT LOGIN INITIALIZER');
  console.log('====================================================');
  console.log(`📁 Profile Name : ${profileName}`);
  console.log(`📂 User Data Dir: ${userDataDir}`);
  console.log(`🌐 Membuka browser (headed: ${headed})...`);
  console.log('----------------------------------------------------');
  console.log('👉 Silakan ketik Email & Password di jendela browser.');
  console.log('👉 Selesaikan verifikasi 2FA / Passkey jika diminta.');
  console.log('👉 Sesi login & cookies akan otomatis tersimpan di user_data.');
  console.log('====================================================\n');

  const session: BrowserSession = await launchBrowser({
    headed,
    profileName,
    userDataDir,
  });

  const { page, context } = session;

  console.log(`🧭 Membuka halaman login: ${loginUrl}`);
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' }).catch((err) => {
    console.warn(`[Google Login] Peringatan navigasi awal: ${err.message}`);
  });

  const startTime = Date.now();
  let userEmail: string | undefined;

  // Loop pemantauan login
  while (true) {
    if (timeoutMs > 0 && Date.now() - startTime > timeoutMs) {
      throw new Error(`[Google Login] Batas waktu login habis (${timeoutMs / 1000} detik).`);
    }

    const status = await checkLoginStatus(page);
    if (status.isLoggedIn) {
      userEmail = status.email;
      break;
    }

    await page.waitForTimeout(1500).catch(() => {});
  }

  // Beri jeda 2 detik agar cookies/token ter-update sempurna
  await page.waitForTimeout(2000).catch(() => {});

  // Ambil email jika belum terdeteksi sebelumnya
  if (!userEmail) {
    const finalCheck = await checkLoginStatus(page);
    userEmail = finalCheck.email;
  }

  // Simpan snapshot storage state ke JSON
  try {
    await context.storageState({ path: storageStatePath });
    console.log(`💾 Snapshot storage state disimpan ke: ${storageStatePath}`);
  } catch (err: any) {
    console.warn(`[Google Login] Gagal menyimpan storage_state.json: ${err.message}`);
  }

  console.log('\n====================================================');
  console.log(`🎉 LOGIN GOOGLE BERHASIL UNTUK PROFILE: [${profileName}]!`);
  if (userEmail) {
    console.log(`👤 Akun terdeteksi : ${userEmail}`);
  }
  console.log(`📁 Sesi & cookies tersimpan di: ${userDataDir}`);
  console.log('====================================================\n');

  if (autoClose) {
    await context.close().catch(() => {});
  }

  return {
    success: true,
    profileName,
    userDataDir,
    storageStatePath,
    userEmail,
    context,
    page,
  };
}

// Support eksekusi langsung dari CLI jika file ini dipanggil langsung
const isDirectExecution = process.argv[1] && (
  process.argv[1].endsWith('google/init-login.ts') ||
  process.argv[1].endsWith('google/init-login.js')
);

if (isDirectExecution) {
  const args = process.argv.slice(2);
  let profileName = 'user_1';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) {
      profileName = args[i + 1];
    }
  }

  initGoogleLogin({ profileName })
    .then(() => {
      console.log('💡 Sesi browser siap digunakan. Tekan Ctrl+C untuk keluar jika sudah selesai.');
    })
    .catch((err) => {
      console.error('❌ Terjadi kesalahan saat init login Google:', err);
      process.exit(1);
    });
}
