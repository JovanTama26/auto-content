// extension/modules/chunk-validator-bg.js
// Modul background service worker terisolasi untuk validasi video chunks

self.ChunkValidatorBackground = (function () {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  return {
    name: 'chunkValidatorBg',

    /**
     * Mencari frame Drive Picker dan mengirim query pencarian file
     */
    async searchInPickerFrames(tabId, filename) {
      let allFrames = [];
      try {
        allFrames = await chrome.webNavigation.getAllFrames({ tabId });
      } catch (e) {
        console.warn('[ChunkValidatorBg] webNavigation.getAllFrames warning:', e);
      }

      // Filter frame anak (iframe docs.google.com/picker)
      const childFrames = allFrames.filter((f) => f.frameId !== 0);

      // Prioritaskan frame yang URL-nya secara eksplisit adalah docs.google.com/picker
      childFrames.sort((a, b) => {
        const aPicker = (a.url || '').includes('picker') || (a.url || '').includes('docs.google.com') ? 1 : 0;
        const bPicker = (b.url || '').includes('picker') || (b.url || '').includes('docs.google.com') ? 1 : 0;
        return bPicker - aPicker;
      });

      // Coba kirim pesan ke frame yang memuat picker.js
      for (const frame of childFrames) {
        const isPickerCandidate =
          !frame.url ||
          frame.url === 'about:blank' ||
          frame.url.includes('docs.google.com') ||
          frame.url.includes('drive.google.com') ||
          frame.url.includes('picker');

        try {
          const res = await chrome.tabs.sendMessage(
            tabId,
            { action: 'PICKER_SEARCH_FILE', filename, module: 'chunkValidator' },
            { frameId: frame.frameId }
          );
          if (res && res.handled && res.found) {
            return res;
          }
        } catch (e) {
          if (isPickerCandidate) {
            try {
              console.log(`[ChunkValidatorBg] Menyuntikkan picker.js ke frame ${frame.frameId}...`);
              await chrome.scripting.executeScript({
                target: { tabId, frameIds: [frame.frameId] },
                files: ['picker.js'],
              });
              await sleep(400);

              const resRetry = await chrome.tabs.sendMessage(
                tabId,
                { action: 'PICKER_SEARCH_FILE', filename, module: 'chunkValidator' },
                { frameId: frame.frameId }
              );
              if (resRetry && resRetry.handled && resRetry.found) {
                return resRetry;
              }
            } catch (injectErr) {
              console.warn(`[ChunkValidatorBg] Gagal injeksi picker ke frame ${frame.frameId}:`, injectErr.message);
            }
          }
        }
      }

      return null;
    },

    /**
     * Memvalidasi keberadaan file di Google Drive melalui Drive Picker
     */
    async validateFileInDrive(tabId, filename) {
      console.log(`[ChunkValidatorBg] Memulai validasi file "${filename}" di tabId ${tabId}...`);

      // 1. Pastikan modal Drive Picker terbuka dan tampil di layar melalui modul content
      try {
        const res = await chrome.tabs.sendMessage(tabId, {
          action: 'ENSURE_DRIVE_PICKER_OPEN',
          module: 'chunkValidator',
        });
        if (res && !res.success) {
          throw new Error(res.error || 'Gagal memicu pembukaan Drive Picker.');
        }
      } catch (err) {
        if (err.message && err.message.includes('Gagal')) {
          throw err;
        }

        try {
          console.warn('[ChunkValidatorBg] Modul content belum siap, mencoba injeksi langsung...');
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['lib/supabase.js', 'content.js', 'modules/chunk-validator.js'],
          });
          await sleep(600);

          const resRetry = await chrome.tabs.sendMessage(tabId, {
            action: 'ENSURE_DRIVE_PICKER_OPEN',
            module: 'chunkValidator',
          });
          if (resRetry && !resRetry.success) {
            throw new Error(resRetry.error || 'Gagal memicu pembukaan Drive Picker.');
          }
        } catch (injectErr) {
          console.error('[ChunkValidatorBg] Gagal injeksi modul:', injectErr);
          throw new Error(
            `Ekstensi belum terhubung ke halaman Google AI Studio (${injectErr.message}). Silakan refresh tab AI Studio.`
          );
        }
      }

      // Jeda sejenak agar iframe siap
      await sleep(1500);

      // 2. Cari di frame picker
      let searchResult = null;
      for (let attempt = 1; attempt <= 8; attempt++) {
        searchResult = await this.searchInPickerFrames(tabId, filename);
        if (searchResult && searchResult.handled && searchResult.found) {
          break;
        }
        await sleep(800);
      }

      if (!searchResult || !searchResult.handled || !searchResult.found) {
        throw new Error(
          'Google Drive Picker belum siap atau iframe tidak merespons. Pastikan dialog Drive Picker sudah terbuka.'
        );
      }

      return searchResult;
    },

    /**
     * Mencari frame Drive Picker dan mengirim perintah select & insert file
     */
    async insertInPickerFrames(tabId, filename) {
      let allFrames = [];
      try {
        allFrames = await chrome.webNavigation.getAllFrames({ tabId });
      } catch (e) {
        console.warn('[ChunkValidatorBg] webNavigation.getAllFrames warning:', e);
      }

      const childFrames = allFrames.filter((f) => f.frameId !== 0);
      childFrames.sort((a, b) => {
        const aPicker = (a.url || '').includes('picker') || (a.url || '').includes('docs.google.com') ? 1 : 0;
        const bPicker = (b.url || '').includes('picker') || (b.url || '').includes('docs.google.com') ? 1 : 0;
        return bPicker - aPicker;
      });

      let lastErr = null;

      for (const frame of childFrames) {
        const isPickerCandidate =
          !frame.url ||
          frame.url === 'about:blank' ||
          frame.url.includes('docs.google.com') ||
          frame.url.includes('drive.google.com') ||
          frame.url.includes('picker');

        try {
          const res = await chrome.tabs.sendMessage(
            tabId,
            { action: 'PICKER_SELECT_AND_INSERT_FILE', filename },
            { frameId: frame.frameId }
          );
          if (res && res.handled && res.success) {
            return res;
          }
          if (res && res.error) {
            lastErr = res.error;
          }
        } catch (e) {
          if (isPickerCandidate) {
            try {
              await chrome.scripting.executeScript({
                target: { tabId, frameIds: [frame.frameId] },
                files: ['picker.js'],
              });
              await sleep(400);

              const resRetry = await chrome.tabs.sendMessage(
                tabId,
                { action: 'PICKER_SELECT_AND_INSERT_FILE', filename },
                { frameId: frame.frameId }
              );
              if (resRetry && resRetry.handled && resRetry.success) {
                return resRetry;
              }
              if (resRetry && resRetry.error) {
                lastErr = resRetry.error;
              }
            } catch (injectErr) {}
          }
        }
      }

      return lastErr ? { handled: true, success: false, error: lastErr } : null;
    },

    /**
     * Otomatis buka Drive Picker, cari file, klik item, dan klik Insert
     */
    async selectAndInsertFileInDrive(tabId, filename) {
      console.log(`[ChunkValidatorBg] Memulai penyisipan file "${filename}" ke editor di tabId ${tabId}...`);

      try {
        const res = await chrome.tabs.sendMessage(tabId, {
          action: 'ENSURE_DRIVE_PICKER_OPEN',
          module: 'chunkValidator',
        });
        if (res && !res.success) {
          throw new Error(res.error || 'Gagal memicu pembukaan Drive Picker.');
        }
      } catch (err) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['lib/supabase.js', 'content.js', 'modules/chunk-validator.js'],
        });
        await sleep(600);
        await chrome.tabs.sendMessage(tabId, {
          action: 'ENSURE_DRIVE_PICKER_OPEN',
          module: 'chunkValidator',
        });
      }

      await sleep(1500);

      let insertResult = null;
      for (let attempt = 1; attempt <= 8; attempt++) {
        insertResult = await this.insertInPickerFrames(tabId, filename);
        if (insertResult && insertResult.handled && insertResult.success) {
          break;
        }
        await sleep(1000);
      }

      if (!insertResult || !insertResult.success) {
        throw new Error(insertResult?.error || 'Google Drive Picker belum siap atau iframe tidak merespons.');
      }

      return insertResult;
    }
  };
})();
