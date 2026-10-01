// playwright/elevenlabs.ts
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { runElevenLabsPipeline } from './pipelines/elevenlabs-pipeline';
import { launchBrowser } from './actions/launch-browser';
import { downloadElevenLabsAudio } from './actions/elevenlabs/download-audio';

const program = new Command();

program
  .name('elevenlabs')
  .description('Automated ElevenLabs account creation, Gmail email verification, onboarding bypass, TTS configuration & audio download')
  .version('1.0.0');

// Subcommand: download
program
  .command('download')
  .description('Unduh audio hasil generate dari riwayat ElevenLabs TTS')
  .option('-g, --generation <number>', 'Nomor generasi audio (1 = awal, 2 = terbaru/terakhir)', '2')
  .option('-o, --output-dir <path>', 'Direktori tujuan penyimpanan file audio', 'downloads')
  .option('-f, --format <format>', 'Format audio (mp3 / wav)', 'mp3')
  .option('--profile <name>', 'Nama profil Chrome di playwright/user_data/', 'user_1')
  .option('--headless', 'Jalankan browser dalam mode headless', false)
  .action(async (opts) => {
    const genNum = parseInt(opts.generation, 10) || 2;
    console.log(`\n📥 Memulai proses unduh audio Generation ${genNum} dari ElevenLabs...`);
    const session = await launchBrowser({
      headed: !opts.headless,
      profileName: opts.profile,
    });

    try {
      const result = await downloadElevenLabsAudio(session.page, {
        generationNumber: genNum,
        outputDir: opts.outputDir,
        format: opts.format,
      });

      console.log('\n====================================================');
      console.log('🎉 PENGUNDUHAN AUDIO BERHASIL!');
      console.log(`📁 File    : ${result.fileName}`);
      console.log(`📍 Lokasi  : ${result.filePath}`);
      console.log(`📊 Ukuran  : ${(result.fileSizeBytes / 1024).toFixed(1)} KB`);
      console.log(`🔢 Generasi: ${result.generationSelected}`);
      console.log('====================================================\n');
    } catch (err: any) {
      console.error('\n❌ Gagal mengunduh audio:', err.message);
      process.exit(1);
    } finally {
      await session.context.close().catch(() => {});
    }
  });

// Default action (Generate speech & optional auto-download)
program
  .option('-t, --text <text>', 'Teks yang akan digenerate ke audio')
  .option('-f, --file <path>', 'Path ke file teks yang akan digenerate')
  .option('-e, --email <email>', 'Alamat email spesifik (default: auto-generate @riztama.my.id)')
  .option('-p, --password <password>', 'Password akun ElevenLabs (default: Jovan@1224)')
  .option('--skip-signup', 'Lewati tahap pendaftaran akun (langsung buka TTS)')
  .option('-v, --voice <voice>', 'Nama voice ElevenLabs', 'Dany Saputra')
  .option('-m, --model <model>', 'Model ElevenLabs', 'Eleven v3')
  .option('-s, --stability <stability>', 'Stabilitas suara (robust / creative)', 'robust')
  .option('-d, --download', 'Unduh file audio setelah proses generate selesai')
  .option('-g, --generation <number>', 'Nomor generasi yang akan diunduh (default: 2)', '2')
  .option('-o, --output-dir <path>', 'Direktori tujuan penyimpanan unduhan', 'downloads')
  .option('--profile <name>', 'Nama profil Chrome di playwright/user_data/', 'user_1')
  .option('--headless', 'Jalankan browser dalam mode headless', false)
  .option('--no-generate', 'Hanya lakukan konfigurasi tanpa menekan tombol generate speech')
  .action(async (opts) => {
    let text = opts.text;

    if (!text && opts.file) {
      const filePath = path.resolve(process.cwd(), opts.file);
      if (fs.existsSync(filePath)) {
        text = fs.readFileSync(filePath, 'utf-8');
      } else {
        console.error(`File teks tidak ditemukan: ${filePath}`);
        process.exit(1);
      }
    }

    if (!text) {
      text = 'Di tengah guyuran hujan yang disambut suka cita oleh para warga, Nam-san, Ji-wan, dan Su-na akhirnya memutuskan untuk melangkah pulang.\n\n[pauses]\n\nSebelum memulai lembaran baru, mereka menyempatkan diri berziarah ke makam sang nenek saat senja tiba, di mana Su-na melepaskan kerinduannya dengan penuh haru di samping Nam-san dan Ji-wan yang setia mendampingi.\n\n[pauses]\n\nKini kedamaian pun kembali menyelimuti Distrik Bus, di mana Nam-san dan Ji-wan kembali membuka lapak daging mereka dengan ditemani canda tawa hangat bersama Su-na.\n\n[pauses]\n\nOke bro, jadi itu dia alur cerita lengkap dari film Badland Hunters. Sampai jumpa di ulasan film seru selanjutnya!';
    }

    try {
      const result = await runElevenLabsPipeline({
        email: opts.email,
        password: opts.password,
        skipSignup: !!opts.skipSignup,
        voiceName: opts.voice,
        modelName: opts.model,
        stability: opts.stability,
        text,
        generateSpeech: opts.generate !== false,
        downloadAudio: !!opts.download,
        generationNumber: parseInt(opts.generation, 10) || 2,
        outputDir: opts.outputDir,
        profileName: opts.profile,
        headed: !opts.headless,
      });

      if (!result.success) {
        console.error('\n❌ Eksekusi pipeline ElevenLabs gagal:', result.error);
        process.exit(1);
      }

      console.log('\n✨ Proses otomatisasi ElevenLabs selesai dengan sukses!');
    } catch (err: any) {
      console.error('\nFatal Error:', err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
