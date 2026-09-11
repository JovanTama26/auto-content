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

  // Modul otomatisasi lain di masa depan akan didaftarkan di sini secara independen
});
