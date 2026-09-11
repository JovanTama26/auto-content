// extension/picker.js
// Content script yang di-inject ke dalam iframe Google Drive Picker (docs.google.com)
// Bertanggung jawab mencari file tanpa ekstensi di Google Drive & memvalidasi keberadaannya secara akurat

(function initContentAutoPicker() {
  const href = window.location.href || '';
  if (!href.includes('picker') && !href.includes('docs.google.com') && !href.includes('drive.google.com')) {
    return;
  }

  // Hindari duplikasi inisialisasi jika script diinjeksi ulang
  if (window.__CONTENT_AUTO_PICKER_INITIALIZED__) {
    return;
  }
  window.__CONTENT_AUTO_PICKER_INITIALIZED__ = true;

  console.log('[Content Auto Picker] Script aktif di iframe Google Drive Picker:', href);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return (rect.width > 20 || el.offsetWidth > 20) && (rect.height > 10 || el.offsetHeight > 10);
  }

  /**
   * Cari elemen input search di Google Drive Picker
   */
  async function findSearchInput(maxWaitMs = 6000) {
    const startTime = Date.now();
    const selectors = [
      'input[placeholder*="Search in Drive" i]',
      'input[aria-label*="Search in Drive" i]',
      'input[placeholder*="Telusuri di Drive" i]',
      'input[aria-label*="Telusuri di Drive" i]',
      'input[placeholder*="Search" i]',
      'input[aria-label*="Search" i]',
      'input[placeholder*="Telusuri" i]',
      'input[aria-label*="Telusuri" i]',
      'input.picker-search-input',
    ];

    while (Date.now() - startTime < maxWaitMs) {
      for (const sel of selectors) {
        const els = Array.from(document.querySelectorAll(sel));
        for (const el of els) {
          if (isElementVisible(el)) {
            return el;
          }
        }
      }
      await sleep(250);
    }
    return null;
  }

  /**
   * Mengetik kata kunci pencarian tanpa ekstensi, memicu submit/Enter,
   * lalu memvalidasi HANYA dari baris item file dokumen hasil pencarian Drive.
   * Tidak akan pernah menandai valid jika input kosong atau pencarian belum dieksekusi.
   */
  async function searchFilename(rawFilename) {
    const baseName = rawFilename.replace(/\.[^/.]+$/, '').trim();
    console.log(`[Content Auto Picker] Memulai pencarian di Drive: "${baseName}" (asal: "${rawFilename}")...`);

    // 1. Jika ada tombol Clear dari pencarian sebelumnya, klik Clear terlebih dahulu
    const clearBtns = Array.from(
      document.querySelectorAll(
        'button[aria-label*="Clear" i], [role="button"][aria-label*="Clear" i], button[title*="Clear" i]'
      )
    );
    const visibleClear = clearBtns.find(isElementVisible);
    if (visibleClear) {
      console.log('[Content Auto Picker] Menghapus query sebelumnya via tombol Clear...');
      visibleClear.click();
      await sleep(350);
    }

    const input = await findSearchInput();
    if (!input) {
      throw new Error('Kolom pencarian Drive Picker tidak ditemukan di dalam iframe.');
    }

    // 2. Fokuskan input dan masukkan keyword secara presisi
    input.focus();
    input.click();
    input.value = baseName;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Verifikasi bahwa teks benar-benar terisi di DOM input
    if (input.value !== baseName) {
      console.warn(`[Content Auto Picker] input.value belum sesuai ("${input.value}"), mencoba setter native...`);
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) nativeSetter.call(input, baseName);
      else input.value = baseName;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (!input.value || input.value.trim().length === 0) {
      throw new Error('Gagal mengisi query pencarian ke dalam input Google Drive Picker (input tetap kosong).');
    }

    await sleep(200);

    // 3. Submit pencarian (Enter Keydown/Keypress/Keyup)
    const enterOpts = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    input.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
    input.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
    input.dispatchEvent(new KeyboardEvent('keyup', enterOpts));

    if (input.form) {
      try {
        input.form.requestSubmit();
      } catch (e) {
        input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    }

    console.log(`[Content Auto Picker] Query "${baseName}" telah dikirim. Menunggu hasil pencarian Drive dimuat...`);

    // 4. Beri waktu hasil pencarian mulai dimuat & verifikasi transisi
    await sleep(800);

    // 5. Tunggu hingga hasil pencarian selesai dimuat (maksimal 9 detik)
    const maxWait = 9000;
    const searchStart = Date.now();
    let found = false;
    let foundElement = null;

    while (Date.now() - searchStart < maxWait) {
      const bodyText = document.body.innerText || '';

      // Tanda eksplisit tidak ada hasil dari Google Drive
      const isNoMatch =
        bodyText.includes('No matching results') ||
        bodyText.includes('Tidak ada hasil yang cocok') ||
        bodyText.includes('Try another search');

      if (isNoMatch) {
        console.log(`ℹ️ [Content Auto Picker] Drive merespons: Tidak ada hasil untuk "${baseName}".`);
        found = false;
        break;
      }

      // Cari baris dokumen/file yang dihasilkan dari pencarian.
      // Di Google Drive Picker modern, item hasil pencarian memiliki [role="option"][data-target="doc"] atau data-id!
      const candidateRows = Array.from(
        document.querySelectorAll(
          '[role="option"][data-target="doc"], [role="option"][data-id], [role="row"][data-id], .picker-dataview-item'
        )
      );

      for (const row of candidateRows) {
        // Jangan cocokkan header tabel
        if (row.querySelector('[role="columnheader"]') || row.closest('thead')) {
          continue;
        }

        const txt = (row.textContent || '').trim();
        const title = (row.getAttribute('title') || '').trim();
        const aria = (row.getAttribute('aria-label') || '').trim();

        // Validasi kecocokan ketat terhadap baseName atau rawFilename
        const isNameMatch =
          txt.includes(rawFilename) ||
          txt.includes(baseName) ||
          title.includes(rawFilename) ||
          title.includes(baseName) ||
          aria.includes(rawFilename) ||
          aria.includes(baseName);

        if (isNameMatch) {
          // Pastikan bukan sekadar folder Google AI Studio bawaan
          const isGoogleFolder = txt.toLowerCase().includes('google ai studio') && !txt.includes(baseName);
          if (!isGoogleFolder) {
            foundElement = row;
            found = true;
            break;
          }
        }
      }

      if (found) {
        break;
      }

      await sleep(400);
    }

    if (found && foundElement) {
      console.log(`🎉 [Content Auto Picker] File "${rawFilename}" DITEMUKAN di Drive!`);
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
      console.log(`ℹ️ [Content Auto Picker] File "${rawFilename}" TIDAK DITEMUKAN di Drive.`);
    }

    return {
      handled: true,
      found,
      filename: rawFilename,
      baseName,
    };
  }

  // Listener pesan dari background / sidepanel
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'PICKER_PING') {
      sendResponse({ handled: true, pong: true, href: window.location.href });
      return true;
    }

    if (message.action === 'PICKER_SEARCH_FILE') {
      searchFilename(message.filename)
        .then((res) => sendResponse(res))
        .catch((err) => {
          console.error('[Content Auto Picker] searchFilename error:', err);
          sendResponse({ handled: true, found: false, error: err.message });
        });
      return true; // async
    }
  });
})();
