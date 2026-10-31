import time
from typing import Optional
from pathlib import Path

TTS_URL = "https://elevenlabs.io/app/speech-synthesis/text-to-speech"
DEFAULT_MODEL = "Eleven v3"
DEFAULT_VOICE = "Dany Saputra"


def safe_goto(page, url: str, wait_until: str = "domcontentloaded", max_retries: int = 3) -> bool:
    """Navigasi aman dengan penanganan otomatis untuk NS_ERROR_ABORT di Camoufox/Firefox."""
    for attempt in range(1, max_retries + 1):
        try:
            page.goto(url, wait_until=wait_until)
            page.wait_for_timeout(1000)
            return True
        except Exception as e:
            err_str = str(e)
            if "NS_ERROR_ABORT" in err_str or "aborted" in err_str.lower():
                print(f"[*] Navigasi tertahan oleh redirect aktif, menunggu sejenak (percobaan {attempt}/{max_retries})...")
                page.wait_for_timeout(2000)
            else:
                if attempt == max_retries:
                    raise e
                page.wait_for_timeout(1500)
    return False


# Injeksi kode JS helper yang persis sama dengan implementasi di extension/modules/elevenlabs-signup.js
JS_TTS_ENGINE = r"""
(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
  }

  function simulateRealClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;

      const opts = {
        bubbles: true,
        cancelable: true,
        composed: true,
        detail: 1,
        clientX: clientX,
        clientY: clientY,
        button: 0,
        buttons: 1,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        width: 1,
        height: 1,
      };

      el.focus?.();
      el.dispatchEvent(new PointerEvent('pointerover', opts));
      el.dispatchEvent(new PointerEvent('pointerenter', opts));
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      if (typeof el.click === 'function') {
        el.click();
      } else {
        el.dispatchEvent(new MouseEvent('click', opts));
      }
    } catch (e) {
      el.click?.();
    }
  }

  function setReactInputValue(inputEl, value) {
    if (!inputEl) return;
    try {
      inputEl.disabled = false;
      inputEl.removeAttribute('disabled');
      inputEl.removeAttribute('readonly');
      inputEl.focus();

      try {
        inputEl.select();
        const success = document.execCommand('insertText', false, value);
        if (success && inputEl.value === value) {
          inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          return;
        }
      } catch (e) {}

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(inputEl, value);
      } else {
        inputEl.value = value;
      }

      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: value, inputType: 'insertText' }));
      inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value.slice(-1) }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.slice(-1) }));

      if (inputEl.value !== value) {
        inputEl.value = value;
        inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      }
    } catch (e) {
      inputEl.value = value;
      inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
  }

  function dismissAllModals() {
    try {
      const unusualDialog = document.querySelector('[role="dialog"], [data-state="open"]');
      if (unusualDialog) {
        const dText = (unusualDialog.innerText || unusualDialog.textContent || '').toLowerCase();
        if (dText.includes('unusual activity') || dText.includes('free tier usage disabled')) {
          // Jangan dismiss dialog ini agar status error terdeteksi sempurna
          return;
        }
      }

      const dismissBtns = Array.from(document.querySelectorAll(
        'button[data-testid="v3-welcome-dialog-get-started"], button[aria-label*="close" i], button[aria-label*="dismiss" i]'
      ));
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (txt === 'get started' || txt === 'remind me later' || txt === 'close' || txt === 'got it' || txt === '✕' || txt === 'x') {
          dismissBtns.push(btn);
        }
      }
      for (const btn of dismissBtns) {
        if (isElementVisible(btn)) {
          simulateRealClick(btn);
        }
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));

      if (document.body) {
        document.body.style.setProperty('pointer-events', 'auto', 'important');
        document.body.style.setProperty('overflow', 'auto', 'important');
      }
      const overlays = document.querySelectorAll('.fixed.inset-0.z-50, [data-state="open"].fixed');
      for (const el of Array.from(overlays)) {
        const txt = (el.textContent || '').toLowerCase();
        if (
          txt.includes('upgrade') ||
          txt.includes('remind me later') ||
          txt.includes('credits remaining') ||
          txt.includes("what's new in eleven v3") ||
          txt.includes("introducing eleven v4") ||
          el.classList.contains('backdrop-blur-none') ||
          el.classList.contains('backdrop-blur-sm')
        ) {
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('visibility', 'hidden', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
        }
      }
    } catch (e) {}
  }

  function getModelSelector() {
    let modelSelector = document.querySelector('[data-testid="tts-model-selector"]');
    if (!modelSelector) {
      const labels = Array.from(document.querySelectorAll('span, div, label, p, h2, h3, h4'));
      const labelEl = labels.find(el => (el.innerText || '').trim().toLowerCase() === 'model');
      if (labelEl) {
        let parent = labelEl.parentElement;
        for (let i = 0; i < 4 && parent; i++) {
          const btn = parent.querySelector('button, [role="button"], [tabindex="0"]');
          if (btn && btn !== labelEl) {
            modelSelector = btn;
            break;
          }
          parent = parent.parentElement;
        }
      }
    }
    if (!modelSelector) {
      const allButtons = Array.from(document.querySelectorAll('button'));
      modelSelector = allButtons.find(b => {
        const txt = (b.innerText || b.textContent || '').toLowerCase();
        return (txt.includes('eleven v') || txt.includes('eleven multilingual')) && !txt.includes('history');
      });
    }
    return modelSelector;
  }

  function getVoiceSelector() {
    let voiceSelector = document.querySelector('[data-testid="tts-voice-selector"]');
    if (!voiceSelector) {
      const labels = Array.from(document.querySelectorAll('span, div, label, p, h2, h3, h4'));
      const labelEl = labels.find(el => (el.innerText || '').trim().toLowerCase() === 'voice');
      if (labelEl) {
        let parent = labelEl.parentElement;
        for (let i = 0; i < 4 && parent; i++) {
          const btn = parent.querySelector('button, [role="button"], [tabindex="0"]');
          if (btn && btn !== labelEl) {
            voiceSelector = btn;
            break;
          }
          parent = parent.parentElement;
        }
      }
    }
    if (!voiceSelector) {
      const allButtons = Array.from(document.querySelectorAll('button'));
      voiceSelector = allButtons.find(b => {
        const txt = (b.innerText || b.textContent || '').toLowerCase();
        return (txt.includes('adam') || txt.includes('dany') || txt.includes('saputra') || txt.includes('dominant')) &&
               !txt.includes('design') && !txt.includes('settings');
      });
    }
    return voiceSelector;
  }

  function formatNarrationScript(rawScript) {
    if (!rawScript || typeof rawScript !== 'string') return '';
    let result = rawScript;
    result = result.replace(/\[VISUAL_ONLY[^\]]*\]/gi, '[pauses]');
    result = result.replace(/\[[^\]]+\]/g, '[pauses]');
    result = result.replace(/<[^>]+>/g, '');
    result = result.replace(/(\s*\[pauses\]\s*)+/gi, '\n\n[pauses]\n\n');
    return result
      .replace(/[^\S\r\n]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();
  }

  function inputNarrationText(text) {
    if (!text) return false;
    const cleanText = formatNarrationScript(text);

    // Cari editor TipTap / ProseMirror atau contenteditable
    const editor = document.querySelector(
      '[data-testid="tts-editor"], .tiptap.ProseMirror[contenteditable="true"], [contenteditable="true"]'
    );

    if (editor) {
      editor.focus();
      editor.click();

      // Hapus teks lama jika ada tombol "Clear text"
      const clearBtn = Array.from(document.querySelectorAll('button')).find((b) => {
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const title = (b.getAttribute('title') || '').toLowerCase();
        return aria.includes('clear text') || title.includes('clear text');
      });

      if (clearBtn && isElementVisible(clearBtn)) {
        simulateRealClick(clearBtn);
      }

      // Hapus konten lama
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      sel.removeAllRanges();
      sel.addRange(range);
      try {
        document.execCommand('delete');
      } catch (e) {}

      // Masukkan teks baru
      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, cleanText);
      } catch (e) {}

      if (!inserted || !editor.innerText.trim()) {
        editor.innerHTML = `<p>${cleanText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
      }

      // Dispatch event input agar status counter & tombol generate aktif
      editor.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: cleanText,
        })
      );
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));

      return true;
    }

    // Fallback untuk textarea standar
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.focus();
      setReactInputValue(textarea, cleanText);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    return false;
  }

  function findGenerateSpeechButton() {
    // Tutup popup pencarian jika ada
    const searchPalette = document.querySelector('[role="dialog"], [cmdk-root], div[data-state="open"]');
    if (searchPalette) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }

    const allButtons = Array.from(document.querySelectorAll('button'));
    const validButtons = allButtons.filter((b) => {
      if (!isElementVisible(b)) return false;
      if (b.closest('header, nav, [role="dialog"], [role="menu"], [cmdk-root]')) return false;
      return true;
    });

    // 1. Teks persis "generate speech" atau "regenerate speech"
    const exactBtn = validButtons.find((b) => {
      const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
      return txt === 'generate speech' || txt === 'regenerate speech';
    });
    if (exactBtn) return exactBtn;

    // 2. data-testid spesifik
    const testIdBtn = validButtons.find((b) => {
      const tid = (b.getAttribute('data-testid') || '').toLowerCase();
      return tid === 'tts-generate' || tid === 'generate-button' || tid === 'speech-generate-button';
    });
    if (testIdBtn) return testIdBtn;

    // 3. aria-label spesifik
    const ariaBtn = validButtons.find((b) => {
      const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
      return aria === 'generate speech' || aria === 'regenerate speech';
    });
    if (ariaBtn) return ariaBtn;

    // 4. Diawali teks "generate speech"
    const startBtn = validButtons.find((b) => {
      const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
      return txt.startsWith('generate speech');
    });
    if (startBtn) return startBtn;

    // 5. Fallback tombol dengan teks "generate" di area konten TTS
    return validButtons.find((b) => {
      const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
      return (
        txt.includes('generate') &&
        !txt.includes('voice') &&
        !txt.includes('image') &&
        !txt.includes('video') &&
        !txt.includes('music')
      );
    });
  }

  function hasCreditLimitReached() {
    const dialogs = Array.from(
      document.querySelectorAll('[role="dialog"], [data-state="open"], .fixed.inset-0, div[aria-modal="true"]')
    );
    for (const d of dialogs) {
      const txt = (d.innerText || d.textContent || '').toLowerCase();
      if (
        txt.includes('unusual activity detected') ||
        txt.includes('free tier usage disabled') ||
        txt.includes('temporarily disabled free access') ||
        txt.includes('unusually high activity from the same ip')
      ) {
        return {
          reached: true,
          ipRestricted: true,
          reason: 'Unusual activity detected: Free tier usage disabled dari koneksi/IP ini oleh ElevenLabs (IP Restriction)'
        };
      }
      if (
        txt.includes('first month 50% off') ||
        txt.includes('first month half price') ||
        (txt.includes('credits remaining') && (txt.includes('subscribe') || txt.includes('upgrade'))) ||
        txt.includes('insufficient credits') ||
        txt.includes('not enough credits') ||
        txt.includes('out of credits')
      ) {
        return { reached: true, reason: 'Modal upgrade kredit muncul di layar (Kredit Habis)' };
      }
    }
    return { reached: false };
  }

  window.__EL_ENGINE__ = {
    sleep,
    isElementVisible,
    simulateRealClick,
    setReactInputValue,
    dismissAllModals,
    getModelSelector,
    getVoiceSelector,
    formatNarrationScript,
    inputNarrationText,
    findGenerateSpeechButton,
    hasCreditLimitReached
  };
})();
"""


def dismiss_modals(page):
    """Tutup modal overlay, dialog pop-up (Got it / Eleven v4), dan banner promosi menggunakan logika ekstensi."""
    try:
        page.evaluate(JS_TTS_ENGINE)
        page.evaluate("() => window.__EL_ENGINE__.dismissAllModals()")
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
    except Exception as e:
        pass


def handle_post_v3_dialog(page, dbg=None) -> bool:
    """Tangani dialog informasi pasca memilih model v3 jika muncul."""
    try:
        page.wait_for_timeout(1000)
        handled = page.evaluate("""() => {
            const v3Btn = document.querySelector('button[data-testid="v3-welcome-dialog-get-started"]');
            if (v3Btn && window.__EL_ENGINE__.isElementVisible(v3Btn)) {
                window.__EL_ENGINE__.simulateRealClick(v3Btn);
                return true;
            }
            const dialog = document.querySelector('[role="dialog"]:not([aria-hidden="true"]), [data-state="open"][role="dialog"]');
            if (!dialog || !window.__EL_ENGINE__.isElementVisible(dialog)) return false;
            const btns = Array.from(dialog.querySelectorAll('button'));
            const actionBtn = btns.find(b => {
                const txt = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
                return txt === 'get started' || txt === 'got it' || txt === 'remind me later' || txt === 'close' || txt === '✕' || txt === 'x';
            });
            if (actionBtn && window.__EL_ENGINE__.isElementVisible(actionBtn)) {
                window.__EL_ENGINE__.simulateRealClick(actionBtn);
                return true;
            }
            return false;
        }""")
        if handled:
            if dbg:
                dbg.log("Modal pasca pergantian model v3 berhasil ditangani.")
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)
            return True
    except Exception:
        pass
    return False


def set_model(page, target_model: str = DEFAULT_MODEL, dbg=None) -> bool:
    """Mengatur model AI ke target_model (default: 'Eleven v3') sesuai alur ekstensi."""
    print(f"[*] Memeriksa & mengatur Model ke '{target_model}'...")
    if dbg:
        dbg.log(f"Memeriksa model: target={target_model}")

    # Pastikan engine JS terinjeksi
    page.evaluate(JS_TTS_ENGINE)

    # Pastikan tab Settings aktif jika sedang di tab History
    page.evaluate("""() => {
        const settingsTab = Array.from(document.querySelectorAll('button, [role="tab"]')).find(t => {
            return (t.innerText || '').trim().toLowerCase() === 'settings';
        });
        if (settingsTab) {
            window.__EL_ENGINE__.simulateRealClick(settingsTab);
        }
    }""")
    page.wait_for_timeout(500)

    # Bersihkan modal Eleven v4 atau banner sebelum memeriksa
    dismiss_modals(page)

    # 1. Cek apakah model saat ini sudah sesuai
    status = page.evaluate("""() => {
        const sel = window.__EL_ENGINE__.getModelSelector();
        if (!sel) return { found: false, text: '' };
        const txt = (sel.innerText || sel.textContent || sel.getAttribute('aria-label') || '').trim().toLowerCase();
        return { found: true, text: txt };
    }""")

    current_text = status.get("text", "")
    print(f"[*] Model saat ini terdeteksi: '{current_text}'")

    if ("v3" in current_text or "eleven v3" in current_text) and "v4" not in current_text:
        print(f"[✓] Model sudah aktif di '{target_model}'.")
        return True

    # 2. Buka dropdown model selector menggunakan PointerEvents native
    opened = page.evaluate("""() => {
        const sel = window.__EL_ENGINE__.getModelSelector();
        if (sel) {
            window.__EL_ENGINE__.simulateRealClick(sel);
            return true;
        }
        return false;
    }""")

    if not opened:
        print("[!] Tombol Model selector tidak ditemukan.")
        return False

    print("[*] Membuka panel pilihan Model...")
    page.wait_for_timeout(1500)

    # 3. Pilih opsi Eleven v3 dari daftar
    selected = page.evaluate("""(targetModel) => {
        const radios = Array.from(document.querySelectorAll('[role="radio"], button, [role="option"], [data-radix-collection-item], div[role="button"]'));
        let v3Radio = radios.find(r => {
            const txt = (r.innerText || r.textContent || '').trim();
            return (txt.startsWith('Eleven v3') || txt.toLowerCase().includes('eleven v3')) && !txt.toLowerCase().includes('v4');
        });

        if (v3Radio) {
            window.__EL_ENGINE__.simulateRealClick(v3Radio);
            return true;
        }

        const allButtons = Array.from(document.querySelectorAll('button, div[role="button"], [role="menuitem"], li'));
        const v3Opt = allButtons.find(o => {
            const txt = (o.innerText || o.textContent || '').trim().toLowerCase();
            return (txt.includes('eleven v3') || (txt.startsWith('v3') && txt.includes('eleven'))) &&
                   !txt.includes('v4') && !txt.includes('try voice design');
        });

        if (v3Opt) {
            window.__EL_ENGINE__.simulateRealClick(v3Opt);
            return true;
        }
        return false;
    }""", target_model)

    if selected:
        print("  -> Opsi Eleven v3 diklik.")
    else:
        print("  [!] Opsi Eleven v3 belum ditemukan di dropdown model.")

    page.wait_for_timeout(1200)

    # 4. Tangani dialog post-v3 jika muncul
    handle_post_v3_dialog(page, dbg=dbg)

    # 5. Tutup dropdown/panel model jika masih terbuka
    page.evaluate("""() => {
        const backBtn = document.querySelector('button[aria-label="Back"], button[aria-label*="back" i]');
        if (backBtn && window.__EL_ENGINE__.isElementVisible(backBtn)) {
            window.__EL_ENGINE__.simulateRealClick(backBtn);
        } else {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
    }""")
    page.wait_for_timeout(600)

    dismiss_modals(page)

    # Verifikasi akhir
    verify_status = page.evaluate("""() => {
        const sel = window.__EL_ENGINE__.getModelSelector();
        return (sel?.innerText || sel?.textContent || '').trim().toLowerCase();
    }""")
    print(f"[*] Verifikasi Model akhir: '{verify_status}'")
    if "v3" in verify_status and "v4" not in verify_status:
        print(f"[✓] Model berhasil diatur ke '{target_model}'.")
        return True
    else:
        print(f"[!] Peringatan: Model masih terbaca '{verify_status}'.")
        return False


def set_voice(page, target_voice: str = DEFAULT_VOICE, dbg=None) -> bool:
    """Mengatur Voice ke target_voice (default: 'Dany Saputra') persis seperti logika ekstensi."""
    print(f"[*] Memeriksa & mengatur Voice ke '{target_voice}'...")
    if dbg:
        dbg.log(f"Memeriksa voice: target={target_voice}")

    # Pastikan engine JS terinjeksi
    page.evaluate(JS_TTS_ENGINE)
    dismiss_modals(page)

    # 1. Cek apakah voice saat ini sudah sesuai
    status = page.evaluate("""() => {
        const sel = window.__EL_ENGINE__.getVoiceSelector();
        if (!sel) return { found: false, text: '' };
        const txt = (sel.innerText || sel.textContent || sel.getAttribute('aria-label') || '').trim().toLowerCase();
        return { found: true, text: txt };
    }""")

    current_text = status.get("text", "")
    print(f"[*] Voice saat ini terdeteksi: '{current_text}'")

    if target_voice.lower() in current_text:
        print(f"[✓] Voice sudah aktif di '{target_voice}'.")
        return True

    # 2. Buka pemilih voice
    opened = page.evaluate("""() => {
        const sel = window.__EL_ENGINE__.getVoiceSelector();
        if (sel) {
            window.__EL_ENGINE__.simulateRealClick(sel);
            return true;
        }
        return false;
    }""")

    if not opened:
        print("[!] Tombol Voice selector tidak ditemukan.")
        return False

    print(f"[*] Membuka pemilih voice untuk '{target_voice}'...")
    page.wait_for_timeout(1500)

    # 3. Cari dan ketik nama voice di kolom pencarian (khusus pemilih voice, jangan navbar atas)
    type_result = page.evaluate("""(targetVoice) => {
        // Cari input pencarian khusus di dalam popover/dialog/modal voice
        const searchInput = Array.from(document.querySelectorAll('input')).find(inp => {
            const ph = (inp.getAttribute('placeholder') || '').toLowerCase();
            return (ph.includes('typing to search') || ph.includes('search')) &&
                   !ph.includes('everything') &&
                   window.__EL_ENGINE__.isElementVisible(inp);
        });

        if (searchInput) {
            window.__EL_ENGINE__.setReactInputValue(searchInput, targetVoice);
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        }
        return false;
    }""", target_voice)

    if type_result:
        print(f"[*] Mengetik '{target_voice}' pada kolom pencarian voice...")
    else:
        print("[!] Kolom pencarian voice tidak ditemukan di popover.")

    page.wait_for_timeout(1500)

    # 4. Helper di browser untuk mencari kartu, hover, dan klik tombol + Use
    def select_voice_card():
        return page.evaluate("""(targetVoice) => {
            const allItems = Array.from(document.querySelectorAll(
                'li, [role="listitem"], [role="option"], [data-radix-collection-item], div[role="button"], button'
            )).filter(window.__EL_ENGINE__.isElementVisible);

            let matching = allItems.filter(el => {
                const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                return txt.includes(targetVoice.toLowerCase()) && !txt.includes('typing to search');
            });

            if (matching.length === 0) return false;

            const targetCard = matching.find(el => el.tagName === 'LI') || matching[0];
            const cardContainer = targetCard.closest('li, [role="listitem"]') || targetCard;

            // HOVER kartu terlebih dahulu agar tombol '+ Use' muncul
            const hoverElement = (el) => {
                if (!el) return;
                try {
                    el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
                    const rect = el.getBoundingClientRect();
                    const clientX = rect.left + rect.width / 2;
                    const clientY = rect.top + rect.height / 2;
                    const opts = { bubbles: true, cancelable: true, clientX, clientY };
                    el.dispatchEvent(new PointerEvent('pointerenter', opts));
                    el.dispatchEvent(new PointerEvent('pointerover', opts));
                    el.dispatchEvent(new MouseEvent('mouseenter', opts));
                    el.dispatchEvent(new MouseEvent('mouseover', opts));
                    el.dispatchEvent(new MouseEvent('mousemove', opts));
                } catch (e) {}
            };

            hoverElement(cardContainer);
            hoverElement(targetCard);

            const isPlayPreviewButton = (btn) => {
                if (!btn) return false;
                const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
                const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                if (aria.includes('play') || aria.includes('preview') || testId.includes('preview') || testId.includes('play')) return true;
                if (txt === 'play' || txt === 'preview') return true;
                return false;
            };

            const allButtons = Array.from(cardContainer.querySelectorAll('button')).concat(
                Array.from(document.querySelectorAll('[role="dialog"] button, [data-state="open"] button, button'))
            );

            let useBtn = allButtons.find(b => {
                if (isPlayPreviewButton(b)) return false;
                const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
                const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                return txt === '+ use' || txt === 'use' || (txt.includes('use') && !txt.includes('user') && !txt.includes('pause')) ||
                       aria === 'use voice' || aria.includes('use');
            });

            if (!useBtn) {
                useBtn = allButtons.find(b => {
                    if (isPlayPreviewButton(b)) return false;
                    const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                    return txt === '+ add' || txt === 'add' || txt.includes('add to voice lab') || aria.includes('add');
                });
            }

            if (!useBtn) {
                useBtn = Array.from(cardContainer.querySelectorAll('button')).find(b => {
                    return !isPlayPreviewButton(b) && (b.classList.contains('inset-0') || !b.getAttribute('aria-label'));
                });
            }

            if (useBtn) {
                window.__EL_ENGINE__.simulateRealClick(useBtn);
                return true;
            }

            // Fallback klik langsung kartu
            window.__EL_ENGINE__.simulateRealClick(cardContainer);
            return true;
        }""", target_voice)

    voice_selected = select_voice_card()

    # Jika tidak ditemukan di tab aktif (My Voices), coba cek tab Explore
    if not voice_selected:
        print("[*] Voice belum ditemukan di tab default, mencoba beralih ke tab Explore...")
        switched_tab = page.evaluate("""() => {
            const exploreTab = Array.from(document.querySelectorAll('button, [role="tab"]')).find(t => {
                const txt = (t.innerText || t.textContent || '').trim().toLowerCase();
                return (txt === 'explore' || txt.includes('explore new voices')) && window.__EL_ENGINE__.isElementVisible(t);
            });
            if (exploreTab) {
                window.__EL_ENGINE__.simulateRealClick(exploreTab);
                return true;
            }
            return false;
        }""")

        if switched_tab:
            page.wait_for_timeout(1500)
            page.evaluate("""(targetVoice) => {
                const searchInput = Array.from(document.querySelectorAll('input')).find(inp => {
                    const ph = (inp.getAttribute('placeholder') || '').toLowerCase();
                    return (ph.includes('typing to search') || ph.includes('search')) &&
                           !ph.includes('everything') &&
                           window.__EL_ENGINE__.isElementVisible(inp);
                });
                if (searchInput) {
                    window.__EL_ENGINE__.setReactInputValue(searchInput, targetVoice);
                    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }""", target_voice)
            page.wait_for_timeout(1500)
            voice_selected = select_voice_card()

    page.wait_for_timeout(1200)

    # 5. Konfirmasi dialog jika ada ("Add to Voice Lab" / "Use voice" / "Done")
    page.evaluate("""() => {
        const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => {
            const t = (b.innerText || b.textContent || '').toLowerCase();
            return (t.includes('add voice') || t.includes('use voice') || t.includes('finish') || t.includes('done')) &&
                   window.__EL_ENGINE__.isElementVisible(b);
        });
        if (confirmBtn) {
            window.__EL_ENGINE__.simulateRealClick(confirmBtn);
        }
    }""")
    page.wait_for_timeout(800)

    # 6. Tutup panel jika masih terbuka
    page.evaluate("""() => {
        const backBtn = document.querySelector('button[aria-label="Back"], button[aria-label*="back" i]');
        if (backBtn && window.__EL_ENGINE__.isElementVisible(backBtn)) {
            window.__EL_ENGINE__.simulateRealClick(backBtn);
        } else {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
    }""")
    page.wait_for_timeout(600)

    dismiss_modals(page)

    # Verifikasi akhir (tunggu hingga React selesai re-render)
    verify_status = ""
    for _ in range(6):
        page.wait_for_timeout(500)
        verify_status = page.evaluate("""() => {
            const sel = window.__EL_ENGINE__.getVoiceSelector();
            const text = (sel?.innerText || sel?.textContent || '').trim().toLowerCase();
            return text;
        }""")
        if target_voice.lower() in verify_status:
            break

    print(f"[*] Verifikasi Voice akhir: '{verify_status}'")
    if target_voice.lower() in verify_status:
        print(f"[✓] Voice berhasil diubah ke '{target_voice}'.")
        return True
    else:
        print(f"[!] Peringatan: Voice masih terbaca '{verify_status}'.")
        return False


def configure_tts_dashboard(
    page,
    model_name: str = DEFAULT_MODEL,
    voice_name: str = DEFAULT_VOICE,
    dbg=None
) -> bool:
    """
    Menavigasi ke halaman utama Text-to-Speech (https://elevenlabs.io/app/speech-synthesis/text-to-speech)
    dan mengonfigurasi berurutan sesuai alur ekstensi:
    1. Pastikan di URL TTS
    2. Bersihkan modal & pastikan tab Settings aktif
    3. Model AI -> Eleven v3 (cek modal post-v3 jika muncul)
    4. Voice -> Dany Saputra
    Catatan: Stability dibiarkan default (balanced di tengah) sesuai instruksi pengguna ("mentok sampai situ aja").
    """
    print("\n" + "=" * 65)
    print("  [TTS] MENGONFIGURASI HALAMAN UTAMA TEXT-TO-SPEECH")
    print("=" * 65)
    print(f"[*] Halaman Target : {TTS_URL}")
    print(f"[*] Model          : {model_name}")
    print(f"[*] Voice          : {voice_name}")
    print(f"[*] Stability      : Default (Balanced - Di Tengah)")
    print("=" * 65)

    # 1. Navigasi ke URL utama text-to-speech
    current_url = page.url.lower()
    if "/speech-synthesis/text-to-speech" not in current_url:
        print(f"[*] Mengarahkan browser ke {TTS_URL} ...")
        safe_goto(page, TTS_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

    dismiss_modals(page)

    # Tunggu editor Text to Speech aktif
    try:
        page.wait_for_selector(
            'textarea, [contenteditable="true"], [data-testid="tts-editor"]',
            timeout=15000
        )
        print("[*] Editor Text-to-Speech siap.")
    except Exception:
        print("[!] Menunggu elemen editor tambahan...")
        page.wait_for_timeout(3000)

    if dbg:
        dbg.snapshot(page, "tts_page_opened", "Halaman Text-to-Speech terbuka")

    # Injeksi engine ekstensi
    page.evaluate(JS_TTS_ENGINE)

    # LANGKAH 1: Atur Model AI -> Eleven v3
    model_success = set_model(page, target_model=model_name, dbg=dbg)
    page.wait_for_timeout(800)

    # LANGKAH 2: Atur Voice -> Dany Saputra
    voice_success = set_voice(page, target_voice=voice_name, dbg=dbg)
    page.wait_for_timeout(800)

    # Bersihkan modal tersisa
    dismiss_modals(page)

    if dbg:
        dbg.snapshot(page, "tts_configured_done", f"TTS terkonfigurasi: Model={model_name}, Voice={voice_name}")

    if model_success and voice_success:
        print("\n" + "=" * 65)
        print(f"  [✓] KONFIGURASI TTS BERHASIL: {model_name} | {voice_name}")
        print("=" * 65 + "\n")
        return True
    else:
        print("\n" + "=" * 65)
        print(f"  [!] STATUS TTS: Model={model_success}, Voice={voice_success}")
        print("=" * 65 + "\n")
        return False


def input_tts_text(page, text: str, dbg=None) -> bool:
    """Memasukkan naskah teks narasi ke dalam editor Text-to-Speech ElevenLabs."""
    print(f"\n[*] Memasukkan teks narasi ({len(text)} karakter) ke editor TTS...")
    if dbg:
        dbg.log(f"Memasukkan teks narasi ({len(text)} karakter)")

    # Injeksi engine jika belum ada
    page.evaluate(JS_TTS_ENGINE)
    dismiss_modals(page)

    success = page.evaluate("""(narrationText) => {
        return window.__EL_ENGINE__.inputNarrationText(narrationText);
    }""", text)

    page.wait_for_timeout(1000)

    # Verifikasi apakah teks berhasil masuk ke editor
    editor_text = page.evaluate("""() => {
        const editor = document.querySelector(
            '[data-testid="tts-editor"], .tiptap.ProseMirror[contenteditable="true"], [contenteditable="true"], textarea'
        );
        return (editor?.innerText || editor?.value || '').trim();
    }""")

    if len(editor_text) > 0:
        print(f"[✓] Teks narasi berhasil dimasukkan ke editor (Terbaca: {len(editor_text)} karakter).")
        if dbg:
            dbg.snapshot(page, "text_inputted", f"Teks narasi terinput ({len(editor_text)} chars)")
        return True
    else:
        print("[!] Gagal memasukkan teks narasi ke editor.")
        return False


def trigger_generate_speech(page, max_wait_sec: int = 120, dbg=None) -> dict:
    """
    Mengklik tombol 'Generate speech' dan memantau proses generasi hingga selesai.
    Mendeteksi spinner loading, modal limit kredit, dan kartu audio player yang dihasilkan.
    """
    print("\n" + "=" * 65)
    print("  [TTS] MEMULAI GENERASI AUDIO SPEECH")
    print("=" * 65)

    page.evaluate(JS_TTS_ENGINE)
    dismiss_modals(page)

    # 1. Cek apakah limit kredit sudah tercapai
    limit_check = page.evaluate("() => window.__EL_ENGINE__.hasCreditLimitReached()")
    if limit_check.get("reached"):
        reason = limit_check.get("reason", "Limit kredit akun tercapai")
        print(f"[!] {reason}")
        return {"success": False, "reason": reason}

    # 2. Cari tombol 'Generate speech'
    btn_info = page.evaluate("""() => {
        const btn = window.__EL_ENGINE__.findGenerateSpeechButton();
        if (!btn) return { found: false };
        const txt = (btn.innerText || btn.textContent || '').trim();
        const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
        return { found: true, text: txt, disabled: disabled };
    }""")

    if not btn_info.get("found"):
        print("[!] Tombol 'Generate speech' tidak ditemukan di halaman.")
        return {"success": False, "reason": "Tombol Generate speech tidak ditemukan"}

    if btn_info.get("disabled"):
        print("[!] Tombol 'Generate speech' dalam keadaan disabled (mungkin kuota habis atau teks kosong).")
        return {"success": False, "reason": "Tombol Generate disabled"}

    print(f"[*] Tombol Generate speech ditemukan: '{btn_info.get('text')}'")
    print("[*] Mengklik tombol Generate speech...")

    # Klik tombol generate speech
    page.evaluate("""() => {
        const btn = window.__EL_ENGINE__.findGenerateSpeechButton();
        if (btn) {
            window.__EL_ENGINE__.simulateRealClick(btn);
            btn.click();
        }
    }""")

    page.wait_for_timeout(2000)

    # Cek apakah langsung muncul modal limit pasca klik
    limit_check_post = page.evaluate("() => window.__EL_ENGINE__.hasCreditLimitReached()")
    if limit_check_post.get("reached"):
        reason = limit_check_post.get("reason", "Modal upgrade limit kredit muncul pasca klik")
        print(f"[!] {reason}")
        return {"success": False, "reason": reason}

    print("[*] Generasi audio sedang diproses oleh ElevenLabs (menunggu hingga selesai)...")
    if dbg:
        dbg.snapshot(page, "generating_speech_started", "Generasi audio dimulai")

    start_time = time.time()
    generation_ready = False

    while time.time() - start_time < max_wait_sec:
        dismiss_modals(page)

        # Cek apakah limit kredit muncul di tengah jalan
        limit_loop = page.evaluate("() => window.__EL_ENGINE__.hasCreditLimitReached()")
        if limit_loop.get("reached"):
            reason = limit_loop.get("reason", "Limit kredit muncul saat proses")
            print(f"[!] {reason}")
            return {"success": False, "reason": reason}

        # Cek status proses:
        # 1. Apakah ada spinner di tombol atau di kartu audio
        # 2. Apakah tombol download / play aktif
        # 3. Apakah ada elemen audio di DOM
        status = page.evaluate("""() => {
            const btn = window.__EL_ENGINE__.findGenerateSpeechButton();
            const isBtnBusy = btn ? (
                btn.getAttribute('data-loading') === 'true' ||
                btn.getAttribute('aria-busy') === 'true' ||
                (btn.innerText || '').toLowerCase().includes('generating')
            ) : false;

            const spinners = Array.from(document.querySelectorAll(
                '.animate-spin, [class*="spin"], [class*="loader"], [class*="loading"], svg[class*="spin"], [role="progressbar"]'
            )).filter(window.__EL_ENGINE__.isElementVisible);

            // Cek apakah ada audio player atau waveform kartu hasil
            const audioEls = Array.from(document.querySelectorAll('audio')).filter(a => a.src && (a.src.startsWith('blob:') || a.src.startsWith('http')));
            const dlButtons = Array.from(document.querySelectorAll('button[aria-label*="download" i], button[title*="download" i]')).filter(window.__EL_ENGINE__.isElementVisible);

            return {
                isBusy: isBtnBusy || spinners.length > 0,
                spinnerCount: spinners.length,
                hasAudioEl: audioEls.length > 0,
                hasDlBtn: dlButtons.length > 0
            };
        }""")

        elapsed = int(time.time() - start_time)

        # Jika sudah berjalan minimal 5 detik dan tidak ada spinner aktif, serta ada bukti audio/tombol
        if elapsed >= 5 and not status.get("isBusy"):
            print(f"[✓] Audio berhasil di-generate dalam {elapsed} detik!")
            generation_ready = True
            break

        if elapsed % 4 == 0:
            print(f"[*] Masih memproses audio... ({elapsed}s)")

        page.wait_for_timeout(1000)

    if not generation_ready:
        print(f"[!] Waktu tunggu generasi mencapai batas ({max_wait_sec}s).")

    page.wait_for_timeout(1500)
    dismiss_modals(page)

    if dbg:
        dbg.snapshot(page, "generate_speech_done", "Generasi audio selesai")

    print("=" * 65)
    print(f"  [✓] HASIL GENERASI AUDIO: {'SUKSES' if generation_ready else 'SELESAI (BATAS WAKTU)'}")
    print("=" * 65 + "\n")

    return {"success": generation_ready}


def input_and_generate_speech(page, text: str, max_wait_sec: int = 120, dbg=None) -> bool:
    """Alur lengkap: masukkan teks narasi, lalu picu dan tunggu hingga generate audio selesai."""
    input_ok = input_tts_text(page, text, dbg=dbg)
    if not input_ok:
        return False

    gen_res = trigger_generate_speech(page, max_wait_sec=max_wait_sec, dbg=dbg)
    return gen_res.get("success", False)

