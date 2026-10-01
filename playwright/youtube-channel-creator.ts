import { launchBrowser } from './actions/launch-browser';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

interface ChannelRecord {
  id: number;
  name: string;
  handle?: string;
  channelUrl: string;
  createdAt: string;
  status: 'success' | 'failed';
  error?: string;
}

// Koleksi kosakata tema Indonesia & Internasional
const INDO_WORDS = [
  'Nusantara', 'Garuda', 'Kisah', 'Cerita', 'Jejak', 'Misteri', 'Lentera', 'Suara',
  'Pojok', 'Ruang', 'Lensa', 'Kabar', 'Wawasan', 'Dunia', 'Kilas', 'Bicara',
  'Sorot', 'Kreasi', 'Harmoni', 'Cakrawala', 'Petualang', 'Santai', 'Fakta', 'Kopi',
  'Detik', 'Alur', 'Seru', 'Rasa', 'Gaya', 'Sinar', 'Gema', 'Titik', 'Cita', 'Senja',
  'Jagat', 'Nalar', 'Bumi', 'Warta', 'Inspirasi', 'Pustaka', 'Pena', 'Langkah', 'Ragam'
];

const GLOBAL_WORDS = [
  'Media', 'Studio', 'Lab', 'Odyssey', 'Chronicles', 'Hub', 'Daily', 'Sphere',
  'Horizon', 'Network', 'Pulse', 'Nexus', 'Universe', 'Zone', 'Insight', 'Scope',
  'Spotlight', 'Frontier', 'Vibe', 'Project', 'Cinema', 'Vision', 'Craft', 'Wave',
  'Flow', 'Spark', 'World', 'Tales', 'Matrix', 'Station', 'Forge', 'Echo', 'Vault',
  'Stream', 'Cast', 'Bytes', 'Vanguard', 'Canvas', 'Edge', 'Chronicle'
];

const DESCRIPTORS = [
  'Creative', 'Smart', 'Digital', 'Modern', 'Prime', 'Global', 'Visual', 'Urban',
  'NextGen', 'Central', 'ID', 'Official', 'Original', 'Alpha'
];

/**
 * Membaca data channel yang sudah tersimpan
 */
function loadExistingChannels(filePath: string): ChannelRecord[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[Storage] Gagal membaca ${filePath}, membuat list baru.`);
    return [];
  }
}

/**
 * Menyimpan data channel ke file JSON secara atomik
 */
function saveChannels(filePath: string, channels: ChannelRecord[]) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(channels, null, 2), 'utf-8');
}

/**
 * Generator nama channel unik variasi Indo + Internasional
 */
function generateUniqueChannelName(existingNames: Set<string>): string {
  const getRandom = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

  for (let attempt = 0; attempt < 500; attempt++) {
    const patternType = Math.floor(Math.random() * 5);
    let candidate = '';

    const indo = getRandom(INDO_WORDS);
    const global = getRandom(GLOBAL_WORDS);
    const desc = getRandom(DESCRIPTORS);

    switch (patternType) {
      case 0:
        candidate = `${indo} ${global}`;
        break;
      case 1:
        candidate = `${global} ${indo}`;
        break;
      case 2:
        candidate = `${indo} ${global} ${desc}`;
        break;
      case 3:
        candidate = `${desc} ${indo} ${global}`;
        break;
      case 4:
        candidate = `${indo} ${getRandom(INDO_WORDS)} ${global}`;
        break;
    }

    if (!existingNames.has(candidate.toLowerCase())) {
      existingNames.add(candidate.toLowerCase());
      return candidate;
    }
  }

  // Fallback jika kombinasi kata habis
  const fallback = `${getRandom(INDO_WORDS)} ${getRandom(GLOBAL_WORDS)} ${Math.floor(100 + Math.random() * 900)}`;
  existingNames.add(fallback.toLowerCase());
  return fallback;
}

/**
 * Jeda waktu acak (dalam milidetik)
 */
function sleepRandom(minSeconds: number, maxSeconds: number): Promise<void> {
  const ms = Math.floor((minSeconds + Math.random() * (maxSeconds - minSeconds)) * 1000);
  console.log(`⏳ Jeda istirahat ${Math.round(ms / 1000)} detik sebelum channel berikutnya...`);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Menunggu konfirmasi input terminal dari pengguna
 */
function waitForTerminalInput(questionText: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(questionText, (ans) => {
      rl.close();
      resolve(ans);
    });
  });
}

export async function runYouTubeChannelCreator(options: {
  target?: number;
  minDelay?: number;
  maxDelay?: number;
  profileName?: string;
  outputPath?: string;
}) {
  const target = options.target ?? 90;
  const minDelay = options.minDelay ?? 8;
  const maxDelay = options.maxDelay ?? 15;
  const profileName = options.profileName ?? 'user_1';
  const outputPath = options.outputPath ?? path.join(process.cwd(), 'data', `youtube_channels_${profileName}.json`);
  const debugDir = path.join(process.cwd(), 'playwright', 'debug');

  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  console.log('====================================================');
  console.log('🎬 YOUTUBE SUB-CHANNEL AUTO CREATOR');
  console.log('====================================================');
  console.log(`🎯 Target Total Channel: ${target}`);
  console.log(`📁 Profile Browser      : ${profileName}`);
  console.log(`💾 Penyimpanan JSON     : ${outputPath}`);
  console.log(`⏱️ Jeda antar pembuatan : ${minDelay}s - ${maxDelay}s`);
  console.log('====================================================\n');

  // Load channel yang sudah ada
  const channels = loadExistingChannels(outputPath);
  const existingNames = new Set<string>(channels.map((c) => c.name.toLowerCase()));

  console.log(`📊 Ditemukan ${channels.length} channel di data JSON saat ini.`);

  if (channels.length >= target) {
    console.log(`✅ Target ${target} channel sudah tercapai! Selesai.`);
    return channels;
  }

  // Buka browser dengan Playwright
  console.log('\n🚀 Meluncurkan browser Chrome persistent context...');
  const { page, context } = await launchBrowser({ headed: true, profileName });

  try {
    while (channels.length < target) {
      const currentNumber = channels.length + 1;
      const channelName = generateUniqueChannelName(existingNames);

      console.log(`\n----------------------------------------------------`);
      console.log(`▶️ [Channel ${currentNumber}/${target}] Menyiapkan: "${channelName}"`);
      console.log(`----------------------------------------------------`);

      // 1. Navigasi ke channel switcher
      try {
        await page.goto('https://www.youtube.com/channel_switcher', {
          waitUntil: 'domcontentloaded',
          timeout: 45000,
        });
      } catch (err: any) {
        console.warn('⚠️ Gagal load channel_switcher, reload ulang...', err?.message);
        await page.reload({ waitUntil: 'domcontentloaded' });
      }

      await page.waitForTimeout(3000);

      // Cek apakah dialihkan ke login
      if (page.url().includes('accounts.google.com/ServiceLogin') || page.url().includes('accounts.google.com/signin')) {
        console.error('❌ Sesi login berakhir atau membutuhkan login ulang.');
        break;
      }

      // 2. Klik tombol "Buat channel"
      const createBtn = page.locator(
        'a[href*="create_channel"], ytd-button-renderer:has-text("Buat channel"), [aria-label*="Buat channel"], button:has-text("Buat channel")'
      ).first();

      const btnVisible = await createBtn.isVisible().catch(() => false);
      if (!btnVisible) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(1000);
      }

      await createBtn.click().catch(async () => {
        await page.evaluate(() => {
          const btn = document.querySelector('a[href*="create_channel"], ytd-button-renderer') as HTMLElement;
          if (btn) btn.click();
        });
      });

      await page.waitForTimeout(2500);

      // 3. Cek apakah muncul modal "Dapatkan fitur lanjutan" / verifikasi YouTube Studio
      const verificationModal = page.locator('tp-yt-paper-dialog:has-text("Dapatkan fitur lanjutan"), [role="dialog"]:has-text("fitur lanjutan")');
      if (await verificationModal.isVisible().catch(() => false)) {
        console.log('\n⚠️ ====================================================');
        console.log('⚠️ TERDETEKSI: Verifikasi Fitur Lanjutan YouTube Studio');
        console.log('👉 Selesaikan verifikasi di browser yang terbuka.');
        console.log('====================================================\n');

        // Tunggu modal verifikasi ditutup oleh user
        await verificationModal.waitFor({ state: 'hidden', timeout: 300000 }).catch(() => {});
        console.log('Verifikasi selesai atau ditutup. Mengulang alur...');
        await page.waitForTimeout(2000);
        continue;
      }

      // 4. Deteksi modal form pembuatan channel
      const dialog = page.locator('ytd-channel-creation-dialog-renderer').first();
      let dialogReady = false;
      try {
        await dialog.waitFor({ state: 'visible', timeout: 8000 });
        dialogReady = true;
      } catch {
        // Cek kembali kemungkinan modal verifikasi muncul terlambat
        const isVerif = await page.locator('button:has-text("Verifikasi"), button:has-text("Verify")').count();
        if (isVerif > 0) {
          console.log('\n⚠️ Menunggu verifikasi akun YouTube Studio diselesaikan oleh pengguna...');
          await page.waitForTimeout(10000);
          continue;
        }
        console.warn('⚠️ Modal belum muncul, mencoba klik ulang tombol Buat channel...');
        await createBtn.click().catch(() => {});
        await page.waitForTimeout(3000);
        dialogReady = await dialog.isVisible().catch(() => false);
      }

      if (!dialogReady) {
        console.error('❌ Dialog pembuatan channel tidak dapat diakses saat ini. Menghentikan loop.');
        await page.screenshot({ path: path.join(debugDir, `error_dialog_${currentNumber}.png`) });
        break;
      }

      // 5. Isi input nama channel
      const inputs = dialog.locator('input');
      const inputCount = await inputs.count();

      if (inputCount === 0) {
        console.error('❌ Tidak ditemukan field input di modal.');
        await page.screenshot({ path: path.join(debugDir, `error_no_inputs_${currentNumber}.png`) });
        continue;
      }

      const nameInput = inputs.first();
      await nameInput.click();
      await nameInput.fill('');
      await page.waitForTimeout(300);
      await nameInput.pressSequentially(channelName, { delay: 45 });
      await page.waitForTimeout(1800);

      // 6. Handle input (field kedua jika ada)
      let detectedHandle = '';
      if (inputCount >= 2) {
        const handleInput = inputs.nth(1);
        detectedHandle = await handleInput.inputValue();
        if (!detectedHandle || detectedHandle === '@') {
          const autoHandle = channelName.toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(10 + Math.random() * 90);
          console.log(`🏷️ Mengisi handle manual: @${autoHandle}`);
          await handleInput.click();
          await handleInput.fill(autoHandle);
          await page.waitForTimeout(1000);
          detectedHandle = `@${autoHandle}`;
        } else {
          console.log(`🏷️ Handle otomatis: ${detectedHandle}`);
        }
      }

      // 7. Tombol submit "Buat channel"
      const submitBtn = dialog.locator('button:has-text("Buat channel"), button:has-text("Create channel")').first();

      let isReady = false;
      for (let w = 0; w < 10; w++) {
        const ariaDisabled = await submitBtn.getAttribute('aria-disabled');
        if (ariaDisabled === 'false' || ariaDisabled === null) {
          isReady = true;
          break;
        }
        await page.waitForTimeout(500);
      }

      if (!isReady) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(1000);
      }

      console.log('🚀 Mengklik tombol "Buat channel"...');
      await submitBtn.click();

      // 8. Tunggu redirect ke channel baru
      console.log('⏳ Menunggu redirect pembuatan channel...');
      let createdUrl = '';
      const startTime = Date.now();

      while (Date.now() - startTime < 30000) {
        await page.waitForTimeout(1500);
        const curUrl = page.url();

        if (curUrl.includes('/channel/') || curUrl.includes('/@') || curUrl.includes('studio.youtube.com')) {
          createdUrl = curUrl;
          break;
        }

        // Cek jika muncul notifikasi error / verifikasi nomor HP
        const bodyContent = await page.textContent('body').catch(() => '');
        if (
          bodyContent?.includes('Kirim kode') ||
          bodyContent?.includes('Verifikasi akun Anda') ||
          bodyContent?.includes('Verify your account') ||
          bodyContent?.includes('Ada masalah saat membuat') ||
          bodyContent?.includes('Terlalu banyak permintaan')
        ) {
          console.error('\n⚠️ TERDETEKSI TANTANGAN VERIFIKASI ATAU RATE LIMIT YOUTUBE!');
          await page.screenshot({ path: path.join(debugDir, `verification_challenge_${currentNumber}.png`) });
          break;
        }
      }

      if (createdUrl) {
        console.log(`🎉 BERHASIL! Channel dibuat: "${channelName}"`);
        console.log(`🔗 URL: ${createdUrl}`);

        const record: ChannelRecord = {
          id: currentNumber,
          name: channelName,
          handle: detectedHandle.startsWith('@') ? detectedHandle : `@${detectedHandle}`,
          channelUrl: createdUrl,
          createdAt: new Date().toISOString(),
          status: 'success',
        };

        channels.push(record);
        saveChannels(outputPath, channels);
        console.log(`💾 Tersimpan ke JSON (${channels.length}/${target})`);
      } else {
        const isDialogGone = !(await dialog.isVisible().catch(() => false));
        if (isDialogGone) {
          const record: ChannelRecord = {
            id: currentNumber,
            name: channelName,
            handle: detectedHandle,
            channelUrl: page.url(),
            createdAt: new Date().toISOString(),
            status: 'success',
          };
          channels.push(record);
          saveChannels(outputPath, channels);
          console.log(`💾 Channel tercatat (modal tertutup): ${channelName}`);
        } else {
          console.error(`❌ Gagal membuat channel "${channelName}". Menghentikan proses demi keamanan akun.`);
          break;
        }
      }

      // Jeda acak antar channel
      if (channels.length < target) {
        await sleepRandom(minDelay, maxDelay);
      }
    }
  } catch (err: any) {
    console.error('❌ Terjadi error dalam eksekusi:', err);
  } finally {
    console.log('\n====================================================');
    console.log('🏁 SELESAI / PROSES DIAKHIRI');
    console.log(`📊 Total channel tersimpan: ${channels.length}`);
    console.log(`💾 Lokasi file: ${outputPath}`);
    console.log('====================================================\n');
    await context.close();
  }

  return channels;
}

// CLI handler
if (require.main === module) {
  const args = process.argv.slice(2);
  let target = 90;
  let minDelay = 8;
  let maxDelay = 15;
  let profileName = 'user_1';
  let outputPath: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) {
      target = parseInt(args[i + 1], 10);
    }
    if (args[i] === '--min-delay' && args[i + 1]) {
      minDelay = parseInt(args[i + 1], 10);
    }
    if (args[i] === '--max-delay' && args[i + 1]) {
      maxDelay = parseInt(args[i + 1], 10);
    }
    if (args[i] === '--profile' && args[i + 1]) {
      profileName = args[i + 1];
    }
    if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[i + 1];
    }
  }

  runYouTubeChannelCreator({ target, minDelay, maxDelay, profileName, outputPath }).catch((err) => {
    console.error('Fatal Error:', err);
    process.exit(1);
  });
}
