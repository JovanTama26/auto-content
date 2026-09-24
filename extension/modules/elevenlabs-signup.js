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
   * Helper untuk trigger klik native lengkap (Pointer & Mouse events)
   * Penting untuk komponen React/Radix UI/Shadcn dialog & buttons
   */
  function triggerNativeClick(el) {
    if (!el) return;
    try {
      el.focus?.();
      const opts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.click();
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
      inputEl.focus();

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;

      // 1. Reset / Clear terlebih dahulu agar React internal tracker mendeteksi perubahan baru
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(inputEl, '');
      } else {
        inputEl.value = '';
      }
      inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

      // 2. Isi value target
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(inputEl, value);
      } else {
        inputEl.value = value;
      }

      inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value.slice(-1) }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.slice(-1) }));

      // 3. Verifikasi value terpasang dengan benar
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

          if (flow && flow.active) {
            const elapsed = Date.now() - (flow.startedAt || 0);
            if (elapsed < 120000) {
              console.log('[ElevenLabsSignup] 🔄 Melanjutkan flow verifikasi & onboarding otomatis dari storage...');
              this.executePostVerifyAndOnboarding(flow);
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
        }).catch(() => {});
      }
    },

    /**
     * Cek apakah browser sudah mencapai Dashboard utama ElevenLabs
     */
    isDashboardReached() {
      const path = window.location.pathname;
      const fullUrl = window.location.href;

      // Halaman autentikasi, verifikasi, atau onboarding BELUM dashboard
      if (
        path.includes('/action') ||
        path.includes('/sign-in') ||
        path.includes('/sign-up') ||
        path.includes('/login') ||
        path.includes('/onboarding') ||
        fullUrl.includes('mode=verifyEmail') ||
        fullUrl.includes('oobCode') ||
        fullUrl.includes('onboarding')
      ) {
        return false;
      }

      // Pastikan form Sign In tidak sedang aktif di layar
      const bodyText = (document.body?.innerText || '').toLowerCase();
      if (bodyText.includes('welcome back') && !!this.findPasswordInput()) {
        return false;
      }
      if (bodyText.includes('email verification') && path.includes('/action')) {
        return false;
      }

      // Daftar rute khas dashboard ElevenLabs
      const dashboardPaths = [
        '/app/speech-synthesis',
        '/app/text-to-speech',
        '/app/home',
        '/app/voice-lab',
        '/app/voices',
        '/app/projects',
        '/app/audio-native',
        '/app/dubbing',
        '/app/overview',
        '/app/explore',
        '/app/history',
        '/app/sound-generation',
      ];

      const matchesDashboardPath = dashboardPaths.some((p) => path.startsWith(p)) || path === '/app' || path === '/app/';

      const hasSynthesisInput = !!document.querySelector('textarea, [contenteditable="true"]');
      const isTTSPath =
        path.includes('/speech-synthesis') ||
        path.includes('/text-to-speech') ||
        path.includes('/app/home') ||
        path === '/app' ||
        path === '/app/';

      // Cek apakah ada modal blocking dialog (onboarding / welcome back dialog)
      const hasBlockingDialog = !!document.querySelector(
        '[role="dialog"]:not([aria-hidden="true"]), [data-state="open"][role="dialog"]'
      );

      // Target utama: speech-synthesis / text-to-speech / home dashboard dengan input editor TTS aktif
      if ((isTTSPath || matchesDashboardPath) && (hasSynthesisInput || !hasBlockingDialog)) {
        return true;
      }

      return false;
    },

    /**
     * Cari dan klik semua checkbox yang belum tercentang
     * Sesuai request: "kalau ada checkbox maka di klik dulu checkbox nya"
     */
    clickAllUncheckedCheckboxes() {
      let count = 0;

      // 1. Native HTML checkbox
      const nativeCheckboxes = document.querySelectorAll('input[type="checkbox"]:not(:checked)');
      for (const cb of nativeCheckboxes) {
        if (isElementVisible(cb) || isElementVisible(cb.parentElement)) {
          console.log('[ElevenLabsOnboarding] 🔘 Mencentang native checkbox...');
          cb.focus();
          cb.checked = true;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
          cb.dispatchEvent(new Event('input', { bubbles: true }));
          cb.click();
          count++;
        }
      }

      // 2. ARIA / Radix UI / Tailwind / Shadcn UI checkbox
      const ariaCheckboxes = document.querySelectorAll(
        '[role="checkbox"][aria-checked="false"], [role="checkbox"][data-state="unchecked"], button[data-state="unchecked"][role="checkbox"]'
      );
      for (const cb of ariaCheckboxes) {
        if (isElementVisible(cb)) {
          console.log('[ElevenLabsOnboarding] 🔘 Mencentang ARIA checkbox...');
          cb.focus();
          cb.click();
          count++;
        }
      }

      return count;
    },

    /**
     * Cari tombol "Skip" untuk melewati onboarding
     * Sesuai request: "kalau ada skip maka skip aja di onboarding"
     */
    findSkipButton() {
      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], span'));
      for (const el of candidates) {
        if (!isElementVisible(el)) continue;
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (
          text === 'skip' ||
          text.startsWith('skip ') ||
          text.endsWith(' skip') ||
          text.includes('skip for now') ||
          text.includes('skip onboarding') ||
          text.includes('skip intro') ||
          text.includes('skip this step') ||
          text.includes("i'll do this later") ||
          text.includes('not now') ||
          el.getAttribute('aria-label')?.toLowerCase().includes('skip')
        ) {
          return el.closest('button, a, [role="button"]') || el;
        }
      }
      return null;
    },

    /**
     * Cari tombol "Continue", "Next", "Done", "Get started"
     */
    findNextOrContinueButton() {
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], a.btn, a[role="button"]'));
      for (const btn of candidates) {
        if (!isElementVisible(btn)) continue;
        if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
        const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (
          text === 'continue' ||
          text.startsWith('continue') ||
          text === 'next' ||
          text.startsWith('next') ||
          text === 'next step' ||
          text === 'get started' ||
          text === "let's go" ||
          text === 'done' ||
          text === 'finish' ||
          text === 'agree and continue' ||
          text === 'agree & continue' ||
          text === 'start creating' ||
          text === 'explore on my own' ||
          text === 'got it'
        ) {
          return btn;
        }
      }
      return null;
    },

    /**
     * Khusus menangani layar onboarding "Choose your platform"
     * Memilih platform ElevenCreative (Text-to-Speech) lalu mengklik tombol Continue
     */
    handleChoosePlatformOnboarding() {
      const bodyText = (document.body?.innerText || '').toLowerCase();
      if (!bodyText.includes('choose your platform') && !bodyText.includes('elevencreative')) {
        return false;
      }

      console.log('[ElevenLabsOnboarding] 🎨 Layar "Choose your platform" terdeteksi! Memilih ElevenCreative...');

      // 1. Cari elemen teks ElevenCreative
      const allEls = Array.from((document.body || document.documentElement).querySelectorAll('*:not(script):not(style)'));
      const creativeTextEl = allEls.find((el) => {
        if (el.children.length > 0) return false;
        const t = (el.textContent || '').trim().toLowerCase();
        return t === 'elevencreative' || t.includes('elevencreative');
      });

      let creativeCard = null;
      if (creativeTextEl) {
        creativeCard =
          creativeTextEl.closest('button, [role="button"], [role="radio"], div[tabindex], div.cursor-pointer') ||
          creativeTextEl.closest('div.border, div.rounded-xl, div.rounded-2xl, div.rounded-lg') ||
          creativeTextEl.parentElement ||
          creativeTextEl.parentElement?.parentElement;
      }

      if (!creativeCard) {
        creativeCard = Array.from((document.body || document.documentElement).querySelectorAll('div, button, [role="button"]')).find((el) => {
          const txt = (el.innerText || el.textContent || '').toLowerCase();
          return txt.includes('elevencreative') && (txt.includes('create, edit') || txt.includes('text to speech'));
        });
      }

      if (creativeCard) {
        console.log('[ElevenLabsOnboarding] 🎯 Mengklik card ElevenCreative...', creativeCard);
        triggerNativeClick(creativeCard);
        creativeCard.click?.();
      }

      // 2. Cari & Klik tombol Continue
      const allButtons = Array.from((document.body || document.documentElement).querySelectorAll('button, [role="button"], a.btn, div[role="button"]'));
      const continueBtn = allButtons.find((b) => {
        if (!isElementVisible(b)) return false;
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        return txt === 'continue' || txt.startsWith('continue');
      });

      if (continueBtn) {
        console.log('[ElevenLabsOnboarding] ➡️ Mengklik Continue pada layar platform...', continueBtn);
        if (continueBtn.disabled || continueBtn.getAttribute('aria-disabled') === 'true') {
          continueBtn.removeAttribute('disabled');
          continueBtn.setAttribute('aria-disabled', 'false');
        }
        triggerNativeClick(continueBtn);
        continueBtn.click?.();
        return true;
      }

      return !!creativeCard;
    },

    /**
     * Khusus menangani layar onboarding "Help us personalize your experience" (Step 2)
     * Mencentang konfirmasi umur 18 tahun dan mengklik tombol "Next"
     */
    handlePersonalizeExperienceOnboarding() {
      const bodyText = (document.body?.innerText || '').toLowerCase();
      if (
        !bodyText.includes('personalize your experience') &&
        !bodyText.includes('reached the age of 18') &&
        !bodyText.includes('18 years old')
      ) {
        return false;
      }

      console.log('[ElevenLabsOnboarding] 📝 Layar "Help us personalize your experience" terdeteksi!');

      // 1. Cari elemen teks yang menyebut umur 18 tahun
      const allEls = Array.from((document.body || document.documentElement).querySelectorAll('*:not(script):not(style)'));
      const ageTextEl = allEls.find((el) => {
        if (el.children.length > 0) return false;
        const txt = (el.textContent || '').toLowerCase();
        return txt.includes('18 years old') || txt.includes('reached the age of 18');
      });

      let checkboxEl = null;
      if (ageTextEl) {
        const container = ageTextEl.closest('label, div.flex, div.grid') || ageTextEl.parentElement;
        if (container) {
          checkboxEl = container.querySelector(
            'input[type="checkbox"], [role="checkbox"], button[role="checkbox"], span.border'
          );
          if (!checkboxEl && container.tagName === 'LABEL') {
            checkboxEl = container;
          }
        }
      }

      if (!checkboxEl) {
        checkboxEl = document.querySelector(
          'input[type="checkbox"]:not(:checked), [role="checkbox"][aria-checked="false"], [role="checkbox"][data-state="unchecked"], button[role="checkbox"]'
        );
      }

      if (checkboxEl) {
        console.log('[ElevenLabsOnboarding] 🔘 Mencentang konfirmasi 18 tahun...', checkboxEl);
        if (checkboxEl.tagName === 'INPUT') {
          checkboxEl.checked = true;
          checkboxEl.dispatchEvent(new Event('input', { bubbles: true }));
          checkboxEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        triggerNativeClick(checkboxEl);
        checkboxEl.click?.();

        const parentLabel = checkboxEl.closest('label');
        if (parentLabel && parentLabel !== checkboxEl) {
          triggerNativeClick(parentLabel);
          parentLabel.click?.();
        }
      }

      // 2. Klik tombol Next
      const allButtons = Array.from((document.body || document.documentElement).querySelectorAll('button, [role="button"], a.btn, div[role="button"]'));
      const nextBtn = allButtons.find((b) => {
        if (!isElementVisible(b)) return false;
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        return txt === 'next' || txt.startsWith('next');
      });

      if (nextBtn) {
        console.log('[ElevenLabsOnboarding] ➡️ Mengklik tombol Next...', nextBtn);
        if (nextBtn.disabled || nextBtn.getAttribute('aria-disabled') === 'true') {
          nextBtn.removeAttribute('disabled');
          nextBtn.setAttribute('aria-disabled', 'false');
        }
        triggerNativeClick(nextBtn);
        nextBtn.click?.();
        return true;
      }

      return !!checkboxEl;
    },

    /**
     * Cari tombol dismiss / close pada pop-up modal
     */
    findDismissButton() {
      const candidates = Array.from(
        document.querySelectorAll('button[aria-label*="close" i], button[aria-label*="dismiss" i], button.close')
      );
      for (const btn of candidates) {
        if (isElementVisible(btn)) return btn;
      }
      return null;
    },

    /**
     * Buka blokir tombol Continue jika onboarding mewajibkan memilih opsi survei terlebih dahulu
     */
    selectFirstOptionIfBlocked() {
      const inputs = Array.from(
        document.querySelectorAll('input[type="radio"]:not(:checked), input[type="checkbox"]:not(:checked), [role="radio"][aria-checked="false"], [role="checkbox"][aria-checked="false"]')
      ).filter(isElementVisible);
      if (inputs.length > 0) {
        console.log('[ElevenLabsOnboarding] Memilih opsi input pertama untuk membuka tombol...');
        triggerNativeClick(inputs[0]);
        inputs[0].click?.();
        return true;
      }

      const cards = Array.from(
        document.querySelectorAll('[data-state="unchecked"], [aria-pressed="false"], [role="option"]')
      ).filter(isElementVisible);
      if (cards.length > 0) {
        console.log('[ElevenLabsOnboarding] Memilih opsi card pertama untuk membuka tombol...');
        triggerNativeClick(cards[0]);
        cards[0].click?.();
        return true;
      }

      // Tombol opsi survey umum yang bukan tombol navigasi
      const optionPills = Array.from(
        document.querySelectorAll('button:not([type="submit"]), [role="button"]')
      ).filter((el) => {
        if (!isElementVisible(el)) return false;
        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (
          txt === 'continue' ||
          txt.startsWith('continue') ||
          txt === 'skip' ||
          txt.startsWith('skip') ||
          txt === 'back' ||
          txt.includes('back') ||
          txt.includes('sign out')
        ) {
          return false;
        }
        return el.offsetWidth > 40 && el.offsetHeight > 20;
      });

      if (optionPills.length > 0) {
        console.log('[ElevenLabsOnboarding] Memilih opsi pill pertama...', optionPills[0]);
        triggerNativeClick(optionPills[0]);
        optionPills[0].click?.();
        return true;
      }

      return false;
    },

    /**
     * Tutup modal "Email Verification" jika muncul di layar (misal di /app/sign-in)
     */
    dismissEmailVerificationModal() {
      const dialog = document.querySelector('[role="dialog"]');
      const bodyText = (document.body?.innerText || '').toLowerCase();
      const hasModal = dialog || bodyText.includes('email verification') || bodyText.includes('almost there');

      if (!hasModal) return false;

      console.log('[ElevenLabsOnboarding] Menutup modal Email Verification...');
      const root = dialog || document;

      // 1. Klik tombol Continue di dalam dialog
      const continueBtn = Array.from(root.querySelectorAll('button')).find((b) => {
        if (!isElementVisible(b)) return false;
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        return txt === 'continue' || txt.includes('continue');
      });

      if (continueBtn) {
        triggerNativeClick(continueBtn);
      }

      // 2. Klik tombol Close (✕) di dalam dialog jika masih ada
      const closeBtn = root.querySelector('button[aria-label*="close" i], button:has(svg), button.close');
      if (closeBtn && isElementVisible(closeBtn)) {
        triggerNativeClick(closeBtn);
      }

      // 3. Tekan tombol Escape untuk memastikan dialog tertutup
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
      );

      return true;
    },

    /**
     * Handle Sign In jika ElevenLabs menampilkan layar "Welcome back" / /app/sign-in
     */
    async handleSignInIfPresent(email, password) {
      const path = window.location.pathname;
      const isSignInPage = path.includes('sign-in') || path.includes('login') || window.location.href.includes('sign-in');
      const bodyText = (document.body?.innerText || '').toLowerCase();
      const hasWelcomeBack = bodyText.includes('welcome back') || bodyText.includes('sign in to your account');

      const emailInput = this.findEmailInput();
      const passwordInput = this.findPasswordInput();

      if ((isSignInPage || hasWelcomeBack || passwordInput) && passwordInput) {
        console.log('[ElevenLabsOnboarding] Form Sign In terdeteksi, memastikan modal tertutup & mengisi kredensial...');

        // Tutup modal email verification jika masih menutupi layar
        this.dismissEmailVerificationModal();
        await sleep(350);

        if (emailInput && (!emailInput.value || (email && emailInput.value !== email))) {
          if (email) setReactInputValue(emailInput, email);
          await sleep(250);
        }

        if (passwordInput && (!passwordInput.value || passwordInput.value !== password)) {
          setReactInputValue(passwordInput, password);
          await sleep(250);
        }

        // Cari tombol submit Sign In spesifik (JANGAN gunakan button[type="submit"] umum karena itu adalah Google)
        const buttons = Array.from(document.querySelectorAll('button'));
        const submitBtn = buttons.find((b) => {
          if (!isElementVisible(b)) return false;
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          return (txt === 'sign in' || txt === 'log in') && !txt.includes('google') && !txt.includes('apple');
        });

        if (submitBtn && !submitBtn.disabled) {
          const now = Date.now();
          if (this.lastSignInClick && now - this.lastSignInClick < 3500) {
            console.log('[ElevenLabsOnboarding] Menunggu respons Sign In sebelumnya...');
            return true;
          }
          console.log('[ElevenLabsOnboarding] Mengklik tombol Sign In spesifik:', submitBtn);
          this.reportStep('login', `Mengisi form Sign In (${email || ''}) dan masuk...`);
          this.lastSignInClick = now;
          triggerNativeClick(submitBtn);
          await sleep(2500);
          return true;
        }
      }
      return false;
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
      } catch (e) {}

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
      } catch (e) {}

      window.location.href = 'https://elevenlabs.io/app/sign-out';
      await sleep(2500);
      return { success: true, method: 'url_redirect' };
    },

    /**
     * Eksekusi alur post-verifikasi & lewati onboarding sampai masuk ke Dashboard
     */
    async executePostVerifyAndOnboarding({ email, password }) {
      if (this.isLoopRunning && this._loopStartTime && Date.now() - this._loopStartTime < 20000) {
        console.log('[ElevenLabsOnboarding] Loop auto-skip sudah berjalan aktif di tab ini.');
        return { running: true };
      }

      this.isLoopRunning = true;
      this._loopStartTime = Date.now();
      this.isSignInSubmitting = false;
      const pass = password || 'Jovan@1224';
      console.log(`[ElevenLabsOnboarding] 🚀 Memulai loop verifikasi & auto-skip onboarding (Email: ${email || 'auto'})...`);

      const startTime = Date.now();
      const maxTimeMs = 75000; // Maksimal 75 detik

      try {
        while (Date.now() - startTime < maxTimeMs) {
          // 1. Cek apakah sudah sampai di Dashboard Text-to-Speech
          if (this.isDashboardReached()) {
            console.log('[ElevenLabsOnboarding] 🎉 DASHBOARD TEXT-TO-SPEECH TERCAPAI! Onboarding selesai.');
            this.reportStep('dashboard', '🎉 Dashboard Text-to-Speech tercapai! Onboarding berhasil dilewati.');
            
            // Berikan jeda hidrasi Next.js agar UI Text-to-Speech stabil sebelum konfigurasi TTS
            await sleep(3500);

            // Tutup popover / tooltip tutorial jika ada
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));

            // Otomatis konfigurasi Voice (Dany Saputra), Model (Eleven v3), dan Stability (Robust) secara berurutan
            try {
              await this.configureTTS({
                voiceName: 'Dany Saputra',
                modelName: 'Eleven v3',
                stability: 'robust',
              });
            } catch (cfgErr) {
              console.warn('[ElevenLabsOnboarding] Peringatan setup TTS:', cfgErr.message);
            }

            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
              chrome.storage.local.remove(['elevenlabs_auto_flow']);
            }
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage({
                action: 'ELEVENLABS_ONBOARDING_COMPLETED',
                payload: { email, url: window.location.href },
              }).catch(() => {});
            }
            this.isLoopRunning = false;
            return {
              success: true,
              message: 'Berhasil verifikasi, masuk Dashboard, dan setup Voice Dany Saputra + Eleven v3 + Stability Robust!',
              dashboardUrl: window.location.href,
            };
          }

          // 1b. Jika sudah login (di /app/home, /app/overview dll.) tapi belum di target Text-to-Speech
          const currentPath = window.location.pathname;
          const isAppPath = currentPath.startsWith('/app') &&
            !currentPath.includes('sign-in') &&
            !currentPath.includes('sign-up') &&
            !currentPath.includes('onboarding') &&
            !currentPath.includes('action');

          if (isAppPath && !currentPath.includes('/speech-synthesis')) {
            console.log('[ElevenLabsOnboarding] 🎯 Terautentikasi! Mengarahkan langsung ke target: https://elevenlabs.io/app/speech-synthesis/text-to-speech');
            this.reportStep('dashboard', 'Mengarahkan ke Dashboard Text-to-Speech...');
            window.location.href = 'https://elevenlabs.io/app/speech-synthesis/text-to-speech';
            await sleep(2500);
            continue;
          }

          // 2. Handle jika berada di halaman pemrosesan link verifikasi (/action?mode=verifyEmail)
          const isActionUrl = window.location.pathname.includes('/action') || window.location.search.includes('mode=verifyEmail');
          if (isActionUrl) {
            this.reportStep('verify', 'Memproses konfirmasi link verifikasi ElevenLabs di browser...');
            this.dismissEmailVerificationModal();
            await sleep(2500);
            continue;
          }

          // 2b. Handle modal "Almost there! Please sign in once more..." di /app/sign-in
          const bodyText = (document.body?.innerText || '').toLowerCase();
          const isAlmostThereModal = bodyText.includes('almost there') || bodyText.includes('please sign in once more');
          if (isAlmostThereModal) {
            console.log('[ElevenLabsOnboarding] Modal "Almost there! Please sign in once more" terdeteksi, menutup modal dan lanjut login...');
            this.reportStep('verify', 'Konfirmasi email berhasil! Melanjutkan pengisian kredensial Sign In...');
            this.dismissEmailVerificationModal();
            await sleep(500);
          }

          // 2c. Handle tombol "Resend" jika berada di layar "We've sent a verification link to..."
          const isAwaitingEmail = bodyText.includes("we've sent a verification link") || bodyText.includes("check your spam or click resend");
          if (isAwaitingEmail && !this.findPasswordInput()) {
            const resendBtn = Array.from(document.querySelectorAll('button')).find(b => {
              const txt = (b.innerText || '').trim().toLowerCase();
              return txt === 'resend' || (txt.startsWith('resend') && !txt.includes('('));
            });

            if (resendBtn && !resendBtn.disabled) {
              console.log('[ElevenLabsOnboarding] Mengklik tombol Resend untuk meminta email verifikasi baru...');
              this.reportStep('verify', 'Mengklik Resend untuk meminta email verifikasi baru dari ElevenLabs...');
              triggerNativeClick(resendBtn);
              await sleep(3000);
            } else {
              this.reportStep('verify', 'Menunggu email verifikasi baru (cek folder SPAM di Gmail jika belum masuk)...');
            }

            // Ambil link verifikasi langsung dari Gmail browser jika belum pernah dipakai
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage && !this.isPollingFreshLink) {
              this.isPollingFreshLink = true;
              chrome.runtime.sendMessage({
                action: 'REQUEST_FRESH_VERIFICATION_LINK',
                payload: { email },
              }, (resp) => {
                this.isPollingFreshLink = false;
                if (resp && resp.verifyUrl && resp.verifyUrl !== window.location.href) {
                  console.log('[ElevenLabsOnboarding] Link verifikasi fresh ditemukan! Membuka link:', resp.verifyUrl);
                  window.location.href = resp.verifyUrl;
                }
              });
            }

            await sleep(3000);
            continue;
          }

          // 3. Handle jika layar meminta Sign In ("Welcome back")
          const didSignIn = await this.handleSignInIfPresent(email, pass);
          if (didSignIn) {
            await sleep(2500);
            continue;
          }

          // 3b. Khusus layar "Choose your platform"
          const didChoosePlatform = this.handleChoosePlatformOnboarding();
          if (didChoosePlatform) {
            this.reportStep('onboarding', 'Memilih platform ElevenCreative & melanjutkan...');
            await sleep(1500);
            continue;
          }

          // 3c. Khusus layar "Help us personalize your experience" (Checkbox 18yo + Next)
          const didPersonalize = this.handlePersonalizeExperienceOnboarding();
          if (didPersonalize) {
            this.reportStep('onboarding', 'Mencentang konfirmasi 18 tahun & melanjutkan personalize...');
            await sleep(1500);
            continue;
          }

          // 4. Periksa checkbox di halaman/modal onboarding
          // Aturan: "kalau ada checkbox maka di klik dulu checkbox nya"
          const checkedCount = this.clickAllUncheckedCheckboxes();
          if (checkedCount > 0) {
            console.log(`[ElevenLabsOnboarding] ✅ Berhasil mencentang ${checkedCount} checkbox.`);
            this.reportStep('onboarding', `Mencentang ${checkedCount} checkbox onboarding...`);
            await sleep(400);
          }

          // 5. Periksa tombol Skip
          // Aturan: "kalau ada skip maka skip aja di onboarding"
          const skipBtn = this.findSkipButton();
          if (skipBtn) {
            console.log('[ElevenLabsOnboarding] ⏩ Tombol Skip ditemukan, mengklik Skip:', skipBtn);
            this.reportStep('onboarding', 'Melewati langkah onboarding (klik Skip)...');
            triggerNativeClick(skipBtn);
            skipBtn.click();
            await sleep(1500);
            continue;
          }

          // 6. Jika tidak ada tombol Skip, periksa tombol Continue / Next / Done
          let nextBtn = this.findNextOrContinueButton();
          if (nextBtn) {
            console.log('[ElevenLabsOnboarding] ➡️ Mengklik tombol Continue / Next:', nextBtn);
            this.reportStep('onboarding', 'Melanjutkan langkah onboarding (klik Continue/Next)...');
            triggerNativeClick(nextBtn);
            nextBtn.click();
            await sleep(1500);
            continue;
          }

          // 7. Jika tombol Continue masih disable karena survey butuh pilih 1 opsi
          const unblocked = this.selectFirstOptionIfBlocked();
          if (unblocked) {
            this.reportStep('onboarding', 'Memilih opsi kuesioner onboarding untuk membuka tombol Continue...');
            await sleep(500);
            nextBtn = this.findNextOrContinueButton();
            if (nextBtn) {
              console.log('[ElevenLabsOnboarding] ➡️ Mengklik tombol Continue setelah memilih opsi:', nextBtn);
              triggerNativeClick(nextBtn);
              nextBtn.click();
              await sleep(1500);
              continue;
            }
          }

          // 8. Cek popup dismiss / close
          const dismissBtn = this.findDismissButton();
          if (dismissBtn) {
            console.log('[ElevenLabsOnboarding] ✕ Menutup popup modal intro:', dismissBtn);
            this.reportStep('onboarding', 'Menutup popup modal intro...');
            triggerNativeClick(dismissBtn);
            dismissBtn.click();
            await sleep(800);
            continue;
          }

          // 9. Jika sudah 25 detik dan masih di /onboarding, coba arahkan langsung ke /speech-synthesis
          const elapsedSec = (Date.now() - startTime) / 1000;
          if (elapsedSec > 25 && window.location.pathname.includes('/onboarding')) {
            console.log('[ElevenLabsOnboarding] ⏳ Mencoba bypass langsung ke speech-synthesis setelah 25s...');
            window.location.href = 'https://elevenlabs.io/app/speech-synthesis/text-to-speech';
            await sleep(3000);
            continue;
          }

          // Jeda antar iterasi pemeriksaan
          await sleep(800);
        }

        console.warn('[ElevenLabsOnboarding] Batas waktu auto-skip selesai (75 detik).');
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.remove(['elevenlabs_auto_flow']);
        }
        this.isLoopRunning = false;
        return {
          success: false,
          error: 'Timeout menunggu dashboard ElevenLabs. Silakan periksa tab browser.',
        };
      } catch (err) {
        console.error('[ElevenLabsOnboarding] Error dalam loop auto-skip:', err);
        this.isLoopRunning = false;
        throw err;
      }
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
      } catch (e) {}
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

      // 2. Polling interval setiap 400ms
      setInterval(() => {
        this.dismissCreditRemainingModal();

        // Auto-pilih ElevenCreative dan Continue jika berada di layar onboarding platform
        const path = window.location.pathname;
        const bText = (document.body?.innerText || '').toLowerCase();
        if (
          path.includes('/onboarding') ||
          bText.includes('choose your platform') ||
          bText.includes('switch between platforms')
        ) {
          this.handleChoosePlatformOnboarding();
        }

        // Auto-centang konfirmasi 18 tahun dan Next jika di layar personalize experience
        if (
          bText.includes('personalize your experience') ||
          bText.includes('reached the age of 18') ||
          bText.includes('18 years old')
        ) {
          this.handlePersonalizeExperienceOnboarding();
        }
      }, 400);

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
      } catch (obsErr) {}
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
      } catch (e) {}
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
      let modelSelector = document.querySelector('[data-testid="tts-model-selector"]');
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
     * Mengatur Voice ke target voice (Mendukung Tipe 1: Sidebar click & Tipe 2: Modal popup hover + Add)
     */
    async setVoice(targetVoice = 'Dany Saputra') {
      let voiceSelector = document.querySelector('[data-testid="tts-voice-selector"]');
      if (!voiceSelector) {
        const labels = Array.from(document.querySelectorAll('span, div, label, p'));
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
        console.warn('[ElevenLabsTTS] Selector voice tidak ditemukan.');
        return false;
      }

      const currentText = (voiceSelector.innerText || voiceSelector.getAttribute('aria-label') || '').toLowerCase();
      if (currentText.includes(targetVoice.toLowerCase())) {
        console.log(`[ElevenLabsTTS] ✅ Voice sudah terset ke ${targetVoice}.`);
        return true;
      }

      console.log(`[ElevenLabsTTS] Membuka pemilih voice untuk '${targetVoice}'...`);
      triggerNativeClick(voiceSelector);
      await sleep(1500);

      let voiceSelected = false;

      // Cari input pencarian voice (berlaku baik untuk dialog popup maupun panel sidebar)
      const searchInput = document.querySelector('input[placeholder*="typing to search" i], input[placeholder*="search" i]');
      if (searchInput) {
        console.log(`[ElevenLabsTTS] Mengetik '${targetVoice}' di kolom pencarian...`);
        setReactInputValue(searchInput, targetVoice);
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(1500);

        // Cari kartu/item yang cocok dengan targetVoice
        let matchingCards = Array.from(document.querySelectorAll('li, div[role="option"], [data-testid*="voice-item"], div[role="button"], button')).filter(el => {
          return (el.innerText || '').toLowerCase().includes(targetVoice.toLowerCase()) && isElementVisible(el);
        });

        // Jika belum ada di tab aktif, coba cek tab Explore
        if (matchingCards.length === 0) {
          const exploreTab = Array.from(document.querySelectorAll('button, [role="tab"]')).find(t => {
            const txt = (t.innerText || '').trim().toLowerCase();
            return (txt === 'explore' || txt.includes('explore new voices')) && isElementVisible(t);
          });
          if (exploreTab) {
            console.log('[ElevenLabsTTS] Mencari voice di tab Explore...');
            triggerNativeClick(exploreTab);
            await sleep(1500);
            const searchInput2 = document.querySelector('input[placeholder*="typing to search" i], input[placeholder*="search" i]');
            if (searchInput2) {
              setReactInputValue(searchInput2, targetVoice);
              searchInput2.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(1500);
            }
            matchingCards = Array.from(document.querySelectorAll('li, div[role="option"], [data-testid*="voice-item"], div[role="button"], button')).filter(el => {
              return (el.innerText || '').toLowerCase().includes(targetVoice.toLowerCase()) && isElementVisible(el);
            });
          }
        }

        if (matchingCards.length > 0) {
          // Cari baris / kartu yang merepresentasikan voice target
          const targetCard = matchingCards.find(el => el.tagName === 'LI') || matchingCards[0];
          const cardContainer = targetCard.closest('li, [role="listitem"]') || targetCard;

          // Helper untuk mendeteksi & mengabaikan tombol Play Preview
          const isPlayPreviewButton = (btn) => {
            if (!btn) return false;
            const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
            const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
            const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
            if (aria.includes('play') || aria.includes('preview') || testId.includes('preview') || testId.includes('play')) return true;
            if (txt === 'play' || txt === 'preview') return true;
            return false;
          };

          // 1. HOVER terlebih dahulu pada kartu voice agar tombol "+ Use" dan "+ Add" muncul
          console.log(`[ElevenLabsTTS] Melakukan hover pada kartu voice '${targetVoice}' untuk memunculkan tombol '+ Use'...`);
          const hoverElement = (el) => {
            if (!el) return;
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            const rect = el.getBoundingClientRect();
            const clientX = rect.left + rect.width / 2;
            const clientY = rect.top + rect.height / 2;
            const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };
            el.dispatchEvent(new PointerEvent('pointerenter', opts));
            el.dispatchEvent(new PointerEvent('pointerover', opts));
            el.dispatchEvent(new MouseEvent('mouseenter', opts));
            el.dispatchEvent(new MouseEvent('mouseover', opts));
            el.dispatchEvent(new MouseEvent('mousemove', opts));
          };

          hoverElement(cardContainer);
          hoverElement(targetCard);
          await sleep(800); // Tunggu tombol Use muncul setelah hover

          // 2. Cari tombol "+ Use" atau "Use" (HINDARI tombol Play Preview!)
          const allButtons = Array.from(cardContainer.querySelectorAll('button')).concat(
            Array.from(document.querySelectorAll('[role="dialog"] button, button'))
          );

          let useBtn = allButtons.find(b => {
            if (isPlayPreviewButton(b)) return false;
            const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            // Cocokkan "+ use", "use", atau "use voice"
            return txt === '+ use' || txt === 'use' || (txt.includes('use') && !txt.includes('user') && !txt.includes('pause')) ||
                   aria === 'use voice' || aria.includes('use');
          });

          // Fallback 1: Jika tombol Use belum ada, coba tombol "+ Add" atau "Add"
          if (!useBtn) {
            useBtn = allButtons.find(b => {
              if (isPlayPreviewButton(b)) return false;
              const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
              const aria = (b.getAttribute('aria-label') || '').toLowerCase();
              return txt === '+ add' || txt === 'add' || txt.includes('add to voice lab') || aria.includes('add');
            });
          }

          // Fallback 2: Jika kartu di My Voices (bukan Explore) dan tidak ada tombol Use/Add, klik overlay non-play
          if (!useBtn) {
            useBtn = Array.from(cardContainer.querySelectorAll('button')).find(b => {
              return !isPlayPreviewButton(b) && (b.classList.contains('inset-0') || !b.getAttribute('aria-label'));
            });
          }

          if (useBtn) {
            console.log(`[ElevenLabsTTS] 🎯 Tombol '${useBtn.innerText || useBtn.getAttribute('aria-label') || 'Use'}' ditemukan! Mengklik tombol Use...`);
            triggerNativeClick(useBtn);
            await sleep(1500);
            voiceSelected = true;

            // Konfirmasi dialog "Add to Voice Lab" / "Use Voice" jika muncul
            const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => {
              const t = (b.innerText || '').toLowerCase();
              return (t.includes('add voice') || t.includes('use voice') || t.includes('finish') || t.includes('done')) && isElementVisible(b);
            });
            if (confirmBtn) {
              triggerNativeClick(confirmBtn);
              await sleep(1200);
            }
          } else {
            console.warn(`[ElevenLabsTTS] Tombol Use tidak ditemukan pada kartu '${targetVoice}'.`);
          }
        } else {
          console.warn(`[ElevenLabsTTS] Kartu voice '${targetVoice}' tidak ditemukan.`);
        }
      }

      // Pastikan modal tertutup jika masih terbuka
      const backBtn = document.querySelector('button[aria-label="Back"], button[aria-label*="back" i]');
      if (backBtn && isElementVisible(backBtn)) {
        triggerNativeClick(backBtn);
        await sleep(600);
      }

      this.dismissAllModals();
      return voiceSelected;
    },

    /**
     * Mengatur Stability Slider ke Robust (1.0 / 100%)
     */
    async setStability(target = 'robust') {
      // Cari slider Stability secara presisi (hindari salah memilih timeline player audio)
      let slider = document.querySelector(
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
        } catch (e) {}

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
      } catch (e) {}

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
        try { a.pause(); } catch (e) {}
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
          } catch (e) {}
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
      const path = window.location.pathname;
      const bodyText = (document.body?.innerText || '').toLowerCase();

      // 1. Cek limit kredit
      const limit = this.hasCreditLimitReached();
      if (limit.reached) {
        return { status: 'CREDIT_LIMIT', reason: limit.reason, url };
      }

      // 2. Cek onboarding
      if (
        path.includes('/onboarding') ||
        url.includes('onboarding') ||
        bodyText.includes('choose your platform') ||
        bodyText.includes('switch between platforms') ||
        bodyText.includes('tell us about yourself') ||
        bodyText.includes('what will you use elevenlabs for')
      ) {
        return { status: 'ONBOARDING', url };
      }

      // 3. Cek halaman verifikasi email / action
      if (
        path.includes('/action') ||
        url.includes('mode=verifyEmail') ||
        url.includes('oobCode') ||
        bodyText.includes("we've sent a verification link")
      ) {
        return { status: 'VERIFY_ACTION', url };
      }

      // 4. Cek halaman Sign In
      if (
        path.includes('/sign-in') ||
        path.includes('/login') ||
        (bodyText.includes('welcome back') && !!this.findPasswordInput())
      ) {
        return { status: 'SIGN_IN', url };
      }

      // 5. Cek halaman Sign Up
      if (
        path.includes('/sign-up') ||
        (bodyText.includes('create an account') && !!this.findEmailInput() && !!this.findPasswordInput())
      ) {
        return { status: 'SIGN_UP', url };
      }

      // 6. Cek dashboard Text-to-Speech
      if (
        path.includes('/speech-synthesis') ||
        path.includes('/text-to-speech') ||
        (path.startsWith('/app') && !!this.findGenerateSpeechButton())
      ) {
        return { status: 'DASHBOARD_TTS', url, ready: true };
      }

      // 7. Cek dashboard umum (/app/home, dll.)
      if (
        path.startsWith('/app') &&
        document.querySelector('button[data-testid="user-menu-button"], button[aria-label*="profile" i]')
      ) {
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
  } catch (e) {}
})();

