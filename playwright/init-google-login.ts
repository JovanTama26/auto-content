import { initGoogleLogin } from './actions/google/init-login';

async function main() {
  const args = process.argv.slice(2);
  let profileName = 'user_1';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) {
      profileName = args[i + 1];
    }
  }

  await initGoogleLogin({ profileName });
  console.log('💡 Sesi browser siap digunakan. Tekan Ctrl+C untuk keluar jika sudah selesai.');
  
  // Menjaga proses tetap aktif sampai user menutup browser atau menekan Ctrl+C
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('❌ Error saat inisialisasi login Google:', err);
  process.exit(1);
});
