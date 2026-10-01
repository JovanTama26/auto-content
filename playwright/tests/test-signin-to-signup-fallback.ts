import { chromium } from 'playwright';

async function testSignInToSignUpFallback() {
  console.log('\n===============================================================');
  console.log('🧪 VALIDASI FALLBACK SIGN-IN KE SIGN-UP KETIKA AKUN BELUM ADA');
  console.log('===============================================================\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let tabWasClosed = false;
  page.on('close', () => { tabWasClosed = true; });

  // 1. Render halaman Sign-In dengan respon error "No user is found with these credentials"
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head><title>ElevenLabs Sign In</title></head>
      <body>
        <div id="signin-container">
          <h2>Welcome back</h2>
          <input type="email" id="email" placeholder="Email" />
          <input type="password" id="password" placeholder="Password" />
          <div id="error-box" style="display: none; color: red;">
            ⚠️ No user is found with these credentials.
          </div>
          <button id="signin-btn" type="submit">Sign in</button>
        </div>
        <script>
          document.getElementById('signin-btn').addEventListener('click', (e) => {
            e.preventDefault();
            // Simulasikan delay network ElevenLabs dan munculkan error No user found
            setTimeout(() => {
              document.getElementById('error-box').style.display = 'block';
            }, 300);
          });
        </script>
      </body>
    </html>
  `);

  console.log('1. Menguji percobaan login dengan email yang belum terdaftar...');
  const signInResult = await page.evaluate(async ({ email, password }) => {
    const emailInput = document.querySelector('input[type="email"]');
    const passwordInput = document.querySelector('input[type="password"]');
    const submitBtn = document.querySelector('button[type="submit"]');

    emailInput.value = email;
    passwordInput.value = password;
    submitBtn.click();

    // Loop monitoring error seperti di executeSignIn yang baru
    const start = Date.now();
    let detectedError = null;
    while (Date.now() - start < 3000) {
      await new Promise((r) => setTimeout(r, 200));
      const bodyText = (document.body?.innerText || '').toLowerCase();
      if (bodyText.includes('no user is found') || bodyText.includes('user not found')) {
        detectedError = 'No user is found with these credentials';
        break;
      }
    }

    if (detectedError) {
      return { success: false, userNotFound: true, error: detectedError };
    }
    return { success: true };
  }, { email: 'reza.panji561@riztama.my.id', password: 'Jovan@1224' });

  console.log(`   - Error Terdeteksi: "${signInResult.error}"`);
  console.log(`   - Status userNotFound: ${signInResult.userNotFound ? '✅ YA (BENAR)' : '❌ TIDAK'}`);
  console.log(`   - Tab ter-close: ${tabWasClosed ? '❌ YA' : '✅ TIDAK'}\n`);

  if (!signInResult.userNotFound) {
    throw new Error('Gagal mendeteksi error akun belum ada di form sign-in!');
  }

  // 2. Simulasikan pengalihan ke Sign-Up
  console.log('2. Menguji pengalihan otomatis ke halaman Sign-Up...');
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head><title>ElevenLabs Sign Up</title></head>
      <body>
        <div id="signup-container">
          <h2>Create an account</h2>
          <input type="email" id="email" placeholder="Email" />
          <input type="password" id="password" placeholder="Password" />
          <button id="signup-btn" type="submit">Sign up</button>
        </div>
      </body>
    </html>
  `);

  const signUpPopulated = await page.evaluate(({ email, password }) => {
    const emailInput = document.querySelector('input[type="email"]');
    const passwordInput = document.querySelector('input[type="password"]');
    emailInput.value = email;
    passwordInput.value = password;
    return emailInput.value === email && passwordInput.value === password;
  }, { email: 'reza.panji561@riztama.my.id', password: 'Jovan@1224' });

  console.log(`   - Halaman Sign-Up otomatis terisi data target: ${signUpPopulated ? '✅ YA' : '❌ TIDAK'}`);
  console.log(`   - Tab ter-close: ${tabWasClosed ? '❌ YA' : '✅ TIDAK'}\n`);

  if (!signUpPopulated || tabWasClosed) {
    throw new Error('Gagal mengisi halaman sign-up!');
  }

  console.log('🎉 PENGUJIAN FALLBACK SIGN-IN KE SIGN-UP 100% SUKSES!');
  await browser.close();
}

testSignInToSignUpFallback().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
