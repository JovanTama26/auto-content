// extension/background.js
// Service worker untuk Chrome Native Side Panel & orkestrasi validasi Google Drive Picker

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[Background] Side Panel behavior error:', error));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mencari frame Drive Picker dan mengirim instruksi pencarian file
 */
async function searchInPickerFrames(tabId, filename) {
  let allFrames = [];
  try {
    allFrames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch (e) {
    console.warn('[Background] webNavigation.getAllFrames warning:', e);
  }

  // Filter frame anak (iframe docs.google.com/picker)
  const childFrames = allFrames.filter((f) => f.frameId !== 0);

  // Coba kirim pesan ke frame yang memuat picker.js
  for (const frame of childFrames) {
    try {
      const res = await chrome.tabs.sendMessage(
        tabId,
        { action: 'PICKER_SEARCH_FILE', filename },
        { frameId: frame.frameId }
      );
      if (res && res.handled) {
        return res;
      }
    } catch (e) {
      // frame ini bukan picker iframe
    }
  }

  // Fallback: coba broadcast atau coba tanpa frameId jika hanya ada 1 frame
  try {
    const res = await chrome.tabs.sendMessage(tabId, { action: 'PICKER_SEARCH_FILE', filename });
    if (res && res.handled) {
      return res;
    }
  } catch (e) {}

  return null;
}

/**
 * Memvalidasi apakah suatu file sudah ada di Google Drive melalui Drive Picker
 */
async function validateFileInDrive(tabId, filename) {
  console.log(`[Background] Memulai validasi file "${filename}" di tabId ${tabId}...`);

  // 1. Pastikan modal Drive Picker terbuka di Google AI Studio
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'ENSURE_DRIVE_PICKER_OPEN' });
  } catch (err) {
    console.warn('[Background] Gagal memastikan Drive Picker terbuka:', err.message);
  }

  // Beri jeda agar iframe picker stabil
  await sleep(1500);

  // 2. Cari frame picker dan jalankan pencarian tanpa ekstensi
  let searchResult = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    searchResult = await searchInPickerFrames(tabId, filename);
    if (searchResult && searchResult.handled) {
      break;
    }
    await sleep(1000);
  }

  if (!searchResult || !searchResult.handled) {
    throw new Error('Google Drive Picker belum siap atau iframe tidak merespons.');
  }

  return searchResult;
}

// Listener pesan dari Side Panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'VALIDATE_DRIVE_FILE') {
    (async () => {
      try {
        const { tabId, filename } = message;
        if (!filename) {
          throw new Error('Filename tidak boleh kosong.');
        }

        const res = await validateFileInDrive(tabId, filename);
        sendResponse({ success: true, ...res });
      } catch (err) {
        console.error('[Background] VALIDATE_DRIVE_FILE error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // async response
  }
});
