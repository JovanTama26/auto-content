// extension/modules/script-generator.js
// Modul otomatisasi Script Generator & Analisis Video Chunks di Google AI Studio
// Berjalan di dalam content script browser (DOM asli) untuk menghindari error deteksi bot

(function () {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const ScriptGenerator = {
    name: 'scriptGenerator',

    init() {
      console.log('[ScriptGenerator] Modul Script Generator siap di Google AI Studio.');
    },

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
     * Cek apakah kartu media chunk BENAR-BENAR terpasang di editor
     * Mendeteksi via selector kustom, pola token (e.g. 117,080 tokens), dan nama file chunk
     */
    hasMediaChunk(filename) {
      const promptBox = document.querySelector(
        'ms-prompt-editor, ms-chat-prompt-box, ms-prompt-bar, .prompt-box, .input-area, [role="main"]'
      );

      // 1. Cek elemen-elemen card chunk bawaan AI Studio
      const cardSelectors = [
        'ms-prompt-media',
        '[data-test-id="prompt-media-container"]',
        '.prompt-media-item-container',
        '.multi-media-row',
        'ms-media-chunk',
        'ms-file-chunk',
        'ms-prompt-chunk',
        'ms-chunk',
        'ms-file-pill',
        'ms-attachment',
        '.file-chunk',
        '.media-chunk',
        '.file-pill',
        '[data-test-id="media-chunk"]',
        '[data-test-id="attached-file"]',
      ];

      for (const sel of cardSelectors) {
        const cards = Array.from(document.querySelectorAll(sel));
        const valid = cards.find((el) => {
          const tag = el.tagName.toLowerCase();
          const testId = (el.getAttribute('data-test-id') || '').toLowerCase();
          return tag !== 'button' && !testId.includes('add') && !el.closest('button') && (this.isElementVisible(el) || el.offsetWidth > 20);
        });
        if (valid) return true;
      }

      // 2. Cek teks di area prompt box (mengandung token badge atau awalan nama file chunk)
      if (promptBox) {
        const txt = (promptBox.innerText || promptBox.textContent || '').toLowerCase();
        const baseName = filename ? filename.replace(/\.[^/.]+$/, '').toLowerCase() : '';
        const shortPrefix = baseName ? baseName.slice(0, 14) : 'part_';

        const hasTokens = /\b\d+[\d,.]*\s*tokens\b/i.test(txt);
        const hasFileText = baseName ? (txt.includes(baseName) || txt.includes(shortPrefix)) : (txt.includes('part_') || txt.includes('tokens'));

        if (hasFileText && (hasTokens || txt.includes('loading') || promptBox.querySelector('ms-prompt-media, [data-test-id="prompt-media-container"]'))) {
          return true;
        }
      }

      // 3. Cek di seluruh dokumen untuk keberadaan card yang memiliki nama file dan badge tokens
      if (filename) {
        const cleanName = filename.replace(/\.[^/.]+$/, '').toLowerCase();
        const shortPrefix = cleanName.slice(0, 14);
        const allElements = Array.from(document.querySelectorAll('*'));
        const matched = allElements.find((el) => {
          const t = (el.innerText || '').toLowerCase();
          const tag = el.tagName.toLowerCase();
          return (
            tag !== 'body' &&
            tag !== 'html' &&
            tag !== 'button' &&
            t.length < 300 &&
            t.includes(shortPrefix) &&
            t.includes('tokens') &&
            (this.isElementVisible(el) || el.offsetWidth > 20)
          );
        });
        if (matched) return true;
      }

      return false;
    },

    /**
     * Cek apakah kartu media chunk di editor sudah selesai loading dari Drive (tidak Loading... dan token sudah dihitung)
     */
    areMediaChunksReady(filename) {
      if (!this.hasMediaChunk(filename)) return false;

      const promptBox =
        document.querySelector(
          'ms-prompt-editor, ms-chat-prompt-box, ms-prompt-bar, .prompt-box, .input-area, [role="main"]'
        ) || document.body;

      const txt = (promptBox.innerText || promptBox.textContent || '').toLowerCase();

      // Jika masih ada kata 'loading' di area input atau progress bar/spinner aktif
      if (txt.includes('loading') || promptBox.querySelector('mat-progress-bar, mat-progress-spinner, .loading')) {
        return false;
      }

      // Perhitungan token video sudah selesai jika ada angka token (misal: "117,080 tokens")
      return /\b\d+[\d,.]*\s*tokens\b/i.test(txt);
    },

    /**
     * Cek apakah sudah ada riwayat turn chat percakapan sebelumnya di halaman
     */
    hasChatTurns() {
      const turns = document.querySelectorAll('ms-chat-turn, .model-response, ms-response-bubble');
      return turns.length > 0;
    },

    /**
     * Mencari elemen input / contenteditable prompt editor di AI Studio
     */
    findPromptEditor() {
      const selectors = [
        'ms-prompt-editor [contenteditable="true"]',
        'ms-prompt-editor textarea',
        'textarea[placeholder*="prompt" i]',
        '[contenteditable="true"]',
        'textarea',
      ];
      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel);
          if (el && this.isElementVisible(el)) return el;
        } catch { }
      }
      return (
        document.querySelector('ms-prompt-editor [contenteditable="true"]') ||
        document.querySelector('[contenteditable="true"]') ||
        document.querySelector('textarea') ||
        null
      );
    },

    /**
     * Mengisi teks prompt ke dalam prompt editor secara native
     */
    fillPromptText(promptText) {
      if (!promptText) return false;
      const el = this.findPromptEditor();
      if (!el) {
        console.warn('[ScriptGenerator] Prompt editor tidak ditemukan di DOM.');
        return false;
      }
      el.focus();
      if ('value' in el) {
        el.value = promptText;
      } else {
        el.innerText = promptText;
      }
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, composed: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, composed: true }));
      console.log(`[ScriptGenerator] ✍️ Prompt berhasil diisi (${promptText.length} karakter).`);
      return true;
    },

    /**
     * Mencari tombol utama "Run" di prompt editor
     */
    findRunButton() {
      const selectors = [
        'ms-run-button button',
        'button.run-button',
        '[data-test-id*="run-button" i]',
        'button[aria-label*="Run" i]',
        'button:has-text("Run")',
      ];

      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel);
          if (el && this.isElementVisible(el)) return el;
        } catch { }
      }

      // Fallback: tombol dengan teks 'Run'
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find((b) => {
        const txt = (b.textContent || '').trim();
        return (txt === 'Run' || txt.startsWith('Run ') || txt.includes('Run Ctrl')) && this.isElementVisible(b);
      }) || null;
    },

    /**
     * Cek apakah tombol Run sudah aktif (tidak disabled dan perhitungan token video selesai)
     */
    isRunButtonEnabled(btn) {
      if (!btn) return false;
      const isDisabled =
        btn.disabled ||
        btn.getAttribute('aria-disabled') === 'true' ||
        btn.classList.contains('disabled') ||
        btn.hasAttribute('disabled');
      return !isDisabled && this.isElementVisible(btn);
    },

    /**
     * Menunggu hingga tombol Run menjadi aktif dan token media selesai dihitung
     */
    async waitForRunButton(maxWaitMs = 60000, filename = '') {
      const startTime = Date.now();
      console.log('[ScriptGenerator] Menunggu tombol Run aktif & token media selesai dihitung...');

      while (Date.now() - startTime < maxWaitMs) {
        const btn = this.findRunButton();
        const mediaReady = this.areMediaChunksReady(filename);

        if (btn && this.isRunButtonEnabled(btn) && mediaReady) {
          console.log('[ScriptGenerator] ✅ Tombol Run aktif & media siap dieksekusi!');
          return btn;
        }
        await sleep(1000);
      }

      throw new Error(`Timeout: Tombol Run / media chunk tidak kunjung siap dalam ${Math.round(maxWaitMs / 1000)} detik.`);
    },

    /**
     * Klik tombol Run secara native (tepat 1x agar tidak terjadi duplikasi stream paralel)
     */
    async clickRunButton(filename = '') {
      if (this._isClickingRun) {
        console.warn('[ScriptGenerator] ⚠️ Pemanggilan clickRunButton diabaikan karena sedang berlangsung.');
        return { clicked: false, inProgress: true };
      }
      this._isClickingRun = true;

      try {
        const btn = await this.waitForRunButton(45000, filename);
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(350);

        btn.focus();
        btn.click();
        console.log('[ScriptGenerator] 🚀 Tombol Run berhasil diklik tepat 1x!');

        return { clicked: true, timestamp: Date.now() };
      } finally {
        // Kunci selama 5 detik untuk mencegah double-trigger yang memicu streaming ganda di AI Studio
        setTimeout(() => {
          this._isClickingRun = false;
        }, 5000);
      }
    },

    /**
     * Mencari indikator tombol Stop (menandakan AI sedang meng-generate)
     */
    findStopButton() {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find((b) => {
        const txt = (b.textContent || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        return (txt.includes('stop') || aria.includes('stop')) && this.isElementVisible(b);
      }) || null;
    },

    /**
     * Cek apakah ada pesan error dari AI Studio di layar
     */
    checkForError() {
      const errorRegex = /(?:an error occurred|an internal error has occurred|error querying drive|failed to generate content|quota exceeded|resource has been exhausted|something went wrong|unable to process request|safety policy|blocked by safety filters|content policy violation|violates content policy)/i;

      // Cek elemen error banner / alert
      const errorElements = Array.from(
        document.querySelectorAll(
          '.error-message, ms-error-message, .mat-mdc-snack-bar-container, [role="alert"], .banner-error'
        )
      );

      for (const el of errorElements) {
        if (this.isElementVisible(el)) {
          const txt = (el.textContent || '').trim();
          if (txt && (errorRegex.test(txt) || txt.toLowerCase().includes('error'))) {
            return txt;
          }
        }
      }

      // Cek turn chat model terakhir
      const modelTurns = Array.from(document.querySelectorAll('ms-chat-turn, .model-response, ms-response-bubble'));
      if (modelTurns.length > 0) {
        const lastTurn = modelTurns[modelTurns.length - 1];
        const lastText = (lastTurn.textContent || '').trim();
        if (errorRegex.test(lastText)) {
          return lastText.slice(0, 200);
        }
      }

      return null;
    },

    /**
     * Membersihkan turn respon AI Studio dari elemen Thought blocks dan mengambil teks bersih
     */
    extractCleanTurnText(turn) {
      if (!turn) return '';

      // Clone DOM turn agar bisa memanipulasi tanpa merusak tampilan asli AI Studio
      const clone = turn.cloneNode(true);

      // 1. Singkirkan semua elemen yang teridentifikasi sebagai Thought chunk / collapsible thought
      const thoughtSelectors = [
        'ms-thought-chunk',
        'ms-thought-viewer',
        'ms-collapsible-thought',
        'ms-thought',
        '[data-test-id*="thought" i]',
        '[class*="thought" i]',
        'button[aria-label*="thought" i]',
        'button[title*="thought" i]',
        '.thought-container',
        '.thought-chunk',
        '.model-thought',
        '.thoughts-wrapper',
        '.thought-content',
        'mat-expansion-panel',
      ];

      for (const sel of thoughtSelectors) {
        try {
          clone.querySelectorAll(sel).forEach((el) => el.remove());
        } catch {}
      }

      // 2. Singkirkan elemen yang teksnya memuat header "✦ Thoughts"
      Array.from(clone.querySelectorAll('*')).forEach((el) => {
        const t = (el.textContent || '').trim();
        if (
          (t.startsWith('✦ Thoughts') ||
            t.startsWith('Thoughts\n') ||
            t === 'Expand to view model thoughts' ||
            t === 'Collapse model thoughts') &&
          el.children.length <= 4
        ) {
          el.remove();
        }
      });

      // 3. Singkirkan elemen author/meta (misal "Model • 11:38 AM", copy/feedback buttons)
      const metaSelectors = [
        'ms-chat-turn-author',
        '.author-header',
        'button[aria-label*="copy" i]',
        'button[aria-label*="thumb" i]',
        'button[aria-label*="share" i]',
        'button[aria-label*="edit" i]',
      ];
      for (const sel of metaSelectors) {
        try {
          clone.querySelectorAll(sel).forEach((el) => el.remove());
        } catch {}
      }

      // 4. Pasang clone ke wrapper off-screen agar Chromium merender layout blok & innerText dengan newline lengkap
      let fullText = '';
      try {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position: absolute; left: -99999px; top: -99999px; opacity: 0; pointer-events: none;';
        wrapper.appendChild(clone);
        document.body.appendChild(wrapper);
        fullText = (wrapper.innerText || wrapper.textContent || '').trim();
        wrapper.remove();
      } catch {
        fullText = (clone.innerText || clone.textContent || '').trim();
      }

      return fullText;
    },

    /**
     * Mengekstrak dan menyambungkan teks output dari AI Studio secara utuh
     */
    extractRawResponse() {
      // Prioritas 1: Ambil dari elemen model turn / response bubble yang memuat JSON naskah
      const turns = Array.from(
        document.querySelectorAll('ms-chat-turn, .model-response, ms-response-bubble, [data-test-id="chat-turn"]')
      );

      for (let i = turns.length - 1; i >= 0; i--) {
        const turn = turns[i];

        // Lewati turn yang merupakan editor prompt user
        if (
          turn.querySelector('ms-prompt-editor, textarea, [contenteditable="true"]') ||
          turn.getAttribute('data-turn-role') === 'user' ||
          turn.classList.contains('user-turn')
        ) {
          continue;
        }

        const extracted = this.extractCleanTurnText(turn);
        if (
          extracted.includes('chunk_part') ||
          extracted.includes('naskah_voiceover') ||
          extracted.includes('script_text') ||
          extracted.includes('scene_')
        ) {
          return extracted;
        }
      }

      // Fallback turn terakhir jika ada teks signifikan
      if (turns.length > 0) {
        const lastTurn = turns[turns.length - 1];
        const extracted = this.extractCleanTurnText(lastTurn);
        if (extracted.trim().length > 30) {
          return extracted;
        }
      }

      // Prioritas 2: Cari tag code / pre di seluruh halaman (gabungkan jika ada beberapa)
      const codes = Array.from(document.querySelectorAll('code, pre'));
      const candidateCodeTexts = [];
      for (const c of codes) {
        const txt = (c.textContent || '').trim();
        if (
          txt.includes('chunk_part') ||
          txt.includes('naskah_voiceover') ||
          txt.includes('script_text') ||
          txt.includes('character_registry')
        ) {
          candidateCodeTexts.push(txt);
        }
      }
      if (candidateCodeTexts.length > 0) {
        return candidateCodeTexts.join('\n');
      }

      // Prioritas 3: Teks seluruh body
      return (document.body.innerText || '').trim();
    },

    /**
     * Membersihkan markdown code block, thought headers, dan menyambungkan potongan JSON
     */
    cleanJsonString(rawText) {
      if (!rawText) return '';

      let cleaned = String(rawText);

      // 1. Bersihkan blok "✦ Thoughts" (baik collapsed maupun expanded) beserta teks di dalamnya
      cleaned = cleaned.replace(
        /\s*✦\s*Thoughts[\s\S]*?(?:(?:Expand|Collapse|Hide)\s+(?:to\s+view\s+)?model\s+thoughts|\bthought\b|[\r\n]{2,})\s*/gi,
        ''
      );
      cleaned = cleaned.replace(/\s*(?:Expand|Collapse|Hide)\s+(?:to\s+view\s+)?model\s+thoughts\s*/gi, '');

      // 2. Cari batas kurung kurawal terluar { ... }
      const startIdx = cleaned.indexOf('{');
      const endIdx = cleaned.lastIndexOf('}');

      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        cleaned = cleaned.slice(startIdx, endIdx + 1);
      } else if (startIdx !== -1) {
        cleaned = cleaned.slice(startIdx);
      }

      // 3. Di dalam struktur JSON, singkirkan semua pagar markdown ``` atau ```json yang tersisa dari split model
      cleaned = cleaned.replace(/`{3,}(?:json)?/gi, '');

      return cleaned.trim();
    },

    /**
     * Merapikan field naskah_voiceover jika ada kata yang terpotong split di tengah (misal: cow\n\nok -> cowok)
     */
    postProcessParsedJson(parsed) {
      if (!parsed || typeof parsed !== 'object') return;

      if (parsed.naskah_voiceover && typeof parsed.naskah_voiceover === 'object') {
        if (typeof parsed.naskah_voiceover.script_text === 'string') {
          parsed.naskah_voiceover.script_text = parsed.naskah_voiceover.script_text
            .replace(/([a-zA-Z0-9])[\r\n]+([a-zA-Z0-9])/g, '$1$2')
            .replace(/[\r\n]{3,}/g, '\n\n')
            .trim();
        }
      }
    },

    /**
     * Parsing JSON dengan toleransi sanitasi kontrol karakter dan pemulihan unescaped newlines
     */
    safeParseJson(jsonString) {
      const cleaned = this.cleanJsonString(jsonString);

      try {
        const parsed = JSON.parse(cleaned);
        this.postProcessParsedJson(parsed);
        return parsed;
      } catch (err1) {
        try {
          // Scanner character-by-character untuk memperbaiki unescaped newlines/tabs di dalam string literal
          let inString = false;
          let escaped = false;
          let result = '';

          for (let i = 0; i < cleaned.length; i++) {
            const char = cleaned[i];

            if (char === '"' && !escaped) {
              inString = !inString;
              result += char;
            } else if (inString && (char === '\n' || char === '\r')) {
              result += char === '\n' ? '\\n' : '';
            } else if (inString && char === '\t') {
              result += '\\t';
            } else {
              result += char;
            }

            if (char === '\\' && !escaped) {
              escaped = true;
            } else {
              escaped = false;
            }
          }

          // Bersihkan trailing commas jika ada (e.g. [1, 2, ] atau { "a": 1, })
          const noTrailingComma = result.replace(/,\s*([\]}])/g, '$1');
          // Bersihkan kontrol karakter selain standard whitespace
          const sanitized = noTrailingComma.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

          const parsed = JSON.parse(sanitized);
          this.postProcessParsedJson(parsed);
          return parsed;
        } catch (err2) {
          throw new Error(`JSON parsing gagal: ${err1.message} (sanitized fallback: ${err2.message})`);
        }
      }
    },

    /**
     * Cek status generasi saat ini secara non-blocking
     */
    checkCurrentStatus() {
      const errorMsg = this.checkForError();
      if (errorMsg) {
        return { status: 'error', errorMessage: errorMsg };
      }

      const stopBtn = this.findStopButton();
      if (stopBtn) {
        return { status: 'generating' };
      }

      const rawOutput = this.extractRawResponse();
      if (rawOutput && rawOutput.length > 80) {
        const hasDone = /"status"\s*:\s*"(?:done|Done)"/i.test(rawOutput);
        const hasScript = rawOutput.includes('naskah_voiceover') || rawOutput.includes('script_text');
        if (hasDone || hasScript) {
          const cleaned = this.cleanJsonString(rawOutput);
          try {
            const parsed = this.safeParseJson(cleaned);
            return {
              status: 'completed',
              rawText: rawOutput,
              cleanedJson: cleaned,
              parsedJson: parsed,
            };
          } catch (pe) {
            return { status: 'generating_streaming', partialLen: rawOutput.length };
          }
        }
      }

      return { status: 'waiting', outputLen: rawOutput ? rawOutput.length : 0 };
    },

    /**
     * Memantau proses generasi output AI Studio hingga selesai atau terjadi error
     */
    async pollGeneration(options = {}) {
      const maxTimeoutMs = options.maxTimeoutMs || 300000; // 5 menit
      const startTime = Date.now();
      let hasStartedGenerating = false;
      let lastOutputLen = 0;
      let stableCount = 0;

      console.log('[ScriptGenerator] ⏳ Memulai pemantauan output AI Studio...');

      while (Date.now() - startTime < maxTimeoutMs) {
        await sleep(2000);
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);

        // 1. Cek apakah ada error AI Studio
        const errorMsg = this.checkForError();
        if (errorMsg) {
          console.warn(`[ScriptGenerator] ⚠️ Terdeteksi error AI Studio: "${errorMsg}"`);
          return {
            success: true,
            hasError: true,
            errorMessage: errorMsg,
            elapsedSec,
          };
        }

        // 2. Cek tombol Stop
        const stopBtn = this.findStopButton();
        if (stopBtn) {
          hasStartedGenerating = true;
          console.log(`[ScriptGenerator] ⏳ Model sedang memproses/menulis respon (Detik ${elapsedSec})...`);
          continue;
        }

        // 3. Jika tombol Stop sudah tidak ada, periksa respon yang sudah tertulis
        const rawOutput = this.extractRawResponse();
        const currentLen = rawOutput.length;

        // Jika output sudah ada isinya yang signifikan
        if (currentLen > 100) {
          // Cek stabilitas teks (panjang tidak berubah dalam 2 iterasi berturut-turut)
          if (currentLen === lastOutputLen) {
            stableCount++;
          } else {
            stableCount = 0;
            lastOutputLen = currentLen;
          }

          // Cek tanda selesai:
          // a. Ada status "done" di dalam teks JSON
          const hasDoneStatus = /"status"\s*:\s*"(?:done|Done)"/i.test(rawOutput);
          // b. Ada blok script_text atau naskah_voiceover
          const hasScript = rawOutput.includes('naskah_voiceover') || rawOutput.includes('script_text');
          // c. Teks sudah stabil selama minimal 4 detik dan stop button tidak ada
          const isStable = stableCount >= 2;

          if ((hasDoneStatus || hasScript) && (isStable || !stopBtn)) {
            console.log(`[ScriptGenerator] 🎉 Respon selesai terdeteksi di detik ${elapsedSec}! Panjang: ${currentLen} karakter.`);

            const cleanedJson = this.cleanJsonString(rawOutput);
            try {
              const parsed = this.safeParseJson(cleanedJson);
              return {
                success: true,
                hasError: false,
                rawText: rawOutput,
                cleanedJson,
                parsedJson: parsed,
                elapsedSec,
              };
            } catch (parseErr) {
              // Jika belum valid JSON tapi masih dalam batas waktu, tunggu lagi
              if (elapsedSec < 30) {
                continue;
              }
              console.warn('[ScriptGenerator] Output belum valid JSON, menunggu sebentar lagi...', parseErr.message);
            }
          }
        }
      }

      return {
        success: false,
        hasError: true,
        errorMessage: `Timeout menunggu output AI Studio (${Math.round(maxTimeoutMs / 1000)}s).`,
      };
    },

    /**
     * Menyimpan hasil JSON ke Supabase dan langsung men-generate prompt Part 2
     */
    async saveOutputAndChainNextPrompt(params) {
      const { contentId, partNumber, totalParts = 6, parsedJson, movieTitle, movieYear } = params;

      console.log(`[ScriptGenerator] 💾 Menyimpan output Part #${partNumber} ke Supabase...`);

      // 1. Simpan script_output ke Supabase pada part saat ini
      const parts = await window.SupabaseBridge.getParts(contentId);
      const currentPart = parts.find((p) => Number(p.part_number) === Number(partNumber));

      if (!currentPart) {
        throw new Error(`Part #${partNumber} tidak ditemukan di database untuk content ${contentId}!`);
      }

      await window.SupabaseBridge.updatePart(currentPart.id, {
        script_output: parsedJson,
        script_status: 'done',
        script_done_at: new Date().toISOString(),
      });

      console.log(`[ScriptGenerator] ✅ Part #${partNumber} berhasil disimpan dengan status 'done'!`);

      // 2. Generate prompt untuk Part berikutnya (jika belum part terakhir)
      const nextPartNum = Number(partNumber) + 1;
      if (nextPartNum <= Number(totalParts)) {
        console.log(`[ScriptGenerator] 🔄 Men-generate prompt untuk Part #${nextPartNum} berbasis output Part #${partNumber}...`);

        const nextPart = parts.find((p) => Number(p.part_number) === nextPartNum);
        const durationSec = nextPart?.duration_sec || 1200;

        // Ambil semua part yang sudah selesai untuk riwayat konteks
        const updatedParts = parts.map((p) =>
          Number(p.part_number) === Number(partNumber)
            ? { ...p, script_output: parsedJson }
            : p
        );
        const finishedParts = updatedParts.filter(
          (p) => Number(p.part_number) < nextPartNum && p.script_output
        );

        if (window.PromptGenerator) {
          const generatedPrompt = window.PromptGenerator.generatePrompt({
            partNumber: nextPartNum,
            totalParts,
            movieTitle: movieTitle || contentId,
            movieYear: movieYear || '',
            durationSec,
            previousParts: finishedParts,
          });

          if (nextPart) {
            await window.SupabaseBridge.updatePart(nextPart.id, {
              prompt: generatedPrompt,
            });
            console.log(`[ScriptGenerator] 🎉 Prompt Part #${nextPartNum} berhasil di-generate & disimpan ke Supabase (${generatedPrompt.length} karakter)!`);
          }

          return {
            savedCurrent: true,
            chainedNext: true,
            nextPartNumber: nextPartNum,
            nextPromptLength: generatedPrompt.length,
          };
        } else {
          console.warn('[ScriptGenerator] window.PromptGenerator tidak tersedia, lewati generate prompt part 2.');
        }
      }

      return { savedCurrent: true, chainedNext: false };
    },

    /**
     * Handler pesan runtime dari Extension Sidepanel / Background
     */
    async handleMessage(message) {
      if (message.action === 'SCRIPT_CLICK_RUN') {
        const filename = message.payload?.filename || message.filename;
        return await this.clickRunButton(filename);
      }

      if (message.action === 'SCRIPT_CHECK_PREPARED') {
        const filename = message.payload?.filename || message.filename;
        const hasMedia = this.hasMediaChunk(filename);
        const mediaReady = hasMedia ? this.areMediaChunksReady(filename) : false;
        const editor = this.findPromptEditor();
        const curText = editor ? ('value' in editor ? editor.value : editor.innerText) : '';
        return {
          hasMedia,
          mediaReady,
          hasPrompt: !!(curText && curText.trim().length > 20),
          isReadyToRun: hasMedia && mediaReady && !!(curText && curText.trim().length > 20)
        };
      }

      if (message.action === 'SCRIPT_FILL_PROMPT') {
        const promptText = message.payload?.promptText || message.promptText;
        const filled = this.fillPromptText(promptText);
        return { success: filled };
      }

      if (message.action === 'SCRIPT_POLL_OUTPUT') {
        return await this.pollGeneration({ maxTimeoutMs: message.maxTimeoutMs || 300000 });
      }

      if (message.action === 'SCRIPT_CHECK_STATUS') {
        return this.checkCurrentStatus();
      }

      if (message.action === 'SCRIPT_SAVE_AND_CHAIN') {
        return await this.saveOutputAndChainNextPrompt(message.payload);
      }

      if (message.action === 'SCRIPT_CHECK_TURNS') {
        return { hasTurns: this.hasChatTurns() };
      }

      return null;
    },
  };

  // Daftarkan ke Global Registry ContentAuto
  if (window.ContentAuto && typeof window.ContentAuto.registerModule === 'function') {
    window.ContentAuto.registerModule('scriptGenerator', ScriptGenerator);
  } else {
    window.ContentAuto = window.ContentAuto || { modules: {} };
    window.ContentAuto.modules = window.ContentAuto.modules || {};
    window.ContentAuto.modules.scriptGenerator = ScriptGenerator;
  }
})();
