// extension/background.js
// Service Worker utama - bertindak sebagai router/dispatcher modul otomatisasi

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[Background] Side Panel behavior error:', error));

// Import modul-modul background terisolasi
importScripts('modules/chunk-validator-bg.js');

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

        // Cari apakah tab elevenlabs.io/sign-up sudah terbuka
        const tabs = await chrome.tabs.query({ url: '*://elevenlabs.io/*' });
        let targetTab = tabs.find((t) => t.url && t.url.includes('elevenlabs.io/sign-up'));

        if (targetTab && targetTab.id) {
          await chrome.tabs.update(targetTab.id, { active: true });
        } else {
          targetTab = await chrome.tabs.create({ url: 'https://elevenlabs.io/sign-up', active: true });
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

        // Delay singkat untuk Next.js / React hydration
        await new Promise((r) => setTimeout(r, 1200));

        // Kirim perintah signup ke Content Script di tab ElevenLabs
        const res = await chrome.tabs.sendMessage(targetTab.id, {
          module: 'elevenlabsSignup',
          action: 'EXECUTE_ELEVENLABS_SIGNUP',
          payload: { email, password },
        });

        sendResponse({ success: true, tabId: targetTab.id, ...res });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // async
  }

  // 3. Modul ElevenLabs Account Activation via verifyUrl
  if (message.action === 'VERIFY_ELEVENLABS_ACCOUNT') {
    (async () => {
      try {
        const { verifyUrl, tabId } = message.payload || {};
        if (!verifyUrl) throw new Error('verifyUrl tidak valid');

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

        sendResponse({ success: true, tabId: targetTabId });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // async
  }
});
