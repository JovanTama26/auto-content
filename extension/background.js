// extension/background.js
// Service Worker utama - bertindak sebagai router/dispatcher modul otomatisasi

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[Background] Side Panel behavior error:', error));

// Import modul-modul background terisolasi
importScripts('modules/chunk-validator-bg.js', 'lib/elevenlabs-verify.js');

console.log('[Background] Service worker siap & modul terisolasi dimuat.');

// Central Background Message Router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. Modul Chunk Validator
  if (message.module === 'chunkValidator' || message.action === 'VALIDATE_DRIVE_FILE') {
    self.ChunkValidatorBackground.validateFileInDrive(message.tabId, message.filename)
      .then((res) => sendResponse({ success: true, ...res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // async
  }

  if (message.action === 'SELECT_DRIVE_FILE') {
    self.ChunkValidatorBackground.selectAndInsertFileInDrive(message.tabId, message.filename)
      .then((res) => sendResponse({ success: true, ...res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // async
  }

  // 2. Modul ElevenLabs Signup Automation
  if (message.action === 'OPEN_AND_SIGNUP_ELEVENLABS') {
    (async () => {
      try {
        const { email, password } = message.payload || {};
        if (!email || !password) {
          throw new Error('Email dan password wajib ada');
        }

        // Cari apakah tab elevenlabs.io/app/sign-up atau sign-up sudah terbuka
        const tabs = await chrome.tabs.query({ url: '*://elevenlabs.io/*' });
        let targetTab = tabs.find((t) => t.url && (t.url.includes('elevenlabs.io/app/sign-up') || t.url.includes('elevenlabs.io/sign-up')));

        if (targetTab && targetTab.id) {
          await chrome.tabs.update(targetTab.id, { url: 'https://elevenlabs.io/app/sign-up', active: true });
          await chrome.tabs.reload(targetTab.id);
        } else {
          targetTab = await chrome.tabs.create({ url: 'https://elevenlabs.io/app/sign-up', active: true });
        }

        // Tunggu tab selesai memuat halaman (status: complete)
        await new Promise((resolve) => {
          let timeoutId;
          function listener(tabId, changeInfo) {
            if (tabId === targetTab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              clearTimeout(timeoutId);
              resolve();
            }
          }
          chrome.tabs.onUpdated.addListener(listener);
          timeoutId = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 9000);
        });

        // Delay untuk Next.js / React hydration
        await new Promise((r) => setTimeout(r, 2000));

        // Kirim perintah signup ke Content Script di tab ElevenLabs dengan retry aman
        let res = null;
        let lastErr = null;
        for (let attempt = 1; attempt <= 8; attempt++) {
          try {
            res = await chrome.tabs.sendMessage(targetTab.id, {
              module: 'elevenlabsSignup',
              action: 'EXECUTE_ELEVENLABS_SIGNUP',
              payload: { email, password },
            });
            if (res) break;
          } catch (sendErr) {
            lastErr = sendErr;
            console.log(`[Background] Menunggu content script ElevenLabs siap (percobaan ${attempt}/8)...`);
            await new Promise((r) => setTimeout(r, 1200));
          }
        }

        if (!res && lastErr) {
          throw new Error(`Content script ElevenLabs belum merespons: ${lastErr.message}`);
        }

        sendResponse({ success: true, tabId: targetTab.id, ...res });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // async
  }

  // 3. Modul ElevenLabs Account Activation via verifyUrl & Auto-Onboarding
  if (message.action === 'VERIFY_ELEVENLABS_ACCOUNT') {
    (async () => {
      try {
        const { verifyUrl, tabId, email, password } = message.payload || {};
        if (!verifyUrl) throw new Error('verifyUrl tidak valid');

        const defaultPassword = password || 'Jovan@1224';

        // Simpan state auto flow agar content script otomatis melanjutkan auto-skip di setiap halaman redirect
        await chrome.storage.local.set({
          elevenlabs_auto_flow: {
            active: true,
            email: email || '',
            password: defaultPassword,
            startedAt: Date.now(),
          },
        });

        let targetTabId = tabId;
        if (targetTabId) {
          try {
            await chrome.tabs.update(targetTabId, { url: verifyUrl, active: true });
          } catch (e) {
            const newTab = await chrome.tabs.create({ url: verifyUrl, active: true });
            targetTabId = newTab.id;
          }
        } else {
          const newTab = await chrome.tabs.create({ url: verifyUrl, active: true });
          targetTabId = newTab.id;
        }

        // Tunggu tab aktivasi selesai memuat
        await new Promise((resolve) => {
          let timeoutId;
          function listener(tid, changeInfo) {
            if (tid === targetTabId && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              clearTimeout(timeoutId);
              resolve();
            }
          }
          chrome.tabs.onUpdated.addListener(listener);
          timeoutId = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 12000);
        });

        // Berikan waktu sejenak untuk hydration Next.js
        await new Promise((r) => setTimeout(r, 1200));

        // Kirim sinyal eksekusi langsung ke content script di tab ElevenLabs
        try {
          chrome.tabs.sendMessage(targetTabId, {
            module: 'elevenlabsSignup',
            action: 'EXECUTE_POST_VERIFY_ONBOARDING',
            payload: { email, password: defaultPassword },
          }).catch(() => {});
        } catch (e) {
          // Handled via storage fallback
        }

        sendResponse({ success: true, tabId: targetTabId });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // async
  }

  // 4. Modul Polling Link Verifikasi Baru jika ElevenLabs meminta verifikasi tambahan pada saat login
  if (message.action === 'REQUEST_FRESH_VERIFICATION_LINK') {
    (async () => {
      try {
        const { email } = message.payload || {};
        if (!email) throw new Error('Email tidak boleh kosong');
        console.log(`[Background] Menerima permintaan link verifikasi email tambahan untuk: ${email}`);

        const verifyData = await self.ElevenLabsVerify.pollForVerifyUrl(email, {
          maxAttempts: 10,
          intervalMs: 3000,
          initialDelayMs: 2000,
          requireFresh: true,
        });

        if (verifyData && verifyData.verifyUrl) {
          console.log(`[Background] Link verifikasi baru ditemukan: ${verifyData.verifyUrl}`);
          sendResponse({ success: true, verifyUrl: verifyData.verifyUrl });
        } else {
          sendResponse({ success: false, error: 'Link verifikasi tidak ditemukan di inbox' });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // async
  }
});
