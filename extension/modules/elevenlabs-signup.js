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

      const matchesDashboardPath = dashboardPaths.some((p) => path.startsWith(p));

      const hasSynthesisInput = !!document.querySelector('textarea, [contenteditable="true"]');
      const isTTSPath = path.includes('/speech-synthesis');

      // Cek apakah ada modal blocking dialog (onboarding / welcome back dialog)
      const hasBlockingDialog = !!document.querySelector(
        '[role="dialog"]:not([aria-hidden="true"]), [data-state="open"][role="dialog"]'
      );

      // Target utama: speech-synthesis / text-to-speech dashboard dengan input editor TTS aktif
      if (isTTSPath && (hasSynthesisInput || !hasBlockingDialog)) {
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
      const dialog = document.querySelector('[role="dialog"]:not([aria-hidden="true"]), [data-state="open"]');
      const root = dialog || document;

      const candidates = Array.from(root.querySelectorAll('button, [role="button"], a.btn'));
      for (const btn of candidates) {
        if (!isElementVisible(btn)) continue;
        if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
        const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (
          text === 'continue' ||
          text === 'next' ||
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
      const radios = Array.from(
        document.querySelectorAll('input[type="radio"]:not(:checked), [role="radio"][aria-checked="false"]')
      ).filter(isElementVisible);
      if (radios.length > 0) {
        console.log('[ElevenLabsOnboarding] Memilih opsi radio pertama untuk membuka tombol...');
        radios[0].click();
        return true;
      }

      const cards = Array.from(
        document.querySelectorAll('[data-state="unchecked"], [aria-pressed="false"], [role="option"]')
      ).filter(isElementVisible);
      if (cards.length > 0) {
        console.log('[ElevenLabsOnboarding] Memilih opsi card pertama untuk membuka tombol...');
        cards[0].click();
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
     * Eksekusi alur post-verifikasi & lewati onboarding sampai masuk ke Dashboard
     */
    async executePostVerifyAndOnboarding({ email, password }) {
      if (this.isLoopRunning) {
        console.log('[ElevenLabsOnboarding] Loop auto-skip sudah berjalan aktif di tab ini.');
        return { running: true };
      }

      this.isLoopRunning = true;
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
            
            // Tutup popover / tooltip tutorial jika ada
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

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
              message: 'Berhasil verifikasi dan masuk ke Dashboard Text-to-Speech ElevenLabs!',
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

            // Cek polling n8n hanya untuk link yang benar-benar fresh (< 5 menit dan belum pernah dipakai)
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
            skipBtn.click();
            await sleep(1200);
            continue;
          }

          // 6. Jika tidak ada tombol Skip, periksa tombol Continue / Next / Done
          let nextBtn = this.findNextOrContinueButton();
          if (nextBtn) {
            console.log('[ElevenLabsOnboarding] ➡️ Mengklik tombol Continue / Next:', nextBtn);
            this.reportStep('onboarding', 'Melanjutkan langkah onboarding (klik Continue/Next)...');
            nextBtn.click();
            await sleep(1200);
            continue;
          }

          // 7. Jika tombol Continue masih disable karena survey butuh pilih 1 opsi
          const unblocked = this.selectFirstOptionIfBlocked();
          if (unblocked) {
            this.reportStep('onboarding', 'Memilih opsi kuesioner onboarding untuk membuka tombol Continue...');
            await sleep(400);
            nextBtn = this.findNextOrContinueButton();
            if (nextBtn) {
              console.log('[ElevenLabsOnboarding] ➡️ Mengklik tombol Continue setelah memilih opsi:', nextBtn);
              nextBtn.click();
              await sleep(1200);
              continue;
            }
          }

          // 8. Cek popup dismiss / close
          const dismissBtn = this.findDismissButton();
          if (dismissBtn) {
            console.log('[ElevenLabsOnboarding] ✕ Menutup popup modal intro:', dismissBtn);
            this.reportStep('onboarding', 'Menutup popup modal intro...');
            dismissBtn.click();
            await sleep(800);
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
     * Handler pesan masuk dari Side Panel atau Background Script
     */
    async handleMessage(message) {
      if (message.action === 'EXECUTE_ELEVENLABS_SIGNUP') {
        return await this.executeSignup(message.payload || {});
      }

      if (message.action === 'EXECUTE_POST_VERIFY_ONBOARDING') {
        return await this.executePostVerifyAndOnboarding(message.payload || {});
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
        msg.action === 'EXECUTE_POST_VERIFY_ONBOARDING' ||
        msg.action === 'PING_ELEVENLABS_TAB'
      ) {
        ElevenLabsSignupModule.handleMessage(msg)
          .then((res) => sendResponse({ success: true, ...res }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;
      }
    });
  }
})();

