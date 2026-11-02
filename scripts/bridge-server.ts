// scripts/bridge-server.ts
// Local HTTP Bridge Server (port 4545)
// Jembatan antara Browser Extension dan otomasi Playwright Google AI Studio Drive Picker

import http from 'http';
import path from 'path';
import fs from 'fs';
import { chromium, BrowserContext, Page } from 'playwright';
import { SupabaseBridge } from '../extension/lib/supabase.js';

const PORT = 4545;
const USER_DATA_DIR = path.resolve(process.cwd(), 'playwright/user_data/user_1');
const EXTENSION_PATH = path.resolve(process.cwd(), 'extension');

let browserContext: BrowserContext | null = null;
let activePage: Page | null = null;
let isBusy = false;

// Pastikan direktori user_data ada
if (!fs.existsSync(USER_DATA_DIR)) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

/**
 * Inisialisasi Browser Context (Reusing session login user_1)
 */
async function getOrCreateBrowser(): Promise<{ context: BrowserContext; page: Page }> {
  if (browserContext && activePage && !activePage.isClosed()) {
    return { context: browserContext, page: activePage };
  }

  console.log('🌐 Memulai browser automation dengan user profile...');

  const bravePath = '/usr/bin/brave-browser';
  const hasBrave = fs.existsSync(bravePath);

  const launchOpts: any = {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
    viewport: { width: 1440, height: 900 },
  };

  if (hasBrave) {
    console.log('🦁 Menggunakan Brave Browser:', bravePath);
    launchOpts.executablePath = bravePath;
  } else {
    launchOpts.channel = 'chrome';
  }

  browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, launchOpts);

  activePage = browserContext.pages().length > 0 ? browserContext.pages()[0] : await browserContext.newPage();

  return { context: browserContext, page: activePage };
}

/**
 * Otomasi upload video chunk ke Drive Picker di Google AI Studio
 * STRICT SCOPE: Hanya sampai file ter-upload dan terpasang di prompt editor!
 */
async function uploadChunkToDrive(videoPath: string, filename: string): Promise<boolean> {
  const fullPath = path.isAbsolute(videoPath) ? videoPath : path.resolve(process.cwd(), videoPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`File video tidak ditemukan di disk: ${fullPath}`);
  }

  const { page } = await getOrCreateBrowser();

  console.log(`\n======================================================`);
  console.log(`📤 [Drive Uploader] Memulai upload: ${filename}`);
  console.log(`📁 Lokasi: ${fullPath} (${(fs.statSync(fullPath).size / (1024 * 1024)).toFixed(1)} MB)`);
  console.log(`======================================================`);

  // Selalu muat fresh chat untuk membersihkan modal backdrop sisa upload sebelumnya
  console.log('🔄 Membuka fresh chat prompt di Google AI Studio (Gemini 3.1 Pro Preview)...');
  await page.goto('https://aistudio.google.com/prompts/new_chat?model=gemini-3.1-pro-preview', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // 1. Klik tombol Attachment (+)
  console.log('🖱️ [1/4] Mengklik tombol attachment (+)...');
  const attachBtnSelector = 'button[aria-label="Insert images, videos, audio, or files"], button:has-text("add_circle")';
  const attachBtn = await page.waitForSelector(attachBtnSelector, { timeout: 15000 });
  await attachBtn.click();
  await page.waitForTimeout(1000);

  // 2. Klik opsi Drive
  console.log('🖱️ [2/4] Mengklik opsi Google Drive...');
  const driveBtnSelector = '.mat-mdc-menu-panel [role="menuitem"]:has-text("Drive"), button:has-text("Drive")';
  const driveBtn = await page.waitForSelector(driveBtnSelector, { timeout: 8000 });
  await driveBtn.click();

  // 3. Tunggu frame Drive Picker
  console.log('⏳ [3/4] Menunggu Google Drive Picker muncul...');
  let pickerFrame = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.waitForTimeout(1000);
    pickerFrame = page.frames().find(f => f.url().includes('picker') || f.name().includes('I0_'));
    if (pickerFrame) break;
  }

  if (!pickerFrame) {
    throw new Error('Frame Google Drive Picker tidak ditemukan');
  }

  // 4. Klik tab Upload
  console.log('🖱️ [4/4] Beralih ke tab "Upload" & memasukkan video...');
  const uploadTab = await pickerFrame.waitForSelector('text="Upload"', { timeout: 10000 });
  await uploadTab.click();
  await page.waitForTimeout(1500);

  const fileInput = await pickerFrame.waitForSelector('input[type="file"]', { state: 'attached', timeout: 10000 });
  if (!fileInput) {
    throw new Error('input[type="file"] tidak ditemukan di tab Upload');
  }
  await fileInput.setInputFiles(fullPath);

  console.log(`🚀 Video dikirim ke Google Drive Picker! Menunggu proses upload selesai...`);

  const debugDir = path.resolve(process.cwd(), 'playwright/debug_snapshots');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  // Tunggu hingga video ter-attach di prompt editor ATAU picker frame menutup
  let uploadCompleted = false;
  const startTime = Date.now();
  const maxWaitMs = 180000; // Maksimal 3 menit

  let second = 0;
  while (Date.now() - startTime < maxWaitMs) {
    await page.waitForTimeout(2000);
    second += 2;

    // Cek apakah kartu attachment video sudah muncul di AI Studio prompt area
    const hasVideoPill = await page.evaluate((fname) => {
      const text = document.body.innerText || '';
      return text.includes(fname) || text.includes('tokens') || !!document.querySelector('ms-media-chunk, .file-chunk, [aria-label*="Remove"]');
    }, filename);

    // Cek apakah picker masih ada dan terlihat
    const pickerVisible = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[src*="picker"]');
      if (!iframe) return false;
      const style = window.getComputedStyle(iframe);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    });

    console.log(`⏱️ [Detik ${second}] Picker visible: ${pickerVisible}, Has Video Pill: ${hasVideoPill}`);

    if (second <= 10 || second % 10 === 0) {
      await page.screenshot({ path: path.join(debugDir, `bridge_upload_${second}s.png`) }).catch(() => { });
    }

    if (hasVideoPill || !pickerVisible) {
      console.log('🎉 Indikator upload selesai terdeteksi!');
      uploadCompleted = true;
      break;
    }
  }

  if (!uploadCompleted) {
    throw new Error('Timeout: Upload ke Google Drive memakan waktu lebih dari 3 menit');
  }

  console.log(`🎉 SUKSES! File ${filename} berhasil ter-upload ke Drive & terpasang di AI Studio!`);
  console.log(`🛑 [HARD STOP] Berhenti sesuai batasan scope (tidak menjalankan prompt).`);

  return true;
}

// ─── HTTP Server ──────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  // Health Check
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), isBusy }));
    return;
  }

  // Upload Single Chunk Endpoint
  if (req.method === 'POST' && url.pathname === '/api/upload-chunk') {
    if (isBusy) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Proses upload lain sedang berjalan' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const { sessionId, partNumber, videoPath, filename } = payload;

        if (!videoPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'videoPath diperlukan' }));
          return;
        }

        isBusy = true;
        await uploadChunkToDrive(videoPath, filename || path.basename(videoPath));
        isBusy = false;

        // Update status di Supabase schema autocontent
        try {
          if (sessionId && partNumber) {
            await SupabaseBridge.request(
              `content_parts?content_id=eq.${encodeURIComponent(sessionId)}&part_number=eq.${encodeURIComponent(partNumber)}`,
              {
                method: 'PATCH',
                body: JSON.stringify({
                  upload_status: 'done',
                  uploaded_at: new Date().toISOString(),
                }),
              }
            );
            console.log(`💾 Supabase ter-update: Session ${sessionId} Part #${partNumber} -> upload_status: 'done'`);
          }
        } catch (dbErr: any) {
          console.warn('⚠️ Gagal update Supabase dari bridge:', dbErr.message);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, sessionId, partNumber, filename }));
      } catch (err: any) {
        isBusy = false;
        console.error('❌ Error handling upload-chunk:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`=======================================================`);
  console.log(`⚡ Content Auto Local Bridge berjalan di: http://127.0.0.1:${PORT}`);
  console.log(`🚀 Siap melayani permintaan upload dari Browser Extension!`);
  console.log(`=======================================================`);
});

// Graceful cleanup
process.on('SIGINT', async () => {
  console.log('\nMematikan bridge server...');
  if (browserContext) await browserContext.close();
  server.close();
  process.exit(0);
});
