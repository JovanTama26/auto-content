import { Page } from 'playwright';
import path from 'path';
import fs from 'fs';

export interface TTSOptions {
  text: string;                             // Naskah narasi yang akan diucapkan
  voiceName?: string;                       // Default: 'Dany Saputra'
  modelName?: string;                       // Default: 'Eleven v3'
  stability?: 'robust' | number;            // Default: 'robust' (1.0)
  targetCategory?: 'alurfilm' | 'assets';   // Default: 'alurfilm'
  outputDir?: string;                       // Default: input/alurfilm/audio/
  outputFilename?: string;                  // Opsional nama file kustom
  partNumber?: number;                      // Nomor part alurfilm
  onLog?: (msg: string) => void;            // Logger callback
}

export interface TTSResult {
  success: boolean;
  audioPath: string;                        // Path absolut file audio tersimpan
  filename: string;                         // Nama file output
  voice: string;                            // Voice terpilih
  model: string;                            // Model terpilih
  stability: string;                        // Stability terpilih
  characterCount: number;                   // Jumlah karakter naskah
  durationEstimateSeconds?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Menutup modal blocking (v3 welcome dialog, upgrade modal, tutorial) dan menetralkan backdrop
 */
async function dismissPopups(page: Page, log?: (m: string) => void) {
  for (let i = 0; i < 3; i++) {
    try {
      const dismissBtns = await page.$$(
        'button[data-testid="v3-welcome-dialog-get-started"], button:has-text("Remind Me Later"), button:has-text("Get started"), button:has-text("Close"), button[aria-label*="close" i], button[aria-label*="dismiss" i], button:has-text("✕")'
      );
      for (const btn of dismissBtns) {
        if (await btn.isVisible().catch(() => false)) {
          log?.('Menutup dialog modal promosi/welcome...');
          await btn.click({ force: true }).catch(() => {});
          await sleep(350);
        }
      }
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(250);
    } catch {}
  }

  // Netralkan pointer-events jika ada backdrop transparan yang menghalangi klik
  await page.evaluate(() => {
    document.body.style.pointerEvents = 'auto';
    const overlays = document.querySelectorAll('.fixed.inset-0.z-50, [data-state="open"].fixed');
    for (const el of Array.from(overlays)) {
      const txt = (el.textContent || '').toLowerCase();
      if (
        txt.includes('upgrade') ||
        txt.includes('remind me later') ||
        txt.includes("what's new in eleven v3")
      ) {
        (el as HTMLElement).style.pointerEvents = 'none';
      }
    }
  }).catch(() => {});
}

/**
 * Konfigurasi Model AI (Eleven v3) dengan Smart State Check
 */
async function ensureModel(page: Page, targetModel: string, log: (m: string) => void) {
  const modelSelector = page.locator('[data-testid="tts-model-selector"]').first();
  await modelSelector.waitFor({ state: 'visible', timeout: 15000 });

  const currentLabel = (await modelSelector.innerText()).trim();
  if (currentLabel.toLowerCase().includes(targetModel.toLowerCase())) {
    log(`Model sudah sesuai: "${currentLabel}" (lewati klik)`);
    return;
  }

  log(`Mengubah model dari "${currentLabel}" ke "${targetModel}"...`);
  await modelSelector.click({ force: true });
  await sleep(1000);

  const modelOption = page
    .locator('[role="radio"], button, [role="option"]')
    .filter({ hasText: new RegExp(targetModel, 'i') })
    .first();

  if (await modelOption.isVisible({ timeout: 5000 }).catch(() => false)) {
    await modelOption.click({ force: true });
    await sleep(1000);
  }

  // Tangani dialog modal v3 jika muncul setelah pemilihan model
  const v3DialogBtn = page
    .locator('button[data-testid="v3-welcome-dialog-get-started"], button:has-text("Get started")')
    .first();
  if (await v3DialogBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
    log('Menutup dialog info Eleven v3...');
    await v3DialogBtn.click({ force: true }).catch(() => {});
    await sleep(500);
  }
}

/**
 * Konfigurasi Voice (Dany Saputra) dengan dukungan Modal Popup & Explore Library
 */
async function ensureVoice(page: Page, targetVoice: string, log: (m: string) => void) {
  const voiceSelector = page.locator('[data-testid="tts-voice-selector"]').first();
  await voiceSelector.waitFor({ state: 'visible', timeout: 15000 });

  const voiceAria = (await voiceSelector.getAttribute('aria-label').catch(() => '')) || '';
  const voiceText = (await voiceSelector.innerText().catch(() => '')) || '';
  const currentVoice = `${voiceAria} ${voiceText}`.toLowerCase();

  if (currentVoice.includes(targetVoice.toLowerCase())) {
    log(`Voice sudah sesuai: "${targetVoice}" (lewati klik)`);
    return;
  }

  log(`Membuka pemilih Voice untuk mencari "${targetVoice}"...`);
  await voiceSelector.click({ force: true });
  await sleep(1500);

  let selected = false;

  // 1. Cek apakah ada Modal Dialog Voice (Tipe 2)
  const modalDialog = page.locator('[role="dialog"]').filter({ hasText: /voice|explore|community|library/i }).first();
  if (await modalDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
    const modalSearch = modalDialog.locator('input[type="text"], input[placeholder*="search" i]').first();
    if (await modalSearch.isVisible().catch(() => false)) {
      await modalSearch.fill(targetVoice);
      await sleep(1500);
    }

    const voiceCards = modalDialog.locator('div, li, [role="button"]').filter({ hasText: targetVoice });
    if ((await voiceCards.count()) > 0) {
      const card = voiceCards.last();
      await card.hover({ force: true }).catch(() => {});
      await sleep(600);

      const useBtn = card.locator('button:has-text("Use"), button:has-text("+ Use"), button[aria-label*="Use" i]').first();
      const addBtn = card.locator('button:has-text("Add"), button:has-text("+ Add"), button[aria-label*="Add" i]').first();
      if (await useBtn.isVisible().catch(() => false)) {
        await useBtn.click({ force: true });
        selected = true;
      } else if (await addBtn.isVisible().catch(() => false)) {
        await addBtn.click({ force: true });
        selected = true;
      }
      await sleep(1200);
    }
  }

  // 2. Jika belum terpilih, cek di panel dropdown/sidebar (Tipe 1)
  if (!selected) {
    const searchInput = page.locator('input[placeholder*="typing to search" i], input[placeholder*="search" i]').first();
    if (await searchInput.isVisible({ timeout: 2500 }).catch(() => false)) {
      log(`Mencari "${targetVoice}" di panel dropdown...`);
      await searchInput.fill(targetVoice);
      await sleep(1500);

      // Cek apakah ada di My Voices
      let targetItem = page.locator('div, li, [role="button"], [role="option"]').filter({ hasText: new RegExp(targetVoice, 'i') }).last();
      let itemVisible = await targetItem.isVisible().catch(() => false);

      // Jika belum terlihat, beralih ke Explore
      if (!itemVisible) {
        const exploreBtn = page.locator('button:has-text("Explore new voices"), button:has-text("Explore"), [role="tab"]:has-text("Explore")').first();
        if (await exploreBtn.isVisible().catch(() => false)) {
          await exploreBtn.click({ force: true });
          await sleep(1800);
          const searchInput2 = page.locator('input[placeholder*="typing to search" i], input[placeholder*="search" i]').first();
          if (await searchInput2.isVisible().catch(() => false)) {
            await searchInput2.fill(targetVoice);
            await sleep(2000);
          }
        }
      }

      targetItem = page.locator('div, li, [role="button"], [role="option"]').filter({ hasText: new RegExp(targetVoice, 'i') }).last();
      itemVisible = await targetItem.isVisible().catch(() => false);

      if (itemVisible) {
        await targetItem.hover({ force: true }).catch(() => {});
        await sleep(300);

        const inlineUseBtn = targetItem.locator('button:has-text("Use"), button:has-text("+ Use"), button[aria-label*="Use" i]').first();
        const inlineAddBtn = targetItem.locator('button:has-text("Add"), button:has-text("+ Add"), button[aria-label*="Add" i]').first();
        if (await inlineUseBtn.isVisible().catch(() => false)) {
          await inlineUseBtn.click({ force: true });
        } else if (await inlineAddBtn.isVisible().catch(() => false)) {
          await inlineAddBtn.click({ force: true });
        } else {
          await targetItem.click({ force: true });
        }
        await sleep(1500);
        selected = true;
        log(`Voice "${targetVoice}" berhasil dipilih.`);
      }
    }
  }

  // Tutup panel/modal pencarian jika masih terbuka
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(600);
}

/**
 * Konfigurasi Slider Stability ke Robust (1.0)
 */
async function ensureStability(page: Page, log: (m: string) => void) {
  try {
    const slider = page.locator('#stability-slider [role="slider"], span[role="slider"][aria-label="Stability"]').first();
    if (await slider.isVisible({ timeout: 2500 }).catch(() => false)) {
      log('Mengatur slider Stability ke posisi Robust (1.0)...');
      await slider.focus();
      await page.keyboard.press('End');
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('ArrowRight');
      }
      await sleep(400);
    }
  } catch (err: any) {
    log(`Catatan stability slider: ${err?.message}`);
  }
}

/**
 * Memasukkan teks naskah ke dalam editor TipTap ProseMirror
 */
async function setEditorText(page: Page, text: string, log: (m: string) => void) {
  log(`Memasukkan naskah (${text.length} karakter) ke editor...`);
  const editor = page.locator('[data-testid="tts-editor"], .tiptap.ProseMirror[contenteditable="true"]').first();
  await editor.waitFor({ state: 'visible', timeout: 15000 });

  await editor.click();
  await sleep(200);

  // Ganti isi editor dengan execCommand untuk trigger TipTap document sync
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
  }, text);

  await sleep(800);
}

/**
 * Fungsi Utama: Generate Speech & Download Audio
 */
export async function generateElevenLabsSpeech(
  page: Page,
  options: TTSOptions
): Promise<TTSResult> {
  const voiceName = options.voiceName || 'Dany Saputra';
  const modelName = options.modelName || 'Eleven v3';
  const text = options.text;
  const log = options.onLog || ((msg: string) => console.log(`[ElevenLabs TTS] ${msg}`));

  // Tentukan folder output
  let targetDir = options.outputDir;
  if (!targetDir) {
    const category = options.targetCategory || 'alurfilm';
    targetDir = category === 'alurfilm'
      ? path.join(process.cwd(), 'input', 'alurfilm', 'audio')
      : path.join(process.cwd(), 'input', 'assets');
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  log(`Memastikan berada di URL Text-to-Speech ElevenLabs...`);
  if (!page.url().includes('/speech-synthesis') && !page.url().includes('/text-to-speech')) {
    await page.goto('https://elevenlabs.io/app/speech-synthesis/text-to-speech', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await sleep(3500);
  }

  // 1. Bersihkan modal
  await dismissPopups(page, log);

  // 2. Pastikan tab Settings aktif
  const settingsTab = page.locator('button, [role="tab"]').filter({ hasText: /^Settings$/i }).first();
  if (await settingsTab.isVisible().catch(() => false)) {
    await settingsTab.click({ force: true }).catch(() => {});
    await sleep(500);
  }

  // 3. Konfigurasi Model
  await ensureModel(page, modelName, log);

  // 4. Konfigurasi Voice
  await ensureVoice(page, voiceName, log);

  // 5. Konfigurasi Stability
  await ensureStability(page, log);

  // 6. Masukkan Teks
  await setEditorText(page, text, log);

  // 7. Klik Generate Speech
  log('Mencari tombol "Generate speech"...');
  const generateBtn = page
    .locator('[data-testid="tts-generate"], button:has-text("Generate speech"), button:has-text("Regenerate speech")')
    .first();

  await generateBtn.waitFor({ state: 'visible', timeout: 10000 });

  const isDisabled = await generateBtn.isDisabled().catch(() => false);
  if (isDisabled) {
    throw new Error('Tombol Generate speech dalam status disabled (kuota credit tidak mencukupi atau teks kosong).');
  }

  log('🚀 Mengklik tombol "Generate speech"...');
  await generateBtn.click({ force: true });
  await sleep(2500);

  // Periksa apakah muncul modal pembatasan / Unusual activity detected / kredit habis
  const limitModalError = await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [data-state="open"]'));
    for (const d of dialogs) {
      const txt = (d.textContent || '').toLowerCase();
      if (txt.includes('unusual activity detected')) {
        return 'ElevenLabs memblokir Free Tier IP ini ("Unusual activity detected"). Diperlukan pergantian IP/proxy atau akun baru.';
      }
      if (txt.includes('insufficient credits') || (txt.includes('upgrade') && txt.includes('credits remaining 0'))) {
        return 'Kuota kredit ElevenLabs pada akun ini telah habis (0 credits).';
      }
    }
    return null;
  });

  if (limitModalError) {
    log(`🚨 Pembatasan terdeteksi: ${limitModalError}`);
    throw new Error(limitModalError);
  }

  // 8. Tunggu hingga tombol Generate tidak loading lagi
  log('Menunggu sintesis suara selesai diproses...');
  for (let i = 0; i < 40; i++) {
    const isGenerating = await generateBtn.isDisabled().catch(() => false);
    if (!isGenerating && i >= 2) {
      log(`Sintesis suara selesai di detik ke-${i + 1}.`);
      break;
    }
    await sleep(1000);
  }

  // 9. Buka tab History untuk mengambil file audio yang baru digenerate
  log('Membuka tab History untuk mengunduh audio hasil generasi...');
  const historyTab = page.locator('[data-testid="tts-history-tab"], [role="tab"]:has-text("History")').first();
  await historyTab.waitFor({ state: 'visible', timeout: 15000 });
  await historyTab.click({ force: true });
  await sleep(2500);

  // Ambil kartu item riwayat teratas
  const historyCard = page.locator('li.eleven-list-item, [data-history-item], div:has(> button[data-testid="audio-player-play-button"])').first();
  await historyCard.hover({ force: true }).catch(() => {});
  await sleep(500);

  // Cari tombol download
  const downloadBtn = page.locator('button[data-testid="history-download-button"], button[aria-label*="download" i]').first();
  await downloadBtn.waitFor({ state: 'attached', timeout: 10000 });

  log('Mengklik tombol Download pada item riwayat terbaru...');
  await downloadBtn.click({ force: true });
  await sleep(800);

  // Pilih format MP3 di menu jika muncul
  const formatOption = page.locator('[role="menuitem"]:has-text("MP3"), [role="menuitem"]:has-text("Original"), [role="menuitem"]').first();

  let downloadObj: any = null;
  const dlPromise = page.waitForEvent('download', { timeout: 25000 }).catch(() => null);

  if (await formatOption.isVisible({ timeout: 3000 }).catch(() => false)) {
    log('Memilih format MP3 dari menu download...');
    await formatOption.click({ force: true });
  }

  downloadObj = await dlPromise;

  if (!downloadObj) {
    throw new Error('Gagal menangkap event download file audio dari ElevenLabs.');
  }

  // Simpan file hasil download
  const timestamp = Date.now();
  const partStr = options.partNumber ? `_part_${String(options.partNumber).padStart(2, '0')}` : '';
  const finalFilename = options.outputFilename || `alurfilm${partStr}_${timestamp}.mp3`;
  const finalAudioPath = path.join(targetDir, finalFilename);

  await downloadObj.saveAs(finalAudioPath);
  const stat = fs.statSync(finalAudioPath);
  log(`🎉 Audio berhasil disimpan di: ${finalAudioPath} (${(stat.size / 1024).toFixed(1)} KB)`);

  return {
    success: true,
    audioPath: finalAudioPath,
    filename: finalFilename,
    voice: voiceName,
    model: modelName,
    stability: 'Robust (1.0)',
    characterCount: text.length,
  };
}
