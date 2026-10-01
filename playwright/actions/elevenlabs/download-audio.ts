// playwright/actions/elevenlabs/download-audio.ts
import { Page } from 'playwright';
import fs from 'fs';
import path from 'path';

export interface DownloadAudioOptions {
  generationNumber?: number; // 1 = First/earliest of recent pair, 2 = Second/latest (Default: 2)
  outputDir?: string; // Default: 'downloads'
  format?: 'mp3' | 'wav'; // Default: 'mp3'
  onLog?: (msg: string) => void;
}

export interface DownloadAudioResult {
  success: boolean;
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  historyId?: string;
  generationSelected: number;
  message: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Downloads generated speech audio from the ElevenLabs TTS History tab.
 */
export async function downloadElevenLabsAudio(
  page: Page,
  options: DownloadAudioOptions = {}
): Promise<DownloadAudioResult> {
  const genNum = options.generationNumber ?? 2;
  const format = options.format || 'mp3';
  const outputDir = path.resolve(process.cwd(), options.outputDir || 'downloads');
  const log = options.onLog || ((msg: string) => console.log(`[ElevenLabs Download] ${msg}`));

  log(`Memastikan berada di dashboard Text-to-Speech...`);
  if (!page.url().includes('/speech-synthesis') && !page.url().includes('/text-to-speech')) {
    await page.goto('https://elevenlabs.io/app/speech-synthesis/text-to-speech', { waitUntil: 'domcontentloaded' });
    await sleep(3500);
  }

  // Buka tab History jika belum terbuka
  const historyTab = page.locator('[data-testid="tts-history-tab"]').first();
  await historyTab.waitFor({ state: 'visible', timeout: 15000 });
  const isSelected = await historyTab.getAttribute('aria-selected').catch(() => 'false');
  if (isSelected !== 'true') {
    log(`Membuka tab History di panel samping...`);
    await historyTab.click({ force: true });
    await sleep(2000);
  }

  // Ambil daftar item history
  log(`Memeriksa daftar audio di tab History...`);
  const historyItems = page.locator('li.eleven-list-item');
  const totalItems = await historyItems.count();

  if (totalItems === 0) {
    throw new Error('Tidak ada riwayat audio yang ditemukan di tab History ElevenLabs.');
  }

  log(`Ditemukan ${totalItems} item di riwayat.`);

  // Menentukan index berdasarkan nomor Generation:
  // Jika genNum === 2: ambil yang terbaru (index 0)
  // Jika genNum === 1: ambil yang sebelumnya (index 1)
  let targetIndex = 0;
  if (genNum === 1) {
    targetIndex = totalItems > 1 ? 1 : 0;
  } else if (genNum === 2) {
    targetIndex = 0;
  } else {
    targetIndex = Math.max(0, totalItems - genNum);
  }

  const selectedItem = historyItems.nth(targetIndex);
  const itemText = (await selectedItem.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 100);
  const triggerEl = selectedItem.locator('[data-history-item]').first();
  const historyId = (await triggerEl.getAttribute('data-history-item').catch(() => '')) || undefined;

  log(`Memilih item Generation ${genNum} (List Index ${targetIndex}, ID: ${historyId || 'N/A'})...`);
  log(`Pratinjau teks: "${itemText}"`);

  // Hover item agar tombol aksi (Download) muncul
  await selectedItem.hover();
  await sleep(400);

  const downloadBtn = selectedItem.locator('button[data-testid="history-download-button"]').first();
  await downloadBtn.waitFor({ state: 'attached', timeout: 10000 });

  log(`Mengklik tombol Download...`);
  await downloadBtn.click({ force: true });
  await sleep(600);

  // Cari opsi format pada dropdown Radix menu
  const targetFormatText = format.toUpperCase();
  log(`Memilih format download: ${targetFormatText}...`);
  const formatOption = page.locator(`[role="menuitem"]:has-text("${targetFormatText}")`).first();
  await formatOption.waitFor({ state: 'visible', timeout: 8000 });

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  log(`Menunggu proses pengunduhan file dari ElevenLabs...`);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 25000 }),
    formatOption.click({ force: true }),
  ]);

  const suggestedName = download.suggestedFilename();
  const safeName = `generation_${genNum}_${suggestedName}`;
  const finalPath = path.join(outputDir, safeName);

  await download.saveAs(finalPath);
  const stats = fs.statSync(finalPath);

  log(`✅ File audio berhasil diunduh!`);
  log(`📁 Lokasi : ${finalPath}`);
  log(`📊 Ukuran : ${(stats.size / 1024).toFixed(1)} KB (${stats.size} bytes)`);

  return {
    success: true,
    filePath: finalPath,
    fileName: safeName,
    fileSizeBytes: stats.size,
    historyId,
    generationSelected: genNum,
    message: `Berhasil mengunduh audio Generation ${genNum} (${safeName})`,
  };
}
