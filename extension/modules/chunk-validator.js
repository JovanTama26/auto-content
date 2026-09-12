// extension/modules/chunk-validator.js
// Modul otomatisasi terisolasi untuk validasi video chunks di Google AI Studio
// Bertanggung jawab membuka menu attachment (+), opsi Google Drive, dan memverifikasi dialog Picker

(function () {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Modul ChunkValidator
   */
  const ChunkValidator = {
    name: 'chunkValidator',

    init() {
      console.log('[ChunkValidator] Modul validasi video chunks terinisialisasi.');
    },

    /**
     * Cek apakah elemen terlihat di layar
     */
    isElementVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },

    /**
     * Simulasikan klik pada tombol secara bersih dan native
     */
    simulateClick(el) {
      if (!el) return;
      el.focus();
      try {
        el.click();
      } catch (e) {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }
    },

    /**
     * Cek apakah modal Google Drive Picker sedang terbuka dan tampil di layar
     */
    isDrivePickerOpen() {
      // 1. Cek iframe picker
      const iframes = Array.from(document.querySelectorAll('iframe'));
      const hasPickerIframe = iframes.some((f) => {
        const src = f.src || '';
        const name = f.name || '';
        const cls = f.className || '';
        const isPicker =
          src.includes('picker') ||
          src.includes('docs.google.com') ||
          name.startsWith('I0_') ||
          name.startsWith('I1_') ||
          cls.includes('picker') ||
          !!f.closest('.picker-iframe-container');

        if (!isPicker) return false;
        const rect = f.getBoundingClientRect();
        return rect.width > 50 && rect.height > 50;
      });

      if (hasPickerIframe) return true;

      // 2. Cek elemen modal dialog / backdrop Google Drive Picker
      const modalDialog = document.querySelector(
        '.google-picker.modal-dialog-bg, [role="dialog"][aria-label*="Select or upload a file" i], .picker-dialog-bg, .picker-iframe-container'
      );
      if (modalDialog && this.isElementVisible(modalDialog)) {
        return true;
      }

      return false;
    },

    /**
     * Helper mencari tombol attachment (+) di prompt area
     */
    findAttachButton() {
      const specificSelectors = [
        'button[data-test-id="add-media-button"]',
        'ms-add-media-button button',
        'button[data-test="selectMediaMenu"]',
        'button[data-test-id*="media" i]',
        'button[aria-label="Insert images, videos, audio, or files"]',
        'button[aria-label*="Insert" i]',
        'button[aria-label*="Sisipkan" i]',
        'button[aria-label*="Tambah" i]',
        'button[aria-label*="media" i]',
        'button[aria-label*="file" i]',
        'button[aria-label*="image" i]',
      ];

      for (const sel of specificSelectors) {
        const el = document.querySelector(sel);
        if (el && this.isElementVisible(el)) return el;
      }

      const promptContainers = document.querySelectorAll(
        'ms-prompt-bar, .prompt-box, ms-chat-prompt-box, .input-area, footer, [role="main"]'
      );
      for (const cont of promptContainers) {
        const btns = Array.from(cont.querySelectorAll('button'));
        const found = btns.find((b) => {
          if (!this.isElementVisible(b)) return false;
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const testId = (b.getAttribute('data-test-id') || '').toLowerCase();
          const inner = (b.innerHTML || '').toLowerCase();
          const txt = (b.textContent || '').trim().toLowerCase();
          return (
            testId.includes('media') ||
            testId.includes('add') ||
            aria.includes('insert') ||
            aria.includes('add') ||
            aria.includes('sisip') ||
            aria.includes('tambah') ||
            inner.includes('add_circle') ||
            inner.includes('add') ||
            txt === 'add' ||
            txt === '+'
          );
        });
        if (found) return found;
      }

      return null;
    },

    /**
     * Helper mencari menu item "Drive" di overlay menu popover
     */
    findDriveMenuItem() {
      const candidates = Array.from(
        document.querySelectorAll(
          '.cdk-overlay-container [role="menuitem"], .mat-mdc-menu-panel [role="menuitem"], [role="menuitem"], .cdk-overlay-pane button'
        )
      );

      return candidates.find((el) => {
        if (!this.isElementVisible(el)) return false;
        const text = (el.textContent || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
        const cls = (el.className || '').toLowerCase();
        return text.includes('drive') || aria.includes('drive') || cls.includes('drive');
      });
    },

    /**
     * Membuka modal Google Drive Picker jika belum terbuka
     */
    async ensureDrivePickerOpen() {
      if (this.isDrivePickerOpen()) {
        console.log('[ChunkValidator] Modal Google Drive Picker sudah terbuka di layar.');
        return { alreadyOpen: true };
      }

      let driveItem = this.findDriveMenuItem();
      if (driveItem) {
        console.log('[ChunkValidator] Menu Drive sudah terbuka, langsung mengklik opsi Drive...');
        this.simulateClick(driveItem);
      } else {
        console.log('[ChunkValidator] Membuka menu attachment (+)...');
        let attachBtn = null;
        for (let attempt = 0; attempt < 12; attempt++) {
          attachBtn = this.findAttachButton();
          if (attachBtn) break;
          await sleep(500);
        }

        if (!attachBtn) {
          throw new Error(
            'Tombol attachment (+) tidak ditemukan di Google AI Studio. Pastikan Anda berada di halaman prompt.'
          );
        }

        attachBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const originalOutline = attachBtn.style.outline;
        attachBtn.style.outline = '3px solid #8b5cf6';

        this.simulateClick(attachBtn);
        await sleep(350);
        attachBtn.style.outline = originalOutline;

        for (let i = 0; i < 15; i++) {
          driveItem = this.findDriveMenuItem();
          if (driveItem) break;
          await sleep(250);
        }

        if (!driveItem) {
          throw new Error('Menu popup (+) terbuka, tapi opsi "Drive" tidak ditemukan di layar.');
        }

        driveItem.style.outline = '3px solid #06b6d4';
        await sleep(150);
        this.simulateClick(driveItem);
      }

      for (let i = 0; i < 25; i++) {
        if (this.isDrivePickerOpen()) {
          console.log('[ChunkValidator] Modal Drive Picker berhasil terbuka!');
          return { alreadyOpen: false, opened: true };
        }
        await sleep(400);
      }

      return { alreadyOpen: false, opened: true };
    },

    /**
     * Handler pesan masuk khusus untuk modul ChunkValidator
     */
    async handleMessage(message, sender) {
      if (
        message.action === 'ENSURE_DRIVE_PICKER_OPEN' ||
        message.action === 'CHUNK_ENSURE_PICKER_OPEN'
      ) {
        return await this.ensureDrivePickerOpen();
      }

      if (message.action === 'DOM_TRIGGER_ATTACH_MENU') {
        const attachBtn = this.findAttachButton();
        if (!attachBtn) throw new Error('Tombol attachment (+) tidak ditemukan.');
        this.simulateClick(attachBtn);
        return { triggered: true };
      }

      return null;
    }
  };

  // Daftarkan ke Global Registry ContentAuto
  if (window.ContentAuto && typeof window.ContentAuto.registerModule === 'function') {
    window.ContentAuto.registerModule('chunkValidator', ChunkValidator);
  } else {
    window.ContentAuto = window.ContentAuto || { modules: {} };
    window.ContentAuto.modules = window.ContentAuto.modules || {};
    window.ContentAuto.modules.chunkValidator = ChunkValidator;
  }
})();
