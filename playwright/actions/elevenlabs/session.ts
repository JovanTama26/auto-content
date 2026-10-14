import { BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';

export const ELEVENLABS_SESSION_PATH = path.resolve(
  process.cwd(),
  'playwright',
  'user_data',
  'elevenlabs_session.json'
);

/**
 * Menyimpan cookies & storage state browser aktif ke file elevenlabs_session.json
 */
export async function saveElevenLabsSession(
  context: BrowserContext,
  filePath: string = ELEVENLABS_SESSION_PATH
): Promise<string> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await context.storageState({ path: filePath });
  console.log(`💾 [Session Manager] Sesi ElevenLabs berhasil disimpan ke: ${filePath}`);
  return filePath;
}

/**
 * Memeriksa apakah tab browser saat ini memiliki sesi login aktif di ElevenLabs
 */
export async function isElevenLabsSessionActive(page: Page): Promise<boolean> {
  const url = page.url();
  const pathName = new URL(url).pathname;

  // Halaman autentikasi berarti belum login
  if (
    pathName.includes('/sign-in') ||
    pathName.includes('/sign-up') ||
    pathName.includes('/login') ||
    url.includes('mode=verifyEmail')
  ) {
    return false;
  }

  // Cek apakah di dashboard atau memiliki elemen autentikasi
  try {
    const isAuthed = await page.evaluate(() => {
      const bodyText = (document.body?.innerText || '').toLowerCase();
      if (bodyText.includes('welcome back') && Boolean(document.querySelector('input[type="password"]'))) {
        return false;
      }
      // Indikator dashboard aktif: ada textarea tts, avatar profile, atau rute /app/speech-synthesis
      const hasEditor = Boolean(document.querySelector('textarea, [contenteditable="true"]'));
      const hasUserMenu = Boolean(
        document.querySelector('[data-testid*="user"], [aria-label*="profile" i], [aria-label*="account" i]')
      );
      const isDashboardPath =
        window.location.pathname.startsWith('/app') &&
        !window.location.pathname.includes('/sign-in') &&
        !window.location.pathname.includes('/sign-up');

      return (isDashboardPath && hasEditor) || hasUserMenu;
    });

    return isAuthed;
  } catch {
    return false;
  }
}
