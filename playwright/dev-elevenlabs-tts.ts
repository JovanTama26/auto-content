import { launchBrowser } from './actions/launch-browser';
import { generateElevenLabsSpeech } from './actions/elevenlabs/tts';
import { ELEVENLABS_SESSION_PATH } from './actions/elevenlabs/session';
import fs from 'fs';

async function main() {
  const args = process.argv.slice(2);
  let text = 'Halo dunia, ini adalah pengujian suara otomatis menggunakan ElevenLabs.';
  let voiceName = 'Dany Saputra';
  let modelName = 'Eleven v3';
  let partNumber: number | undefined = undefined;
  let isHeaded = false;
  let targetCategory: 'alurfilm' | 'assets' = 'alurfilm';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--text' && args[i + 1]) text = args[i + 1];
    if (args[i] === '--voice' && args[i + 1]) voiceName = args[i + 1];
    if (args[i] === '--model' && args[i + 1]) modelName = args[i + 1];
    if (args[i] === '--part' && args[i + 1]) partNumber = parseInt(args[i + 1], 10);
    if (args[i] === '--headed') isHeaded = true;
    if (args[i] === '--category' && args[i + 1]) targetCategory = args[i + 1] as any;
  }

  console.log('====================================================');
  console.log('🎙️ ELEVENLABS TTS RUNNER');
  console.log('====================================================');
  console.log(`Model    : ${modelName}`);
  console.log(`Voice    : ${voiceName}`);
  console.log(`Category : ${targetCategory}`);
  if (partNumber) console.log(`Part #   : ${partNumber}`);
  console.log(`Mode     : ${isHeaded ? 'Headed' : 'Headless'}`);
  console.log(`Naskah   : "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);
  console.log('====================================================\n');

  const session = await launchBrowser({
    profileName: 'user_1',
    headed: isHeaded,
    storageStatePath: fs.existsSync(ELEVENLABS_SESSION_PATH) ? ELEVENLABS_SESSION_PATH : undefined,
  });

  try {
    const result = await generateElevenLabsSpeech(session.page, {
      text,
      voiceName,
      modelName,
      partNumber,
      targetCategory,
      onLog: (m) => console.log(`[TTS] ${m}`),
    });

    console.log('\n====================================================');
    console.log('✅ GENERATE TTS BERHASIL');
    console.log(`📂 Audio Path : ${result.audioPath}`);
    console.log(`📁 Filename   : ${result.filename}`);
    console.log(`📝 Karakter   : ${result.characterCount}`);
    console.log('====================================================\n');
  } finally {
    await session.context.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
