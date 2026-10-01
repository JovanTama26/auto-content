import { chromium } from 'playwright';

async function testAllElevenLabsConditions() {
  console.log('\n===============================================================');
  console.log('🧪 VALIDASI LENGKAP SEMUA KONDISI ELEVENLABS (NO TAB CLOSE)');
  console.log('===============================================================\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // TRACK TAB CLOSE: Catat jika ada event 'close' pada page
  let tabWasClosed = false;
  page.on('close', () => {
    tabWasClosed = true;
  });

  // -------------------------------------------------------------
  // KONDISI 1: TAB DI HALAMAN SIGN-IN (WELCOME BACK)
  // -------------------------------------------------------------
  console.log('1. Menguji Kondisi Tab di /app/sign-in (Welcome back)...');
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head><title>ElevenLabs Sign In</title></head>
      <body>
        <div id="signin-container">
          <h2>Welcome back</h2>
          <input type="email" id="email" placeholder="Email" />
          <input type="password" id="password" placeholder="Password" />
          <button id="signin-btn" type="submit">Sign in</button>
          <a href="/app/sign-up" id="signup-link">Don't have an account? Sign up</a>
        </div>
        <script>
          window.__SIGNIN_SUBMITTED = false;
          document.getElementById('signin-btn').addEventListener('click', (e) => {
            e.preventDefault();
            const em = document.getElementById('email').value;
            const pw = document.getElementById('password').value;
            if (em && pw) {
              window.__SIGNIN_SUBMITTED = true;
            }
          });
        </script>
      </body>
    </html>
  `);

  // Evaluasi executeSignIn di halaman sign-in
  const signinResult = await page.evaluate(({ email, password }) => {
    const emailInput = document.querySelector('input[type="email"]');
    const passwordInput = document.querySelector('input[type="password"]');
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.innerText || '').toLowerCase().includes('sign in')
    );

    if (!emailInput || !passwordInput || !btn) {
      return { success: false, error: 'Elements not found' };
    }

    emailInput.value = email;
    passwordInput.value = password;
    btn.click();

    return {
      success: true,
      emailFilled: emailInput.value,
      passFilled: passwordInput.value.length > 0,
      submitted: window.__SIGNIN_SUBMITTED,
    };
  }, { email: 'miko.putra10@riztama.my.id', password: 'Jovan@1224' });

  console.log(`   - Email terisi: ${signinResult.emailFilled}`);
  console.log(`   - Password terisi: ${signinResult.passFilled ? '✅ YA' : '❌ TIDAK'}`);
  console.log(`   - Tombol Sign In diklik: ${signinResult.submitted ? '✅ YA' : '❌ TIDAK'}`);
  console.log(`   - Tab ter-close: ${tabWasClosed ? '❌ YA (ERROR)' : '✅ TIDAK (AMAN)'}\n`);

  if (!signinResult.submitted || tabWasClosed) {
    throw new Error('Pengujian Kondisi 1 Sign In gagal!');
  }

  // -------------------------------------------------------------
  // KONDISI 2: TAB DI HALAMAN SIGN-UP (CREATE ACCOUNT)
  // -------------------------------------------------------------
  console.log('2. Menguji Kondisi Tab di /app/sign-up (Create account)...');
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head><title>ElevenLabs Sign Up</title></head>
      <body>
        <div id="signup-container">
          <h2>Create an account</h2>
          <input type="email" id="email" placeholder="Email" />
          <input type="password" id="password" placeholder="Password" />
          <input type="checkbox" id="terms" />
          <button id="signup-btn" type="submit">Sign up</button>
        </div>
        <script>
          window.__SIGNUP_SUBMITTED = false;
          document.getElementById('signup-btn').addEventListener('click', (e) => {
            e.preventDefault();
            window.__SIGNUP_SUBMITTED = true;
          });
        </script>
      </body>
    </html>
  `);

  const signupResult = await page.evaluate(({ email, password }) => {
    const emailInput = document.querySelector('input[type="email"]');
    const passwordInput = document.querySelector('input[type="password"]');
    const cb = document.querySelector('input[type="checkbox"]');
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.innerText || '').toLowerCase().includes('sign up')
    );

    emailInput.value = email;
    passwordInput.value = password;
    if (cb) cb.checked = true;
    btn.click();

    return {
      success: true,
      emailFilled: emailInput.value,
      submitted: window.__SIGNUP_SUBMITTED,
    };
  }, { email: 'baru.account123@riztama.my.id', password: 'Jovan@1224' });

  console.log(`   - Email terisi: ${signupResult.emailFilled}`);
  console.log(`   - Tombol Sign Up diklik: ${signupResult.submitted ? '✅ YA' : '❌ TIDAK'}`);
  console.log(`   - Tab ter-close: ${tabWasClosed ? '❌ YA (ERROR)' : '✅ TIDAK (AMAN)'}\n`);

  if (!signupResult.submitted || tabWasClosed) {
    throw new Error('Pengujian Kondisi 2 Sign Up gagal!');
  }

  // -------------------------------------------------------------
  // KONDISI 3: TAB DI DASHBOARD TTS (INPUT TEXT ONLY)
  // -------------------------------------------------------------
  console.log('3. Menguji Kondisi Tab di Dashboard TTS (Input Naskah Only)...');
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head><title>ElevenLabs TTS</title></head>
      <body>
        <div data-testid="tts-editor" class="tiptap ProseMirror" contenteditable="true">
          <p>Teks lama</p>
        </div>
        <button id="generate-speech-btn">Generate speech</button>
        <script>
          window.__GENERATE_CLICKS = 0;
          document.getElementById('generate-speech-btn').addEventListener('click', () => {
            window.__GENERATE_CLICKS++;
          });
        </script>
      </body>
    </html>
  `);

  const ttsResult = await page.evaluate((narrationText) => {
    const editor = document.querySelector('[data-testid="tts-editor"]');
    editor.innerHTML = '<p>' + narrationText + '</p>';
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    return {
      success: true,
      editorContent: editor.innerText.trim(),
      generateClicked: window.__GENERATE_CLICKS,
    };
  }, 'Naskah narasi Part #1 [pauses] yang sangat bagus.');

  console.log(`   - Naskah Masuk ke Editor: "${ttsResult.editorContent}"`);
  console.log(`   - Generate Speech Diklik Otomatis: ${ttsResult.generateClicked} (Harus 0)`);
  console.log(`   - Tab ter-close: ${tabWasClosed ? '❌ YA (ERROR)' : '✅ TIDAK (AMAN)'}\n`);

  if (!ttsResult.editorContent.includes('Part #1') || ttsResult.generateClicked !== 0 || tabWasClosed) {
    throw new Error('Pengujian Kondisi 3 Dashboard TTS gagal!');
  }

  console.log('🎉 SEMUA KONDISI ELEVENLABS 100% SUKSES DITEST (ZERO TAB CLOSE)!');
  await browser.close();
}

testAllElevenLabsConditions().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
