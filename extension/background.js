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

  /**
   * Helper pembersihan TOTAL sesi ElevenLabs:
   * 1. Hapus localStorage, sessionStorage, IndexedDB, dan document.cookie via eksekusi script di seluruh tab ElevenLabs
   * 2. Tutup seluruh tab ElevenLabs tanpa terkecuali
   * 3. Bersihkan data via chrome.browsingData.remove (origins: elevenlabs.io & subdomains)
   * 4. Hapus seluruh cookies via chrome.cookies.getAll({}) dengan variasi URL, storeId, & partitionKey
   * 5. Bersihkan storage local auto flow
   */
  async function clearAllElevenLabsSession() {
    console.log('[Background] 🧹 Memulai pembersihan TOTAL sesi & cookies ElevenLabs...');

    // 1. Eksekusi pembersihan DOM storage di seluruh tab ElevenLabs sebelum ditutup
    try {
      const allTabs = await chrome.tabs.query({});
      const elevenTabs = allTabs.filter(
        (t) => t.url && t.url.toLowerCase().includes('elevenlabs')
      );

      for (const tab of elevenTabs) {
        try {
          if (chrome.scripting && tab.id) {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                try { localStorage.clear(); } catch (e) {}
                try { sessionStorage.clear(); } catch (e) {}
                try {
                  const cookies = document.cookie ? document.cookie.split(';') : [];
                  cookies.forEach((c) => {
                    const eqPos = c.indexOf('=');
                    const name = eqPos > -1 ? c.substring(0, eqPos).trim() : c.trim();
                    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.elevenlabs.io`;
                    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=elevenlabs.io`;
                    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
                  });
                } catch (e) {}
                try {
                  if (window.indexedDB && window.indexedDB.databases) {
                    window.indexedDB.databases().then((dbs) => {
                      (dbs || []).forEach((db) => {
                        if (db && db.name) window.indexedDB.deleteDatabase(db.name);
                      });
                    });
                  }
                } catch (e) {}
              },
            }).catch(() => {});
          }
        } catch (scriptErr) {
          // Tab mungkin sedang navigating/closing
        }
      }
    } catch (tabErr) {
      console.warn('[Background] Warning clearing elevenlabs tabs storage:', tabErr);
    }

    // 2. Bersihkan via chrome.browsingData.remove jika tersedia
    if (chrome.browsingData && typeof chrome.browsingData.remove === 'function') {
      try {
        await chrome.browsingData.remove(
          {
            origins: [
              'https://elevenlabs.io',
              'https://api.elevenlabs.io',
              'https://auth.elevenlabs.io',
              'https://www.elevenlabs.io',
              'http://elevenlabs.io',
            ],
          },
          {
            cache: true,
            cookies: true,
            fileSystems: true,
            indexedDB: true,
            localStorage: true,
            serviceWorkers: true,
            webSQL: true,
          }
        );
        console.log('[Background] 🧹 chrome.browsingData.remove sukses.');
      } catch (bDataErr) {
        console.warn('[Background] chrome.browsingData.remove warning:', bDataErr);
      }
    }

    // 3. Hapus seluruh cookies ElevenLabs dari semua store
    if (chrome.cookies) {
      try {
        const allCookies = await chrome.cookies.getAll({});
        const elevenCookies = allCookies.filter(
          (c) =>
            (c.domain && c.domain.toLowerCase().includes('elevenlabs')) ||
            (c.name && c.name.toLowerCase().includes('elevenlabs'))
        );

        console.log(`[Background] 🧹 Menghapus ${elevenCookies.length} cookies ElevenLabs...`);

        for (const c of elevenCookies) {
          const cleanDomain = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
          const urlVariants = [
            `https://${cleanDomain}${c.path || '/'}`,
            `http://${cleanDomain}${c.path || '/'}`,
            `https://elevenlabs.io${c.path || '/'}`,
            `https://api.elevenlabs.io${c.path || '/'}`,
            `https://auth.elevenlabs.io${c.path || '/'}`,
            `https://www.elevenlabs.io${c.path || '/'}`,
          ];

          for (const u of urlVariants) {
            const details = { url: u, name: c.name };
            if (c.storeId) details.storeId = c.storeId;
            if (c.partitionKey) details.partitionKey = c.partitionKey;
            await chrome.cookies.remove(details).catch(() => {});
          }
        }
      } catch (cErr) {
        console.warn('[Background] Warning clear cookies:', cErr);
      }
    }

    // 4. Bersihkan state storage lokal
    try {
      await chrome.storage.local.remove(['elevenlabs_auto_flow']);
    } catch (e) {}

    // Beri jeda 1.2 detik agar browser tuntas menutup koneksi sesi
    await new Promise((r) => setTimeout(r, 1200));
    console.log('[Background] ✅ Pembersihan TOTAL sesi & cookies ElevenLabs tuntas.');
  }

  /**
   * Helper pengiriman pesan yang aman ke content script ElevenLabs.
   * Jika content script belum terinjeksi atau terputus (karena ekstensi di-reload),
   * secara otomatis menginjeksi modules/elevenlabs-signup.js terlebih dahulu lalu mencoba kembali.
   */
  async function safeSendMessageToElevenLabsTab(tabId, messagePayload) {
    try {
      return await chrome.tabs.sendMessage(tabId, messagePayload);
    } catch (err) {
      console.warn(`[Background] Tabs sendMessage gagal pada tab ${tabId}, mencoba injeksi ulang script...`);
      try {
        if (chrome.scripting && tabId) {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js', 'modules/elevenlabs-signup.js'],
          }).catch(() => {});
          await new Promise((r) => setTimeout(r, 400));
          return await chrome.tabs.sendMessage(tabId, messagePayload);
        }
      } catch (injErr) {
        console.warn('[Background] Gagal retry sendMessage setelah injeksi:', injErr.message);
      }
      throw err;
    }
  }

  // 1b. Modul Notifikasi Captcha ElevenLabs (Fokuskan tab & window agar pengguna dapat menyelesaikannya langsung)
  if (message.action === 'ELEVENLABS_CAPTCHA_ALERT') {
    (async () => {
      try {
        if (sender.tab?.id && message.payload?.active) {
          await chrome.tabs.update(sender.tab.id, { active: true });
          if (sender.tab.windowId) {
            await chrome.windows.update(sender.tab.windowId, { focused: true });
          }
        }
      } catch (e) { }
    })();
  }

  // 2. Modul ElevenLabs Signup Automation
  if (message.action === 'OPEN_AND_SIGNUP_ELEVENLABS') {
    (async () => {
      try {
        const { email, password } = message.payload || {};
        if (!email || !password) {
          throw new Error('Email dan password wajib ada');
        }

        // Cari apakah ada tab ElevenLabs yang sedang terbuka
        const allTabs = await chrome.tabs.query({});
        let targetTab = allTabs.find(
          (t) => t.url && t.url.toLowerCase().includes('elevenlabs.io')
        );

        if (targetTab && targetTab.id) {
          console.log('[Background] Mengarahkan tab ElevenLabs yang ada ke halaman sign-up (tanpa menutup tab)...');
          if (targetTab.windowId) {
            await chrome.windows.update(targetTab.windowId, { focused: true }).catch(() => {});
          }

          console.log('[Background] Memuat ulang tab ElevenLabs ke halaman sign-up agar form bersih...');
          await chrome.tabs.update(targetTab.id, { url: 'https://elevenlabs.io/app/sign-up', active: true });
          await chrome.tabs.reload(targetTab.id);
          // Tunggu tab selesai memuat halaman sign-up (status: complete)
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
            }, 12000);
          });
          await new Promise((r) => setTimeout(r, 2200));
        } else {
          console.log('[Background] Membuka tab baru ke halaman sign-up...');
          targetTab = await chrome.tabs.create({ url: 'https://elevenlabs.io/app/sign-up', active: true });
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
            }, 12000);
          });
          await new Promise((r) => setTimeout(r, 2200));
        }

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

  // 2a-2. Modul Login / Sign In Akun Terdaftar ElevenLabs
  if (message.action === 'EXECUTE_ELEVENLABS_SIGNIN') {
    (async () => {
      try {
        const { email, password, tabId } = message.payload || {};
        let targetId = tabId;
        if (!targetId) {
          const allTabs = await chrome.tabs.query({});
          const tTab = allTabs.find((t) => t.url && t.url.toLowerCase().includes('elevenlabs.io'));
          targetId = tTab?.id;
        }
        if (!targetId) throw new Error('Tab ElevenLabs tidak ditemukan.');

        const res = await safeSendMessageToElevenLabsTab(targetId, {
          module: 'elevenlabsSignup',
          action: 'EXECUTE_ELEVENLABS_SIGNIN',
          payload: { email, password },
        });
        sendResponse({ success: true, tabId: targetId, ...res });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // async
  }

  // 2b. Modul Hapus SEMUA cookies elevenlabs.io tanpa terkecuali & tutup semua tab ElevenLabs
  if (message.action === 'CLEAR_COOKIES_AND_CLOSE_ELEVENLABS_TABS') {
    (async () => {
      try {
        await clearAllElevenLabsSession();
        sendResponse({ success: true });
      } catch (err) {
        console.error('[Background] Error clear cookies & close tabs:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // async
  }

  // 2c. Modul Sign Out Akun ElevenLabs Secara Bersih
  if (message.action === 'SIGN_OUT_ELEVENLABS') {
    (async () => {
      try {
        console.log('[Background] 🚪 Melakukan Sign Out akun ElevenLabs...');
        const allTabs = await chrome.tabs.query({});
        const elevenTabs = allTabs.filter(
          (t) => t.url && t.url.toLowerCase().includes('elevenlabs.io')
        );

        let signedOut = false;
        for (const tab of elevenTabs) {
          try {
            const res = await safeSendMessageToElevenLabsTab(tab.id, {
              module: 'elevenlabsSignup',
              action: 'EXECUTE_ELEVENLABS_SIGNOUT',
            }).catch(() => null);

            if (res && res.success) {
              signedOut = true;
              break;
            }
          } catch (e) {}
        }

        // Jika content script belum merespons, navigasikan tab ke /app/sign-out
        if (!signedOut && elevenTabs.length > 0) {
          const targetTab = elevenTabs[0];
          await chrome.tabs.update(targetTab.id, { url: 'https://elevenlabs.io/app/sign-out', active: true });
          await new Promise((resolve) => {
            let tid;
            function listener(id, info) {
              if (id === targetTab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                clearTimeout(tid);
                resolve();
              }
            }
            chrome.tabs.onUpdated.addListener(listener);
            tid = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }, 6000);
          });
          await new Promise((r) => setTimeout(r, 1200));
        }

        sendResponse({ success: true });
      } catch (err) {
        console.error('[Background] Error Sign Out ElevenLabs:', err);
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

  // 4. Modul Ekstraksi Link Verifikasi Langsung dari Gmail (0 External API)
  if (message.action === 'FETCH_GMAIL_VERIFICATION_LINK') {
    (async () => {
      try {
        const { email, maxWaitSeconds, pollIntervalMs } = message.payload || {};
        console.log(`[Background] Memulai pengambilan link verifikasi untuk: ${email || 'target'}`);

        const onProgress = (msg, attempt) => {
          chrome.runtime.sendMessage({
            action: 'GMAIL_VERIFY_PROGRESS',
            payload: { message: msg, attempt },
          }).catch(() => {});
        };

        const result = await self.ElevenLabsVerify.pollForVerifyUrl(email, {
          maxWaitSeconds: maxWaitSeconds || 90,
          pollIntervalMs: pollIntervalMs || 2000,
          onProgress,
        });

        sendResponse({ success: true, ...result });
      } catch (err) {
        console.error('[Background] Gagal mengambil link verifikasi:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // async
  }

  // 5. Modul Polling Link Verifikasi Baru jika ElevenLabs meminta verifikasi tambahan pada saat login
  if (message.action === 'REQUEST_FRESH_VERIFICATION_LINK') {
    (async () => {
      try {
        const { email } = message.payload || {};
        if (!email) throw new Error('Email tidak boleh kosong');
        console.log(`[Background] Menerima permintaan link verifikasi email tambahan untuk: ${email}`);

        const onProgress = (msg, attempt) => {
          chrome.runtime.sendMessage({
            action: 'GMAIL_VERIFY_PROGRESS',
            payload: { message: msg, attempt },
          }).catch(() => {});
        };

        const verifyData = await self.ElevenLabsVerify.pollForVerifyUrl(email, {
          maxWaitSeconds: 45,
          pollIntervalMs: 2000,
          onProgress,
        });

        if (verifyData && verifyData.verifyUrl) {
          console.log(`[Background] Link verifikasi baru ditemukan: ${verifyData.verifyUrl}`);
          sendResponse({ success: true, verifyUrl: verifyData.verifyUrl });
        } else {
          sendResponse({ success: false, error: 'Link verifikasi tidak ditemukan' });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // async
  }

  // 5a. Buka/Aktifkan Tab ElevenLabs dan Tunggu Sampai Posisi Halaman Benar-Benar Stabil (Settle)
  if (message.action === 'ENSURE_AND_DETECT_ELEVENLABS_SESSION') {
    (async () => {
      try {
        const allTabs = await chrome.tabs.query({});
        let targetTab = allTabs.find(
          (t) => t.url && t.url.toLowerCase().includes('elevenlabs.io')
        );

        // Jika belum ada tab ElevenLabs sama sekali, buka tab baru secara otomatis
        if (!targetTab || !targetTab.id) {
          console.log('[Background] 🌐 Belum ada tab ElevenLabs, membuka tab baru otomatis ke speech-synthesis...');
          targetTab = await chrome.tabs.create({
            url: 'https://elevenlabs.io/app/speech-synthesis',
            active: true,
          });

          // Tunggu tab selesai memuat dokumen awal
          await new Promise((resolve) => {
            let tid;
            function listener(id, info) {
              if (id === targetTab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                clearTimeout(tid);
                resolve();
              }
            }
            chrome.tabs.onUpdated.addListener(listener);
            tid = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }, 8000);
          });
          // Berikan jeda 2.5 detik untuk redirect awal Next.js (bisa ke /onboarding, /sign-in, dll)
          await new Promise((r) => setTimeout(r, 2500));
        } else {
          // Tab sudah ada, aktifkan tab tersebut
          await chrome.tabs.update(targetTab.id, { active: true }).catch(() => {});
          await new Promise((r) => setTimeout(r, 1200));
        }

        // POLLING / OBSERVASI SELAMA 3-5 DETIK SAMPAI POSISI HALAMAN STABIL (SETTLED)
        // Memastikan sistem tidak menyimpulkan terlalu dini saat Next.js sedang redirect
        let stableStatus = 'UNKNOWN';
        let stableUrl = '';
        let consecutiveMatches = 0;
        let lastDetected = '';

        for (let check = 0; check < 6; check++) {
          const currentTab = await chrome.tabs.get(targetTab.id).catch(() => null);
          if (!currentTab) break;

          stableUrl = currentTab.url || '';

          let csRes = null;
          try {
            csRes = await safeSendMessageToElevenLabsTab(targetTab.id, {
              module: 'elevenlabsSignup',
              action: 'GET_ELEVENLABS_STATUS',
            });
          } catch (e) {}

          let detected = csRes?.status || 'UNKNOWN';
          if (detected === 'UNKNOWN') {
            if (stableUrl.includes('/onboarding')) detected = 'ONBOARDING';
            else if (stableUrl.includes('/sign-in') || stableUrl.includes('/login')) detected = 'SIGN_IN';
            else if (stableUrl.includes('/sign-up')) detected = 'SIGN_UP';
            else if (stableUrl.includes('/action') || stableUrl.includes('mode=verifyEmail')) detected = 'VERIFY_ACTION';
            else if (stableUrl.includes('/speech-synthesis') || stableUrl.includes('/text-to-speech')) detected = 'DASHBOARD_TTS';
            else if (stableUrl.includes('/app')) detected = 'DASHBOARD_HOME';
          }

          if (detected !== 'UNKNOWN') {
            if (detected === lastDetected) {
              consecutiveMatches++;
              if (consecutiveMatches >= 2) {
                // Posisi stabil terkonfirmasi 2x berturut-turut!
                stableStatus = detected;
                break;
              }
            } else {
              lastDetected = detected;
              consecutiveMatches = 1;
            }
          }

          await new Promise((r) => setTimeout(r, 800));
        }

        if (stableStatus === 'UNKNOWN' && lastDetected) {
          stableStatus = lastDetected;
        }

        console.log(`[Background] 🎯 Posisi tab ElevenLabs stabil terdeteksi: ${stableStatus} (${stableUrl})`);
        sendResponse({
          success: true,
          status: stableStatus,
          tabId: targetTab.id,
          url: stableUrl,
        });
      } catch (err) {
        console.error('[Background] Error ensure & detect ElevenLabs session:', err);
        sendResponse({ success: false, error: err.message, status: 'UNKNOWN' });
      }
    })();
    return true; // async
  }

  // 5b. Deteksi State/Posisi Halaman ElevenLabs Secara Akurat (FSM State Detector)
  if (message.action === 'GET_ELEVENLABS_STATUS') {
    (async () => {
      try {
        const allTabs = await chrome.tabs.query({});
        const elevenTabs = allTabs.filter(
          (t) => t.url && t.url.toLowerCase().includes('elevenlabs.io')
        );

        if (elevenTabs.length === 0) {
          sendResponse({ success: true, status: 'NO_TAB' });
          return;
        }

        // Prioritaskan tab yang sedang aktif, atau tab yang berada di app/onboarding/tts
        let targetTab =
          elevenTabs.find((t) => t.active) ||
          elevenTabs.find((t) => t.url.includes('/speech-synthesis') || t.url.includes('/text-to-speech')) ||
          elevenTabs.find((t) => t.url.includes('/onboarding')) ||
          elevenTabs[0];

        // 1. Coba query content script di tab
        let contentStatus = null;
        try {
          contentStatus = await safeSendMessageToElevenLabsTab(targetTab.id, {
            module: 'elevenlabsSignup',
            action: 'GET_ELEVENLABS_STATUS',
          });
        } catch (e) {
          // Content script mungkin belum ready
        }

        if (contentStatus && contentStatus.status && contentStatus.status !== 'UNKNOWN') {
          sendResponse({ success: true, tabId: targetTab.id, ...contentStatus });
          return;
        }

        // 2. Fallback deteksi URL tab jika content script belum ready
        const url = targetTab.url || '';
        let detected = 'UNKNOWN';
        if (url.includes('/onboarding')) {
          detected = 'ONBOARDING';
        } else if (url.includes('/action') || url.includes('mode=verifyEmail') || url.includes('oobCode')) {
          detected = 'VERIFY_ACTION';
        } else if (url.includes('/sign-in') || url.includes('/login')) {
          detected = 'SIGN_IN';
        } else if (url.includes('/sign-up')) {
          detected = 'SIGN_UP';
        } else if (url.includes('/speech-synthesis') || url.includes('/text-to-speech')) {
          detected = 'DASHBOARD_TTS';
        } else if (url.includes('/app')) {
          detected = 'DASHBOARD_HOME';
        }

        sendResponse({ success: true, tabId: targetTab.id, status: detected, url });
      } catch (err) {
        sendResponse({ success: false, error: err.message, status: 'UNKNOWN' });
      }
    })();
    return true; // async
  }

  // 5c. Navigasi Tab ElevenLabs dengan Keamanan Load Completion
  if (message.action === 'NAVIGATE_ELEVENLABS_TAB') {
    (async () => {
      try {
        const { tabId, url } = message.payload || {};
        const targetUrl = url || 'https://elevenlabs.io/app/speech-synthesis/text-to-speech';

        let targetTabId = tabId;
        if (!targetTabId) {
          const allTabs = await chrome.tabs.query({});
          const existing = allTabs.find((t) => t.url && t.url.toLowerCase().includes('elevenlabs.io'));
          if (existing) {
            targetTabId = existing.id;
          } else {
            const newTab = await chrome.tabs.create({ url: targetUrl, active: true });
            targetTabId = newTab.id;
          }
        }

        await chrome.tabs.update(targetTabId, { url: targetUrl, active: true });

        // Tunggu load complete (maksimal 7000ms)
        await new Promise((resolve) => {
          let tid;
          function listener(id, info) {
            if (id === targetTabId && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              clearTimeout(tid);
              resolve();
            }
          }
          chrome.tabs.onUpdated.addListener(listener);
          tid = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 7000);
        });

        await new Promise((r) => setTimeout(r, 1500));
        sendResponse({ success: true, tabId: targetTabId });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // async
  }

  // 5d. Relaying Eksekusi Onboarding Langsung ke Tab
  if (message.action === 'EXECUTE_POST_VERIFY_ONBOARDING') {
    (async () => {
      try {
        const { tabId, email, password } = message.payload || {};
        let targetTabId = tabId;

        if (!targetTabId) {
          const allTabs = await chrome.tabs.query({});
          const onboardingTab = allTabs.find(
            (t) => t.url && t.url.toLowerCase().includes('elevenlabs.io') && t.url.includes('/onboarding')
          );
          const anyElevenTab = allTabs.find((t) => t.url && t.url.toLowerCase().includes('elevenlabs.io'));
          targetTabId = (onboardingTab || anyElevenTab)?.id;
        }

        if (!targetTabId) {
          throw new Error('Tidak ada tab ElevenLabs yang ditemukan untuk eksekusi onboarding.');
        }

        // Pastikan tab aktif
        await chrome.tabs.update(targetTabId, { active: true }).catch(() => {});

        const res = await safeSendMessageToElevenLabsTab(targetTabId, {
          module: 'elevenlabsSignup',
          action: 'EXECUTE_POST_VERIFY_ONBOARDING',
          payload: { email, password: password || 'Jovan@1224' },
        });

        sendResponse({ success: true, tabId: targetTabId, ...res });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // async
  }

  // Helper untuk memastikan tab ElevenLabs berada di halaman kerja TTS (/speech-synthesis atau /text-to-speech)
  async function ensureElevenLabsTtsTab() {
    const allTabs = await chrome.tabs.query({});
    let ttsTab = allTabs.find(
      (t) =>
        t.url &&
        t.url.toLowerCase().includes('elevenlabs.io') &&
        (t.url.includes('/speech-synthesis') ||
          t.url.includes('/text-to-speech'))
    );

    // Jangan pernah jadikan tab auth, onboarding, atau action sebagai ttsTab
    if (!ttsTab || !ttsTab.id) {
      // Cari tab elevenlabs umum (/app/home) tapi pastikan BUKAN onboarding, auth, atau action
      ttsTab = allTabs.find(
        (t) =>
          t.url &&
          t.url.toLowerCase().includes('elevenlabs.io') &&
          !t.url.includes('/sign-up') &&
          !t.url.includes('/sign-in') &&
          !t.url.includes('/login') &&
          !t.url.includes('/onboarding') &&
          !t.url.includes('/action')
      );
    }

    if (!ttsTab || !ttsTab.id) {
      ttsTab = await chrome.tabs.create({ url: 'https://elevenlabs.io/app/speech-synthesis', active: true });
      await new Promise((r) => setTimeout(r, 4000));
      return ttsTab;
    }

    // Jika tab adalah sign-up, sign-in, onboarding, atau action, navigasikan ke speech-synthesis
    if (
      ttsTab.url &&
      (ttsTab.url.includes('/sign-up') ||
        ttsTab.url.includes('/sign-in') ||
        ttsTab.url.includes('/login') ||
        ttsTab.url.includes('/onboarding') ||
        ttsTab.url.includes('/action'))
    ) {
      await chrome.tabs.update(ttsTab.id, { url: 'https://elevenlabs.io/app/speech-synthesis', active: true });
      await new Promise((r) => setTimeout(r, 4000));
      return ttsTab;
    }

    // Aktifkan tab TTS yang sedang terbuka
    await chrome.tabs.update(ttsTab.id, { active: true });
    return ttsTab;
  }

  // 6. Modul Konfigurasi TTS ElevenLabs (Voice, Model, Stability)
  if (message.action === 'CONFIGURE_ELEVENLABS_TTS') {
    (async () => {
      try {
        const ttsTab = await ensureElevenLabsTtsTab();
        if (!ttsTab || !ttsTab.id) {
          throw new Error('Tab ElevenLabs TTS tidak ditemukan.');
        }

        const res = await safeSendMessageToElevenLabsTab(ttsTab.id, {
          module: 'elevenlabsSignup',
          action: 'CONFIGURE_ELEVENLABS_TTS',
          payload: message.payload || {},
        });

        sendResponse({ success: true, ...res });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // async
  }

  // 7. Modul Generate Speech & Download Generation 2
  if (
    message.action === 'GENERATE_AND_DOWNLOAD_TTS' ||
    message.action === 'INPUT_AND_GENERATE_SPEECH' ||
    message.action === 'INPUT_TEXT_ONLY' ||
    message.action === 'PLAY_GENERATION_PREVIEW' ||
    message.action === 'DOWNLOAD_GENERATION'
  ) {
    (async () => {
      try {
        const ttsTab = await ensureElevenLabsTtsTab();
        if (!ttsTab || !ttsTab.id) {
          throw new Error('Tab ElevenLabs TTS tidak ditemukan.');
        }

        const res = await safeSendMessageToElevenLabsTab(ttsTab.id, {
          module: 'elevenlabsSignup',
          action: message.action,
          payload: message.payload || {},
        });

        sendResponse({ success: true, ...res });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // async
  }

  // 8. Modul Nama File Audio Kustom & Direct Download Otomatis
  if (message.action === 'SET_TARGET_AUDIO_FILENAME') {
    const rawName = message.payload?.filename || '';
    if (rawName) {
      targetAudioDownloadFilename = rawName.endsWith('.mp3') ? rawName : `${rawName}.mp3`;
      console.log(`[Background] Target download audio filename diset ke: ${targetAudioDownloadFilename}`);
    } else {
      targetAudioDownloadFilename = null;
    }
    sendResponse({ success: true, filename: targetAudioDownloadFilename });
    return true;
  }

  if (message.action === 'TRIGGER_DIRECT_DOWNLOAD') {
    (async () => {
      try {
        const { dataUrl, filename } = message.payload || {};
        if (!dataUrl) throw new Error('Data URL audio tidak valid.');

        const safeFilename = filename
          ? (filename.endsWith('.mp3') ? filename : `${filename}.mp3`)
          : (targetAudioDownloadFilename || 'audio.mp3');

        targetAudioDownloadFilename = safeFilename;

        console.log(`[Background] ⚡ Memicu direct download otomatis: ${safeFilename} (saveAs: false)...`);
        const downloadId = await chrome.downloads.download({
          url: dataUrl,
          filename: safeFilename,
          saveAs: false, // Simpan otomatis tanpa prompt Save As
          conflictAction: 'uniquify',
        });

        console.log(`[Background] ✅ Direct download dimulai (ID: ${downloadId})`);
        sendResponse({ success: true, downloadId, filename: safeFilename });
      } catch (err) {
        console.error('[Background] Gagal direct download audio:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // async
  }

  // 9. Modul Native CDP & Main-World Clicker (untuk checkbox Radix UI onboarding & tombol sensitif)
  if (message.action === 'CLICK_ONBOARDING_CHECKBOX') {
    (async () => {
      const tabId = sender.tab?.id || message.tabId;
      const { x, y } = message.payload || {};

      console.log(`[Background] 🎯 Permintaan klik native checkbox onboarding pada tab ${tabId} (x: ${x}, y: ${y})...`);

      // Strategi A: CDP Native Hardware Click via chrome.debugger (paling tangguh & authentic)
      if (tabId && x && y && chrome.debugger) {
        try {
          await chrome.debugger.attach({ tabId }, '1.3');
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: Math.round(x),
            y: Math.round(y),
            button: 'left',
            clickCount: 1,
          });
          await new Promise((r) => setTimeout(r, 60));
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: Math.round(x),
            y: Math.round(y),
            button: 'left',
            clickCount: 1,
          });
          await chrome.debugger.detach({ tabId });
          console.log('[Background] ✅ CDP Native Click berhasil dieksekusi!');
          sendResponse({ success: true, method: 'cdp' });
          return;
        } catch (cdpErr) {
          console.warn('[Background] CDP Click fallback:', cdpErr.message);
          try { await chrome.debugger.detach({ tabId }); } catch (e) {}
        }
      }

      // Strategi B: Main World execution via chrome.scripting.executeScript
      if (tabId && chrome.scripting) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
              const inp = document.querySelector('input[name="adult"], input[type="checkbox"]');
              if (inp) {
                try {
                  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
                  if (setter) setter.call(inp, true);
                  else inp.checked = true;
                  inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                  inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                } catch (e) {}
              }
              const b = document.querySelector('button[role="checkbox"], button[data-agent-id*="checkbox"]');
              if (b) {
                const isChecked = b.getAttribute('aria-checked') === 'true' || b.getAttribute('data-state') === 'checked';
                if (!isChecked) {
                  b.focus?.();
                  b.click?.();
                  b.closest('label')?.click?.();
                }
              }
            },
          });
          console.log('[Background] ✅ Main-World click berhasil dieksekusi!');
          sendResponse({ success: true, method: 'main_world' });
          return;
        } catch (scriptErr) {
          console.warn('[Background] Main-World click error:', scriptErr.message);
        }
      }

      sendResponse({ success: false });
    })();
    return true; // async
  }
});

// Variabel penampung nama file audio download target
let targetAudioDownloadFilename = null;
let targetAudioDownloadTimer = null;

// Interceptor onDeterminingFilename untuk memastikan file audio ElevenLabs selalu bernama target
if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    console.log('[Background] Download event terdeteksi:', item.filename, item.url);
    if (targetAudioDownloadFilename) {
      const finalName = targetAudioDownloadFilename.endsWith('.mp3')
        ? targetAudioDownloadFilename
        : `${targetAudioDownloadFilename}.mp3`;
      console.log(`[Background] 📁 Mengubah nama file download otomatis ke: ${finalName}`);
      suggest({
        filename: finalName,
        conflictAction: 'uniquify',
      });
      // Beri jeda sebelum menghapus target nama file agar tidak bentrok jika ada multiple request
      if (targetAudioDownloadTimer) clearTimeout(targetAudioDownloadTimer);
      targetAudioDownloadTimer = setTimeout(() => {
        targetAudioDownloadFilename = null;
      }, 20000);
      return; // Sinkron, tidak return true
    }
  });
}

// Log download yang berhasil dibuat di browser
if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.onCreated) {
  chrome.downloads.onCreated.addListener((item) => {
    console.log('[Background] 📥 File download terdeteksi di browser (ID:', item.id, ', URL:', item.url?.slice(0, 50), ')');
  });
}
