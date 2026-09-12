// extension/modules/elevenlabs-signup.js
// Modul otomatisasi Sign Up ElevenLabs
// Berjalan di dalam content script browser (DOM asli) pada https://elevenlabs.io/*

(function () {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Helper untuk mengisi input controlled-component di React / Next.js
   */
  function setReactInputValue(inputEl, value) {
    if (!inputEl) return;
    inputEl.focus();

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(inputEl, value);
    } else {
      inputEl.value = value;
    }

    inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  const ElevenLabsSignupModule = {
    name: 'elevenlabsSignup',

    init() {
      console.log('[ElevenLabsSignup] Modul otomatisasi Signup ElevenLabs aktif di tab.');
    },

    /**
     * Cari elemen input email dengan berbagai selector fallback
     */
    findEmailInput() {
      const selectors = [
        'input[type="email"]',
        'input[autocomplete="email"]',
        'input[name="email"]',
        'input[placeholder*="email" i]',
        'input[aria-label*="email" i]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return el;
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
        if (el && el.offsetParent !== null) return el;
      }
      return null;
    },

    /**
     * Cari tombol submit "Sign up"
     */
    findSubmitButton() {
      const submitByType = document.querySelector('button[type="submit"]');
      if (submitByType) return submitByType;

      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find((btn) => {
        const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        return txt === 'sign up' || txt === 'sign-up' || txt.includes('create account');
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
        await sleep(400);
      }
      throw new Error('Form signup ElevenLabs tidak ditemukan setelah 15 detik. Pastikan berada di halaman https://elevenlabs.io/sign-up.');
    },

    /**
     * Jalankan proses otomatisasi signup
     */
    async executeSignup({ email, password }) {
      if (!email || !password) {
        throw new Error('Email dan password wajib disediakan untuk signup.');
      }

      console.log(`[ElevenLabsSignup] Memulai otomatisasi signup untuk email: ${email}`);

      // 1. Tunggu input email & password
      const { emailInput, passwordInput } = await this.waitForFormElements();
      console.log('[ElevenLabsSignup] Form terdeteksi, mengisi data...');

      await sleep(300);

      // 2. Isi email
      setReactInputValue(emailInput, email);
      await sleep(400);

      // 3. Isi password
      setReactInputValue(passwordInput, password);
      await sleep(500);

      // 4. Cari tombol Sign up
      let submitBtn = this.findSubmitButton();
      if (!submitBtn) {
        throw new Error('Tombol "Sign up" tidak ditemukan di halaman.');
      }

      // 5. Tunggu tombol enable jika masih disabled
      let waitDisabledCount = 0;
      while (submitBtn && submitBtn.disabled && waitDisabledCount < 20) {
        // Re-dispatch input events to trigger React re-render
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);
        waitDisabledCount++;
        submitBtn = this.findSubmitButton();
      }

      if (submitBtn && submitBtn.disabled) {
        console.warn('[ElevenLabsSignup] Tombol masih disabled, mencoba klik paksa...');
        submitBtn.disabled = false;
      }

      console.log('[ElevenLabsSignup] Mengklik tombol Sign up...');
      submitBtn.click();

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

        // Cek apakah ada pesan error di form (misal: "email already in use")
        const errorNodes = document.querySelectorAll('[role="alert"], .tw-text-red-500, .text-danger, .error-message');
        for (const err of errorNodes) {
          const errTxt = err.innerText?.trim();
          if (errTxt && errTxt.length > 3 && !errTxt.toLowerCase().includes('password')) {
            throw new Error(`ElevenLabs Error: ${errTxt}`);
          }
        }

        // Cek apakah halaman beralih ke halaman verifikasi atau terdapat teks verifikasi
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
     * Handler pesan masuk dari Side Panel atau Background Script
     */
    async handleMessage(message) {
      if (message.action === 'EXECUTE_ELEVENLABS_SIGNUP') {
        return await this.executeSignup(message.payload || {});
      }

      if (message.action === 'PING_ELEVENLABS_TAB') {
        return {
          ready: true,
          url: window.location.href,
          hasForm: !!(this.findEmailInput() && this.findPasswordInput()),
        };
      }

      return null;
    }
  };

  // Daftarkan ke Global Registry ContentAuto
  if (window.ContentAuto && typeof window.ContentAuto.registerModule === 'function') {
    window.ContentAuto.registerModule('elevenlabsSignup', ElevenLabsSignupModule);
  } else {
    // Fallback standalone listener jika content.js dimuat setelahnya atau terpisah
    window.__ELEVENLABS_SIGNUP_MODULE__ = ElevenLabsSignupModule;
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.module === 'elevenlabsSignup' || msg.action === 'EXECUTE_ELEVENLABS_SIGNUP' || msg.action === 'PING_ELEVENLABS_TAB') {
        ElevenLabsSignupModule.handleMessage(msg)
          .then((res) => sendResponse({ success: true, ...res }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;
      }
    });
  }
})();
