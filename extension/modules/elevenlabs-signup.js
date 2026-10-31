// extension/modules/elevenlabs-signup.js
// Modul otomatisasi Sign Up, Post-Verification & Onboarding ElevenLabs
// Berjalan di dalam content script browser (DOM asli) pada https://elevenlabs.io/*

(function () {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Helper untuk memeriksa apakah elemen terlihat (visible) di layar
   */
  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
  }

  /**
   * Helper untuk trigger klik native lengkap (Pointer & Mouse events dengan koordinat realistis)
   * Penting untuk komponen React/Radix UI/Shadcn dialog & buttons
   */
  function triggerNativeClick(el) {
    simulateRealClick(el);
  }

  function simulateRealClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;

      const opts = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        detail: 1,
        screenX: clientX,
        screenY: clientY,
        clientX: clientX,
        clientY: clientY,
        button: 0,
        buttons: 1,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        width: 1,
        height: 1,
      };

      el.focus?.();
      el.dispatchEvent(new PointerEvent('pointerover', opts));
      el.dispatchEvent(new PointerEvent('pointerenter', opts));
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      // TUNGGAL: Hanya panggil .click(), JANGAN dispatchEvent('click') ganda
      if (typeof el.click === 'function') {
        el.click();
      } else {
        el.dispatchEvent(new MouseEvent('click', opts));
      }
    } catch (e) {
      el.click?.();
    }
  }

  /**
   * Helper untuk mengisi input controlled-component di React / Next.js
   */
  /**
   * Helper untuk mengisi input controlled-component di React / Next.js
   */
  function setReactInputValue(inputEl, value) {
    if (!inputEl) return;
    try {
      inputEl.disabled = false;
      inputEl.removeAttribute('disabled');
      inputEl.removeAttribute('readonly');
      inputEl.focus();

      // 1. Coba browser native execCommand ('insertText') - mensimulasikan ketikan/paste nyata pengguna
      try {
        inputEl.select();
        const success = document.execCommand('insertText', false, value);
        if (success && inputEl.value === value) {
          inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          return;
        }
      } catch (e) { }

      // 2. Fallback: Prototype setter descriptor + InputEvent + KeyboardEvent
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(inputEl, value);
      } else {
        inputEl.value = value;
      }

      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: value, inputType: 'insertText' }));
      inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value.slice(-1) }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.slice(-1) }));

      if (inputEl.value !== value) {
        inputEl.value = value;
        inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      }
    } catch (e) {
      console.warn('[setReactInputValue] Warning:', e);
      inputEl.value = value;
      inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
  }

  const ElevenLabsSignupModule = {
    name: 'elevenlabsSignup',
    isLoopRunning: false,

    init() {
      console.log('[ElevenLabsSignup] Modul otomatisasi ElevenLabs aktif di tab:', window.location.href);

      // Cek apakah ada flow auto-skip yang tersimpan di storage atau jika halaman adalah link verifikasi
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['elevenlabs_auto_flow'], (res) => {
          const flow = res?.elevenlabs_auto_flow;
          const isVerifyUrl =
            window.location.href.includes('mode=verifyEmail') ||
            window.location.search.includes('oobCode') ||
            window.location.pathname.includes('/action');
          const isTtsPath = (window.location.pathname || '').toLowerCase().includes('/speech-synthesis/text-to-speech');

          if (flow && flow.active) {
            const elapsed = Date.now() - (flow.startedAt || 0);
            if (elapsed < 120000) {
              if (flow.step === 'configure_tts' && isTtsPath) {
                console.log('[ElevenLabsSignup] 🎯 Halaman TTS terbuka pasca onboarding! Melanjutkan konfigurasi TTS...');
                this.finishTTSSetupOnPage({ email: flow.email });
              } else {
                console.log('[ElevenLabsSignup] 🔄 Melanjutkan flow verifikasi & onboarding otomatis dari storage...');
                this.executePostVerifyAndOnboarding(flow);
              }
            } else {
              console.log('[ElevenLabsSignup] Flow auto-onboarding expired (>2 menit), menghapus flag.');
              chrome.storage.local.remove(['elevenlabs_auto_flow']);
            }
          } else if (isVerifyUrl) {
            console.log('[ElevenLabsSignup] 🚀 Halaman verifikasi email terdeteksi langsung dari URL! Memulai auto-skip...');
            chrome.storage.local.set({
              elevenlabs_auto_flow: {
                active: true,
                email: '',
                password: 'Jovan@1224',
                startedAt: Date.now(),
              },
            });
            this.executePostVerifyAndOnboarding({ password: 'Jovan@1224' });
          }
        });
      }
    },

    /**
     * Cari elemen input email dengan berbagai selector fallback
     */
    findEmailInput() {
      const selectors = [
        'input[type="email"]',
        'input[autocomplete="email"]',
        'input[autocomplete="username"]',
        'input[name="email"]',
        'input[placeholder*="email" i]',
        'input[aria-label*="email" i]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && isElementVisible(el)) return el;
      }
      return null;
    },

    /**
     * Cari elemen input password dengan berbagai selector fallback
     */
    findPasswordInput() {
      const selectors = [
        'input[type="password"]',
        'input[autocomplete="new-password"]',
        'input[autocomplete="current-password"]',
        'input[name="password"]',
        'input[placeholder*="password" i]',
        'input[aria-label*="password" i]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && isElementVisible(el)) return el;
      }
      return null;
    },

    /**
     * Cari tombol submit "Sign up" spesifik (bukan Google/Apple)
     */
    findSubmitButton() {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find((btn) => {
        if (!isElementVisible(btn)) return false;
        const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        return (
          (txt === 'sign up' || txt === 'sign-up' || txt === 'create account' || txt.includes('sign up')) &&
          !txt.includes('google') &&
          !txt.includes('apple')
        );
      });
    },

    /**
     * Tunggu form ter-render (React hydration)
     */
    async waitForFormElements(maxWaitMs = 15000) {
      const startTime = Date.now();
      while (Date.now() - startTime < maxWaitMs) {
        const emailInput = this.findEmailInput();
        const passwordInput = this.findPasswordInput();
        if (emailInput && passwordInput) {
          return { emailInput, passwordInput };
        }
        // Jika akun lama masih aktif di browser dan redirect ke dashboard
        if (this.isDashboardReached() && !window.location.pathname.includes('/sign-up')) {
          console.warn('[ElevenLabsSignup] Sesi akun lama masih aktif di browser. Menjalankan Sign Out...');
          await this.executeSignOut();
          await sleep(1500);
          window.location.href = 'https://elevenlabs.io/app/sign-up';
          await sleep(2500);
        }
        await sleep(400);
      }
      throw new Error('Form signup ElevenLabs tidak ditemukan setelah 15 detik. Pastikan berada di halaman https://elevenlabs.io/app/sign-up.');
    },

    /**
     * Helper untuk mencentang checkbox jika ada di form signup
     */
    clickAllUncheckedCheckboxes() {
      try {
        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"], button[role="checkbox"]'));
        for (const cb of checkboxes) {
          if (cb.tagName.toLowerCase() === 'input' && !cb.checked) {
            cb.checked = true;
            cb.dispatchEvent(new Event('input', { bubbles: true }));
            cb.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (cb.getAttribute('role') === 'checkbox' && cb.getAttribute('aria-checked') !== 'true') {
            triggerNativeClick(cb);
          }
        }
      } catch (e) { }
    },

    /**
     * Jalankan proses otomatisasi signup awal
     */
    async executeSignup({ email, password }) {
      if (!email || !password) {
        throw new Error('Email dan password wajib disediakan untuk signup.');
      }

      console.log(`[ElevenLabsSignup] Memulai otomatisasi signup untuk email: ${email}`);

      // 1. Tunggu input email & password
      const { emailInput, passwordInput } = await this.waitForFormElements();
      console.log(`[ElevenLabsSignup] Form terdeteksi, mengisi data target: ${email}`);

      await sleep(300);

      // Pastikan field input tidak dalam status disabled
      emailInput.disabled = false;
      passwordInput.disabled = false;

      // 2. Isi email target
      setReactInputValue(emailInput, email);
      await sleep(300);

      if (emailInput.value !== email) {
        console.warn(`[ElevenLabsSignup] Email mismatch: '${emailInput.value}' vs target '${email}'. Memperbaiki paksa...`);
        setReactInputValue(emailInput, email);
      }

      // 3. Isi password target
      setReactInputValue(passwordInput, password);
      await sleep(400);

      if (passwordInput.value !== password) {
        console.warn('[ElevenLabsSignup] Password mismatch, memperbaiki paksa...');
        setReactInputValue(passwordInput, password);
      }

      console.log(`[ElevenLabsSignup] Verifikasi form: email=${emailInput.value}, passLength=${passwordInput.value.length}`);

      // 3b. Centang checkbox persetujuan jika ada di form signup
      this.clickAllUncheckedCheckboxes();
      await sleep(300);

      // 4. Cari tombol Sign up
      let submitBtn = this.findSubmitButton();
      if (!submitBtn) {
        throw new Error('Tombol "Sign up" tidak ditemukan di halaman.');
      }

      // 5. Tunggu tombol enable jika masih disabled
      let waitDisabledCount = 0;
      while (submitBtn && submitBtn.disabled && waitDisabledCount < 20) {
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
        this.clickAllUncheckedCheckboxes();
        await sleep(300);
        waitDisabledCount++;
        submitBtn = this.findSubmitButton();
      }

      if (submitBtn && submitBtn.disabled) {
        console.warn('[ElevenLabsSignup] Tombol masih disabled, mencoba klik paksa...');
        submitBtn.disabled = false;
      }

      console.log('[ElevenLabsSignup] Mengklik tombol Sign up spesifik:', submitBtn);
      triggerNativeClick(submitBtn);
      try { submitBtn.click(); } catch (e) { }

      try {
        passwordInput.focus();
        passwordInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      } catch (e) { }

      try {
        const formEl = document.querySelector('form');
        if (formEl && typeof formEl.requestSubmit === 'function') formEl.requestSubmit();
      } catch (e) { }

      // 6. Pantau indikasi pengiriman / verifikasi
      let statusResult = {
        success: true,
        email,
        message: 'Tombol Sign up berhasil diklik. Permintaan verifikasi terkirim.',
        details: 'Menunggu konfirmasi verifikasi email dari ElevenLabs.',
      };

      const monitorStart = Date.now();
      while (Date.now() - monitorStart < 12000) {
        await sleep(600);

        const errorNodes = document.querySelectorAll('[role="alert"], .tw-text-red-500, .text-danger, .error-message');
        for (const err of errorNodes) {
          const errTxt = err.innerText?.trim();
          if (errTxt && errTxt.length > 3 && !errTxt.toLowerCase().includes('password')) {
            if (
              errTxt.toLowerCase().includes('already exists') ||
              errTxt.toLowerCase().includes('already registered') ||
              errTxt.toLowerCase().includes('user already exists')
            ) {
              console.log('[ElevenLabsSignup] ℹ️ Akun ini sudah terdaftar sebelumnya di ElevenLabs.');
              return { success: false, alreadyExists: true, error: errTxt };
            }
            throw new Error(`ElevenLabs Error: ${errTxt}`);
          }
        }

        const bodyText = document.body.innerText || '';
        if (
          bodyText.toLowerCase().includes('verify your email') ||
          bodyText.toLowerCase().includes('check your inbox') ||
          bodyText.toLowerCase().includes('sent an email') ||
          bodyText.toLowerCase().includes('we sent a verification') ||
          window.location.href.includes('verify') ||
          window.location.href.includes('confirm')
        ) {
          console.log('[ElevenLabsSignup] ✅ Halaman konfirmasi verifikasi email terdeteksi!');
          statusResult.message = `Berhasil mendaftar! Link verifikasi telah dikirim ke ${email}.`;
          statusResult.verifiedScreen = true;
          break;
        }
      }

      return statusResult;
    },

    /**
     * Cari tombol "Sign in" spesifik pada form login
     */
    findSignInButton() {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find((btn) => {
        if (!isElementVisible(btn)) return false;
        const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        return (
          (txt === 'sign in' || txt === 'sign-in' || txt === 'log in' || txt === 'login') &&
          !txt.includes('google') &&
          !txt.includes('apple') &&
          !txt.includes('sso')
        );
      });
    },

    /**
     * Jalankan proses otomatisasi login (Sign In)
     */
    async executeSignIn({ email, password }) {
      if (!email || !password) {
        throw new Error('Email dan password wajib disediakan untuk sign in.');
      }

      console.log(`[ElevenLabsSignIn] 🔑 Memulai otomatisasi login untuk email: ${email}`);

      // 1. Tunggu input email & password
      const { emailInput, passwordInput } = await this.waitForFormElements(10000);
      emailInput.disabled = false;
      passwordInput.disabled = false;

      // 2. Isi email target
      setReactInputValue(emailInput, email);
      await sleep(300);

      // 3. Isi password target
      setReactInputValue(passwordInput, password);
      await sleep(400);

      // 4. Cari tombol Sign in
      let submitBtn = this.findSignInButton() || document.querySelector('button[type="submit"]');
      if (!submitBtn) {
        throw new Error('Tombol "Sign in" tidak ditemukan di halaman.');
      }

      console.log('[ElevenLabsSignIn] 🎯 Mengklik tombol Sign in:', submitBtn);
      triggerNativeClick(submitBtn);
      submitBtn.click();

      // Pantau respon login selama 4.5 detik: apakah redirect berhasil atau muncul error "No user is found"
      const startTime = Date.now();
      let detectedError = null;

      while (Date.now() - startTime < 4500) {
        await sleep(400);

        // A. Cek apakah halaman sudah berpindah URL (berhasil login)
        const currentPath = window.location.pathname;
        if (
          !currentPath.includes('/sign-in') &&
          !currentPath.includes('/login') &&
          (currentPath.includes('/app') || currentPath.includes('/speech') || currentPath.includes('/onboarding'))
        ) {
          console.log('[ElevenLabsSignIn] ✅ Login berhasil! URL berpindah ke:', window.location.href);
          return { success: true, message: 'Login berhasil, sesi aktif.' };
        }

        // B. Cek pesan error "No user is found with these credentials"
        const bodyText = (document.body?.innerText || '').toLowerCase();
        if (
          bodyText.includes('no user is found') ||
          bodyText.includes('user not found') ||
          bodyText.includes('no account found') ||
          bodyText.includes('invalid credentials') ||
          bodyText.includes('incorrect email or password') ||
          bodyText.includes('wrong password')
        ) {
          detectedError = 'No user is found with these credentials';
          console.warn('[ElevenLabsSignIn] ⚠️ Akun tidak ditemukan di ElevenLabs:', detectedError);
          break;
        }

        // Cek elemen alert / error
        const alertEls = Array.from(
          document.querySelectorAll('[role="alert"], [class*="red"], [class*="error"], .text-danger')
        );
        for (const el of alertEls) {
          if (!isElementVisible(el)) continue;
          const txt = (el.innerText || el.textContent || '').trim();
          if (
            txt &&
            (txt.toLowerCase().includes('no user') ||
              txt.toLowerCase().includes('credential') ||
              txt.toLowerCase().includes('not found') ||
              txt.toLowerCase().includes('invalid'))
          ) {
            detectedError = txt;
            break;
          }
        }
        if (detectedError) break;
      }

      if (detectedError) {
        return {
          success: false,
          userNotFound: true,
          error: detectedError,
          message: 'Akun tidak ditemukan di sistem ElevenLabs.',
        };
      }

      // Jika URL masih di /sign-in setelah 4.5 detik
      if (window.location.pathname.includes('/sign-in')) {
        return {
          success: false,
          userNotFound: true,
          error: 'Login tidak berpindah halaman (akun kemungkinan belum terdaftar).',
        };
      }

      return {
        success: true,
        email,
        message: 'Tombol Sign in berhasil diklik. Menunggu pengalihan sesi login...',
      };
    },

    /**
     * Broadcast status langkah flow ke Side Panel / Background
     */
    reportStep(step, message) {
      console.log(`[ElevenLabsAutoFlow] [${step}] ${message}`);
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          action: 'ELEVENLABS_FLOW_STEP',
          payload: { step, message },
        }).catch(() => { });
      }
    },

    /**
    /**
     * Cek apakah browser sudah berada di halaman Text-to-Speech aktif dengan editor siap pakai
     */
    isTTSDashboardReached() {
      const path = window.location.pathname;
      const isTTS = path.includes('/speech-synthesis') || path.includes('/text-to-speech');
      const hasEditor = !!document.querySelector('textarea, [contenteditable="true"], [data-testid="tts-editor"]');
      const hasModelOrVoice = !!document.querySelector('[data-testid="tts-model-selector"], [data-testid="tts-voice-selector"]');
      const hasGenerateBtn = !!this.findGenerateSpeechButton();
      return isTTS && (hasEditor || hasModelOrVoice || hasGenerateBtn);
    },

    /**
     * Memeriksa secara ketat apakah browser sudah mencapai Dashboard utama ElevenLabs.
     * PERSIS IDENTIK DENGAN CAMOUFOX: is_dashboard_reached(page) di camoufox/elevenlabs/signup.py
     * PENTING: Jangan return True jika masih di /sign-in, /sign-up, /action, /onboarding,
     * atau jika masih ada modal 'Email Verification' / input password.
     */
    isDashboardReached() {
      try {
        const path = (window.location.pathname || '').toLowerCase();
        const fullUrl = (window.location.href || '').toLowerCase();

        // Jangan pernah anggap dashboard jika masih berada di halaman autentikasi/onboarding
        const authPaths = ['/sign-in', '/sign-up', '/login', '/action', '/onboarding'];
        if (authPaths.some((ap) => path.includes(ap) || fullUrl.includes(ap))) {
          return false;
        }

        const body = (document.body?.innerText || '').toLowerCase();

        // Jika dialog modal email verification atau form sign in masih ada
        if (body.includes('email verification') || body.includes('welcome back') || body.includes('almost there')) {
          return false;
        }

        // Jika masih ada input password yang terlihat
        const passInputs = Array.from(document.querySelectorAll('input[type="password"]'));
        for (const inp of passInputs) {
          if (isElementVisible(inp)) {
            return false;
          }
        }

        // Rute dashboard ElevenLabs yang sah
        const dashboardPaths = [
          '/app/speech-synthesis',
          '/app/text-to-speech',
          '/app/voices',
          '/app/voice-lab',
          '/app/overview',
          '/app/home',
          '/app/projects',
        ];

        const matchesPath = dashboardPaths.some((dp) => path.startsWith(dp)) || path === '/app' || path === '/app/';
        const hasUserMenu = Boolean(document.querySelector('button[data-testid="user-menu-button"], button[aria-label*="profile" i]'));
        const hasTtsEditor = Boolean(document.querySelector('textarea, [contenteditable="true"], [data-testid="tts-editor"]'));
        const hasHeading = body.includes('what would you like to create');

        return matchesPath && (hasUserMenu || hasTtsEditor || hasHeading);
      } catch (e) {
        return false;
      }
    },

    /**
     * Langkah 1: Cek dialog modal pop-up "Email Verification" ("Almost there! Please sign in once more...")
     * Persis seperti yang tampil pada screenshot pengguna & Camoufox:
     * - Target: div[role="dialog"] button:has-text("Continue"), div[aria-modal="true"] button:has-text("Continue"), button:has-text("Continue")
     * - Tutup jika ada tombol X / Close
     */
    async handleEmailVerificationModal() {
      const bodyText = (document.body?.innerText || '').toLowerCase();
      if (!bodyText.includes('almost there') && !bodyText.includes('email verification')) {
        return false;
      }

      const modalDialog = document.querySelector('div[role="dialog"], div[aria-modal="true"], [data-state="open"]');
      const root = modalDialog || document;
      const buttons = Array.from(root.querySelectorAll('button')).filter(isElementVisible);

      const modalContinue = buttons.find((b) => {
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        return txt === 'continue' || txt.startsWith('continue');
      });

      if (modalContinue) {
        console.log('[ElevenLabsOnboarding] Modal dialog "Email Verification" terdeteksi! Mengklik tombol Continue...');
        this.reportStep('verify', 'Modal Email Verification terdeteksi. Mengklik Continue...');
        triggerNativeClick(modalContinue);
        try { modalContinue.click(); } catch (e) { }
        await sleep(1500);
        return true;
      }

      // Tutup jika ada tombol X / Close
      const modalClose = buttons.find((b) => {
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        return aria.includes('close') || aria.includes('dismiss') || txt === '✕' || txt === 'x' || txt === 'close';
      });

      if (modalClose) {
        console.log('[ElevenLabsOnboarding] Menutup modal dengan tombol close...');
        triggerNativeClick(modalClose);
        try { modalClose.click(); } catch (e) { }
        await sleep(1000);
        return true;
      }

      return false;
    },

    /**
     * Langkah 2: Cek apakah ada form Sign In / Password ("Welcome back")
     * Persis seperti Camoufox:
     * - pass_inputs = page.locator('input[type="password"]')
     * - email_inputs = page.locator('input[type="email"], input[name="email"]')
     * - button[type="submit"] filter has_text("Sign in") filter has_not_text("Google") filter has_not_text("Apple")
     */
    async handleSignInForm(email, password) {
      const passInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(isElementVisible);
      if (passInputs.length === 0) return false;

      console.log('[ElevenLabsOnboarding] Form Sign In ("Welcome back") terdeteksi...');
      this.reportStep('login', 'Form Sign In terdeteksi, mengisi kredensial...');

      const emailInputs = Array.from(document.querySelectorAll('input[type="email"], input[name="email"]')).filter(isElementVisible);
      if (emailInputs.length > 0) {
        const curVal = emailInputs[0].value || '';
        if (!curVal || (email && curVal !== email)) {
          if (email) setReactInputValue(emailInputs[0], email);
          await sleep(300);
        }
      }

      const passVal = password || 'Jovan@1224';
      setReactInputValue(passInputs[0], passVal);
      await sleep(300);

      // Cari tombol Sign In spesifik (Bukan login Google atau Apple)
      const allButtons = Array.from(document.querySelectorAll('button[type="submit"], button')).filter(isElementVisible);
      let signInBtn = allButtons.find((b) => {
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        const isGoogleOrApple = txt.includes('google') || txt.includes('apple');
        return !isGoogleOrApple && (txt === 'sign in' || txt.startsWith('sign in'));
      });

      if (!signInBtn) {
        signInBtn = allButtons.find((b) => {
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          const isGoogleOrApple = txt.includes('google') || txt.includes('apple');
          return !isGoogleOrApple && (txt === 'log in' || txt.startsWith('log in') || b.type === 'submit');
        });
      }

      if (signInBtn && !signInBtn.disabled && signInBtn.getAttribute('aria-disabled') !== 'true') {
        const now = Date.now();
        if (this.lastSignInClick && now - this.lastSignInClick < 3500) {
          console.log('[ElevenLabsOnboarding] Menunggu respons Sign In sebelumnya...');
          return true;
        }
        this.lastSignInClick = now;
        console.log('[ElevenLabsOnboarding] Mengklik tombol Sign In spesifik:', signInBtn);
        this.reportStep('login', `Mengklik tombol Sign In untuk ${email || 'akun'}...`);
        triggerNativeClick(signInBtn);
        try { signInBtn.click(); } catch (e) { }
        await sleep(2000);
        return true;
      }

      return true;
    },

    /**
     * Langkah 3: Cek Layar Onboarding "Choose your platform"
     * Persis seperti Camoufox:
     * - creative_card = page.locator('text="ElevenCreative"').first
     * - continue_btn = page.locator('button:has-text("Continue"), [role="button"]:has-text("Continue")').first
     */
    async handleChoosePlatform() {
      const bodyText = (document.body?.innerText || '').toLowerCase();
      if (!bodyText.includes('choose your platform') && !bodyText.includes('switch between platforms')) {
        return false;
      }

      console.log('[ElevenLabsOnboarding] Layar "Choose your platform" terdeteksi! Memilih ElevenCreative...');
      this.reportStep('onboarding', 'Memilih platform ElevenCreative...');

      const allEls = Array.from(document.querySelectorAll('div, button, [role="button"], section, article')).filter(isElementVisible);
      const creativeCard = allEls.find((el) => {
        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        return txt.includes('elevencreative');
      });

      if (creativeCard) {
        triggerNativeClick(creativeCard);
        try { creativeCard.click(); } catch (e) { }
        await sleep(500);
      }

      const allButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(isElementVisible);
      const continueBtn = allButtons.find((b) => {
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        return txt === 'continue' || txt.startsWith('continue');
      });

      if (continueBtn) {
        triggerNativeClick(continueBtn);
        try { continueBtn.click(); } catch (e) { }
        await sleep(2000);
        return true;
      }

      return !!creativeCard;
    },

    /**
     * Langkah 4: Cek Layar Onboarding "Help us personalize your experience" (Konfirmasi Umur 18+)
     * Persis seperti Camoufox:
     * - adult_input = page.locator('input[name="adult"]').first
     * - adult_btn = page.locator('button[role="checkbox"], [role="checkbox"]').first (aria-checked != "true")
     * - next_btn = page.locator('button[type="submit"], button:has-text("Next")').filter(has_not_text="Google").first
     */
    async handlePersonalizeExperience() {
      const bodyText = (document.body?.innerText || '').toLowerCase();
      const adultInput = document.querySelector('input[name="adult"]');
      const isPersonalize =
        bodyText.includes('personalize your experience') ||
        bodyText.includes('18 years old') ||
        bodyText.includes('reached the age of 18') ||
        Boolean(adultInput);

      if (!isPersonalize) return false;

      console.log('[ElevenLabsOnboarding] Layar konfirmasi umur 18 tahun terdeteksi! Mencentang checkbox...');
      this.reportStep('onboarding', 'Mencentang konfirmasi umur 18 tahun...');

      // 1. Centang native input jika ada
      if (adultInput) {
        try {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
          if (setter) setter.call(adultInput, true);
          else adultInput.checked = true;
          adultInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          adultInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        } catch (e) { }
      }

      // 2. Centang custom ARIA checkbox
      const adultBtn = document.querySelector('button[role="checkbox"], [role="checkbox"]');
      if (adultBtn && isElementVisible(adultBtn)) {
        const ariaChecked = adultBtn.getAttribute('aria-checked');
        if (ariaChecked !== 'true') {
          triggerNativeClick(adultBtn);
          try { adultBtn.click(); } catch (e) { }
          const lbl = adultBtn.closest('label');
          if (lbl) {
            triggerNativeClick(lbl);
            try { lbl.click(); } catch (e) { }
          }
          await sleep(400);
        }
      }

      // 3. Klik tombol Next
      const allButtons = Array.from(document.querySelectorAll('button[type="submit"], button')).filter(isElementVisible);
      const nextBtn = allButtons.find((b) => {
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        const isGoogleOrApple = txt.includes('google') || txt.includes('apple');
        return !isGoogleOrApple && (txt === 'next' || txt.startsWith('next') || txt === 'continue' || txt.startsWith('continue') || b.type === 'submit');
      });

      if (nextBtn) {
        console.log('[ElevenLabsOnboarding] Mengklik tombol Next 18+:', nextBtn);
        triggerNativeClick(nextBtn);
        try { nextBtn.click(); } catch (e) { }
        await sleep(2000);
        return true;
      }

      return true;
    },

    /**
     * Langkah 5: Cek jika onboarding mengharuskan memilih opsi kuesioner pertama
     * Persis seperti Camoufox:
     * main [data-state="unchecked"], main [aria-pressed="false"], main [role="radio"][aria-checked="false"], main input[type="radio"]:not(:checked)
     */
    async handleSurveyOption() {
      const surveyOption = document.querySelector(
        'main [data-state="unchecked"], main [aria-pressed="false"], main [role="radio"][aria-checked="false"], main input[type="radio"]:not(:checked)'
      );
      if (surveyOption && isElementVisible(surveyOption)) {
        console.log('[ElevenLabsOnboarding] Memilih opsi kuesioner pertama untuk melanjutkan...');
        triggerNativeClick(surveyOption);
        try { surveyOption.click(); } catch (e) { }
        await sleep(500);
        return true;
      }
      return false;
    },

    /**
     * Langkah 6: Cek Tombol "Skip" / "Explore on my own" / "Maybe later"
     * Persis seperti Camoufox list selector:
     * - button:has-text("Skip")
     * - button:has-text("Skip for now")
     * - button:has-text("Explore on my own")
     * - button:has-text("Maybe later")
     * - button:has-text("Not now")
     * - button:has-text("Got it")
     * - button:has-text("Continue with free")
     * - button:has-text("Start with free")
     */
    async handleSkipButtons() {
      const skipTargets = [
        'skip',
        'skip for now',
        'explore on my own',
        'maybe later',
        'not now',
        'got it',
        'continue with free',
        'start with free',
      ];
      const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a.btn')).filter(isElementVisible);

      for (const target of skipTargets) {
        const btn = allButtons.find((b) => {
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          return txt === target || txt.startsWith(target);
        });
        if (btn) {
          const btnTxt = (btn.innerText || btn.textContent || '').trim();
          console.log(`[ElevenLabsOnboarding] Mengklik tombol lewati: '${btnTxt}'...`);
          this.reportStep('onboarding', `Mengklik tombol lewati: ${btnTxt}...`);
          triggerNativeClick(btn);
          try { btn.click(); } catch (e) { }
          await sleep(1500);
          return true;
        }
      }
      return false;
    },

    /**
     * Langkah 7: Cek Tombol "Continue" / "Next" umum jika aktif
     * Persis seperti Camoufox:
     * button:has-text("Continue"), button:has-text("Next") filter has_not_text("Google")
     * btn_txt in ["continue", "next", "done", "finish", "get started"]
     */
    async handleGenericContinue() {
      const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a.btn')).filter(isElementVisible);
      const continueBtn = allButtons.find((b) => {
        if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        if (txt.includes('google') || txt.includes('apple')) return false;
        return ['continue', 'next', 'done', 'finish', 'get started'].includes(txt);
      });

      if (continueBtn) {
        const btnTxt = (continueBtn.innerText || continueBtn.textContent || '').trim();
        console.log(`[ElevenLabsOnboarding] Mengklik tombol lanjut: '${btnTxt}'...`);
        this.reportStep('onboarding', `Mengklik tombol lanjut: ${btnTxt}...`);
        triggerNativeClick(continueBtn);
        try { continueBtn.click(); } catch (e) { }
        await sleep(2000);
        return true;
      }
      return false;
    },

    /**
     * LOOP LENGKAP ONBOARDING & SIGN IN ELEVENLABS
     * PERSIS IDENTIK DENGAN CAMOUFOX: handle_onboarding_and_signin di camoufox/elevenlabs/signup.py
     * Menjalankan siklus:
     * 0. isDashboardReached() -> True
     * 1. Modal "Email Verification" / "Almost there! Please sign in once more..." -> Klik Continue / Close
     * 2. Form Sign In ("Welcome back") -> Isi password & submit non-Google non-Apple
     * 3. Layar "Choose your platform" -> Klik ElevenCreative -> Continue
     * 4. Layar "Help us personalize your experience" -> Check 18+ adult -> Next
     * 5. Opsi kuesioner pertama jika ada
     * 6. Tombol Skip / Explore on my own / Maybe later / dll.
     * 7. Tombol Continue / Next umum jika aktif
     */
    async handleOnboardingAndSignIn({ email, password, maxDurationSeconds = 90 } = {}) {
      console.log('\n=================================================================');
      console.log('  [ONBOARDING] MENYELESAIKAN ONBOARDING & SIGN IN ELEVENLABS');
      console.log('=================================================================');

      const startTime = Date.now();
      const maxMs = maxDurationSeconds * 1000;

      while (Date.now() - startTime < maxMs) {
        await sleep(1500);

        // 0. Cek apakah sudah resmi mendarat di dashboard
        if (this.isDashboardReached()) {
          console.log('[✓] DASHBOARD UTAMA ELEVENLABS BERHASIL DICAPAI!');
          this.reportStep('dashboard', '🎉 Dashboard utama ElevenLabs berhasil dicapai!');
          return true;
        }

        // 1. Cek dialog modal pop-up "Email Verification" ("Almost there! Please sign in once more...")
        const didModal = await this.handleEmailVerificationModal();
        if (didModal) continue;

        // 2. Cek apakah ada form Sign In / Password ("Welcome back")
        const didSignIn = await this.handleSignInForm(email, password);
        if (didSignIn) continue;

        // 3. Cek Layar Onboarding: "Choose your platform"
        const didPlatform = await this.handleChoosePlatform();
        if (didPlatform) continue;

        // 4. Cek Layar Onboarding: "Help us personalize your experience" (Konfirmasi Umur 18+)
        const didAge = await this.handlePersonalizeExperience();
        if (didAge) continue;

        // 5. Cek jika onboarding mengharuskan memilih opsi kuesioner pertama
        await this.handleSurveyOption();

        // 6. Cek Tombol "Skip" / "Explore on my own" / "Maybe later"
        const didSkip = await this.handleSkipButtons();
        if (didSkip) continue;

        // 7. Cek Tombol "Continue" / "Next" umum jika aktif
        const didGeneric = await this.handleGenericContinue();
        if (didGeneric) continue;
      }

      return this.isDashboardReached();
    },

    /**
     * Lakukan Sign Out akun ElevenLabs secara native via UI menu dengan bener-bener mengklik tombol logout
     * Alur:
     * 1. Tutup / netralkan semua dialog modal limit atau upgrade yang menghalangi layar
     * 2. Cari tombol avatar / profil (data-testid="user-menu-button", aria-label="Your profile", dsb.)
     * 3. Buka dropdown menu Radix UI
     * 4. Cari item "Sign out" / "Log out" di dalam menu dan klik secara native
     * 5. Tangani konfirmasi jika muncul
     * 6. Tunggu navigasi ke sign-in / login selesai
     */
    async executeSignOut() {
      console.log('[ElevenLabsSignup] 🚪 Memulai proses Sign Out akun ElevenLabs secara native (klik tombol logout)...');
      this.reportStep('signout', 'Melakukan Sign Out akun ElevenLabs (mengklik tombol logout)...');

      const currentUrl = window.location.href;
      if (currentUrl.includes('/sign-in') || currentUrl.includes('/login') || currentUrl.includes('/sign-up')) {
        console.log('[ElevenLabsSignup] Sudah di halaman sign-in/login, tidak perlu logout lagi.');
        return { success: true, method: 'already_logged_out' };
      }

      // 1. Dismiss / netralkan modal dialog upgrade atau limit yang menutupi layar
      try {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        await sleep(200);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        await sleep(200);

        const dismissButtons = Array.from(document.querySelectorAll(
          'button[aria-label*="close" i], button[aria-label*="dismiss" i], button:has-text("Remind Me Later"), button:has-text("Close"), button:has-text("✕")'
        ));
        for (const btn of dismissButtons) {
          if (isElementVisible(btn)) {
            triggerNativeClick(btn);
            await sleep(150);
          }
        }

        // Netralkan pointer-events pada modal atau backdrop yang tersisa
        document.body.style.pointerEvents = 'auto';
        const overlays = Array.from(document.querySelectorAll('[role="dialog"], [data-state="open"], .fixed.inset-0'));
        for (const o of overlays) {
          const txt = (o.textContent || '').toLowerCase();
          if (txt.includes('upgrade') || txt.includes('credits') || txt.includes('first month') || txt.includes('subscribe')) {
            o.style.pointerEvents = 'none';
          }
        }
      } catch (e) { }

      await sleep(400);

      // 2. Cari tombol avatar / profil di UI
      try {
        let profileBtn = document.querySelector('button[data-testid="user-menu-button"], button[aria-label="Your profile"]');
        if (!profileBtn) {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(isElementVisible);
          profileBtn = buttons.find((b) => {
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            const tid = (b.getAttribute('data-testid') || '').toLowerCase();
            return (
              aria === 'your profile' ||
              tid === 'user-menu-button' ||
              aria.includes('profile') ||
              aria.includes('account') ||
              tid.includes('user-menu') ||
              tid.includes('user_menu') ||
              tid.includes('profile')
            );
          });
        }

        // Fallback: tombol avatar di header / topbar paling kanan
        if (!profileBtn) {
          const header = document.querySelector('header') || document.body;
          const allHeaderBtns = Array.from(header.querySelectorAll('button, [role="button"]')).filter(isElementVisible);
          if (allHeaderBtns.length > 0) {
            profileBtn = allHeaderBtns[allHeaderBtns.length - 1];
          }
        }

        if (profileBtn) {
          console.log('[ElevenLabsSignup] 👤 Tombol avatar ditemukan, mengklik untuk membuka menu...', profileBtn);
          const avatarTarget = profileBtn.closest('button, [role="button"]') || profileBtn;
          triggerNativeClick(avatarTarget);
          avatarTarget.click?.();

          // 3. Tunggu hingga dropdown menu Radix UI selesai me-render opsi Sign Out
          let signOutBtn = null;
          for (let wait = 0; wait < 15; wait++) {
            await sleep(200);
            const menuItems = Array.from(
              document.querySelectorAll(
                '[role="menuitem"], [data-radix-collection-item], [role="menu"] button, [role="menu"] a, button, a'
              )
            ).filter(isElementVisible);

            signOutBtn = menuItems.find((el) => {
              const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
              return (
                txt === 'sign out' ||
                txt === 'log out' ||
                txt.includes('sign out') ||
                txt.includes('log out') ||
                txt === 'keluar'
              );
            });

            if (!signOutBtn) {
              const allPossible = Array.from(
                document.querySelectorAll('[data-radix-popper-content-wrapper] *, [role="menu"] *, [data-radix-menu-content] *')
              ).filter(isElementVisible);
              signOutBtn = allPossible.find((el) => {
                const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                return (txt === 'sign out' || txt === 'log out' || txt.includes('sign out') || txt.includes('log out')) && el.children.length <= 1;
              });
            }

            if (signOutBtn) break;
          }

          if (signOutBtn) {
            console.log('[ElevenLabsSignup] 🎯 Tombol Sign out ditemukan di dropdown menu! Mengklik tombol Logout...', signOutBtn);
            const clickTarget = signOutBtn.closest('[role="menuitem"], [data-radix-collection-item], button, a') || signOutBtn;
            triggerNativeClick(clickTarget);
            clickTarget.click?.();
            await sleep(1500);

            // Cek jika muncul dialog konfirmasi "Are you sure you want to log out?"
            const confirmBtn = Array.from(document.querySelectorAll('[role="dialog"] button, div[aria-modal="true"] button')).find((b) => {
              const txt = (b.textContent || '').toLowerCase();
              return txt.includes('sign out') || txt.includes('log out') || txt.includes('confirm') || txt.includes('yes');
            });
            if (confirmBtn) {
              console.log('[ElevenLabsSignup] Mengonfirmasi dialog logout...');
              triggerNativeClick(confirmBtn);
              confirmBtn.click?.();
              await sleep(1500);
            }

            // Tunggu pengalihan ke /app/sign-in
            for (let i = 0; i < 15; i++) {
              await sleep(400);
              const url = window.location.href;
              if (url.includes('/sign-in') || url.includes('/login') || url.includes('/sign-up')) {
                console.log('[ElevenLabsSignup] 🎉 Berhasil Sign Out via UI click! Halaman sekarang:', url);
                return { success: true, method: 'ui_menu_click' };
              }
            }

            return { success: true, method: 'ui_menu_click' };
          } else {
            console.warn('[ElevenLabsSignup] Opsi "Sign out" tidak ditemukan di dalam menu dropdown yang terbuka.');
          }
        } else {
          console.warn('[ElevenLabsSignup] Tombol avatar / profile tidak teridentifikasi di halaman.');
        }
      } catch (uiErr) {
        console.warn('[ElevenLabsSignup] Error saat klik UI logout:', uiErr.message);
      }

      // Fallback pengamanan jika klik UI belum berhasil
      console.log('[ElevenLabsSignup] Mengarahkan ke https://elevenlabs.io/app/sign-out sebagai pengaman...');
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) { }

      window.location.href = 'https://elevenlabs.io/app/sign-out';
      await sleep(2500);
      return { success: true, method: 'url_redirect' };
    },

    /**
     * Eksekusi alur post-verifikasi & lewati onboarding sampai masuk ke Dashboard
     */
    /**
     * Eksekusi alur post-verifikasi & onboarding sampai masuk ke Page TTS
     * PATOKAN 100% IDENTIK CAMOUFOX:
     * 1. Jalankan handleOnboardingAndSignIn()
     * 2. Setelah dashboard tercapai:
     *    Pastikan halaman terakhir mendarat di https://elevenlabs.io/app/speech-synthesis/text-to-speech
     * 3. Konfigurasi TTS (Model Eleven v3 -> Voice Dany Saputra -> Stability Robust)
     */
    async executePostVerifyAndOnboarding({ email, password }) {
      if (this.isLoopRunning && this._loopStartTime && Date.now() - this._loopStartTime < 25000) {
        console.log('[ElevenLabsOnboarding] Loop auto-skip sudah berjalan aktif di tab ini.');
        return { running: true };
      }

      this.isLoopRunning = true;
      this._loopStartTime = Date.now();
      const pass = password || 'Jovan@1224';

      try {
        const completed = await this.handleOnboardingAndSignIn({ email, password: pass, maxDurationSeconds: 90 });

        if (completed) {
          console.log('\n=================================================================');
          console.log('  [✓✓✓] ONBOARDING SUKSES - MEMULAI NAVIGASI & KONFIGURASI TTS!');
          console.log('=================================================================');
          this.reportStep('dashboard', '🎉 Onboarding selesai! Memastikan mendarat di halaman Text-to-Speech...');

          const currentPath = (window.location.pathname || '').toLowerCase();
          const targetTtsUrl = 'https://elevenlabs.io/app/speech-synthesis/text-to-speech';

          // Pastikan halaman terakhir mendarat di https://elevenlabs.io/app/speech-synthesis/text-to-speech
          if (!currentPath.includes('/speech-synthesis/text-to-speech')) {
            console.log(`[*] Menavigasi ke halaman utama Text-to-Speech (${targetTtsUrl})...`);
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
              chrome.storage.local.set({
                elevenlabs_auto_flow: {
                  active: true,
                  step: 'configure_tts',
                  email,
                  password: pass,
                  startedAt: Date.now(),
                },
              });
            }
            window.location.href = targetTtsUrl;
            return { success: true, navigatingToTTS: true };
          }

          // Jika tab sudah berada di /speech-synthesis/text-to-speech
          await this.finishTTSSetupOnPage({ email });
          this.isLoopRunning = false;
          return { success: true, ttsConfigured: true, dashboardUrl: window.location.href };
        } else {
          console.warn('[ElevenLabsOnboarding] Onboarding belum mencapai dashboard setelah batas waktu.');
          this.isLoopRunning = false;
          return { success: false, error: 'Batas waktu onboarding habis tanpa mencapai Dashboard.' };
        }
      } catch (err) {
        console.error('[ElevenLabsOnboarding] Error saat onboarding flow:', err);
        this.isLoopRunning = false;
        throw err;
      }
    },

    /**
     * Konfigurasi TTS setelah halaman Text-to-Speech terbuka sempurna
     * (Sama persis seperti configure_tts_dashboard di Camoufox)
     */
    async finishTTSSetupOnPage({ email } = {}) {
      console.log('[ElevenLabsTTS] 🎙️ Mempersiapkan halaman Text-to-Speech & membersihkan modal promo...');
      this.reportStep('tts_config', 'Menyiapkan halaman Text-to-Speech...');

      await sleep(2000);
      this.dismissAllModals();

      // Tunggu elemen kontrol TTS ter-mount dan siap diinteraksikan
      for (let w = 0; w < 12; w++) {
        if (
          this.isTTSDashboardReached() ||
          document.querySelector('[data-testid="tts-model-selector"], [data-testid="tts-voice-selector"], textarea, [contenteditable="true"]')
        ) {
          break;
        }
        await sleep(1000);
        this.dismissAllModals();
      }

      console.log('[ElevenLabsTTS] 🎛️ Mengonfigurasi model & voice di Text-to-Speech (Eleven v3, Dany Saputra, Stability Robust)...');
      this.reportStep('tts_config', 'Mengonfigurasi Model Eleven v3 & Voice Dany Saputra...');

      let cfgSuccess = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          this.dismissAllModals();
          const cfgRes = await this.configureTTS({
            voiceName: 'Dany Saputra',
            modelName: 'Eleven v3',
            stability: 'robust',
          });
          if (cfgRes && cfgRes.success) {
            cfgSuccess = true;
            break;
          }
        } catch (cfgErr) {
          console.warn(`[ElevenLabsTTS] Percobaan ${attempt}/3 konfigurasi TTS gagal:`, cfgErr.message);
          await sleep(1500);
        }
      }

      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.remove(['elevenlabs_auto_flow']);
      }
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          action: 'ELEVENLABS_ONBOARDING_COMPLETED',
          payload: { email, url: window.location.href, ttsConfigured: cfgSuccess },
        }).catch(() => { });
      }

      console.log('\n=================================================================');
      console.log('  [✓✓✓] PENGATURAN TTS SELESAI - HALAMAN UTAMA AKTIF!');
      console.log('=================================================================\n');
      return { success: true, ttsConfigured: cfgSuccess };
    },

    /**
     * Menutup dan menyembunyikan modal peringatan sisa kredit ("Only X% of your monthly credits remaining")
     * atau popup promo upgrade lainnya di mana pun muncul di layar ElevenLabs.
     */
    dismissCreditRemainingModal() {
      try {
        const potentialModals = Array.from(
          document.querySelectorAll(
            '[role="dialog"], [data-state="open"], .fixed.inset-0, div[aria-modal="true"]'
          )
        );

        for (const el of potentialModals) {
          const txt = (el.innerText || el.textContent || '').toLowerCase();
          if (
            txt.includes('credits remaining') ||
            txt.includes('remind me later') ||
            (txt.includes('subscribe now') && txt.includes('credits')) ||
            txt.includes('monthly credits') ||
            txt.includes('first month half price')
          ) {
            console.log('[ElevenLabsTTS] 🛡️ Modal "Credits Remaining" terdeteksi! Menyembunyikan dan menutup otomatis...');

            // 1. Klik tombol "Remind Me Later" jika ada
            const buttons = Array.from(el.querySelectorAll('button'));
            const remindBtn = buttons.find((b) => {
              const t = (b.innerText || b.textContent || '').trim().toLowerCase();
              return t.includes('remind me later') || t === 'remind me';
            });
            if (remindBtn && isElementVisible(remindBtn)) {
              triggerNativeClick(remindBtn);
              remindBtn.click();
            }

            // 2. Klik tombol close (✕)
            const closeBtn = buttons.find((b) => {
              const aria = (b.getAttribute('aria-label') || '').toLowerCase();
              const title = (b.getAttribute('title') || '').toLowerCase();
              const t = (b.innerText || b.textContent || '').trim();
              return aria.includes('close') || title.includes('close') || t === '✕' || t === '×' || t === 'x';
            });
            if (closeBtn && isElementVisible(closeBtn)) {
              triggerNativeClick(closeBtn);
              closeBtn.click();
            }

            // 3. Tekan tombol Escape
            document.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
            );

            // 4. Sembunyikan visual secara total (display: none !important)
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('visibility', 'hidden', 'important');
            el.style.setProperty('opacity', '0', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');

            // Cari parent backdrop (.fixed.inset-0) jika ada dan sembunyikan juga
            const backdrop = el.closest('.fixed.inset-0') || el.parentElement;
            if (backdrop && backdrop !== document.body && backdrop !== document.documentElement) {
              backdrop.style.setProperty('display', 'none', 'important');
              backdrop.style.setProperty('visibility', 'hidden', 'important');
              backdrop.style.setProperty('pointer-events', 'none', 'important');
            }

            // 5. Pulihkan scroll dan interaksi klik pada body
            if (document.body) {
              document.body.style.setProperty('pointer-events', 'auto', 'important');
              document.body.style.setProperty('overflow', 'auto', 'important');
            }
            if (document.documentElement) {
              document.documentElement.style.setProperty('pointer-events', 'auto', 'important');
              document.documentElement.style.setProperty('overflow', 'auto', 'important');
            }
          }
        }
      } catch (e) { }
    },

    /**
     * Watcher otomatis yang berjalan terus-menerus untuk mendeteksi dan
     * MENYEMBUNYIKAN (hide) popup modal "Only X% of your monthly credits remaining"
     * atau popup upgrade/credits lainnya di mana pun ia muncul di ElevenLabs.
     */
    startAutoDismissWatcher() {
      if (this._autoDismissWatcherStarted) return;
      this._autoDismissWatcherStarted = true;

      // 1. Jalankan langsung
      this.dismissCreditRemainingModal();

      // 2. Polling interval setiap 500ms untuk membersihkan modal blocking
      setInterval(() => {
        this.dismissCreditRemainingModal();
      }, 500);

      // 3. MutationObserver agar instan mendeteksi saat elemen ditambahkan ke DOM
      try {
        const observer = new MutationObserver(() => {
          this.dismissCreditRemainingModal();
        });
        const targetNode = document.body || document.documentElement;
        if (targetNode) {
          observer.observe(targetNode, {
            childList: true,
            subtree: true,
          });
        }
      } catch (obsErr) { }
    },

    /**
     * Menutup modal atau dialog promosi/upgrade/welcome yang menghalangi layar TANPA merusak DOM React
     */
    dismissAllModals() {
      try {
        this.dismissCreditRemainingModal();

        const dismissBtns = Array.from(document.querySelectorAll(
          'button[data-testid="v3-welcome-dialog-get-started"], button[aria-label*="close" i], button[aria-label*="dismiss" i]'
        ));
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const btn of buttons) {
          const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
          if (txt === 'get started' || txt === 'remind me later' || txt === 'close' || txt === 'got it' || txt === '✕' || txt === 'x') {
            dismissBtns.push(btn);
          }
        }
        for (const btn of dismissBtns) {
          if (isElementVisible(btn)) {
            triggerNativeClick(btn);
          }
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));

        // Pulihkan pointer-events body & sembunyikan overlay secara aman
        if (document.body) {
          document.body.style.setProperty('pointer-events', 'auto', 'important');
          document.body.style.setProperty('overflow', 'auto', 'important');
        }
        const overlays = document.querySelectorAll('.fixed.inset-0.z-50, [data-state="open"].fixed');
        for (const el of Array.from(overlays)) {
          const txt = (el.textContent || '').toLowerCase();
          if (
            txt.includes('upgrade') ||
            txt.includes('remind me later') ||
            txt.includes('credits remaining') ||
            txt.includes("what's new in eleven v3") ||
            el.classList.contains('backdrop-blur-none') ||
            el.classList.contains('backdrop-blur-sm')
          ) {
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('visibility', 'hidden', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
          }
        }
      } catch (e) { }
    },

    /**
     * Menangani modal popup yang biasa muncul setelah berpindah ke Eleven v3
     * ("What's new in Eleven v3", promo dialog, atau welcome popup).
     * Sesuai alur pengguna:
     * "intinya bikin berurutan pindah model v3 dulu abis itu biasanya muncul modal sih kalau nggak muncul yudh skip aja abis itu pilih voice terus adjust stbility nya"
     */
    async handlePostModelV3Modal() {
      console.log('[ElevenLabsTTS] 🔍 Memeriksa apakah muncul modal popup pasca pergantian model v3...');
      // Beri jeda 1.2 detik agar jika ada dialog v3 dari SPA, dialog sempat ter-render
      await sleep(1200);

      // 1. Cek tombol "Get started" khusus dialog v3 ElevenLabs (data-testid="v3-welcome-dialog-get-started")
      const v3DialogBtn = document.querySelector('button[data-testid="v3-welcome-dialog-get-started"]');
      if (v3DialogBtn && isElementVisible(v3DialogBtn)) {
        console.log('[ElevenLabsTTS] 🎯 Modal popup v3 ("What\'s new in Eleven v3") terdeteksi! Mengklik Get Started...');
        triggerNativeClick(v3DialogBtn);
        await sleep(600);
        return true;
      }

      // 2. Cek apakah ada dialog yang terbuka di layar (role="dialog")
      const dialog = document.querySelector('[role="dialog"]:not([aria-hidden="true"]), [data-state="open"][role="dialog"]');
      if (dialog && isElementVisible(dialog)) {
        console.log('[ElevenLabsTTS] Modal dialog terdeteksi setelah pilih model, mencari tombol tutup...');
        const btns = Array.from(dialog.querySelectorAll('button'));
        const actionBtn = btns.find(b => {
          const txt = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
          return txt === 'get started' || txt === 'got it' || txt === 'remind me later' || txt === 'close' || txt === '✕' || txt === 'x';
        }) || dialog.querySelector('button[aria-label*="close" i], button[aria-label*="dismiss" i]');

        if (actionBtn && isElementVisible(actionBtn)) {
          console.log('[ElevenLabsTTS] Mengklik tombol penutup modal:', actionBtn.innerText || 'close');
          triggerNativeClick(actionBtn);
          await sleep(600);
        }

        // Tekan Escape untuk memastikan dialog tertutup rapi
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        await sleep(500);
        return true;
      }

      console.log('[ElevenLabsTTS] Tidak ada modal v3 yang muncul, langsung skip ke langkah berikutnya.');
      return false;
    },

    /**
     * Mengatur Model ke Eleven v3
     */
    async setModel(targetModel = 'Eleven v3') {
      let modelSelector = null;
      for (let w = 0; w < 10; w++) {
        modelSelector = document.querySelector('[data-testid="tts-model-selector"]');
        if (!modelSelector) {
          const labels = Array.from(document.querySelectorAll('span, div, label, p'));
          const labelEl = labels.find(el => (el.innerText || '').trim().toLowerCase() === 'model');
          if (labelEl) {
            let parent = labelEl.parentElement;
            for (let i = 0; i < 4 && parent; i++) {
              const btn = parent.querySelector('button, [role="button"], [tabindex="0"]');
              if (btn && btn !== labelEl) {
                modelSelector = btn;
                break;
              }
              parent = parent.parentElement;
            }
          }
        }
        if (modelSelector && isElementVisible(modelSelector)) break;
        await sleep(600);
      }

      if (!modelSelector) {
        console.warn('[ElevenLabsTTS] Selector model tidak ditemukan.');
        return false;
      }

      const currentText = (modelSelector.innerText || modelSelector.getAttribute('aria-label') || '').toLowerCase();
      if (currentText.includes('v3') || currentText.includes('eleven v3')) {
        console.log('[ElevenLabsTTS] ✅ Model sudah terset ke Eleven v3.');
        return true;
      }

      console.log('[ElevenLabsTTS] Membuka dropdown model selector...');
      triggerNativeClick(modelSelector);
      await sleep(1500);

      // Cari radio button Eleven v3 atau kartu model
      const radios = Array.from(document.querySelectorAll('[role="radio"], button, [role="option"]'));
      let v3Radio = radios.find(r => {
        const txt = (r.innerText || '').trim();
        return txt.startsWith('Eleven v3') || txt.toLowerCase().includes('eleven v3');
      });

      if (v3Radio) {
        console.log('[ElevenLabsTTS] Memilih radio button Eleven v3...');
        triggerNativeClick(v3Radio);
        await sleep(1200);
      } else {
        const allButtons = Array.from(document.querySelectorAll('button, div[role="button"], [role="menuitem"]'));
        const v3Opt = allButtons.find(o => {
          const txt = (o.innerText || '').trim().toLowerCase();
          return (txt.includes('eleven v3') || (txt.startsWith('v3') && txt.includes('eleven'))) && !txt.includes('try voice design');
        });
        if (v3Opt) {
          console.log('[ElevenLabsTTS] Memilih opsi Eleven v3 fallback...');
          triggerNativeClick(v3Opt);
          await sleep(1200);
        } else {
          console.warn('[ElevenLabsTTS] Opsi Eleven v3 tidak ditemukan di daftar.');
        }
      }

      // Tutup panel "Select a model" (klik tombol Back jika ada, atau tekan Escape)
      const backBtn = document.querySelector('button[aria-label="Back"], button[aria-label*="back" i]');
      if (backBtn && isElementVisible(backBtn)) {
        console.log('[ElevenLabsTTS] Menutup panel model via tombol Back...');
        triggerNativeClick(backBtn);
        await sleep(800);
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(600);
      }

      this.dismissAllModals();
      return true;
    },

    /**
     * Cari tombol Voice selector di halaman TTS
     * PERSIS SEPERTI getVoiceSelector DI CAMOUFOX (camoufox/elevenlabs/configure_tts.py)
     */
    getVoiceSelector() {
      let voiceSelector = document.querySelector('[data-testid="tts-voice-selector"]');
      if (!voiceSelector) {
        const labels = Array.from(document.querySelectorAll('span, div, label, p, h2, h3, h4'));
        const labelEl = labels.find(el => (el.innerText || '').trim().toLowerCase() === 'voice');
        if (labelEl) {
          let parent = labelEl.parentElement;
          for (let i = 0; i < 4 && parent; i++) {
            const btn = parent.querySelector('button, [role="button"], [tabindex="0"]');
            if (btn && btn !== labelEl) {
              voiceSelector = btn;
              break;
            }
            parent = parent.parentElement;
          }
        }
      }
      if (!voiceSelector) {
        const allButtons = Array.from(document.querySelectorAll('button'));
        voiceSelector = allButtons.find(b => {
          const txt = (b.innerText || b.textContent || '').toLowerCase();
          return (
            (txt.includes('adam') ||
              txt.includes('dany') ||
              txt.includes('saputra') ||
              txt.includes('roger') ||
              txt.includes('rachel') ||
              txt.includes('dominant')) &&
            !txt.includes('design') &&
            !txt.includes('settings')
          );
        });
      }
      return voiceSelector;
    },

    /**
     * Mengatur Voice ke target voice (default: 'Dany Saputra')
     * PERSIS 100% IDENTIK DENGAN set_voice DI CAMOUFOX (camoufox/elevenlabs/configure_tts.py:588-820)
     */
    async setVoice(targetVoice = 'Dany Saputra') {
      console.log(`[ElevenLabsTTS] [*] Memeriksa & mengatur Voice ke '${targetVoice}'...`);
      this.dismissAllModals();

      // 1. Cek apakah voice saat ini sudah sesuai
      let voiceSelector = null;
      for (let w = 0; w < 10; w++) {
        voiceSelector = this.getVoiceSelector();
        if (voiceSelector && isElementVisible(voiceSelector)) break;
        await sleep(500);
      }

      if (!voiceSelector) {
        console.warn('[ElevenLabsTTS] [!] Tombol Voice selector tidak ditemukan.');
        return false;
      }

      const currentText = (voiceSelector.innerText || voiceSelector.textContent || voiceSelector.getAttribute('aria-label') || '').trim().toLowerCase();
      console.log(`[ElevenLabsTTS] [*] Voice saat ini terdeteksi: '${currentText}'`);

      if (currentText.includes(targetVoice.toLowerCase())) {
        console.log(`[ElevenLabsTTS] [✓] Voice sudah aktif di '${targetVoice}'.`);
        return true;
      }

      // 2. Buka pemilih voice
      console.log(`[ElevenLabsTTS] [*] Membuka pemilih voice untuk '${targetVoice}'...`);
      triggerNativeClick(voiceSelector);
      await sleep(1500);

      // Helper untuk mencari input pencarian voice di dalam dialog/popover (HINDARI navbar "Search everything")
      const findVoiceSearchInput = () => {
        const dialog = document.querySelector('[role="dialog"], [data-state="open"], div[aria-modal="true"]');
        const root = dialog || document;
        const inputs = Array.from(root.querySelectorAll('input')).filter(isElementVisible);
        return inputs.find(inp => {
          const ph = (inp.getAttribute('placeholder') || '').toLowerCase();
          return (ph.includes('typing to search') || ph.includes('search') || ph.includes('find')) &&
                 !ph.includes('everything');
        });
      };

      // 3. Ketik nama voice di kolom pencarian
      let searchInput = findVoiceSearchInput();
      if (searchInput) {
        console.log(`[ElevenLabsTTS] [*] Mengetik '${targetVoice}' pada kolom pencarian voice...`);
        setReactInputValue(searchInput, targetVoice);
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        console.warn('[ElevenLabsTTS] [!] Kolom pencarian voice tidak ditemukan di popover.');
      }
      await sleep(1500);

      // 4. Helper untuk mencari kartu, hover, dan klik tombol + Use
      const selectVoiceCard = async () => {
        const dialog = document.querySelector('[role="dialog"], [data-state="open"], div[aria-modal="true"]');
        const root = dialog || document;
        const allItems = Array.from(root.querySelectorAll(
          'li, [role="listitem"], [role="option"], [data-radix-collection-item], div[role="button"], button'
        )).filter(isElementVisible);

        const matching = allItems.filter(el => {
          const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
          return txt.includes(targetVoice.toLowerCase()) && !txt.includes('typing to search') && !txt.includes('everything');
        });

        if (matching.length === 0) return false;

        const targetCard = matching.find(el => el.tagName === 'LI') || matching[0];
        const cardContainer = targetCard.closest('li, [role="listitem"]') || targetCard;

        // Hover kartu voice agar tombol '+ Use' muncul (persis Camoufox)
        const hoverElement = (el) => {
          if (!el) return;
          try {
            el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
            const rect = el.getBoundingClientRect();
            const clientX = rect.left + rect.width / 2;
            const clientY = rect.top + rect.height / 2;
            const opts = { bubbles: true, cancelable: true, clientX, clientY };
            el.dispatchEvent(new PointerEvent('pointerenter', opts));
            el.dispatchEvent(new PointerEvent('pointerover', opts));
            el.dispatchEvent(new MouseEvent('mouseenter', opts));
            el.dispatchEvent(new MouseEvent('mouseover', opts));
            el.dispatchEvent(new MouseEvent('mousemove', opts));
          } catch (e) { }
        };

        hoverElement(cardContainer);
        hoverElement(targetCard);
        await sleep(600);

        const isPlayPreviewButton = (btn) => {
          if (!btn) return false;
          const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
          const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
          const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
          if (aria.includes('play') || aria.includes('preview') || testId.includes('preview') || testId.includes('play')) return true;
          if (txt === 'play' || txt === 'preview') return true;
          return false;
        };

        const allButtons = Array.from(cardContainer.querySelectorAll('button')).concat(
          Array.from(root.querySelectorAll('button'))
        );

        let useBtn = allButtons.find(b => {
          if (isPlayPreviewButton(b)) return false;
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          return (
            txt === '+ use' ||
            txt === 'use' ||
            (txt.includes('use') && !txt.includes('user') && !txt.includes('pause')) ||
            aria === 'use voice' ||
            aria.includes('use')
          );
        });

        if (!useBtn) {
          useBtn = allButtons.find(b => {
            if (isPlayPreviewButton(b)) return false;
            const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            return txt === '+ add' || txt === 'add' || txt.includes('add to voice lab') || aria.includes('add');
          });
        }

        if (!useBtn) {
          useBtn = Array.from(cardContainer.querySelectorAll('button')).find(b => {
            return !isPlayPreviewButton(b) && (b.classList.contains('inset-0') || !b.getAttribute('aria-label'));
          });
        }

        if (useBtn) {
          console.log(`[ElevenLabsTTS] [✓] Mengklik tombol Use pada kartu '${targetVoice}':`, useBtn);
          triggerNativeClick(useBtn);
          try { useBtn.click(); } catch (e) { }
          return true;
        }

        // Fallback klik langsung kartu
        console.log(`[ElevenLabsTTS] Mengklik langsung kartu voice '${targetVoice}'...`);
        triggerNativeClick(cardContainer);
        try { cardContainer.click(); } catch (e) { }
        return true;
      };

      let voiceSelected = await selectVoiceCard();

      // Jika tidak ditemukan di tab aktif (My Voices), beralih ke tab Explore (persis Camoufox)
      if (!voiceSelected) {
        console.log('[ElevenLabsTTS] [*] Voice belum ditemukan di tab default, mencoba beralih ke tab Explore...');
        const dialog = document.querySelector('[role="dialog"], [data-state="open"], div[aria-modal="true"]');
        const root = dialog || document;

        const exploreTab = Array.from(root.querySelectorAll('button, [role="tab"]')).find(t => {
          const txt = (t.innerText || t.textContent || '').trim().toLowerCase();
          return (txt === 'explore' || txt.includes('explore new voices')) && isElementVisible(t);
        });

        if (exploreTab) {
          triggerNativeClick(exploreTab);
          try { exploreTab.click(); } catch (e) { }
          await sleep(1500);

          searchInput = findVoiceSearchInput();
          if (searchInput) {
            console.log(`[ElevenLabsTTS] [*] Mengetik '${targetVoice}' di tab Explore...`);
            setReactInputValue(searchInput, targetVoice);
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(1500);
          }

          voiceSelected = await selectVoiceCard();
        }
      }

      await sleep(1200);

      // 5. Konfirmasi dialog jika ada ("Add to Voice Lab" / "Use voice" / "Done")
      const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => {
        const t = (b.innerText || b.textContent || '').toLowerCase();
        return (t.includes('add voice') || t.includes('use voice') || t.includes('finish') || t.includes('done')) && isElementVisible(b);
      });
      if (confirmBtn) {
        triggerNativeClick(confirmBtn);
        try { confirmBtn.click(); } catch (e) { }
      }
      await sleep(800);

      // 6. Tutup panel jika masih terbuka (Back atau Escape)
      const backBtn = document.querySelector('button[aria-label="Back"], button[aria-label*="back" i]');
      if (backBtn && isElementVisible(backBtn)) {
        triggerNativeClick(backBtn);
        try { backBtn.click(); } catch (e) { }
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
      await sleep(600);

      this.dismissAllModals();

      // 7. Verifikasi akhir (persis Camoufox loop 6x)
      let verifyStatus = '';
      for (let attempt = 0; attempt < 6; attempt++) {
        await sleep(500);
        const sel = this.getVoiceSelector();
        verifyStatus = (sel?.innerText || sel?.textContent || '').trim().toLowerCase();
        if (verifyStatus.includes(targetVoice.toLowerCase())) {
          console.log(`[ElevenLabsTTS] [✓✓✓] Voice berhasil diubah ke '${targetVoice}'!`);
          return true;
        }
      }

      console.warn(`[ElevenLabsTTS] [!] Peringatan: Voice akhir masih terbaca '${verifyStatus}'.`);
      return verifyStatus.includes(targetVoice.toLowerCase());
    },

    /**
     * Mengatur Stability Slider ke Robust (1.0 / 100%)
     */
    async setStability(target = 'robust') {
      // Cari slider Stability secara presisi (hindari salah memilih timeline player audio)
      let slider = null;
      for (let w = 0; w < 10; w++) {
        slider = document.querySelector(
          '#stability-slider [role="slider"], span[role="slider"][aria-label="Stability"], [aria-label="Stability"][role="slider"], [aria-label*="Stability" i][role="slider"], #stability-slider'
        );

        if (!slider) {
          const labels = Array.from(document.querySelectorAll('span, div, label, p'));
          const stabLabel = labels.find(l => (l.innerText || '').trim().toLowerCase() === 'stability');
          if (stabLabel) {
            let parent = stabLabel.parentElement;
            for (let i = 0; i < 4 && parent; i++) {
              const s = parent.querySelector('[role="slider"], input[type="range"]');
              if (s) {
                slider = s;
                break;
              }
              parent = parent.parentElement;
            }
          }
        }
        if (slider && isElementVisible(slider)) break;
        await sleep(600);
      }

      // Klik label "Robust" secara langsung jika elemen teks dapat memicu slider snap
      const allSpans = Array.from(document.querySelectorAll('span, div, p, label'));
      const robustLabel = allSpans.find(el => (el.innerText || '').trim().toLowerCase() === 'robust');
      if (robustLabel) {
        triggerNativeClick(robustLabel);
        await sleep(300);
      }

      if (slider) {
        const sliderThumb = slider.getAttribute('role') === 'slider'
          ? slider
          : (slider.querySelector('[role="slider"]') || slider);

        if (sliderThumb.tagName === 'INPUT' && sliderThumb.type === 'range') {
          sliderThumb.value = sliderThumb.max || '1';
          sliderThumb.dispatchEvent(new Event('input', { bubbles: true }));
          sliderThumb.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          sliderThumb.focus();
          sliderThumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', keyCode: 35, bubbles: true }));
          sliderThumb.dispatchEvent(new KeyboardEvent('keyup', { key: 'End', keyCode: 35, bubbles: true }));
          for (let i = 0; i < 5; i++) {
            sliderThumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true }));
            sliderThumb.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', keyCode: 39, bubbles: true }));
          }

          const track = slider.closest('[data-orientation="horizontal"]') || sliderThumb.parentElement || slider;
          if (track) {
            const rect = track.getBoundingClientRect();
            const clientX = rect.right - 2;
            const clientY = rect.top + rect.height / 2;
            const opts = { bubbles: true, cancelable: true, clientX, clientY };
            track.dispatchEvent(new PointerEvent('pointerdown', opts));
            track.dispatchEvent(new MouseEvent('mousedown', opts));
            track.dispatchEvent(new PointerEvent('pointerup', opts));
            track.dispatchEvent(new MouseEvent('mouseup', opts));
            track.dispatchEvent(new MouseEvent('click', opts));
          }
        }
        console.log('[ElevenLabsTTS] ✅ Stability berhasil diatur ke Robust.');
        return true;
      }

      console.warn('[ElevenLabsTTS] Slider stability tidak ditemukan.');
      return false;
    },

    /**
     * Konfigurasi lengkap TTS secara berurutan sesuai alur pengguna:
     * 1. Pindah model v3 dulu
     * 2. Tangani modal v3 jika muncul (kalau tidak muncul skip saja)
     * 3. Pilih voice (Dany Saputra)
     * 4. Adjust stability (Robust 1.0)
     */
    async configureTTS({ voiceName = 'Dany Saputra', modelName = 'Eleven v3', stability = 'robust' } = {}) {
      console.log(`[ElevenLabsTTS] 🎛️ Memulai konfigurasi TTS berurutan: Model (${modelName}) -> Cek Modal -> Voice (${voiceName}) -> Stability (${stability})...`);
      this.reportStep('tts_config', `Memulai konfigurasi TTS: Model ${modelName} -> Voice ${voiceName} -> Stability ${stability}...`);

      // Beri jeda awal & bersihkan modal sisa secara aman
      await sleep(1000);
      this.dismissAllModals();

      // Pastikan tab Settings aktif jika sedang di tab History
      const settingsTab = Array.from(document.querySelectorAll('button, [role="tab"]')).find(t => {
        return (t.innerText || '').trim().toLowerCase() === 'settings';
      });
      if (settingsTab) {
        triggerNativeClick(settingsTab);
        await sleep(600);
      }

      // LANGKAH 1: Pindah model v3 dulu
      console.log(`[ElevenLabsTTS] 📌 Langkah 1: Memindahkan Model ke '${modelName}'...`);
      this.reportStep('tts_config', `1/3 Memindahkan model ke ${modelName}...`);
      await this.setModel(modelName);
      await sleep(800);

      // LANGKAH 2: Abis itu biasanya muncul modal sih kalau nggak muncul yudh skip aja
      console.log('[ElevenLabsTTS] 📌 Langkah 2: Memeriksa apakah ada modal pasca pindah model...');
      this.reportStep('tts_config', 'Memeriksa modal info/update Eleven v3...');
      await this.handlePostModelV3Modal();
      this.dismissAllModals();
      await sleep(800);

      // LANGKAH 3: Abis itu pilih voice
      console.log(`[ElevenLabsTTS] 📌 Langkah 3: Memilih voice '${voiceName}'...`);
      this.reportStep('tts_config', `2/3 Memilih Voice '${voiceName}'...`);
      await this.setVoice(voiceName);
      await sleep(800);
      this.dismissAllModals();

      // LANGKAH 4: Terus adjust stability nya
      console.log(`[ElevenLabsTTS] 📌 Langkah 4: Mengatur stability ke '${stability}' (Robust 1.0)...`);
      this.reportStep('tts_config', `3/3 Mengatur Stability ke '${stability}' (Robust 1.0)...`);
      await this.setStability(stability);
      await sleep(500);

      console.log('[ElevenLabsTTS] 🎉 Konfigurasi TTS selesai dengan sukses!');
      this.reportStep('tts_config', '✅ Konfigurasi TTS selesai: Model v3 -> Voice Dany Saputra -> Stability Robust.');

      return {
        success: true,
        voiceName,
        modelName,
        stability,
        message: 'Konfigurasi TTS berurutan berhasil: Model v3 -> Voice Dany Saputra -> Stability Robust!',
      };
    },

    /**
     * Konversi semua tag kurung siku [...] (seperti [VISUAL_ONLY], [pause], dll) menjadi [pauses]
     * Persis seperti yang ada di aplikasi Electron (convertToElevenLabsTtsScript)
     */
    formatNarrationScript(rawScript) {
      if (!rawScript || typeof rawScript !== 'string') return '';
      let result = rawScript;
      result = result.replace(/\[VISUAL_ONLY[^\]]*\]/gi, '[pauses]');
      result = result.replace(/\[[^\]]+\]/g, '[pauses]');
      result = result.replace(/<[^>]+>/g, '');
      result = result.replace(/(\s*\[pauses\]\s*)+/gi, '\n\n[pauses]\n\n');
      return result
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .trim();
    },

    /**
     * Memasukkan teks narasi ke editor ElevenLabs (TipTap / ProseMirror)
     */
    async inputNarrationText(text) {
      if (!text) {
        console.warn('[ElevenLabsTTS] Teks narasi kosong.');
        return false;
      }

      // Pastikan semua tag [...] dikonversi menjadi [pauses]
      const cleanText = this.formatNarrationScript(text);

      console.log(`[ElevenLabsTTS] 📝 Memasukkan teks narasi (${cleanText.length} karakter, [pauses] formatted) ke editor...`);
      this.reportStep('tts_input', `1/3 Memasukkan teks narasi (${cleanText.length} karakter)...`);

      // Tutup popup atau modal search jika ada yang terbuka
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      await sleep(200);

      // Cari editor TipTap / ProseMirror
      const editor = document.querySelector(
        '[data-testid="tts-editor"], .tiptap.ProseMirror[contenteditable="true"], [contenteditable="true"]'
      );

      if (editor) {
        editor.focus();
        editor.click();
        await sleep(200);

        // Hapus teks lama jika ada tombol "Clear text"
        const clearBtn = Array.from(document.querySelectorAll('button')).find((b) => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const title = (b.getAttribute('title') || '').toLowerCase();
          return aria.includes('clear text') || title.includes('clear text');
        });

        if (clearBtn && isElementVisible(clearBtn)) {
          triggerNativeClick(clearBtn);
          await sleep(200);
        }

        // Seleksi dan hapus semua konten lama di editor
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete');
        await sleep(200);

        // Masukkan teks baru menggunakan execCommand agar terdeteksi TipTap/ProseMirror state
        const inserted = document.execCommand('insertText', false, cleanText);
        if (!inserted || !editor.innerText.trim()) {
          editor.innerHTML = `<p>${cleanText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
        }

        // Dispatch input events agar counter karakter & validasi tombol ElevenLabs terupdate
        editor.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: cleanText,
          })
        );
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(400);

        try {
          editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) { }

        console.log('[ElevenLabsTTS] ✅ Teks narasi ([pauses]) berhasil dimasukkan ke TipTap editor.');
        return true;
      }

      // Fallback untuk textarea standar jika ada
      const textarea = document.querySelector('textarea');
      if (textarea) {
        textarea.focus();
        setReactInputValue(textarea, cleanText);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(600);
        console.log('[ElevenLabsTTS] ✅ Teks narasi ([pauses]) berhasil dimasukkan ke textarea.');
        return true;
      }

      console.warn('[ElevenLabsTTS] Editor TTS tidak ditemukan.');
      return false;
    },

    /**
     * Cari tombol Generate speech spesifik di UI ElevenLabs TTS
     * (Menghindari tombol search navbar, dialog popover, dll.)
     */
    findGenerateSpeechButton() {
      // Pastikan dialog / modal command palette tertutup jika terbuka
      const searchPalette = document.querySelector('[role="dialog"], [cmdk-root], div[data-state="open"]');
      if (searchPalette) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      }

      const allButtons = Array.from(document.querySelectorAll('button'));

      // Filter: Hanya tombol yang visible dan BUKAN di header/navigasi/modal dialog
      const validButtons = allButtons.filter((b) => {
        if (!isElementVisible(b)) return false;
        if (b.closest('header, nav, [role="dialog"], [role="menu"], [cmdk-root]')) return false;
        return true;
      });

      // 1. Teks persis "generate speech" atau "regenerate speech"
      const exactBtn = validButtons.find((b) => {
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        return txt === 'generate speech' || txt === 'regenerate speech';
      });
      if (exactBtn) return exactBtn;

      // 2. data-testid spesifik
      const testIdBtn = validButtons.find((b) => {
        const tid = (b.getAttribute('data-testid') || '').toLowerCase();
        return tid === 'tts-generate' || tid === 'generate-button' || tid === 'speech-generate-button';
      });
      if (testIdBtn) return testIdBtn;

      // 3. aria-label spesifik
      const ariaBtn = validButtons.find((b) => {
        const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
        return aria === 'generate speech' || aria === 'regenerate speech';
      });
      if (ariaBtn) return ariaBtn;

      // 4. Diawali teks "generate speech"
      const startBtn = validButtons.find((b) => {
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        return txt.startsWith('generate speech');
      });
      if (startBtn) return startBtn;

      // 5. Fallback tombol dengan teks "generate" di area konten TTS (abaikan image/video/music)
      return validButtons.find((b) => {
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        return (
          txt.includes('generate') &&
          !txt.includes('voice') &&
          !txt.includes('image') &&
          !txt.includes('video') &&
          !txt.includes('music')
        );
      });
    },

    /**
     * Memeriksa apakah limit kuota kredit ElevenLabs telah habis
     * Ciri-ciri:
     * - Muncul modal "First Month 50% Off" / "Upgrade" / "Only X% of your monthly credits remaining"
     * - Teks credit counter: sisa kredit < karakter yang dibutuhkan (misal: 2,280 credits remaining < 3,870)
     * - Tombol Generate speech disabled dengan pesan kuota
     */
    hasCreditLimitReached() {
      // 1. Cek keberadaan modal dialog upgrade / credit limit di DOM
      const dialogs = Array.from(
        document.querySelectorAll('[role="dialog"], [data-state="open"], .fixed.inset-0, div[aria-modal="true"]')
      );
      for (const d of dialogs) {
        const txt = (d.innerText || d.textContent || '').toLowerCase();
        if (
          txt.includes('first month 50% off') ||
          txt.includes('first month half price') ||
          (txt.includes('everything you need to create more') && txt.includes('upgrade')) ||
          (txt.includes('credits remaining') && (txt.includes('subscribe') || txt.includes('upgrade'))) ||
          (txt.includes('monthly credits') && txt.includes('upgrade')) ||
          (txt.includes('free 10k') && txt.includes('creator')) ||
          txt.includes('insufficient credits') ||
          txt.includes('not enough credits') ||
          txt.includes('out of credits') ||
          (txt.includes('upgrade') && txt.includes('month') && txt.includes('$'))
        ) {
          console.log('[ElevenLabsTTS] 🚨 Limit kredit terdeteksi via modal upgrade:', txt.slice(0, 80));
          return { reached: true, reason: 'Modal upgrade kredit muncul di layar' };
        }
      }

      // 2. Cek text counter sisa kredit vs karakter yang dibutuhkan
      try {
        const bodyText = document.body?.innerText || '';
        const creditMatch = bodyText.match(/([\d,]+)\s+credits?\s+remaining/i);
        const charMatch = bodyText.match(/([\d,]+)\s*\/\s*[\d,]+/);
        if (creditMatch && charMatch) {
          const remainingCredits = parseInt(creditMatch[1].replace(/,/g, ''), 10);
          const neededChars = parseInt(charMatch[1].replace(/,/g, ''), 10);
          if (remainingCredits >= 0 && neededChars > remainingCredits) {
            console.log(`[ElevenLabsTTS] 🚨 Limit kredit terdeteksi via counter: Butuh ${neededChars}, sisa ${remainingCredits}`);
            return {
              reached: true,
              reason: `Kredit akun kurang (Butuh ${neededChars}, sisa ${remainingCredits})`,
            };
          }
        }
      } catch (e) { }

      // 3. Cek apakah tombol Generate disabled karena kredit habis
      const genBtn = this.findGenerateSpeechButton();
      if (genBtn && genBtn.disabled) {
        const title = (genBtn.getAttribute('title') || '').toLowerCase();
        const aria = (genBtn.getAttribute('aria-label') || '').toLowerCase();
        if (
          title.includes('credit') || aria.includes('credit') ||
          title.includes('quota') || aria.includes('limit') ||
          title.includes('upgrade')
        ) {
          return { reached: true, reason: 'Tombol Generate disabled karena kuota kredit habis' };
        }
      }

      return { reached: false };
    },

    /**
     * Mengklik tombol Generate speech dan memantau proses generasi audio
     */
    async triggerGenerateSpeech(maxWaitSec = 120) {
      console.log('[ElevenLabsTTS] 🚀 Mencari tombol Generate speech...');
      this.reportStep('tts_generate', '2/3 Mencari & mengklik tombol Generate speech...');

      // Tutup modal / search palette jika ada yang terbuka
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      await sleep(300);
      this.dismissCreditRemainingModal();

      // Cek apakah kuota kredit sudah habis sebelum mengklik
      const limitBefore = this.hasCreditLimitReached();
      if (limitBefore.reached) {
        console.warn('[ElevenLabsTTS] 🚨 Limit kredit terdeteksi sebelum klik Generate:', limitBefore.reason);
        return { success: false, creditLimitReached: true, reason: limitBefore.reason };
      }

      let targetBtn = null;
      for (let attempt = 0; attempt < 15; attempt++) {
        this.dismissCreditRemainingModal();
        targetBtn = this.findGenerateSpeechButton();
        if (targetBtn && !targetBtn.disabled) break;
        await sleep(300);
      }

      // Cek lagi setelah tombol teridentifikasi
      const limitAtButton = this.hasCreditLimitReached();
      if (limitAtButton.reached) {
        console.warn('[ElevenLabsTTS] 🚨 Limit kredit terdeteksi:', limitAtButton.reason);
        return { success: false, creditLimitReached: true, reason: limitAtButton.reason };
      }

      if (!targetBtn) {
        throw new Error('Tombol "Generate speech" tidak ditemukan di halaman Text-to-Speech.');
      }

      if (targetBtn.disabled) {
        // Cek apakah disabled karena kredit
        return {
          success: false,
          creditLimitReached: true,
          reason: 'Tombol "Generate speech" disabled (kredit akun habis)',
        };
      }

      this.dismissCreditRemainingModal();
      console.log('[ElevenLabsTTS] 🎯 Tombol Generate speech ditemukan! Mengklik tombol...', targetBtn);
      this.reportStep('tts_generate', '2/3 Mengklik tombol Generate speech...');

      triggerNativeClick(targetBtn);
      targetBtn.click();
      await sleep(1500);

      // Cek apakah langsung muncul modal limit kredit pasca klik
      const limitAfterClick = this.hasCreditLimitReached();
      if (limitAfterClick.reached) {
        console.warn('[ElevenLabsTTS] 🚨 Modal limit kredit muncul pasca klik Generate:', limitAfterClick.reason);
        return { success: false, creditLimitReached: true, reason: limitAfterClick.reason };
      }

      this.dismissCreditRemainingModal();
      this.reportStep('tts_generate', 'Generasi audio sedang diproses (menunggu ring muter selesai)...');

      // Pantau hingga audio selesai digenerate
      const startTime = Date.now();
      const maxWaitMs = maxWaitSec * 1000;
      let generationReady = false;

      // Berikan jeda awal agar ElevenLabs memulai proses dan ring muter muncul
      await sleep(3000);

      while (Date.now() - startTime < maxWaitMs) {
        this.dismissCreditRemainingModal();

        // Pantau apakah modal limit kredit tiba-tiba muncul di tengah proses
        const limitInLoop = this.hasCreditLimitReached();
        if (limitInLoop.reached) {
          console.warn('[ElevenLabsTTS] 🚨 Modal limit kredit muncul saat menunggu generasi:', limitInLoop.reason);
          return { success: false, creditLimitReached: true, reason: limitInLoop.reason };
        }

        await sleep(1000);
        const elapsed = Math.round((Date.now() - startTime) / 1000);

        // Periksa apakah kartu Generation 2 sudah selesai diproses (ring muter hilang & tombol download aktif)
        const isFinished = this.isGenerationFinished(2);
        if (isFinished && elapsed >= 4) {
          console.log(`[ElevenLabsTTS] 🎉 Generasi audio Generation 2 SELESAI setelah ${elapsed} detik! (Ring muter sudah hilang, tombol download aktif)`);
          this.reportStep('tts_generate', `✅ Generasi audio Generation 2 selesai (${elapsed}s)!`);
          generationReady = true;
          break;
        }

        // Cek status tombol Generate speech di bawah
        const currentBtn = this.findGenerateSpeechButton();
        const isBtnLoading =
          currentBtn?.getAttribute('data-loading') === 'true' ||
          currentBtn?.getAttribute('aria-busy') === 'true' ||
          (currentBtn?.innerText || '').toLowerCase().includes('generating');

        if (!isBtnLoading && isFinished && elapsed >= 5) {
          console.log(`[ElevenLabsTTS] ✅ Tombol dan kartu Generation 2 selesai diproses.`);
          generationReady = true;
          break;
        }

        // Update laporan berkala ke side panel setiap 3 detik
        if (elapsed % 3 === 0) {
          console.log(`[ElevenLabsTTS] ⏳ Masih memproses generasi audio (${elapsed}s)... ring muter di kartu masih aktif.`);
          this.reportStep('tts_generate', `Menunggu ElevenLabs memproses audio (${elapsed}s)... (ring muter masih aktif)`);
        }
      }

      if (!generationReady) {
        console.warn(`[ElevenLabsTTS] Waktu tunggu generasi (${maxWaitSec}s) berakhir, mencoba melanjutkan...`);
      }

      await sleep(1200);
      return { success: generationReady };
    },

    /**
     * Memeriksa apakah kartu Generation tertentu sudah selesai diproses
     * Sesuai request: saat proses berlangsung ikonnya adalah ring muter-muter.
     * Ketika selesai, ring muter hilang dan tombol aksi (terutama Download) muncul.
     */
    isGenerationFinished(generationNumber = 2) {
      const card = this.getGenerationCard(generationNumber);
      if (!card) return false;

      // 1. Cek apakah ada elemen animasi ring muter / spinner di kartu
      const spinners = Array.from(
        card.querySelectorAll(
          '.animate-spin, [class*="spin"], [class*="loader"], [class*="loading"], svg[class*="spin"], [role="progressbar"], [role="status"]'
        )
      ).filter(isElementVisible);

      if (spinners.length > 0) {
        // Masih ada ring muter-muter! Berarti ElevenLabs masih memproses generasi
        return false;
      }

      // 2. Cek apakah tombol-tombol aksi (Download, Thumbs Up, dll.) sudah muncul
      // Saat memproses (loading), kartu hanya menampilkan Play dan spinner ring.
      // Saat selesai, tombol Download (tray / panah ke bawah) dan tombol Thumbs muncul.
      const cardButtons = Array.from(card.querySelectorAll('button')).filter(isElementVisible);

      const hasActionButtons = cardButtons.some((b) => {
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const title = (b.getAttribute('title') || '').toLowerCase();
        const testid = (b.getAttribute('data-testid') || '').toLowerCase();
        const html = b.innerHTML.toLowerCase();
        return (
          aria.includes('download') || aria.includes('unduh') ||
          title.includes('download') || title.includes('unduh') ||
          testid.includes('download') ||
          aria.includes('thumb') || title.includes('thumb') ||
          html.includes('download') || html.includes('arrow-down') ||
          html.includes('tray') || html.includes('lucide-download')
        );
      });

      // Kartu yang selesai setidaknya memiliki tombol Download atau minimal 3-5 tombol
      if (!hasActionButtons && cardButtons.length < 3) {
        return false;
      }

      return true;
    },

    /**
     * Mengambil container kartu Generation spesifik (Generation 1 atau Generation 2)
     */
    getGenerationCard(generationNumber = 2) {
      const otherNumber = generationNumber === 2 ? 1 : 2;
      const targetLabel = `generation ${generationNumber}`;
      const otherLabel = `generation ${otherNumber}`;

      // 1. Cari kandidat elemen teks "generation X" di luar footer / bottom audio player bar
      const candidates = Array.from(
        document.body.querySelectorAll('span, p, div, h1, h2, h3, h4, h5, label')
      ).filter((el) => {
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return false;
        if (el.closest('.fixed.bottom-0, footer, [data-testid="audio-player"]')) return false;
        const txt = (el.textContent || '').trim().toLowerCase();
        return txt === targetLabel || (txt.includes(targetLabel) && !txt.includes(otherLabel));
      });

      if (candidates.length === 0) {
        console.warn(`[ElevenLabsTTS] Label "${targetLabel}" tidak ditemukan di DOM.`);
        return null;
      }

      // Ambil leaf node terdalam yang teksnya mengandung targetLabel
      const leaf =
        candidates.find(
          (el) => !Array.from(el.children).some((c) => (c.textContent || '').toLowerCase().includes(targetLabel))
        ) || candidates[candidates.length - 1];

      // Naik ke parent container kartu yang HANYA memuat Generation target, TIDAK memuat otherLabel!
      let bestCard = leaf.parentElement;
      let cur = leaf.parentElement;
      while (cur && cur !== document.body) {
        const text = (cur.textContent || '').toLowerCase();
        // Berhenti jika mulai menyentuh parent pembungkus yang memuat generation lain!
        if (text.includes(otherLabel)) {
          break;
        }
        if (cur.querySelectorAll('button').length >= 1) {
          bestCard = cur;
        }
        cur = cur.parentElement;
      }

      console.log(`[ElevenLabsTTS] ✅ Kartu ${targetLabel} terisolasi ditemukan:`, bestCard);
      return bestCard;
    },

    /**
     * Memutar preview audio khusus Generation yang dipilih (default: Generation 2)
     * Sesuai request: "play preview juga yang generation 2 juga"
     */
    async playGenerationPreview(generationNumber = 2) {
      console.log(`[ElevenLabsTTS] ▶️ Memutar preview audio khusus Generation ${generationNumber}...`);
      this.reportStep('tts_preview', `Memutar preview audio Generation ${generationNumber}...`);

      // 1. Hentikan pemutaran audio sebelumnya (misal Generation 1 yang sedang jalan di bottom bar)
      document.querySelectorAll('audio').forEach((a) => {
        try { a.pause(); } catch (e) { }
      });

      // 2. Ambil kartu target yang terisolasi khusus Generation X (BUKAN wrapper bersama)
      const card = this.getGenerationCard(generationNumber);
      if (!card) {
        console.warn(`[ElevenLabsTTS] Kartu Generation ${generationNumber} tidak ditemukan.`);
        return { success: false, error: `Kartu Generation ${generationNumber} tidak ditemukan di halaman.` };
      }

      const cardButtons = Array.from(card.querySelectorAll('button')).filter(isElementVisible);
      if (cardButtons.length === 0) {
        return { success: false, error: `Tidak ada tombol pada kartu Generation ${generationNumber}.` };
      }

      // 3. Cari tombol Play/Pause di dalam kartu Generation target
      // (Tombol Play lingkaran hitam di sebelah kiri waveform)
      const playBtn =
        cardButtons.find((b) => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const title = (b.getAttribute('title') || '').toLowerCase();
          return aria.includes('play') || title.includes('play') || aria.includes('pause') || title.includes('pause');
        }) || cardButtons[0];

      if (playBtn) {
        console.log(`[ElevenLabsTTS] 🎯 Mengklik tombol Play pada kartu Generation ${generationNumber}:`, playBtn);
        triggerNativeClick(playBtn);
        playBtn.click();
        await sleep(1000);

        this.reportStep('tts_preview', `▶️ Preview audio Generation ${generationNumber} berhasil diputar.`);
        return {
          success: true,
          generationNumber,
          message: `Preview audio Generation ${generationNumber} berhasil diputar!`,
        };
      }

      return {
        success: false,
        error: `Tombol Play pada kartu Generation ${generationNumber} tidak ditemukan.`,
      };
    },

    /**
     * Mendownload file audio hasil output khusus Generation 2 (BUKAN Generation 1)
     * Sesuai request:
     * - Cukup dipicu SEKALI (anti-race condition & anti-duplikasi)
     * - Unduh otomatis tanpa prompt Save As (saveAs: false via background & onDeterminingFilename)
     * - Ubah nama file otomatis sesuai pattern content idfile & audio-counter number
     */
    async downloadGeneration(targetGenerationNumber = 2, customFilename = null) {
      if (this._isDownloadingSingleLock) {
        console.warn('[ElevenLabsTTS] ⚠️ Download sedang diproses! Mengabaikan trigger ganda untuk mencegah race condition.');
        return {
          success: true,
          generationNumber: targetGenerationNumber,
          filename: customFilename,
          message: 'Download sedang diproses (single trigger lock aktif).',
        };
      }
      this._isDownloadingSingleLock = true;

      const safeFilename = customFilename
        ? (customFilename.endsWith('.mp3') ? customFilename : `${customFilename}.mp3`)
        : `audio-generation-${targetGenerationNumber}.mp3`;

      console.log(`[ElevenLabsTTS] 📥 Mencari dan mendownload audio Generation ${targetGenerationNumber}... Target file: ${safeFilename}`);
      this.reportStep('tts_download', `Mendownload output audio Generation ${targetGenerationNumber} (${safeFilename})...`);

      try {
        // 1. Daftarkan target nama file ke background script untuk di-intercept oleh onDeterminingFilename
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          try {
            await chrome.runtime.sendMessage({
              action: 'SET_TARGET_AUDIO_FILENAME',
              payload: { filename: safeFilename },
            });
          } catch (e) { }
        }

        // 2. Interceptor pada link anchor yang dibuat secara dinamis oleh ElevenLabs
        let downloadTriggered = false;
        const clickCaptureHandler = (e) => {
          const a = e.target.closest('a') || (e.target.tagName === 'A' ? e.target : null);
          if (a && (a.hasAttribute('download') || a.href?.startsWith('blob:') || a.href?.includes('.mp3'))) {
            console.log('[ElevenLabsTTS] 🎯 Intercepted download anchor:', a.href, a.download);
            a.setAttribute('download', safeFilename);
            a.download = safeFilename;
            downloadTriggered = true;
          }
        };
        window.addEventListener('click', clickCaptureHandler, true);

        // Helper untuk mendeteksi apakah suatu tombol adalah tombol download
        const isDownloadBtn = (b) => {
          if (!b) return false;
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const title = (b.getAttribute('title') || '').toLowerCase();
          const testid = (b.getAttribute('data-testid') || '').toLowerCase();
          if (
            aria.includes('download') || aria.includes('unduh') ||
            title.includes('download') || title.includes('unduh') ||
            testid.includes('download')
          ) {
            return true;
          }
          const svg = b.querySelector('svg');
          if (svg) {
            const html = svg.outerHTML.toLowerCase();
            if (
              html.includes('download') || html.includes('arrow-down') ||
              html.includes('tray') || html.includes('lucide-download')
            ) {
              return true;
            }
          }
          return false;
        };

        // Prioritas 1: Cari tombol Download di dalam kartu Generation spesifik (terisolasi)
        const card = this.getGenerationCard(targetGenerationNumber);
        let downloadBtn = null;

        if (card) {
          const cardButtons = Array.from(card.querySelectorAll('button')).filter(isElementVisible);
          downloadBtn = cardButtons.find(isDownloadBtn);
        }

        // Prioritas 2: Cari tombol download di Bottom Audio Player Bar (yang sudah memuat Generation target dari playGenerationPreview)
        if (!downloadBtn) {
          const bottomBar = document.querySelector('.fixed.bottom-0, [data-testid="audio-player"], footer');
          if (bottomBar) {
            const bBtns = Array.from(bottomBar.querySelectorAll('button')).filter(isElementVisible);
            downloadBtn = bBtns.find(isDownloadBtn);
          }
        }

        // Prioritas 3: Cari tombol download global di halaman
        if (!downloadBtn) {
          const allDlButtons = Array.from(
            document.querySelectorAll('button[aria-label*="download" i], button[title*="download" i], button[data-testid*="download" i]')
          ).filter(isElementVisible);
          if (allDlButtons.length >= targetGenerationNumber) {
            downloadBtn = allDlButtons[targetGenerationNumber - 1];
          } else if (allDlButtons.length > 0) {
            downloadBtn = allDlButtons[allDlButtons.length - 1];
          }
        }

        // Eksekusi klik tombol download yang ditemukan (HANYA SEKALI!)
        if (downloadBtn) {
          console.log(`[ElevenLabsTTS] 🎯 Tombol Download ditemukan! Mengklik tombol (single trigger)...`, downloadBtn);
          triggerNativeClick(downloadBtn);
          downloadBtn.click();
          downloadTriggered = true; // Tandai langsung terpicu agar tidak memicu fallback berganda!
          await sleep(500);

          // Cek jika muncul popup dropdown pilihan format audio (MP3 / Original)
          const menuItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]'));
          const mp3Option = menuItems.find((m) => {
            const t = (m.innerText || m.textContent || '').trim().toLowerCase();
            return t.includes('mp3') || t.includes('original') || t.includes('download');
          });
          if (mp3Option && isElementVisible(mp3Option)) {
            console.log('[ElevenLabsTTS] Memilih format MP3 dari dropdown menu:', mp3Option.innerText);
            triggerNativeClick(mp3Option);
            mp3Option.click();
            await sleep(600);
          }
        }

        // Fallback Terakhir: HANYA jika download BENAR-BENAR belum terpicu sama sekali (tidak ada tombol download di mana pun)
        if (!downloadTriggered) {
          const audioEl = document.querySelector('audio');
          if (audioEl && audioEl.src && (audioEl.src.startsWith('blob:') || audioEl.src.startsWith('http'))) {
            console.log('[ElevenLabsTTS] 🚀 Fallback unduhan langsung via audio src (karena tidak ada tombol download):', audioEl.src);
            const a = document.createElement('a');
            a.href = audioEl.src;
            a.download = safeFilename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => a.remove(), 300);
            downloadTriggered = true;
          }
        }

        await sleep(1000);
        window.removeEventListener('click', clickCaptureHandler, true);

        console.log(`[ElevenLabsTTS] 🎉 Download Generation ${targetGenerationNumber} berhasil dipicu secara tunggal! Target: ${safeFilename}`);
        this.reportStep('tts_download', `✅ Download audio Generation ${targetGenerationNumber} berhasil dipicu: ${safeFilename}`);

        return {
          success: true,
          generationNumber: targetGenerationNumber,
          filename: safeFilename,
          message: `Download audio Generation ${targetGenerationNumber} berhasil dipicu (${safeFilename}).`,
        };
      } finally {
        // Lepaskan lock setelah jeda aman untuk mencegah double download
        setTimeout(() => {
          this._isDownloadingSingleLock = false;
        }, 4000);
      }
    },

    /**
     * Alur lengkap TTS:
     * 1. Input teks narasi
     * 2. Klik tombol Generate / Regenerate speech
     * 3. Tunggu hingga kartu Generation 2 selesai diproses
     * 4. Putar preview audio khusus Generation 2
     * 5. Download hasil audio Generation 2 otomatis tersimpan dengan custom filename
     */
    async generateAndDownloadTTS({ text, generationNumber = 2, download = true, customFilename = null } = {}) {
      console.log(`[ElevenLabsTTS] 🎙️ Memulai alur TTS: Input Narasi -> Klik Generate -> Play Preview Gen ${generationNumber} -> Download (${download ? 'Ya' : 'Tidak'}, Filename: ${customFilename || 'default'})...`);
      this.reportStep('tts_full', `1/3 Memasukkan teks narasi (${text?.length || 0} karakter) ke ElevenLabs...`);

      // 1. Input teks narasi ke editor TipTap ProseMirror
      if (text) {
        const inputSuccess = await this.inputNarrationText(text);
        if (!inputSuccess) {
          throw new Error('Gagal memasukkan teks narasi ke editor ElevenLabs.');
        }
        await sleep(800);
      }

      // 2. Klik tombol "Generate speech" / "Regenerate speech"
      this.reportStep('tts_full', '2/3 Mengklik tombol Generate speech...');
      const genResult = await this.triggerGenerateSpeech(120);

      if (genResult && genResult.creditLimitReached) {
        console.warn('[ElevenLabsTTS] 🚨 Generate dihentikan karena limit kredit tercapai:', genResult.reason);
        this.reportStep('tts_full', `🚨 Limit kredit tercapai (${genResult.reason})! Melakukan Logout otomatis (klik native)...`);
        // Bener-bener mengklik tombol logout secara native
        await this.executeSignOut();
        return {
          success: false,
          creditLimitReached: true,
          signedOut: true,
          reason: genResult.reason,
          error: genResult.reason,
        };
      }

      if (!genResult || !genResult.success) {
        console.warn('[ElevenLabsTTS] Peringatan: Generation tidak terdeteksi dalam batas waktu, mencoba fallback...');
      }

      await sleep(1500);

      // 3. Putar preview audio khusus Generation 2
      console.log(`[ElevenLabsTTS] ▶️ Memutar preview audio khusus Generation ${generationNumber}...`);
      this.reportStep('tts_full', `Memutar preview audio Generation ${generationNumber}...`);
      try {
        await this.playGenerationPreview(generationNumber);
      } catch (playErr) {
        console.warn('[ElevenLabsTTS] Peringatan putar preview:', playErr.message);
      }

      if (!download) {
        this.reportStep('tts_full', `✅ Berhasil generate speech & memutar preview Generation ${generationNumber}!`);
        return {
          success: true,
          generationNumber,
          message: `Berhasil generate speech dan memutar preview audio Generation ${generationNumber}!`,
        };
      }

      // 4. Download hasil audio khusus Generation 2 (otomatis tersimpan dengan nama kustom)
      await sleep(1000);
      this.reportStep('tts_full', `3/3 Mendownload hasil audio khusus Generation ${generationNumber}...`);
      const dlResult = await this.downloadGeneration(generationNumber, customFilename);

      return {
        success: dlResult.success,
        generationNumber,
        filename: dlResult.filename || customFilename,
        message: `Teks narasi berhasil digenerate, preview Generation ${generationNumber} diputar, dan audio otomatis tersimpan ke lokal sebagai ${dlResult.filename || customFilename || 'audio.mp3'}!`,
      };
    },

    /**
     * Handler pesan masuk dari Side Panel atau Background Script
     */
    async handleMessage(message) {
      if (message.action === 'EXECUTE_ELEVENLABS_SIGNUP') {
        return await this.executeSignup(message.payload || {});
      }

      if (message.action === 'EXECUTE_ELEVENLABS_SIGNIN') {
        return await this.executeSignIn(message.payload || {});
      }

      if (message.action === 'EXECUTE_POST_VERIFY_ONBOARDING') {
        return await this.executePostVerifyAndOnboarding(message.payload || {});
      }

      if (message.action === 'CONFIGURE_ELEVENLABS_TTS') {
        return await this.configureTTS(message.payload || {});
      }

      if (message.action === 'INPUT_TEXT_ONLY') {
        const ok = await this.inputNarrationText(message.payload?.text || '');
        return {
          success: ok,
          message: ok
            ? 'Naskah berhasil dimasukkan ke editor ElevenLabs! Siap digenerate secara manual.'
            : 'Gagal memasukkan naskah ke editor ElevenLabs.',
        };
      }

      if (message.action === 'GENERATE_AND_DOWNLOAD_TTS') {
        return await this.generateAndDownloadTTS(message.payload || {});
      }

      if (message.action === 'INPUT_AND_GENERATE_SPEECH') {
        return await this.generateAndDownloadTTS({ ...(message.payload || {}), download: false });
      }

      if (message.action === 'PLAY_GENERATION_PREVIEW') {
        return await this.playGenerationPreview(message.payload?.generationNumber || 2);
      }

      if (message.action === 'DOWNLOAD_GENERATION') {
        return await this.downloadGeneration(
          message.payload?.generationNumber || 2,
          message.payload?.customFilename || null
        );
      }

      if (message.action === 'EXECUTE_ELEVENLABS_SIGNOUT') {
        return await this.executeSignOut();
      }

      if (message.action === 'GET_ELEVENLABS_STATUS') {
        return this.getTabStatus();
      }

      if (message.action === 'PING_ELEVENLABS_TAB') {
        return {
          ready: true,
          url: window.location.href,
          isDashboard: this.isDashboardReached(),
          hasForm: !!(this.findEmailInput() && this.findPasswordInput()),
        };
      }

      return null;
    },

    /**
     * Deteksi posisi/status halaman ElevenLabs saat ini (Sign In, Sign Up, Onboarding, Verify, Dashboard, atau Limit)
     */
    getTabStatus() {
      const url = window.location.href;
      const path = (window.location.pathname || '').toLowerCase();
      const bodyText = (document.body?.innerText || '').toLowerCase();

      // 1. Cek limit kredit
      const limit = this.hasCreditLimitReached();
      if (limit.reached) {
        return { status: 'CREDIT_LIMIT', reason: limit.reason, url };
      }

      // 2. Cek onboarding (Prioritas tinggi: cegah race condition saat SPA me-redirect ke onboarding)
      if (
        path.includes('/onboarding') ||
        url.includes('onboarding') ||
        bodyText.includes('choose your platform') ||
        bodyText.includes('switch between platforms') ||
        bodyText.includes('personalize your experience') ||
        bodyText.includes('reached the age of 18') ||
        bodyText.includes('18 years old') ||
        bodyText.includes('what will you use elevenlabs for') ||
        bodyText.includes('tell us about yourself') ||
        bodyText.includes('how do you plan to use') ||
        Boolean(document.querySelector('input[name="adult"]')) ||
        (Boolean(document.querySelector('button[role="checkbox"]')) && !path.includes('/speech-synthesis') && !path.includes('/text-to-speech'))
      ) {
        return { status: 'ONBOARDING', url };
      }

      // 3. Cek halaman verifikasi email / action / modal pop-up verifikasi
      if (
        path.includes('/action') ||
        url.includes('mode=verifyEmail') ||
        url.includes('oobCode') ||
        bodyText.includes("we've sent a verification link") ||
        bodyText.includes('almost there') ||
        bodyText.includes('email verification')
      ) {
        return { status: 'VERIFY_ACTION', url };
      }

      // 4. Cek halaman Sign In ("Welcome back")
      if (
        path.includes('/sign-in') ||
        path.includes('/login') ||
        (bodyText.includes('welcome back') && Boolean(this.findPasswordInput())) ||
        (Boolean(this.findPasswordInput()) && !path.includes('/speech-synthesis') && !path.includes('/text-to-speech'))
      ) {
        return { status: 'SIGN_IN', url };
      }

      // 5. Cek halaman Sign Up
      if (
        path.includes('/sign-up') ||
        (bodyText.includes('create an account') && Boolean(this.findEmailInput()) && Boolean(this.findPasswordInput()))
      ) {
        return { status: 'SIGN_UP', url };
      }

      // 6. Cek dashboard Text-to-Speech
      if (
        (path.includes('/speech-synthesis') || path.includes('/text-to-speech')) &&
        this.isDashboardReached()
      ) {
        return { status: 'DASHBOARD_TTS', url, ready: true };
      }

      // 7. Cek dashboard umum (/app/home, /app/overview, dll.)
      if (this.isDashboardReached()) {
        return { status: 'DASHBOARD_HOME', url };
      }

      return { status: 'UNKNOWN', url };
    }
  };

  // Daftarkan ke Global Registry ContentAuto
  if (window.ContentAuto && typeof window.ContentAuto.registerModule === 'function') {
    window.ContentAuto.registerModule('elevenlabsSignup', ElevenLabsSignupModule);
  } else {
    // Fallback standalone listener jika content.js dimuat terpisah
    window.__ELEVENLABS_SIGNUP_MODULE__ = ElevenLabsSignupModule;
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (
        msg.module === 'elevenlabsSignup' ||
        msg.action === 'EXECUTE_ELEVENLABS_SIGNUP' ||
        msg.action === 'EXECUTE_ELEVENLABS_SIGNIN' ||
        msg.action === 'EXECUTE_ELEVENLABS_SIGNOUT' ||
        msg.action === 'EXECUTE_POST_VERIFY_ONBOARDING' ||
        msg.action === 'CONFIGURE_ELEVENLABS_TTS' ||
        msg.action === 'INPUT_TEXT_ONLY' ||
        msg.action === 'GENERATE_AND_DOWNLOAD_TTS' ||
        msg.action === 'INPUT_AND_GENERATE_SPEECH' ||
        msg.action === 'PLAY_GENERATION_PREVIEW' ||
        msg.action === 'DOWNLOAD_GENERATION' ||
        msg.action === 'GET_ELEVENLABS_STATUS' ||
        msg.action === 'PING_ELEVENLABS_TAB'
      ) {
        ElevenLabsSignupModule.handleMessage(msg)
          .then((res) => sendResponse({ success: true, ...res }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;
      }
    });
  }

  // Jalankan Auto-Dismiss Watcher segera setelah script dimuat di tab ElevenLabs
  try {
    ElevenLabsSignupModule.startAutoDismissWatcher();
  } catch (e) { }
})();

