// extension/modules/mapping-generator.js
// Modul otomatisasi Video Mapping di Google AI Studio (aistudio.google.com)
// Mengotomasi sinkronisasi visual video chunk terhadap transkrip naskah/audio VO
// Berjalan di dalam content script browser (DOM asli) untuk menghindari deteksi bot

(function () {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const MappingGenerator = {
    name: 'mappingGenerator',

    init() {
      console.log('[MappingGenerator] 🎯 Modul Video Mapping Generator siap di Google AI Studio.');
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
     * Cek apakah kartu media chunk video BENAR-BENAR terpasang di editor
     * Mendeteksi via selector kustom, pola token (misal 117,080 tokens), dan nama file chunk
     */
    hasMediaChunk(filename) {
      const promptBox = document.querySelector(
        'ms-prompt-editor, ms-chat-prompt-box, ms-prompt-bar, .prompt-box, .input-area, [role="main"]'
      );

      // 1. Cek elemen card chunk bawaan AI Studio
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
        } catch {}
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
        console.warn('[MappingGenerator] Prompt editor tidak ditemukan di DOM.');
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
      console.log(`[MappingGenerator] ✍️ Video Mapping Prompt berhasil diisi (${promptText.length} karakter).`);
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
        } catch {}
      }

      // Fallback: tombol dengan teks 'Run'
      const buttons = Array.from(document.querySelectorAll('button'));
      return (
        buttons.find((b) => {
          const txt = (b.textContent || '').trim();
          return (txt === 'Run' || txt.startsWith('Run ') || txt.includes('Run Ctrl')) && this.isElementVisible(b);
        }) || null
      );
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
      console.log('[MappingGenerator] Menunggu tombol Run aktif & token media selesai dihitung...');

      while (Date.now() - startTime < maxWaitMs) {
        const btn = this.findRunButton();
        const mediaReady = this.areMediaChunksReady(filename);

        if (btn && this.isRunButtonEnabled(btn) && mediaReady) {
          console.log('[MappingGenerator] ✅ Tombol Run aktif & media video siap dieksekusi!');
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
        console.warn('[MappingGenerator] ⚠️ Pemanggilan clickRunButton diabaikan karena sedang berlangsung.');
        return { clicked: false, inProgress: true };
      }
      this._isClickingRun = true;

      try {
        const btn = await this.waitForRunButton(45000, filename);
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(350);

        btn.focus();
        btn.click();
        console.log('[MappingGenerator] 🚀 Tombol Run berhasil diklik tepat 1x!');

        return { clicked: true, timestamp: Date.now() };
      } finally {
        // Kunci selama 5 detik untuk mencegah double-trigger
        setTimeout(() => {
          this._isClickingRun = false;
        }, 5000);
      }
    },

    /**
     * Mencari indikator tombol Stop (menandakan AI sedang meng-generate)
     */
    findStopButton() {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      return (
        buttons.find((b) => {
          const txt = (b.textContent || '').trim().toLowerCase();
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const title = (b.getAttribute('title') || '').toLowerCase();
          return (
            (txt === 'stop' ||
              txt.startsWith('stop ') ||
              aria.includes('stop') ||
              aria.includes('cancel') ||
              title.includes('stop')) &&
            this.isElementVisible(b)
          );
        }) || null
      );
    },

    /**
     * Memeriksa apakah AI Studio saat ini sedang aktif memproses / streaming output
     */
    isGenerating() {
      if (this.findStopButton()) return true;

      const progressSelectors = [
        'mat-progress-bar',
        'mat-spinner',
        'mat-progress-spinner',
        '.streaming-indicator',
        '.loading-indicator',
        '[role="progressbar"]',
        'ms-chat-turn.streaming',
        '[data-test-id*="streaming" i]',
        '[class*="streaming" i]',
      ];
      for (const sel of progressSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el && this.isElementVisible(el)) return true;
        } catch {}
      }

      return false;
    },

    /**
     * Cek apakah ada pesan error fatal sistem dari AI Studio di layar
     */
    checkForError() {
      // JANGAN cek error jika AI masih aktif men-generate respon!
      if (this.isGenerating()) {
        return null;
      }

      const fatalErrorRegex =
        /(?:quota exceeded|resource has been exhausted|internal error has occurred|failed to generate content|model is overloaded|rate limit exceeded|safety policy violation|blocked by safety filters|content policy violation|unable to process request)/i;

      // 1. Cek banner / alert spesifik tingkat sistem AI Studio
      const bannerSelectors = [
        'ms-banner[variant="error"]',
        '.banner-error',
        '.error-banner',
        '.callout-error',
        '.banner.error',
        '.mat-mdc-snack-bar-container',
      ];

      for (const sel of bannerSelectors) {
        const banners = Array.from(document.querySelectorAll(sel));
        for (const el of banners) {
          if (this.isElementVisible(el)) {
            const txt = (el.textContent || '').trim();
            if (txt && fatalErrorRegex.test(txt)) {
              return txt;
            }
          }
        }
      }

      // 2. Cek apakah ada turn model yang gagal total (misal turn-error atau error-state)
      const modelTurns = Array.from(
        document.querySelectorAll('ms-chat-turn, .model-response, ms-response-bubble, [data-test-id="chat-turn"]')
      );
      if (modelTurns.length > 0) {
        const lastTurn = modelTurns[modelTurns.length - 1];

        const isUserTurn =
          lastTurn.querySelector('ms-prompt-editor, textarea, [contenteditable="true"]') ||
          lastTurn.getAttribute('data-turn-role') === 'user' ||
          lastTurn.classList.contains('user-turn');

        if (!isUserTurn) {
          const turnErrorEl = lastTurn.querySelector(
            '.error-state, .turn-error, .error-container, [data-test-id="turn-error"]'
          );
          const lastText = (lastTurn.textContent || '').trim();

          const hasJsonOrCode =
            lastTurn.querySelector('code, pre, ms-code-block') ||
            lastText.includes('mappings') ||
            lastText.includes('scene_id') ||
            lastText.includes('sentence_index') ||
            lastText.includes('{');

          if (!hasJsonOrCode) {
            if (turnErrorEl && this.isElementVisible(turnErrorEl)) {
              return (turnErrorEl.textContent || '').trim() || 'AI Studio model turn error';
            }
            if (lastText.length > 0 && lastText.length < 350 && fatalErrorRegex.test(lastText)) {
              return lastText;
            }
          }
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
        'ms-thought-container',
        'ms-reasoning-chunk',
        'ms-reasoning',
        '[data-test-id*="thought" i]',
        '[data-test-id*="thinking" i]',
        '[class*="thought" i]',
        '[class*="thinking" i]',
        '[aria-label*="thought" i]',
        '[aria-label*="thinking" i]',
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

      // 2. Singkirkan elemen yang teksnya memuat header "✦ Thoughts" atau "Thinking Process"
      Array.from(clone.querySelectorAll('*')).forEach((el) => {
        const t = (el.textContent || '').trim();
        if (
          (t.startsWith('✦ Thoughts') ||
            t.startsWith('Thoughts\n') ||
            t.startsWith('Thinking Process') ||
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
     * Mengekstrak dan menyambungkan teks output Video Mapping dari AI Studio secara utuh
     */
    extractRawResponse() {
      // Prioritas 1: Ambil dari elemen model turn / response bubble yang memuat JSON mapping
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

        // Cek elemen code block langsung di dalam turn model (paling bersih dan terhindar dari thoughts)
        const codeEls = Array.from(
          turn.querySelectorAll('ms-code-block, pre code, pre, [data-test-id="code-block"]')
        );
        for (const codeEl of codeEls) {
          const cText = (codeEl.textContent || '').trim();
          if (
            cText.includes('mappings') ||
            cText.includes('scene_id') ||
            cText.includes('sentence_index') ||
            cText.includes('source_start_seconds')
          ) {
            return cText;
          }
        }

        const extracted = this.extractCleanTurnText(turn);
        if (
          extracted.includes('mappings') ||
          extracted.includes('scene_id') ||
          extracted.includes('sentence_index') ||
          extracted.includes('source_start_seconds')
        ) {
          return extracted;
        }
      }

      // Prioritas 2: Cari tag code / pre di seluruh halaman (pilih yang memuat data mapping)
      const codes = Array.from(
        document.querySelectorAll('ms-code-block, pre code, pre, [data-test-id="code-block"]')
      );
      const candidateCodeTexts = [];
      for (const c of codes) {
        const txt = (c.textContent || '').trim();
        if (
          txt.includes('mappings') ||
          txt.includes('scene_id') ||
          txt.includes('sentence_index') ||
          txt.includes('source_start_seconds')
        ) {
          candidateCodeTexts.push(txt);
        }
      }
      if (candidateCodeTexts.length > 0) {
        return candidateCodeTexts[candidateCodeTexts.length - 1];
      }

      // Fallback turn model terakhir jika ada teks signifikan
      for (let i = turns.length - 1; i >= 0; i--) {
        const turn = turns[i];
        const isUserTurn =
          turn.querySelector('ms-prompt-editor, textarea, [contenteditable="true"]') ||
          turn.getAttribute('data-turn-role') === 'user' ||
          turn.classList.contains('user-turn');
        if (!isUserTurn) {
          const extracted = this.extractCleanTurnText(turn);
          if (extracted.trim().length > 30) {
            return extracted;
          }
        }
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

      // 1. Prioritas utama: jika teks memuat markdown code block ```json ... ``` atau ``` ... ```
      const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
      let match;
      let targetCodeBlock = '';
      while ((match = codeBlockRegex.exec(cleaned)) !== null) {
        const blockContent = match[1].trim();
        if (
          blockContent.includes('{') &&
          (blockContent.includes('mappings') ||
            blockContent.includes('scene_id') ||
            blockContent.includes('chunk_part'))
        ) {
          targetCodeBlock = blockContent;
        }
      }
      if (targetCodeBlock) {
        cleaned = targetCodeBlock;
      }

      // 2. Bersihkan blok "✦ Thoughts" (baik collapsed maupun expanded) beserta teks di dalamnya
      cleaned = cleaned.replace(
        /\s*✦\s*Thoughts[\s\S]*?(?:(?:Expand|Collapse|Hide)\s+(?:to\s+view\s+)?model\s+thoughts|\bthought\b|[\r\n]{2,})\s*/gi,
        ''
      );
      cleaned = cleaned.replace(/\s*(?:Expand|Collapse|Hide)\s+(?:to\s+view\s+)?model\s+thoughts\s*/gi, '');
      cleaned = cleaned.replace(/^(?:Thinking Process|Thoughts):?\s*[\s\S]*?\n(?=\{)/i, '');

      // 3. Cari batas kurung kurawal terluar { ... }
      const startIdx = cleaned.indexOf('{');
      const endIdx = cleaned.lastIndexOf('}');

      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        cleaned = cleaned.slice(startIdx, endIdx + 1);
      } else if (startIdx !== -1) {
        cleaned = cleaned.slice(startIdx);
      }

      // 4. Di dalam struktur JSON, singkirkan semua pagar markdown ``` atau ```json
      cleaned = cleaned.replace(/`{3,}(?:json)?/gi, '');

      return cleaned.trim();
    },

    /**
     * Merapikan field mapping jika ada teks terputus
     */
    postProcessParsedJson(parsed) {
      if (!parsed || typeof parsed !== 'object') return;

      if (Array.isArray(parsed.mappings)) {
        parsed.mappings.forEach((item) => {
          if (item && typeof item.text === 'string') {
            item.text = item.text
              .replace(/([a-zA-Z0-9])[\r\n]+([a-zA-Z0-9])/g, '$1$2')
              .replace(/[\r\n]{3,}/g, '\n\n')
              .trim();
          }
        });
      }
    },

    /**
     * Parsing JSON dengan toleransi sanitasi kontrol karakter dan pemulihan unescaped newlines
     */
    safeParseJson(jsonString) {
      const cleaned = this.cleanJsonString(jsonString);

      // Level 1: Standard JSON parse
      try {
        const parsed = JSON.parse(cleaned);
        this.postProcessParsedJson(parsed);
        return parsed;
      } catch (err1) {
        // Level 2: Character scanner fixing unescaped newlines/tabs inside strings
        try {
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
          // Level 3: Ganti smart quotes & trailing commas fallback
          try {
            let repaired = cleaned
              .replace(/[\u201C\u201D]/g, '\\"')
              .replace(/[\u2018\u2019]/g, "'")
              .replace(/,\s*([\]}])/g, '$1');
            const parsed = JSON.parse(repaired);
            this.postProcessParsedJson(parsed);
            return parsed;
          } catch (err3) {
            throw new Error(`JSON mapping parsing gagal: ${err1.message} (sanitized fallback: ${err2.message})`);
          }
        }
      }
    },

    /**
     * Cek status generasi mapping saat ini secara non-blocking
     */
    checkCurrentStatus() {
      // 1. Ekstrak output teks saat ini
      const rawOutput = this.extractRawResponse();

      // 2. Cek apakah output JSON sudah terbentuk dan valid (Prioritas tertinggi!)
      if (rawOutput && rawOutput.length > 80) {
        const hasMappings = rawOutput.includes('mappings');
        const hasScene = rawOutput.includes('scene_id') || rawOutput.includes('chunk_part');
        const hasDone = /"status"\s*:\s*"(?:done|Done)"/i.test(rawOutput);

        if (hasMappings || hasScene || hasDone) {
          const cleaned = this.cleanJsonString(rawOutput);
          try {
            const parsed = this.safeParseJson(cleaned);
            if (parsed && (Array.isArray(parsed.mappings) || parsed.scene_id || parsed.chunk_part)) {
              return {
                status: 'completed',
                rawText: rawOutput,
                cleanedJson: cleaned,
                parsedJson: parsed,
              };
            }
          } catch (pe) {
            if (this.isGenerating()) {
              return { status: 'generating_streaming', partialLen: rawOutput.length };
            }
          }
        }
      }

      // 3. Cek apakah model masih aktif men-generate / streaming
      if (this.isGenerating()) {
        return { status: 'generating', outputLen: rawOutput ? rawOutput.length : 0 };
      }

      // 4. Jika sudah tidak streaming dan teks cukup panjang, coba parse sekali lagi
      if (rawOutput && rawOutput.length > 100) {
        const cleaned = this.cleanJsonString(rawOutput);
        try {
          const parsed = this.safeParseJson(cleaned);
          if (parsed && (Array.isArray(parsed.mappings) || parsed.scene_id || parsed.chunk_part)) {
            return {
              status: 'completed',
              rawText: rawOutput,
              cleanedJson: cleaned,
              parsedJson: parsed,
            };
          }
        } catch {}
      }

      // 5. HANYA jika TIDAK sedang generate dan TIDAK ada output valid, periksa error sistem
      const errorMsg = this.checkForError();
      if (errorMsg) {
        return { status: 'error', errorMessage: errorMsg };
      }

      return { status: 'waiting', outputLen: rawOutput ? rawOutput.length : 0 };
    },

    /**
     * Memantau proses generasi output AI Studio hingga selesai atau terjadi error
     */
    async pollGeneration(options = {}) {
      const maxTimeoutMs = options.maxTimeoutMs || 360000; // 6 menit
      const startTime = Date.now();
      let lastOutputLen = 0;
      let stableCount = 0;

      console.log('[MappingGenerator] ⏳ Memulai pemantauan output Video Mapping AI Studio...');

      while (Date.now() - startTime < maxTimeoutMs) {
        await sleep(2000);
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);

        // 1. Ekstrak output teks saat ini
        const rawOutput = this.extractRawResponse();
        const currentLen = rawOutput ? rawOutput.length : 0;
        const isGen = this.isGenerating();

        // 2. Cek apakah output sudah selesai dan valid
        if (currentLen > 80) {
          if (currentLen === lastOutputLen) {
            stableCount++;
          } else {
            stableCount = 0;
            lastOutputLen = currentLen;
          }

          const hasMappings = rawOutput.includes('mappings');
          const hasDoneStatus = /"status"\s*:\s*"(?:done|Done)"/i.test(rawOutput);
          const isStable = stableCount >= 2;

          if ((hasDoneStatus || hasMappings) && (isStable || !isGen)) {
            const cleanedJson = this.cleanJsonString(rawOutput);
            try {
              const parsed = this.safeParseJson(cleanedJson);
              if (parsed && (Array.isArray(parsed.mappings) || parsed.scene_id || parsed.chunk_part)) {
                console.log(`[MappingGenerator] 🎉 Respon mapping selesai di detik ${elapsedSec}! Panjang: ${currentLen} karakter.`);
                return {
                  success: true,
                  hasError: false,
                  rawText: rawOutput,
                  cleanedJson,
                  parsedJson: parsed,
                  elapsedSec,
                };
              }
            } catch (parseErr) {
              if (elapsedSec < 30 || isGen) {
                // Masih streaming, lanjut tunggu
              } else {
                console.warn('[MappingGenerator] Output mapping belum valid JSON, menunggu sebentar lagi...', parseErr.message);
              }
            }
          }
        }

        // 3. Jika model masih generate, lanjutkan loop
        if (isGen) {
          console.log(`[MappingGenerator] ⏳ Model sedang memproses video & menyusun mapping (Detik ${elapsedSec})...`);
          continue;
        }

        // 4. HANYA jika tidak streaming dan belum valid, periksa error fatal sistem
        const errorMsg = this.checkForError();
        if (errorMsg && currentLen < 80) {
          console.warn(`[MappingGenerator] ⚠️ Terdeteksi error fatal AI Studio: "${errorMsg}"`);
          return {
            success: true,
            hasError: true,
            errorMessage: errorMsg,
            elapsedSec,
          };
        }
      }

      // Terakhir kali sebelum timeout: coba parse jika ada teks yang tertinggal di layar
      const finalRaw = this.extractRawResponse();
      if (finalRaw && finalRaw.length > 80) {
        try {
          const finalCleaned = this.cleanJsonString(finalRaw);
          const finalParsed = this.safeParseJson(finalCleaned);
          if (finalParsed && (Array.isArray(finalParsed.mappings) || finalParsed.scene_id || finalParsed.chunk_part)) {
            return {
              success: true,
              hasError: false,
              rawText: finalRaw,
              cleanedJson: finalCleaned,
              parsedJson: finalParsed,
              elapsedSec: Math.round((Date.now() - startTime) / 1000),
            };
          }
        } catch {}
      }

      return {
        success: false,
        hasError: true,
        errorMessage: `Timeout menunggu output Video Mapping AI Studio (${Math.round(maxTimeoutMs / 1000)}s).`,
      };
    },

    /**
     * Menyimpan hasil JSON Video Mapping ke Supabase
     */
    async saveMappingOutput(params) {
      const { contentId, partNumber, parsedJson } = params;

      console.log(`[MappingGenerator] 💾 Menyimpan output Video Mapping Part #${partNumber} ke Supabase...`);

      const parts = await window.SupabaseBridge.getParts(contentId);
      const currentPart = parts.find((p) => Number(p.part_number) === Number(partNumber));

      if (!currentPart) {
        throw new Error(`Part #${partNumber} tidak ditemukan di database untuk content ${contentId}!`);
      }

      try {
        await window.SupabaseBridge.updatePart(currentPart.id, {
          mapping_output: parsedJson,
          mapping_status: 'done',
          mapping_done_at: new Date().toISOString(),
        });
      } catch (patchErr) {
        console.warn('[MappingGenerator] ⚠️ Gagal update mapping_output, memeriksa kolom:', patchErr);
        // Jika kolom belum ada di database Supabase (error 42703)
        if (patchErr.message && (patchErr.message.includes('mapping_output') || patchErr.message.includes('42703'))) {
          throw new Error(
            `Kolom 'mapping_output' belum ada di Supabase database. Silakan jalankan script SQL 'scripts/migration-add-mapping-columns.sql' di Supabase SQL Editor terlebih dahulu.`
          );
        }
        throw patchErr;
      }

      console.log(`[MappingGenerator] ✅ Video Mapping Part #${partNumber} berhasil disimpan ke Supabase dengan status 'done'!`);

      return {
        saved: true,
        partNumber: Number(partNumber),
        itemCount: Array.isArray(parsedJson?.mappings) ? parsedJson.mappings.length : 0,
      };
    },

    /**
     * Handler pesan runtime dari Extension Sidepanel / Background
     */
    async handleMessage(message) {
      if (message.action === 'MAPPING_CLICK_RUN') {
        const filename = message.payload?.filename || message.filename;
        return await this.clickRunButton(filename);
      }

      if (message.action === 'MAPPING_CHECK_PREPARED') {
        const filename = message.payload?.filename || message.filename;
        const hasMedia = this.hasMediaChunk(filename);
        const mediaReady = hasMedia ? this.areMediaChunksReady(filename) : false;
        const editor = this.findPromptEditor();
        const curText = editor ? ('value' in editor ? editor.value : editor.innerText) : '';
        return {
          hasMedia,
          mediaReady,
          hasPrompt: !!(curText && curText.trim().length > 20),
          isReadyToRun: hasMedia && mediaReady && !!(curText && curText.trim().length > 20),
        };
      }

      if (message.action === 'MAPPING_FILL_PROMPT') {
        const promptText = message.payload?.promptText || message.promptText;
        const filled = this.fillPromptText(promptText);
        return { success: filled };
      }

      if (message.action === 'MAPPING_POLL_OUTPUT') {
        return await this.pollGeneration({ maxTimeoutMs: message.maxTimeoutMs || 360000 });
      }

      if (message.action === 'MAPPING_CHECK_STATUS') {
        return this.checkCurrentStatus();
      }

      if (message.action === 'MAPPING_SAVE_OUTPUT') {
        return await this.saveMappingOutput(message.payload);
      }

      if (message.action === 'MAPPING_CHECK_TURNS') {
        return { hasTurns: this.hasChatTurns() };
      }

      return null;
    },
  };

  // Daftarkan ke Global Registry ContentAuto
  if (window.ContentAuto && typeof window.ContentAuto.registerModule === 'function') {
    window.ContentAuto.registerModule('mappingGenerator', MappingGenerator);
  } else {
    window.ContentAuto = window.ContentAuto || { modules: {} };
    window.ContentAuto.modules = window.ContentAuto.modules || {};
    window.ContentAuto.modules.mappingGenerator = MappingGenerator;
  }
})();
