import { Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { executeElevenLabsLogout } from './logout';

export interface TTSConfigureOptions {
  voiceName?: string; // Default: 'Dany Saputra'
  modelName?: string; // Default: 'Eleven v3'
  stability?: 'robust' | 'creative' | number; // Default: 'robust' (max 1.0)
  text?: string;
  generateSpeech?: boolean; // Default: true
  downloadGeneration?: boolean; // Default: true jika text disediakan
  generationNumberToDownload?: number; // Default: 2 (Generation 2)
  downloadDir?: string; // Default: downloads/
  onLog?: (msg: string) => void;
}

export interface TTSConfigureResult {
  success: boolean;
  voiceSelected: string;
  modelSelected: string;
  stabilitySet: string;
  textGenerated: boolean;
  downloadedFilePath?: string;
  generationDownloaded?: number;
  message: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Dismisses any promo, upgrade, or welcome modal blocking the screen and unblocks pointer events.
 */
async function dismissAllModals(page: Page, log?: (m: string) => void) {
  for (let i = 0; i < 3; i++) {
    try {
      const dismissBtns = await page.$$(
        'button[data-testid="v3-welcome-dialog-get-started"], button:has-text("Remind Me Later"), button:has-text("Get started"), button:has-text("Close"), button[aria-label*="close" i], button[aria-label*="dismiss" i], button:has-text("✕")'
      );
      for (const btn of dismissBtns) {
        if (await btn.isVisible().catch(() => false)) {
          log?.('Menutup dialog modal promosi/upgrade/welcome...');
          await btn.click({ force: true }).catch(() => {});
          await sleep(350);
        }
      }
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(250);
    } catch {}
  }

  // Netralkan overlay jika masih tersisa & pulihkan pointer-events tanpa merusak DOM
  await page.evaluate(() => {
    document.body.style.pointerEvents = 'auto';
    const overlays = document.querySelectorAll('.fixed.inset-0.z-50, [data-state="open"].fixed');
    for (const el of Array.from(overlays)) {
      const txt = (el.textContent || '').toLowerCase();
      if (
        txt.includes('upgrade') ||
        txt.includes('remind me later') ||
        txt.includes('credits remaining') ||
        txt.includes("what's new in eleven v3") ||
        el.classList.contains('backdrop-blur-none') ||
        el.classList.contains('backdrop-blur-sm')
      ) {
        // Netralkan pointer events tanpa menghapus node agar tidak memicu client-side crash
        (el as HTMLElement).style.pointerEvents = 'none';
      }
    }
  }).catch(() => {});
}

/**
 * Configures Voice (Dany Saputra), Model (Eleven v3), Stability slider (Robust),
 * inputs narration text into TipTap editor, and clicks Generate speech.
 */
export async function configureElevenLabsTTS(
  page: Page,
  options: TTSConfigureOptions = {}
): Promise<TTSConfigureResult> {
  const targetVoice = options.voiceName || 'Dany Saputra';
  const targetModel = options.modelName || 'Eleven v3';
  const textToGenerate = options.text;
  const shouldGenerate = options.generateSpeech ?? true;
  const log = options.onLog || ((msg: string) => console.log(`[ElevenLabs TTS] ${msg}`));

  log(`Memastikan berada di URL Text-to-Speech...`);
  if (!page.url().includes('/speech-synthesis') && !page.url().includes('/text-to-speech')) {
    await page.goto('https://elevenlabs.io/app/speech-synthesis/text-to-speech', { waitUntil: 'domcontentloaded' });
    await sleep(3500);
  }

  // Tutup overlay atau modal promo
  await dismissAllModals(page, log);
  await sleep(800);

  // Pastikan berada di tab Settings (bukan History)
  const settingsTab = page.locator('button, [role="tab"]').filter({ hasText: /^Settings$/i }).first();
  if (await settingsTab.isVisible().catch(() => false)) {
    await settingsTab.click({ force: true }).catch(() => {});
    await sleep(800);
  }

  // 1. ATUR MODEL: Eleven v3 (Terlebih dahulu agar kompatibilitas terapkan ke voice)
  log(`1/4 Memeriksa & Mengatur Model ke '${targetModel}'...`);
  await dismissAllModals(page, log);

  const modelSelector = page.locator('[data-testid="tts-model-selector"]').first();
  await modelSelector.waitFor({ state: 'visible', timeout: 15000 });
  const modelAria = (await modelSelector.getAttribute('aria-label').catch(() => '')) || '';
  const modelText = (await modelSelector.innerText().catch(() => '')) || '';
  const currentModel = `${modelAria} ${modelText}`.toLowerCase();
  log(`Model terdeteksi saat ini: ${modelAria || modelText.trim().replace(/\n+/g, ' ')}`);

  if (!currentModel.includes('v3') && !currentModel.includes('eleven v3')) {
    log(`Membuka panel pemilih Model...`);
    await modelSelector.click({ force: true });
    await sleep(1500);

    // Cari radio button / kartu Eleven v3
    const v3Radio = page.locator('[role="radio"], button').filter({ hasText: /^Eleven v3/i }).first();
    const isV3Vis = await v3Radio.isVisible().catch(() => false);

    if (isV3Vis) {
      log(`Memilih radio button 'Eleven v3'...`);
      await v3Radio.click({ force: true });
      await sleep(1200);
    } else {
      // Fallback selector text
      const v3Card = page.locator(':has-text("Eleven v3")').last();
      if (await v3Card.isVisible().catch(() => false)) {
        log(`Memilih kartu 'Eleven v3' via fallback...`);
        await v3Card.click({ force: true });
        await sleep(1200);
      } else {
        log(`Peringatan: Kartu Eleven v3 tidak ditemukan di panel model.`);
      }
    }

    // Kembali ke panel Settings dari panel "Select a model"
    const backBtn = page.locator('button[aria-label="Back"], button:has-text("Back"), button:has-text("Select a model")').first();
    if (await backBtn.isVisible().catch(() => false)) {
      log(`Menutup panel model (mengklik Back)...`);
      await backBtn.click({ force: true }).catch(() => {});
      await sleep(800);
    } else {
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(600);
    }

    // Cek modal popup pasca v3 jika ada (What's new in Eleven v3 dll.)
    log(`Memeriksa apakah muncul modal pasca beralih ke Eleven v3...`);
    await sleep(1200);
    const v3WelcomeBtn = page.locator('button[data-testid="v3-welcome-dialog-get-started"], [role="dialog"] button:has-text("Get started"), [role="dialog"] button:has-text("Got it"), [role="dialog"] button:has-text("Close"), [role="dialog"] button:has-text("✕")').first();
    if (await v3WelcomeBtn.isVisible().catch(() => false)) {
      log(`🎯 Modal pasca v3 terdeteksi, mengklik tombol penutup...`);
      await v3WelcomeBtn.click({ force: true }).catch(() => {});
      await sleep(600);
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(400);
    } else {
      log(`Tidak ada modal pasca v3 yang muncul, melanjutkan langsung ke pemilihan voice.`);
    }

    await dismissAllModals(page, log);
  } else {
    log(`✅ Model sudah terset ke: ${targetModel}`);
  }

  await dismissAllModals(page, log);

  // 2. ATUR VOICE: Dany Saputra (Mendukung Tipe 1: Sidebar click & Tipe 2: Modal popup hover + Add)
  log(`2/4 Memeriksa & Mengatur Voice ke '${targetVoice}'...`);
  await dismissAllModals(page, log);

  const voiceSelector = page.locator('[data-testid="tts-voice-selector"]').first();
  await voiceSelector.waitFor({ state: 'visible', timeout: 15000 });
  const voiceAria = (await voiceSelector.getAttribute('aria-label').catch(() => '')) || '';
  const voiceText = (await voiceSelector.innerText().catch(() => '')) || '';
  const currentVoice = `${voiceAria} ${voiceText}`.toLowerCase();
  log(`Voice terdeteksi saat ini: ${voiceAria || voiceText.trim().replace(/\n+/g, ' ')}`);

  if (!currentVoice.includes(targetVoice.toLowerCase())) {
    log(`Membuka pemilih Voice...`);
    await voiceSelector.click({ force: true });
    await sleep(1500);

    let voiceSelectedSuccessfully = false;

    // Cek apakah ada Modal Popup pemilih voice (Tipe 2: Modal Popup)
    const modalDialog = page.locator('[role="dialog"]').filter({ hasText: /voice|explore|community|library/i }).first();
    const isModalOpen = await modalDialog.isVisible().catch(() => false);

    if (isModalOpen) {
      log(`Modal popup pemilih voice terdeteksi (Tipe 2: Modal Popup)...`);
      const modalSearch = modalDialog.locator('input[type="text"], input[placeholder*="search" i]').first();
      if (await modalSearch.isVisible().catch(() => false)) {
        await modalSearch.fill(targetVoice);
        await sleep(1500);
      }

      // Cari kartu voice di dalam modal
      const voiceCards = modalDialog.locator('div, li, [role="button"]').filter({ hasText: targetVoice });
      const cardCount = await voiceCards.count();
      if (cardCount > 0) {
        const card = voiceCards.last();
        log(`Melakukan hover pada kartu voice '${targetVoice}' di dalam modal popup untuk memunculkan tombol '+ Use'...`);
        await card.hover({ force: true }).catch(() => {});
        await sleep(800);

        // Cari tombol "Use" atau "+ Use" (HINDARI tombol play preview!)
        const useBtn = card.locator('button:has-text("Use"), button:has-text("+ Use"), button[aria-label*="Use" i]').first();
        const addBtn = card.locator('button:has-text("Add"), button:has-text("+ Add"), button[aria-label*="Add" i]').first();
        const overlayBtn = card.locator('button.absolute.inset-0, button:not([data-testid*="preview"]):not([aria-label*="play" i])').first();

        if (await useBtn.isVisible().catch(() => false)) {
          log(`🎯 Tombol 'Use' / '+ Use' terdeteksi! Mengklik tombol Use...`);
          await useBtn.click({ force: true });
          await sleep(1500);
          voiceSelectedSuccessfully = true;
        } else if (await addBtn.isVisible().catch(() => false)) {
          log(`Tombol 'Add' / '+ Add' terdeteksi! Mengklik tombol Add...`);
          await addBtn.click({ force: true });
          await sleep(1500);
          voiceSelectedSuccessfully = true;
        } else if (await overlayBtn.isVisible().catch(() => false)) {
          log(`Mengklik kartu voice non-play overlay...`);
          await overlayBtn.click({ force: true });
          await sleep(1500);
          voiceSelectedSuccessfully = true;
        }

        // Tangani konfirmasi jika ada dialog "Add to Voice Lab" / "Use Voice"
        const confirmBtn = page.locator('button:has-text("Add Voice"), button:has-text("Use Voice"), button:has-text("Add to Voice Lab"), button:has-text("Finish"), button:has-text("Done")').first();
        if (await confirmBtn.isVisible().catch(() => false)) {
          log(`Mengonfirmasi penambahan voice ke library...`);
          await confirmBtn.click({ force: true });
          await sleep(1200);
        }
      }
    }

    // Jika belum terpilih, jalankan alur Tipe 1 (Sidebar list click & Explore search)
    if (!voiceSelectedSuccessfully) {
      log(`Memproses pemilihan voice di panel Sidebar (Tipe 1)...`);
      const searchInput = page.locator('input[placeholder*="typing to search" i], input[placeholder*="search" i]').first();

      if (await searchInput.isVisible().catch(() => false)) {
        log(`Mengetik '${targetVoice}' di kolom pencarian...`);
        await searchInput.fill(targetVoice);
        await sleep(1500);

        // 1. Cek di daftar My Voices saat ini
        let targetItem = page.locator('div, li, [role="button"], [role="option"]').filter({ hasText: new RegExp(targetVoice, 'i') }).last();
        let itemVisible = await targetItem.isVisible().catch(() => false);

        // 2. Jika tidak ada di My Voices, pindah ke tab Explore
        if (!itemVisible) {
          log(`Voice '${targetVoice}' belum ada di My Voices, beralih ke tab Explore / Explore new voices...`);
          const exploreBtn = page.locator('button:has-text("Explore new voices"), button:has-text("Explore"), [role="tab"]:has-text("Explore")').first();
          if (await exploreBtn.isVisible().catch(() => false)) {
            await exploreBtn.click({ force: true });
            await sleep(1800);

            // Re-fill input pencarian di Explore jika kosong
            const searchInput2 = page.locator('input[placeholder*="typing to search" i], input[placeholder*="search" i]').first();
            if (await searchInput2.isVisible().catch(() => false)) {
              await searchInput2.fill(targetVoice);
              await sleep(2000);
            }
          }
        }

        // Cari item voice lagi setelah pencarian
        targetItem = page.locator('div, li, [role="button"], [role="option"]').filter({ hasText: new RegExp(targetVoice, 'i') }).last();
        itemVisible = await targetItem.isVisible().catch(() => false);

        if (itemVisible) {
          log(`Melakukan hover dan klik pada voice '${targetVoice}' di sidebar...`);
          await targetItem.hover({ force: true }).catch(() => {});
          await sleep(300);

          // Cek apakah ada tombol Use atau Add yang muncul saat dihover
          const inlineUseBtn = targetItem.locator('button:has-text("Use"), button:has-text("+ Use"), button[aria-label*="Use" i]').first();
          const inlineAddBtn = targetItem.locator('button:has-text("Add"), button:has-text("+ Add"), button[aria-label*="Add" i]').first();
          if (await inlineUseBtn.isVisible().catch(() => false)) {
            log(`Mengklik tombol 'Use' pada item voice...`);
            await inlineUseBtn.click({ force: true });
          } else if (await inlineAddBtn.isVisible().catch(() => false)) {
            log(`Mengklik tombol 'Add' pada item voice...`);
            await inlineAddBtn.click({ force: true });
          } else {
            // Klik baris voice non-play
            const rowBtn = targetItem.locator('button:not([data-testid*="preview"]):not([aria-label*="play" i])').first();
            if (await rowBtn.isVisible().catch(() => false)) {
              await rowBtn.click({ force: true });
            } else {
              log(`Mengklik baris voice '${targetVoice}' secara langsung...`);
              await targetItem.click({ force: true });
            }
          }
          await sleep(1500);
          voiceSelectedSuccessfully = true;
        } else {
          log(`Peringatan: Voice '${targetVoice}' tidak ditemukan di My Voices maupun Explore.`);
          await page.keyboard.press('Escape').catch(() => {});
        }
      }
    }

    // Pastikan kembali ke panel Settings jika panel voice masih terbuka
    const backBtn = page.locator('button[aria-label="Back"], button:has-text("Back"), [role="dialog"] button:has-text("Select a voice")').first();
    if (await backBtn.isVisible().catch(() => false)) {
      await backBtn.click({ force: true }).catch(() => {});
      await sleep(600);
    }
  } else {
    log(`✅ Voice sudah terset ke: ${targetVoice}`);
  }

  await dismissAllModals(page, log);

  // 3. ATUR STABILITY SLIDER: ROBUST (Max 1.0 / 100%)
  log(`3/4 Mengatur Stability ke 'Robust' (Maksimal)...`);
  try {
    const stabilitySlider = page.locator('#stability-slider [role="slider"], span[role="slider"][aria-label="Stability"]').first();
    if (await stabilitySlider.isVisible().catch(() => false)) {
      await stabilitySlider.focus();
      await page.keyboard.press('End');
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('ArrowRight');
      }

      // Drag mouse ke kanan untuk memastikan nilai 1.0 (Robust)
      const box = await stabilitySlider.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + 300, box.y + box.height / 2);
        await page.mouse.up();
      }

      const val = await stabilitySlider.getAttribute('aria-valuenow').catch(() => '1');
      log(`✅ Stability slider diatur ke: ${val} (Robust)`);
    } else {
      log(`Stability slider tidak ditemukan di DOM, melanjutkan...`);
    }
  } catch (err: any) {
    log(`Peringatan slider stability: ${err.message}`);
  }

  // 4. INPUT TEKS KE TIPTAP / PROSEMIRROR EDITOR
  let textInputted = false;
  if (textToGenerate) {
    log(`4/4 Memasukkan teks naskah (${textToGenerate.length} karakter) ke speech editor...`);
    
    // Cari editor TipTap ProseMirror atau tts-editor
    const editor = page.locator('[data-testid="tts-editor"], .tiptap.ProseMirror[contenteditable="true"]').first();
    const isEditorVisible = await editor.isVisible().catch(() => false);

    if (isEditorVisible) {
      await editor.click();
      await sleep(200);

      // Select all contents and replace with textToGenerate via execCommand
      await page.evaluate((val: string) => {
        const ed = document.querySelector('[data-testid="tts-editor"], .tiptap.ProseMirror[contenteditable="true"]');
        if (ed) {
          (ed as HTMLElement).focus();
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(ed);
          sel?.removeAllRanges();
          sel?.addRange(range);
          document.execCommand('delete');
          document.execCommand('insertText', false, val);
          ed.dispatchEvent(new Event('input', { bubbles: true }));
          ed.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, textToGenerate);

      await sleep(1000);
      textInputted = true;
      log(`✅ Teks naskah berhasil dimasukkan ke TipTap editor.`);
    } else {
      // Fallback untuk textarea standar jika TipTap tidak ada
      const textarea = page.locator('textarea').first();
      if (await textarea.isVisible().catch(() => false)) {
        await textarea.click({ force: true });
        await textarea.evaluate((el: HTMLTextAreaElement, val: string) => {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        }, textToGenerate);
        await sleep(800);
        textInputted = true;
        log(`✅ Teks naskah berhasil dimasukkan ke textarea fallback.`);
      }
    }
  }

  // 5. KLIK TOMBOL "Generate speech" & DOWNLOAD GENERATION 2
  let downloadedFilePath: string | undefined;
  const targetGenNumber = options.generationNumberToDownload || 2;
  const shouldDownload = options.downloadGeneration ?? (textToGenerate ? true : false);

  if (shouldGenerate) {
    log(`Mencari dan memicu tombol 'Generate speech'...`);
    const generateBtn = page.locator('[data-testid="tts-generate"], button:has-text("Generate speech"), button:has-text("Regenerate speech")').first();
    await generateBtn.waitFor({ state: 'visible', timeout: 10000 });

    const isDisabled = await generateBtn.isDisabled().catch(() => false);
    if (isDisabled) {
      log(`⚠️ Tombol Generate speech dalam status disabled (cek apakah kuota credits mencukupi).`);
      log(`🚨 Limit kredit terdeteksi! Memulai proses auto-logout native...`);
      await executeElevenLabsLogout(page, { onLog: log });
      return {
        success: false,
        voiceSelected: targetVoice,
        modelSelected: targetModel,
        stabilitySet: 'Robust (1.0)',
        textGenerated: textInputted,
        message: 'Tombol Generate disabled karena kuota habis. Otomatis logout telah dijalankan.',
      };
    } else {
      log(`🚀 Mengklik tombol 'Generate speech'...`);
      await generateBtn.click({ force: true });
      await sleep(2000);

      // Cek apakah langsung muncul modal limit kredit pasca klik
      const isLimitModalVisible = await page.evaluate(() => {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [data-state="open"], .fixed.inset-0'));
        for (const d of dialogs) {
          const txt = (d.textContent || '').toLowerCase();
          if (txt.includes('upgrade') || txt.includes('credits') || txt.includes('first month') || txt.includes('insufficient')) return true;
        }
        return false;
      });

      if (isLimitModalVisible) {
        log(`🚨 Modal limit kredit terdeteksi pasca klik Generate! Menjalankan auto-logout native...`);
        await executeElevenLabsLogout(page, { onLog: log });
        return {
          success: false,
          voiceSelected: targetVoice,
          modelSelected: targetModel,
          stabilitySet: 'Robust (1.0)',
          textGenerated: textInputted,
          message: 'Limit kredit tercapai. Otomatis logout telah dijalankan.',
        };
      }

      // Pantau hingga output Generation 1 & Generation 2 muncul dan siap
      log(`Menunggu output Generation 1 & Generation 2 selesai diproses...`);
      let gen2Detected = false;
      for (let i = 0; i < 45; i++) {
        await sleep(1000);
        const isCardReady = await page.evaluate((genNum: number) => {
          const target = `Generation ${genNum}`;
          const labels = Array.from(document.querySelectorAll('p, span')).filter(
            (el) => el.tagName !== 'SCRIPT' && (el.innerText || '').trim() === target
          );
          if (labels.length === 0) return false;

          const card = labels[0].closest('.border') || labels[0].closest('div.relative') || labels[0].parentElement;
          if (!card) return false;

          const btns = Array.from(card.querySelectorAll('button'));
          const dlBtn = btns.find((b) => (b.getAttribute('aria-label') || '').toLowerCase().includes('download')) ||
                        btns[btns.length - 1];

          if (!dlBtn) return false;
          const isBtnLoading = dlBtn.getAttribute('data-loading') === 'true';
          return !isBtnLoading && !dlBtn.disabled;
        }, targetGenNumber);

        if (isCardReady && i >= 2) {
          log(`✅ Output Generation ${targetGenNumber} terkonfirmasi siap di detik ke-${i + 1}!`);
          gen2Detected = true;
          break;
        }
      }

      // Download hasil output Generation 2 sesuai permintaan spesifik pengguna
      if (shouldDownload && gen2Detected) {
        log(`Mendownload hasil audio output Generation ${targetGenNumber} (bukan Generation 1)...`);
        const targetDir = options.downloadDir || path.resolve(process.cwd(), 'downloads');
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        await sleep(1000);
        const downloadPromise = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);

        // Klik tombol Download di dalam kartu Generation 2
        await page.evaluate((genNum: number) => {
          const target = `Generation ${genNum}`;
          const labels = Array.from(document.querySelectorAll('p, span')).filter(
            (el) => el.tagName !== 'SCRIPT' && (el.innerText || '').trim() === target
          );
          if (labels.length === 0) return false;

          const card = labels[0].closest('.border') || labels[0].closest('div.relative') || labels[0].parentElement;
          if (!card) return false;

          const buttons = Array.from(card.querySelectorAll('button'));
          const dlBtn = buttons.find((b) => (b.getAttribute('aria-label') || '').toLowerCase().includes('download')) ||
                        buttons[buttons.length - 1];

          if (dlBtn) {
            dlBtn.click();
            return true;
          }
          return false;
        }, targetGenNumber);

        const download = await downloadPromise;
        if (download) {
          const filename = download.suggestedFilename() || `ElevenLabs_Gen${targetGenNumber}.mp3`;
          downloadedFilePath = path.join(targetDir, filename);
          await download.saveAs(downloadedFilePath);
          log(`🎉 File audio Generation ${targetGenNumber} berhasil didownload: ${downloadedFilePath}`);
        } else {
          log(`⚠️ Timeout menunggu event download Generation ${targetGenNumber}`);
        }
      }

      log(`✅ Proses Generate speech & Download Generation ${targetGenNumber} selesai.`);
    }
  }

  const finalVoiceAria = await page.locator('[data-testid="tts-voice-selector"]').first().getAttribute('aria-label').catch(() => '');
  const finalModelAria = await page.locator('[data-testid="tts-model-selector"]').first().getAttribute('aria-label').catch(() => '');

  return {
    success: true,
    voiceSelected: finalVoiceAria ? finalVoiceAria.replace('Select voice - ', '') : targetVoice,
    modelSelected: finalModelAria ? finalModelAria.replace('Select model - ', '') : targetModel,
    stabilitySet: 'Robust (1.0)',
    textGenerated: textInputted,
    downloadedFilePath,
    generationDownloaded: downloadedFilePath ? targetGenNumber : undefined,
    message: downloadedFilePath
      ? `Konfigurasi TTS selesai, speech digenerate, dan output Generation ${targetGenNumber} berhasil didownload!`
      : 'Konfigurasi ElevenLabs TTS selesai dan Generate speech telah dijalankan dengan sukses.',
  };
}
