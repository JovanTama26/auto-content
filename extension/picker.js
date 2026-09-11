// extension/picker.js
// Content script yang di-inject ke dalam iframe Google Drive Picker (docs.google.com)
// Bertanggung jawab mencari file tanpa ekstensi di Google Drive & memvalidasi keberadaannya

(function initContentAutoPicker() {
  if (!window.location.href.includes('picker')) {
    return;
  }

  console.log('[Content Auto Picker] Script siap di iframe Google Drive Picker:', window.location.href);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Cari elemen input search di Google Drive Picker
   */
  async function findSearchInput(maxWaitMs = 4000) {
    const startTime = Date.now();
    const selectors = [
      'input[aria-label*="Search in Drive"]',
      'input[placeholder*="Search in Drive"]',
      'input[aria-label*="Telusuri di Drive"]',
      'input[placeholder*="Telusuri di Drive"]',
      'input.picker-search-input',
      'input[type="text"]'
    ];

    while (Date.now() - startTime < maxWaitMs) {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && (el.offsetParent !== null || el.offsetWidth > 0)) {
          return el;
        }
      }
      await sleep(300);
    }
    return null;
  }

  /**
   * Mengetik kata kunci pencarian tanpa ekstensi & menekan Enter
   */
  async function searchFilename(rawFilename) {
    // Ambil nama file tanpa ekstensi (contoh: WV-FILM-20260911-FOMM_part_02.mp4 -> WV-FILM-20260911-FOMM_part_02)
    const baseName = rawFilename.replace(/\.[^/.]+$/, '').trim();
    console.log(`[Content Auto Picker] Mencari file di Drive: "${baseName}" (asal: "${rawFilename}")...`);

    const input = await findSearchInput();
    if (!input) {
      throw new Error('Kolom pencarian Drive Picker tidak ditemukan.');
    }

    // Fokus dan isi kata kunci
    input.focus();
    input.click();
    input.value = '';
    input.value = baseName;

    // Trigger events agar picker mendeteksi input
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Simulasikan Enter
    const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
    input.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
    input.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
    input.dispatchEvent(new KeyboardEvent('keyup', enterOpts));

    console.log(`[Content Auto Picker] Enter ditekan untuk "${baseName}". Menunggu hasil pencarian Drive...`);

    // Tunggu hasil pencarian muncul dan stabil (maksimal 8 detik)
    const maxWait = 8000;
    const searchStart = Date.now();
    let found = false;
    let foundElement = null;

    while (Date.now() - searchStart < maxWait) {
      await sleep(500);

      const bodyText = document.body.innerText || '';

      // Cek apakah Drive mengembalikan tanda tidak ada hasil
      const isNoMatch =
        bodyText.includes('No matching results') ||
        bodyText.includes('Tidak ada hasil yang cocok') ||
        bodyText.includes('Try another search');

      // Cek apakah item file yang cocok sudah tampil di daftar hasil
      const candidateEls = Array.from(
        document.querySelectorAll('[role="row"], [role="gridcell"], [role="option"], .picker-grid-item, .picker-list-item, div[title], span[title], div')
      );

      foundElement = candidateEls.find((el) => {
        // Jangan cocokkan input search itu sendiri
        if (el === input || el.contains(input)) return false;
        
        const txt = (el.textContent || '').trim();
        const title = (el.getAttribute('title') || '').trim();
        const aria = (el.getAttribute('aria-label') || '').trim();

        const match =
          txt.includes(rawFilename) ||
          txt.includes(baseName) ||
          title.includes(rawFilename) ||
          title.includes(baseName) ||
          aria.includes(rawFilename) ||
          aria.includes(baseName);

        const isVisible = el.offsetParent !== null || el.offsetWidth > 0;
        return match && isVisible && txt.length < 150;
      });

      if (foundElement) {
        found = true;
        break;
      }

      if (isNoMatch) {
        found = false;
        break;
      }
    }

    if (found && foundElement) {
      console.log(`🎉 [Content Auto Picker] File "${rawFilename}" DITEMUKAN di Drive!`);
      // Beri efek highlight hijau visual
      foundElement.style.outline = '3px solid #10b981';
      foundElement.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.8)';
      foundElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        if (foundElement) {
          foundElement.style.outline = '';
          foundElement.style.boxShadow = '';
        }
      }, 4000);
    } else {
      console.log(`ℹ️ [Content Auto Picker] File "${rawFilename}" BELUM ADA di Drive.`);
    }

    return {
      handled: true,
      found,
      filename: rawFilename,
      baseName
    };
  }

  // Listener pesan dari background / sidepanel
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'PICKER_PING') {
      sendResponse({ handled: true, isPicker: true, url: window.location.href });
      return true;
    }

    if (message.action === 'PICKER_SEARCH_FILE') {
      searchFilename(message.filename)
        .then((res) => sendResponse({ success: true, ...res }))
        .catch((err) => sendResponse({ success: false, handled: true, error: err.message }));
      return true; // async
    }
  });
})();
