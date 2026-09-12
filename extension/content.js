// extension/content.js
// Entry point utama Content Script di Google AI Studio (aistudio.google.com)
// Menyediakan Global Registry & Message Dispatcher agar setiap modul otomatisasi terisolasi dan tidak saling bentrok

(function initContentAutoCore() {
  if (window.__CONTENT_AUTO_CORE_INITIALIZED__) return;
  window.__CONTENT_AUTO_CORE_INITIALIZED__ = true;

  console.log('[Content Auto] Core Dispatcher & Automation Hub siap di Google AI Studio.');

  // Global Registry untuk modularitas otomatisasi yang terisolasi
  window.ContentAuto = window.ContentAuto || {
    modules: {},

    /**
     * Mendaftarkan modul otomatisasi baru secara terisolasi
     */
    registerModule(name, moduleObj) {
      if (this.modules[name]) {
        console.warn(`[Content Auto] Modul "${name}" sudah terdaftar sebelumnya, menimpa instance...`);
      }
      this.modules[name] = moduleObj;
      if (typeof moduleObj.init === 'function') {
        try {
          moduleObj.init();
        } catch (e) {
          console.error(`[Content Auto] Error saat inisialisasi modul "${name}":`, e);
        }
      }
      console.log(`[Content Auto] ✅ Modul otomatisasi terdaftar: ${name}`);
    },

    /**
     * Mengambil modul yang telah terdaftar berdasarkan nama
     */
    getModule(name) {
      return this.modules[name];
    }
  };

  // Central Message Dispatcher ke modul yang dituju
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 1. Jika pesan memiliki target modul spesifik
    if (message.module && window.ContentAuto.modules[message.module]) {
      const targetMod = window.ContentAuto.modules[message.module];
      if (typeof targetMod.handleMessage === 'function') {
        targetMod
          .handleMessage(message, sender)
          .then((res) => sendResponse({ success: true, ...res }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true; // async
      }
    }

    // 2. Broadcast / fallback ke modul yang menangani action tersebut
    for (const [modName, mod] of Object.entries(window.ContentAuto.modules)) {
      if (typeof mod.handleMessage === 'function') {
        mod
          .handleMessage(message, sender)
          .then((res) => {
            if (res !== null && res !== undefined) {
              sendResponse({ success: true, ...res });
            }
          })
          .catch((err) => sendResponse({ success: false, error: err.message }));
      }
    }

    return true; // async
  });

  // Window PostMessage Bridge (Untuk komunikasi antara runner test & modul ekstensi)
  window.addEventListener('message', async (event) => {
    if (!event.data || event.data.source !== 'CONTENT_AUTO_RUNNER') return;
    const { action, module, payload, requestId } = event.data;
    console.log(`[Content Auto Bridge] Runner message:`, action, module);

    let result = null;
    let error = null;

    try {
      if (module && window.ContentAuto.modules[module]) {
        result = await window.ContentAuto.modules[module].handleMessage({ action, payload, ...(payload || {}) });
      } else {
        for (const mod of Object.values(window.ContentAuto.modules)) {
          if (typeof mod.handleMessage === 'function') {
            result = await mod.handleMessage({ action, payload, ...(payload || {}) });
            if (result !== null && result !== undefined) break;
          }
        }
      }
    } catch (err) {
      error = err.message;
    }

    window.postMessage(
      {
        source: 'CONTENT_AUTO_REPLY',
        requestId,
        success: !error && result?.success !== false,
        result,
        error: error || result?.error || result?.errorMessage,
      },
      '*'
    );
  });
})();
