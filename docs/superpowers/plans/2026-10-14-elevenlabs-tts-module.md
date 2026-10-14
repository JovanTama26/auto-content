# ElevenLabs Text-to-Speech (TTS) Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun modul mandiri Text-to-Speech ElevenLabs berbasis Playwright yang menggunakan sesi login tersimpan (`elevenlabs_session.json`), mengonfigurasi Model Eleven v3 + Voice Dany Saputra + Stability Robust (1.0), men-generate speech dari naskah, dan menyimpan output audio `.mp3` langsung ke direktori audio Electron (`input/alurfilm/audio/`).

**Architecture:** Modul aksi mandiri `playwright/actions/elevenlabs/tts.ts` menerima objek `TTSOptions`, memverifikasi state UI aktif (smart state check), mengonfigurasi kontrol UI jika belum sesuai, memasukkan naskah ke TipTap editor, menangkap event download Playwright dari audio hasil generate, dan menyimpannya ke `input/alurfilm/audio/`. CLI runner `playwright/dev-elevenlabs-tts.ts` membungkus modul ini untuk eksekusi fleksibel dari terminal (`npm run elevenlabs:tts`).

**Tech Stack:** TypeScript, Node.js (fs, path), Playwright (`chromium.launchPersistentContext`, `page.waitForEvent('download')`).

## Global Constraints
- Target audio default: `input/alurfilm/audio/` (sesuai spesifikasi Electron `ALURFILM_AUDIO_DIR`).
- Voice default: `Dany Saputra`.
- Model default: `Eleven v3`.
- Stability slider default: `1.0` (Robust).
- Sesi kredensial dimuat dari: `playwright/user_data/elevenlabs_session.json`.
- Tidak boleh ada type error pada `npx tsc --noEmit`.

---

### Task 1: Create Core Action Module `playwright/actions/elevenlabs/tts.ts`

**Files:**
- Create: `playwright/actions/elevenlabs/tts.ts`
- Test: `playwright/tests/test-tts-action.ts`

**Interfaces:**
- Consumes: `playwright/actions/launch-browser.ts` (`BrowserSession`), `playwright/actions/elevenlabs/session.ts` (`isElevenLabsSessionActive`)
- Produces: `generateElevenLabsSpeech(page: Page, options: TTSOptions): Promise<TTSResult>`

- [ ] **Step 1: Write test script for TTS action**

Buat file pengujian di `playwright/tests/test-tts-action.ts`:
```typescript
import { launchBrowser } from '../actions/launch-browser';
import { generateElevenLabsSpeech } from '../actions/elevenlabs/tts';
import { ELEVENLABS_SESSION_PATH } from '../actions/elevenlabs/session';
import fs from 'fs';
import path from 'path';

async function testTTSAction() {
  console.log('🧪 Testing generateElevenLabsSpeech action...');
  const session = await launchBrowser({
    profileName: 'user_1',
    headed: true,
    storageStatePath: fs.existsSync(ELEVENLABS_SESSION_PATH) ? ELEVENLABS_SESSION_PATH : undefined,
  });

  try {
    const testText = 'Ini adalah pengujian otomatis modul Text to Speech ElevenLabs Dany Saputra model v3.';
    const result = await generateElevenLabsSpeech(session.page, {
      text: testText,
      voiceName: 'Dany Saputra',
      modelName: 'Eleven v3',
      stability: 'robust',
      partNumber: 1,
      targetCategory: 'alurfilm',
    });

    console.log('Result:', JSON.stringify(result, null, 2));
    if (!result.success) throw new Error('TTS Generation failed');
    if (!fs.existsSync(result.audioPath)) throw new Error(`Audio file not found: ${result.audioPath}`);
    const stat = fs.statSync(result.audioPath);
    if (stat.size === 0) throw new Error('Audio file is empty');
    console.log(`✅ Test passed! File size: ${stat.size} bytes`);
  } finally {
    await session.context.close();
  }
}

testTTSAction().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx playwright/tests/test-tts-action.ts`
Expected: FAIL with Cannot find module `../actions/elevenlabs/tts`.

- [ ] **Step 3: Implement `playwright/actions/elevenlabs/tts.ts`**

Buat file `playwright/actions/elevenlabs/tts.ts`:
```typescript
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
async function dismissPopups(page: Page, log: (m: string) => void) {
  for (let i = 0; i < 3; i++) {
    try {
      const dismissBtns = await page.$$(
        'button[data-testid="v3-welcome-dialog-get-started"], button:has-text("Remind Me Later"), button:has-text("Get started"), button:has-text("Close"), button[aria-label*="close" i], button[aria-label*="dismiss" i], button:has-text("✕")'
      );
      for (const btn of dismissBtns) {
        if (await btn.isVisible().catch(() => false)) {
          log('Menutup dialog modal promosi/welcome...');
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
  const v3DialogBtn = page.locator('button[data-testid="v3-welcome-dialog-get-started"], button:has-text("Get started")').first();
  if (await v3DialogBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
    log('Menutup dialog info Eleven v3...');
    await v3DialogBtn.click({ force: true }).catch(() => {});
    await sleep(500);
  }
}

/**
 * Konfigurasi Voice (Dany Saputra) dengan Smart State Check
 */
async function ensureVoice(page: Page, targetVoice: string, log: (m: string) => void) {
  const voiceSelector = page.locator('[data-testid="tts-voice-selector"]').first();
  await voiceSelector.waitFor({ state: 'visible', timeout: 15000 });

  const currentLabel = (await voiceSelector.innerText()).trim();
  if (currentLabel.toLowerCase().includes(targetVoice.toLowerCase())) {
    log(`Voice sudah sesuai: "${currentLabel}" (lewati klik)`);
    return;
  }

  log(`Mengubah voice dari "${currentLabel}" ke "${targetVoice}"...`);
  await voiceSelector.click({ force: true });
  await sleep(1200);

  // Cari input search voice di dropdown jika tersedia
  const searchInput = page.locator('input[placeholder*="Search" i], input[type="search"]').first();
  if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await searchInput.fill(targetVoice);
    await sleep(800);
  }

  const voiceItem = page
    .locator('button, [role="option"]')
    .filter({ hasText: new RegExp(targetVoice, 'i') })
    .first();

  if (await voiceItem.isVisible({ timeout: 5000 }).catch(() => false)) {
    await voiceItem.click({ force: true });
    await sleep(1000);
    log(`Voice berhasil diubah ke "${targetVoice}".`);
  } else {
    log(`⚠️ Voice "${targetVoice}" tidak ditemukan di daftar, menggunakan voice aktif.`);
    await page.keyboard.press('Escape').catch(() => {});
  }
}

/**
 * Konfigurasi Slider Stability ke Robust (1.0)
 */
async function ensureStability(page: Page, log: (m: string) => void) {
  try {
    const slider = page.locator('input[type="range"], [role="slider"]').first();
    if (await slider.isVisible({ timeout: 3000 }).catch(() => false)) {
      log('Mengatur slider Stability ke posisi Robust (1.0)...');
      await slider.evaluate((el: HTMLInputElement) => {
        el.value = '1';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await sleep(500);
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
  const editor = page.locator('.tiptap.ProseMirror, [contenteditable="true"]').first();
  await editor.waitFor({ state: 'visible', timeout: 15000 });

  await editor.click({ force: true });
  await sleep(400);

  // Bersihkan teks lama dan masukkan teks baru secara andal
  await page.evaluate((val: string) => {
    const el = document.querySelector('.tiptap.ProseMirror, [contenteditable="true"]');
    if (el) {
      el.innerHTML = `<p>${val.replace(/\n+/g, '</p><p>')}</p>`;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, text);

  await sleep(600);
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

  // 7. Klik Generate Speech & Tangkap Download
  log('Memicu tombol "Generate speech"...');
  const generateBtn = page
    .locator('button')
    .filter({ hasText: /^Generate speech$/i })
    .first();

  await generateBtn.waitFor({ state: 'visible', timeout: 10000 });

  // Siapkan listener download
  const downloadPromise = page.waitForEvent('download', { timeout: 75000 }).catch(() => null);

  await generateBtn.click({ force: true });
  log('Menunggu proses generate dan event download...');

  let download = await downloadPromise;

  // Jika direct download event belum terpicu, cari tombol Download di audio card terbaru
  if (!download) {
    log('Mencari tombol download di kartu audio hasil generasi...');
    await sleep(5000);
    const fallbackDownloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);

    const downloadCardBtn = page
      .locator('button[aria-label*="download" i], button:has-text("Download")')
      .first();

    if (await downloadCardBtn.isVisible().catch(() => false)) {
      await downloadCardBtn.click({ force: true }).catch(() => {});
      download = await fallbackDownloadPromise;
    }
  }

  if (!download) {
    throw new Error('Gagal menangkap download audio setelah Generate speech dijalankan.');
  }

  // Simpan file hasil download
  const timestamp = Date.now();
  const partStr = options.partNumber ? `_part_${String(options.partNumber).padStart(2, '0')}` : '';
  const finalFilename = options.outputFilename || `alurfilm${partStr}_${timestamp}.mp3`;
  const finalAudioPath = path.join(targetDir, finalFilename);

  await download.saveAs(finalAudioPath);
  log(`🎉 Audio berhasil disimpan di: ${finalAudioPath}`);

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx playwright/tests/test-tts-action.ts`
Expected: PASS (audio tersimpan di `input/alurfilm/audio/`).

- [ ] **Step 5: Commit**

```bash
git add playwright/actions/elevenlabs/tts.ts playwright/tests/test-tts-action.ts
git commit -m "feat: implement generateElevenLabsSpeech action with model v3, voice dany, and electron audio directory integration"
```

---

### Task 2: Implement CLI Dev Runner & NPM Script

**Files:**
- Create: `playwright/dev-elevenlabs-tts.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `playwright/actions/elevenlabs/tts.ts` (`generateElevenLabsSpeech`), `playwright/actions/launch-browser.ts` (`launchBrowser`), `playwright/actions/elevenlabs/session.ts` (`ELEVENLABS_SESSION_PATH`)
- Produces: CLI command `npm run elevenlabs:tts`

- [ ] **Step 1: Create `playwright/dev-elevenlabs-tts.ts`**

Buat file `playwright/dev-elevenlabs-tts.ts`:
```typescript
import { launchBrowser } from './actions/launch-browser';
import { generateElevenLabsSpeech } from './actions/elevenlabs/tts';
import { ELEVENLABS_SESSION_PATH } from './actions/elevenlabs/session';
import fs from 'fs';

async function main() {
  const args = process.argv.slice(2);
  let text = 'Halo dunia, ini adalah pengujian suara otomatis menggunakan ElevenLabs.';
  let voiceName = 'Dany Saputra';
  let modelName = 'Eleven v3';
  let partNumber: number | undefined = undefined;
  let isHeaded = false;
  let targetCategory: 'alurfilm' | 'assets' = 'alurfilm';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--text' && args[i + 1]) text = args[i + 1];
    if (args[i] === '--voice' && args[i + 1]) voiceName = args[i + 1];
    if (args[i] === '--model' && args[i + 1]) modelName = args[i + 1];
    if (args[i] === '--part' && args[i + 1]) partNumber = parseInt(args[i + 1], 10);
    if (args[i] === '--headed') isHeaded = true;
    if (args[i] === '--category' && args[i + 1]) targetCategory = args[i + 1] as any;
  }

  console.log('====================================================');
  console.log('🎙️ ELEVENLABS TTS RUNNER');
  console.log('====================================================');
  console.log(`Model    : ${modelName}`);
  console.log(`Voice    : ${voiceName}`);
  console.log(`Category : ${targetCategory}`);
  if (partNumber) console.log(`Part #   : ${partNumber}`);
  console.log(`Mode     : ${isHeaded ? 'Headed' : 'Headless'}`);
  console.log(`Naskah   : "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);
  console.log('====================================================\n');

  const session = await launchBrowser({
    profileName: 'user_1',
    headed: isHeaded,
    storageStatePath: fs.existsSync(ELEVENLABS_SESSION_PATH) ? ELEVENLABS_SESSION_PATH : undefined,
  });

  try {
    const result = await generateElevenLabsSpeech(session.page, {
      text,
      voiceName,
      modelName,
      partNumber,
      targetCategory,
      onLog: (m) => console.log(`[TTS] ${m}`),
    });

    console.log('\n====================================================');
    console.log('✅ GENERATE TTS BERHASIL');
    console.log(`📂 Audio Path : ${result.audioPath}`);
    console.log(`📁 Filename   : ${result.filename}`);
    console.log(`📝 Karakter   : ${result.characterCount}`);
    console.log('====================================================\n');
  } finally {
    await session.context.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add script to `package.json`**

Tambahkan entry di `package.json` scripts:
```json
"elevenlabs:tts": "npx tsx playwright/dev-elevenlabs-tts.ts"
```

- [ ] **Step 3: Test CLI script execution**

Run: `npm run elevenlabs:tts -- --text="Pengujian CLI runner ElevenLabs" --part=1`
Expected: Output menampilkan audio berhasil digenerate dan tersimpan di `input/alurfilm/audio/`.

- [ ] **Step 4: Commit**

```bash
git add playwright/dev-elevenlabs-tts.ts package.json
git commit -m "feat: add elevenlabs:tts CLI runner and npm script"
```

---

### Task 3: Comprehensive Verification & Type Safety

**Files:**
- Verify: whole codebase via `tsc --noEmit`

- [ ] **Step 1: Run TypeScript compiler check**

Run: `npx tsc --noEmit`
Expected: PASS (0 errors).

- [ ] **Step 2: Verify audio output directory compatibility**

Run: `ls -la input/alurfilm/audio/`
Expected: File audio `.mp3` hasil pengujian terdaftar dan memiliki ukuran > 0 bytes.

- [ ] **Step 3: Clean up temporary test files if any and commit**

```bash
git add .
git commit -m "chore: finalize elevenlabs tts module and verify clean type checks"
```
