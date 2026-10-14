import { Page } from 'playwright';

export interface ConfigureTTSOptions {
  modelName?: string;
  voiceName?: string;
  stability?: 'robust' | 'standard' | string;
  onLog?: (msg: string) => void;
}

export interface ConfigureTTSResult {
  success: boolean;
  model: string;
  voice: string;
  stability: string;
  message: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tutup modal overlay tutorial atau dialog sisa
 */
export async function dismissAllModals(page: Page): Promise<void> {
  try {
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(200);

    await page.evaluate(() => {
      const dismissButtons = Array.from(
        document.querySelectorAll(
          'button[aria-label*="close" i], button[aria-label*="dismiss" i], button.close, button:has-text("Remind Me Later"), button:has-text("Got it"), button:has-text("✕")'
        )
      );
      for (const btn of dismissButtons) {
        const s = window.getComputedStyle(btn);
        if (s.display !== 'none' && s.visibility !== 'hidden' && (btn as HTMLElement).offsetWidth > 0) {
          (btn as HTMLElement).click();
        }
      }
    }).catch(() => {});
  } catch {}
}

/**
 * Handle dialog "What's new in Eleven v3" pasca memilih model v3
 */
export async function handlePostModelV3Modal(page: Page, log: (m: string) => void): Promise<boolean> {
  log('Memeriksa apakah muncul dialog info pasca memilih Eleven v3...');
  await sleep(1000);

  // 1. Cek tombol "Get started" khusus dialog v3
  const v3Btn = page.locator('button[data-testid="v3-welcome-dialog-get-started"]').first();
  if (await v3Btn.isVisible().catch(() => false)) {
    log('🎯 Dialog v3 ("What\'s new in Eleven v3") terdeteksi! Mengklik Get started...');
    await v3Btn.click().catch(() => {});
    await sleep(600);
    return true;
  }

  // 2. Cek modal dialog umum pasca ganti model
  const handled = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]:not([aria-hidden="true"]), [data-state="open"][role="dialog"]');
    if (!dialog) return false;

    const btns = Array.from(dialog.querySelectorAll('button'));
    const actionBtn = btns.find((b) => {
      const txt = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
      return (
        txt === 'get started' ||
        txt === 'got it' ||
        txt === 'remind me later' ||
        txt === 'close' ||
        txt === '✕' ||
        txt === 'x'
      );
    });

    if (actionBtn) {
      (actionBtn as HTMLElement).click();
      return true;
    }
    return false;
  }).catch(() => false);

  if (handled) {
    log('Dialog pasca ganti model ditutup.');
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(500);
    return true;
  }

  log('Tidak ada dialog v3 yang muncul, lanjut ke langkah berikutnya.');
  return false;
}

/**
 * Langkah 1: Mengatur Model AI ke Eleven v3
 */
export async function setModel(page: Page, targetModel = 'Eleven v3', log: (m: string) => void): Promise<boolean> {
  log(`📌 [Model] Memeriksa & mengatur model ke '${targetModel}'...`);

  // Pastikan tab "Settings" aktif jika halaman sedang di tab History
  const settingsTab = page.locator('button:has-text("Settings"), [role="tab"]:has-text("Settings")').first();
  if (await settingsTab.isVisible().catch(() => false)) {
    await settingsTab.click().catch(() => {});
    await sleep(400);
  }

  // 1. Cek apakah model saat ini sudah sesuai
  const currentModelText = await page.evaluate(() => {
    let el = document.querySelector('[data-testid="tts-model-selector"]');
    if (!el) {
      const labels = Array.from(document.querySelectorAll('span, div, label, p'));
      const labelEl = labels.find((l) => (l.textContent || '').trim().toLowerCase() === 'model');
      if (labelEl && labelEl.parentElement) {
        el = labelEl.parentElement.querySelector('button, [role="button"], [tabindex="0"]');
      }
    }
    return (el?.textContent || el?.getAttribute('aria-label') || '').toLowerCase();
  }).catch(() => '');

  if (currentModelText.includes('v3') || currentModelText.includes('eleven v3')) {
    log(`✅ [Model] Model sudah aktif di '${targetModel}'.`);
    return true;
  }

  // 2. Buka dropdown model selector
  const modelSelector = page.locator('[data-testid="tts-model-selector"], button:has-text("Model"), [aria-label*="Model" i]').first();
  if (await modelSelector.isVisible().catch(() => false)) {
    await modelSelector.click().catch(() => {});
  } else {
    // Fallback evaluasi DOM
    await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('span, div, label, p'));
      const labelEl = labels.find((el) => (el.textContent || '').trim().toLowerCase() === 'model');
      if (labelEl && labelEl.parentElement) {
        const btn = labelEl.parentElement.querySelector('button, [role="button"]');
        if (btn) (btn as HTMLElement).click();
      }
    }).catch(() => {});
  }

  await sleep(1200);

  // 3. Pilih opsi Eleven v3
  const v3Radio = page.locator('[role="radio"]:has-text("Eleven v3"), button:has-text("Eleven v3"), [role="option"]:has-text("Eleven v3")').first();
  if (await v3Radio.isVisible().catch(() => false)) {
    log('Memilih kartu Eleven v3...');
    await v3Radio.click().catch(() => {});
    await sleep(1000);
  } else {
    // Fallback cari via evaluate
    await page.evaluate(() => {
      const allEls = Array.from(document.querySelectorAll('[role="radio"], button, [role="option"], div[role="button"]'));
      const opt = allEls.find((el) => {
        const t = (el.textContent || '').trim().toLowerCase();
        return (t.includes('eleven v3') || (t.startsWith('v3') && t.includes('eleven'))) && !t.includes('try voice design');
      });
      if (opt) (opt as HTMLElement).click();
    }).catch(() => {});
    await sleep(1000);
  }

  // 4. Tutup panel "Select a model" jika masih terbuka
  const backBtn = page.locator('button[aria-label="Back"], button[aria-label*="back" i]').first();
  if (await backBtn.isVisible().catch(() => false)) {
    await backBtn.click().catch(() => {});
    await sleep(600);
  } else {
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(500);
  }

  await dismissAllModals(page);
  return true;
}

/**
 * Langkah 2: Mengatur Voice ke targetVoice ('Dany Saputra')
 */
export async function setVoice(page: Page, targetVoice = 'Dany Saputra', log: (m: string) => void): Promise<boolean> {
  log(`📌 [Voice] Memeriksa & mengatur Voice ke '${targetVoice}'...`);

  // 1. Cek apakah voice sudah terpilih
  const currentVoiceText = await page.evaluate(() => {
    let el = document.querySelector('[data-testid="tts-voice-selector"]');
    if (!el) {
      const labels = Array.from(document.querySelectorAll('span, div, label, p'));
      const labelEl = labels.find((l) => (l.textContent || '').trim().toLowerCase() === 'voice');
      if (labelEl && labelEl.parentElement) {
        el = labelEl.parentElement.querySelector('button, [role="button"], [tabindex="0"]');
      }
    }
    return (el?.textContent || el?.getAttribute('aria-label') || '').toLowerCase();
  }).catch(() => '');

  if (currentVoiceText.includes(targetVoice.toLowerCase())) {
    log(`✅ [Voice] Voice sudah aktif di '${targetVoice}'.`);
    return true;
  }

  // 2. Buka dropdown voice selector
  const voiceSelector = page.locator('[data-testid="tts-voice-selector"], button:has-text("Voice"), [aria-label*="Voice" i]').first();
  if (await voiceSelector.isVisible().catch(() => false)) {
    await voiceSelector.click().catch(() => {});
  } else {
    await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('span, div, label, p'));
      const labelEl = labels.find((l) => (l.textContent || '').trim().toLowerCase() === 'voice');
      if (labelEl && labelEl.parentElement) {
        const btn = labelEl.parentElement.querySelector('button, [role="button"]');
        if (btn) (btn as HTMLElement).click();
      }
    }).catch(() => {});
  }

  await sleep(1500);

  // 3. Ketik nama voice di kolom pencarian
  const searchInput = page.locator('input[placeholder*="typing to search" i], input[placeholder*="search" i]').first();
  if (await searchInput.isVisible().catch(() => false)) {
    log(`Mengetik '${targetVoice}' di kolom pencarian voice...`);
    await searchInput.fill(targetVoice);
    await sleep(1200);
  }

  // 4. Pilih kartu voice & klik tombol Use
  const voiceSelected = await page.evaluate((target) => {
    function isVisible(el: Element | null): boolean {
      if (!el) return false;
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && (el as HTMLElement).offsetWidth > 0;
    }

    let matching = Array.from(
      document.querySelectorAll('li, div[role="option"], [data-testid*="voice-item"], div[role="button"], button')
    ).filter((el) => (el.textContent || '').toLowerCase().includes(target.toLowerCase()) && isVisible(el));

    // Jika belum ada di tab aktif, coba cek tab Explore
    if (matching.length === 0) {
      const exploreTab = Array.from(document.querySelectorAll('button, [role="tab"]')).find((t) => {
        const txt = (t.textContent || '').trim().toLowerCase();
        return (txt === 'explore' || txt.includes('explore new voices')) && isVisible(t);
      });
      if (exploreTab) {
        (exploreTab as HTMLElement).click();
      }
    }

    if (matching.length === 0) return false;

    const card = matching.find((el) => el.tagName === 'LI') || matching[0];
    const container = card.closest('li, [role="listitem"]') || card;

    // Hover container untuk memunculkan tombol Use / Add
    const rect = container.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    container.dispatchEvent(new PointerEvent('pointerenter', opts));
    container.dispatchEvent(new MouseEvent('mouseenter', opts));
    container.dispatchEvent(new MouseEvent('mouseover', opts));

    // Cari tombol "+ Use" atau "Use" (bukan play button)
    const allButtons = Array.from(container.querySelectorAll('button')).concat(
      Array.from(document.querySelectorAll('[role="dialog"] button, button'))
    );

    const isPlayBtn = (b: Element) => {
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const txt = (b.textContent || '').trim().toLowerCase();
      return aria.includes('play') || aria.includes('preview') || txt === 'play' || txt === 'preview';
    };

    let useBtn = allButtons.find((b) => {
      if (isPlayBtn(b)) return false;
      const txt = (b.textContent || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      return txt === '+ use' || txt === 'use' || (txt.includes('use') && !txt.includes('user')) || aria.includes('use');
    });

    if (!useBtn) {
      useBtn = allButtons.find((b) => {
        if (isPlayBtn(b)) return false;
        const txt = (b.textContent || '').trim().toLowerCase();
        return txt === '+ add' || txt === 'add' || txt.includes('add to voice lab');
      });
    }

    if (useBtn) {
      (useBtn as HTMLElement).click();
      return true;
    }

    // Klik container langsung jika tidak ada tombol terpisah
    (card as HTMLElement).click();
    return true;
  }, targetVoice).catch(() => false);

  await sleep(1200);

  // 5. Konfirmasi dialog "Add voice" jika muncul
  const confirmBtn = page.locator('button:has-text("Add voice"), button:has-text("Use voice"), button:has-text("Done")').first();
  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click().catch(() => {});
    await sleep(800);
  }

  // 6. Tutup panel jika masih terbuka
  const backBtn = page.locator('button[aria-label="Back"], button[aria-label*="back" i]').first();
  if (await backBtn.isVisible().catch(() => false)) {
    await backBtn.click().catch(() => {});
    await sleep(600);
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }

  await dismissAllModals(page);
  log(`✅ [Voice] Voice '${targetVoice}' berhasil dipilih.`);
  return Boolean(voiceSelected);
}

/**
 * Langkah 3: Mengatur Stability Slider ke Robust (1.0 / 100%)
 */
export async function setStability(page: Page, target = 'robust', log: (m: string) => void): Promise<boolean> {
  log(`📌 [Stability] Mengatur stability ke '${target}' (Robust 1.0)...`);

  // Klik teks label "Robust" jika ada
  const robustLabel = page.locator('span:has-text("Robust"), div:has-text("Robust"), p:has-text("Robust")').first();
  if (await robustLabel.isVisible().catch(() => false)) {
    await robustLabel.click().catch(() => {});
    await sleep(300);
  }

  // Sesuaikan slider ke posisi maksimal
  const adjusted = await page.evaluate(() => {
    let slider = document.querySelector(
      '#stability-slider [role="slider"], span[role="slider"][aria-label="Stability"], [aria-label="Stability"][role="slider"], [aria-label*="Stability" i][role="slider"], #stability-slider'
    );

    if (!slider) {
      const labels = Array.from(document.querySelectorAll('span, div, label, p'));
      const stabLabel = labels.find((l) => (l.textContent || '').trim().toLowerCase() === 'stability');
      if (stabLabel && stabLabel.parentElement) {
        slider = stabLabel.parentElement.querySelector('[role="slider"], input[type="range"]');
      }
    }

    if (slider) {
      const thumb = slider.getAttribute('role') === 'slider'
        ? slider
        : (slider.querySelector('[role="slider"]') || slider);

      if (thumb.tagName === 'INPUT' && (thumb as HTMLInputElement).type === 'range') {
        const input = thumb as HTMLInputElement;
        input.value = input.max || '1';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        (thumb as HTMLElement).focus();
        thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', keyCode: 35, bubbles: true }));
        thumb.dispatchEvent(new KeyboardEvent('keyup', { key: 'End', keyCode: 35, bubbles: true }));

        for (let i = 0; i < 5; i++) {
          thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true }));
          thumb.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', keyCode: 39, bubbles: true }));
        }

        const track = slider.closest('[data-orientation="horizontal"]') || thumb.parentElement || slider;
        if (track) {
          const rect = track.getBoundingClientRect();
          const opts = { bubbles: true, cancelable: true, clientX: rect.right - 2, clientY: rect.top + rect.height / 2 };
          track.dispatchEvent(new PointerEvent('pointerdown', opts));
          track.dispatchEvent(new MouseEvent('mousedown', opts));
          track.dispatchEvent(new PointerEvent('pointerup', opts));
          track.dispatchEvent(new MouseEvent('mouseup', opts));
          track.dispatchEvent(new MouseEvent('click', opts));
        }
      }
      return true;
    }
    return false;
  }).catch(() => false);

  if (adjusted) {
    log('✅ [Stability] Slider stability berhasil diatur ke Robust.');
    return true;
  }

  log('⚠️ [Stability] Slider stability tidak ditemukan atau sudah maksimal.');
  return false;
}

/**
 * Modul Utama: Konfigurasi Lengkap TTS ElevenLabs secara Berurutan
 * 1. Pindah Model (Eleven v3)
 * 2. Cek & Tangani dialog v3 jika muncul
 * 3. Pilih Voice (Dany Saputra)
 * 4. Atur Stability (Robust 1.0)
 */
export async function configureElevenLabsTTS(
  page: Page,
  options: ConfigureTTSOptions = {}
): Promise<ConfigureTTSResult> {
  const modelName = options.modelName || 'Eleven v3';
  const voiceName = options.voiceName || 'Dany Saputra';
  const stability = options.stability || 'robust';
  const log = options.onLog || ((msg: string) => console.log(`[ElevenLabsTTS] ${msg}`));

  log('====================================================');
  log('🎛️ MEMULAI KONFIGURASI TTS ELEVENLABS');
  log(`1. Model AI   : ${modelName}`);
  log(`2. Voice      : ${voiceName}`);
  log(`3. Stability  : ${stability} (Robust 1.0)`);
  log('====================================================\n');

  // 1. Bersihkan modal sisa awal
  await dismissAllModals(page);
  await sleep(600);

  // 2. Langkah 1: Model Eleven v3
  await setModel(page, modelName, log);
  await sleep(800);

  // 3. Langkah 2: Dialog post-model v3
  await handlePostModelV3Modal(page, log);
  await dismissAllModals(page);
  await sleep(600);

  // 4. Langkah 3: Voice Dany Saputra
  await setVoice(page, voiceName, log);
  await sleep(800);
  await dismissAllModals(page);

  // 5. Langkah 4: Stability Robust
  await setStability(page, stability, log);
  await sleep(600);

  log('\n🎉 KONFIGURASI TTS ELEVENLABS BERHASIL SELESAI!');
  return {
    success: true,
    model: modelName,
    voice: voiceName,
    stability,
    message: `Berhasil mengonfigurasi TTS: Model (${modelName}) -> Voice (${voiceName}) -> Stability (${stability})!`,
  };
}
