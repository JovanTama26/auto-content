import { launchBrowser } from './actions/launch-browser';
import { executeElevenLabsAutoSignup } from './actions/elevenlabs/auto-signup';

async function main() {
  const args = process.argv.slice(2);
  let profileName = 'user_1';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) {
      profileName = args[i + 1];
    }
  }

  console.log(`Menggunakan profile: ${profileName} (memuat sesi Google/Gmail)`);
  const session = await launchBrowser({ headed: true, profileName });

  try {
    const result = await executeElevenLabsAutoSignup(session.context, session.page);
    console.log('Hasil Eksekusi:', JSON.stringify(result, null, 2));
  } finally {
    // Opsional: sesi browser tetap hidup atau ditutup sesuai kebutuhan
    console.log('Otomasi selesai.');
  }
}

main().catch((err) => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
