// extension/content.js
// Content script yang berjalan di Google AI Studio (aistudio.google.com)
// HANYA sebagai listener otomasi DOM (membuka menu attachment & Google Drive Picker)

(function initContentAutoAutomation() {
  console.log('[Content Auto] Content script siap di Google AI Studio.');

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isDrivePickerOpen() {
    const iframe = document.querySelector('iframe[src*="picker"], iframe[src*="docs.google.com"], iframe[name*="I0_"], iframe[name*="I1_"]');
    return !!(iframe && (iframe.offsetParent !== null || iframe.offsetWidth > 0));
  }

  /**
   * Helper mencari tombol attachment (+) secara tangguh
   */
  function findAttachButton() {
    // 1. Selector aria-label spesifik
    const ariaSelectors = [
      'button[aria-label="Insert images, videos, audio, or files"]',
      'button[aria-label*="Insert"]',
      'button[aria-label*="Sisipkan"]',
      'button[aria-label*="image"]',
      'button[aria-label*="media"]',
      'button[aria-label*="file"]'
    ];

    for (const sel of ariaSelectors) {
      const el = document.querySelector(sel);
      if (el && (el.offsetParent !== null || el.offsetWidth > 0)) return el;
    }

    // 2. Cari berdasarkan icon Material (add_circle, add, attach_file)
    const allButtons = Array.from(document.querySelectorAll('button'));
    const iconBtn = allButtons.find((b) => {
      const txt = (b.textContent || '').trim().toLowerCase();
      const isVis = b.offsetParent !== null || b.offsetWidth > 0;
      return isVis && (txt.includes('add_circle') || txt === 'add' || txt.includes('attach'));
    });
    if (iconBtn) return iconBtn;

    // 3. Cari button di sekitar bar prompt chat
    const promptContainer = document.querySelector('ms-prompt-bar, .prompt-box, .input-area, footer, [role="main"]');
    if (promptContainer) {
      const promptBtns = Array.from(promptContainer.querySelectorAll('button'));
      const found = promptBtns.find(b => {
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const inner = (b.innerHTML || '').toLowerCase();
        return aria.includes('insert') || aria.includes('add') || inner.includes('add_circle') || inner.includes('<svg');
      });
      if (found) return found;
    }

    return null;
  }

  /**
   * Membuka modal Google Drive Picker jika belum terbuka
   */
  async function ensureDrivePickerOpen() {
    if (isDrivePickerOpen()) {
      console.log('[Content Auto] Modal Google Drive Picker sudah terbuka di layar.');
      return { alreadyOpen: true };
    }

    console.log('[Content Auto] Membuka modal Drive Picker...');
    const attachBtn = findAttachButton();
    if (!attachBtn) {
      throw new Error('Tombol attachment (+) tidak ditemukan di halaman Google AI Studio.');
    }

    // Beri visual highlight pada tombol attachment
    attachBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const originalOutline = attachBtn.style.outline;
    attachBtn.style.outline = '3px solid #8b5cf6';
    await sleep(250);

    attachBtn.click();
    await sleep(500);
    attachBtn.style.outline = originalOutline;

    // Tunggu menu popover opsi muncul
    let driveItem = null;
    for (let i = 0; i < 10; i++) {
      const menuItems = Array.from(
        document.querySelectorAll('.mat-mdc-menu-panel button, .mat-mdc-menu-panel [role="menuitem"], [role="menuitem"], .cdk-overlay-pane button')
      );

      driveItem = menuItems.find((el) => {
        const text = (el.textContent || '').trim().toLowerCase();
        return text.includes('drive');
      });

      if (driveItem) break;
      await sleep(400);
    }

    if (!driveItem) {
      throw new Error('Menu popup terbuka, tapi opsi "Drive" tidak ditemukan.');
    }

    driveItem.style.outline = '3px solid #06b6d4';
    await sleep(250);
    driveItem.click();

    // Tunggu iframe Drive Picker muncul
    for (let i = 0; i < 15; i++) {
      if (isDrivePickerOpen()) {
        console.log('[Content Auto] Modal Drive Picker berhasil terbuka!');
        return { alreadyOpen: false, opened: true };
      }
      await sleep(500);
    }

    return { alreadyOpen: false, opened: true };
  }

  // Listener pesan dari Side Panel / Background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ENSURE_DRIVE_PICKER_OPEN' || message.action === 'DOM_TRIGGER_ATTACH_MENU') {
      ensureDrivePickerOpen()
        .then((res) => sendResponse({ success: true, ...res }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // async
    }

    if (message.action === 'CHECK_ATTACHMENT_STATUS') {
      sendResponse({
        isPickerOpen: isDrivePickerOpen()
      });
      return true;
    }
  });
})();
