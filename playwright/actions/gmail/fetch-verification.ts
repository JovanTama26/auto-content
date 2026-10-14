// playwright/actions/gmail/fetch-verification.ts
import { BrowserContext } from 'playwright';
import fs from 'fs';
import path from 'path';

export interface FetchVerificationOptions {
  targetEmail?: string;
  startedAt?: number;
  maxWaitSeconds?: number;
  pollIntervalMs?: number;
  onLog?: (msg: string) => void;
}

export interface VerificationResult {
  verifyUrl: string;
  oobCode?: string;
  subject?: string;
  receivedAt?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const DEFAULT_USED_CODES = [
  'nY-MgWeglzZEQbZJAbWtqpu0jgXRBBjEpoaUcYslbjsAAAGglotM7g',
  '8nCwsQblOiZACzOi95yJWRzY9AEbSDGoNj3tkJTikNoAAAGgwAuraQ',
  'Ru3IkzItA4O4Pu0flY3PGQ5KOCFtJMHH4cHrbu18EtEAAAGgwAJB1A',
  'ZSTx1xd0OT9mizgB1ihY2teZMWGbMAtkqmVabMn702QAAAGgv_5urQ',
  '0pWCT1TiAtN8WDrAV38-C9TD86Kw1nVlz4v2uJsdBwQAAAGgvYm5vA',
  'WvDJSfcGtU5W4BlTptcSRjtcQWU0z3a05YvNdlFtOb4AAAGgvYDjGg',
  'IZguDPAez8Ync3si2XGutkOnOIYNrH2gZwklG81MRn8AAAGgvW9eEw',
  'eX4BPBbJKlbZf2vbeE70SgUIo6Fm2a2D1ZQXBXez6-4AAAGgvUzOng',
  '-rCp362zjYMV3jDe7uKVDk29f8FDjIgwhNCOiPhtR4UAAAGgvLgwNA',
  'G3tydcK9Bzznf_q3FktZsTEg-5SNOoxq5BZ2bkI-fbgAAAGhOcnkzQ',
];

const USED_CODES_PATH = path.resolve(process.cwd(), 'playwright', 'user_data', 'used_oob_codes.json');

export function getUsedOobCodes(): Set<string> {
  try {
    if (fs.existsSync(USED_CODES_PATH)) {
      const data = JSON.parse(fs.readFileSync(USED_CODES_PATH, 'utf-8'));
      if (Array.isArray(data)) {
        return new Set([...DEFAULT_USED_CODES, ...data]);
      }
    }
  } catch (err) {
    console.warn('[UsedCodes] Gagal membaca used_oob_codes.json:', err);
  }
  return new Set(DEFAULT_USED_CODES);
}

export function saveUsedOobCode(code: string): void {
  if (!code) return;
  try {
    const set = getUsedOobCodes();
    if (!set.has(code)) {
      set.add(code);
      const dir = path.dirname(USED_CODES_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(USED_CODES_PATH, JSON.stringify(Array.from(set), null, 2), 'utf-8');
      console.log(`[UsedCodes] oobCode disimpan sebagai terpakai: ${code}`);
    }
  } catch (err) {
    console.warn('[UsedCodes] Gagal menyimpan used_oob_codes.json:', err);
  }
}

/**
 * Searches Gmail for the latest ElevenLabs verification email and extracts the fresh verification URL.
 * Ported & optimized from extension/lib/elevenlabs-verify.js
 */
export async function fetchVerificationLinkFromGmail(
  context: BrowserContext,
  options: FetchVerificationOptions = {}
): Promise<VerificationResult> {
  const maxWaitSeconds = options.maxWaitSeconds ?? 90;
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const targetEmail = options.targetEmail || '';
  const log = options.onLog || ((msg: string) => console.log(`[Gmail Verifier] ${msg}`));

  log(`Membuka tab Gmail untuk memantau email verifikasi ElevenLabs...`);

  const gmailPage = await context.newPage();
  gmailPage.setDefaultTimeout(35000);

  const startTime = Date.now();
  const maxWaitMs = maxWaitSeconds * 1000;

  try {
    // 1. Query pencarian spesifik contek dari ekstensi: ElevenLabs [prefix]
    const emailPrefix = targetEmail ? targetEmail.split('@')[0] : '';
    const searchQuery = emailPrefix
      ? `ElevenLabs ${emailPrefix}`
      : (targetEmail ? `ElevenLabs ${targetEmail}` : 'ElevenLabs in:anywhere');
    const searchUrl = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(searchQuery)}`;

    log(`Navigasi pencarian Gmail: ${searchUrl}`);
    await gmailPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // Tunggu render awal
    await sleep(2500);

    let attempt = 0;
    while (Date.now() - startTime < maxWaitMs) {
      if (gmailPage.isClosed()) {
        throw new Error('Tab Gmail tertutup selama proses verifikasi.');
      }

      attempt++;
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      const usedCodesList = Array.from(getUsedOobCodes());

      // Evaluasi langsung di konteks DOM tab Gmail (seperti inTabInspectGmail di ekstensi)
      const inspectResult = await gmailPage.evaluate(
        ({ usedCodes, targetEmail }) => {
          const bodyText = (document.body ? document.body.innerText : '').toLowerCase();

          // Deteksi belum login
          if (
            window.location.hostname.includes('accounts.google.com') ||
            bodyText.includes('sign in to continue to gmail') ||
            bodyText.includes('masuk untuk melanjutkan ke gmail')
          ) {
            return { status: 'not_logged_in', error: 'Sesi Gmail belum login di browser.' };
          }

          const emailPrefix = targetEmail ? targetEmail.split('@')[0].toLowerCase() : '';

          // Periksa semua anchor tautan di halaman
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          const candidates: { href: string; code: string; isUsed: boolean }[] = [];

          for (const a of anchors) {
            const href = (a as HTMLAnchorElement).href || '';
            const text = (a.textContent || '').trim().toLowerCase();

            if (
              (href.includes('elevenlabs.io') || href.includes('auth.elevenlabs.io')) &&
              (href.includes('verify') ||
                href.includes('oobCode') ||
                href.includes('ticket') ||
                href.includes('token') ||
                href.includes('action') ||
                text.includes('verify email') ||
                text.includes('verify your email') ||
                text.includes('confirm email') ||
                text.includes('verify'))
            ) {
              let code = '';
              try {
                const parsed = new URL(href);
                code =
                  parsed.searchParams.get('ticket') ||
                  parsed.searchParams.get('oobCode') ||
                  parsed.searchParams.get('token') ||
                  href;
              } catch {
                code = href;
              }

              const isUsed = code ? usedCodes.includes(code) : false;
              candidates.push({ href, code, isUsed });
            }
          }

          // Cari link fresh yang belum pernah terpakai dari urutan paling bawah (pesan terbaru)
          for (let i = candidates.length - 1; i >= 0; i--) {
            const c = candidates[i];
            if (c.code && !c.isUsed) {
              return {
                status: 'found',
                verifyUrl: c.href,
                oobCode: c.code,
              };
            }
          }

          // Deteksi jika saat ini sedang di dalam tampilan thread email
          const h2Subject = document.querySelector('h2.hP');
          const isInsideEmailThread = Boolean(h2Subject) || window.location.hash.split('/').length >= 3;

          if (isInsideEmailThread) {
            // Buka konten terlipat jika ada
            const expandables = document.querySelectorAll(
              'div[role="listitem"] [aria-expanded="false"], span[aria-label*="Expand" i], div[aria-label*="Show trimmed content" i], [aria-label*="Lihat konten yang dipangkas" i]'
            );
            expandables.forEach((el) => {
              try { (el as HTMLElement).click(); } catch {}
            });

            const listItems = Array.from(document.querySelectorAll('div[role="listitem"]'));
            const lastItem = listItems[listItems.length - 1];
            if (lastItem && lastItem.getAttribute('aria-expanded') === 'false') {
              try { (lastItem as HTMLElement).click(); } catch {}
            }

            // Jika thread ini hanya berisi link lama yang sudah pernah terpakai, kembali ke list search
            if (candidates.length > 0 && candidates.every((c) => c.isUsed)) {
              const backBtn = document.querySelector(
                'div[aria-label*="Back" i], div[aria-label*="Kembali" i], div[data-tooltip*="Back" i], div[data-tooltip*="Kembali" i]'
              );
              if (backBtn) {
                try { (backBtn as HTMLElement).click(); } catch {}
              }
              return { status: 'inside_thread_old' };
            }

            return { status: 'inside_thread_waiting' };
          }

          // Jika sedang di daftar list email (tabel tr.zA)
          const rows = Array.from(document.querySelectorAll('tr.zA, [role="row"].zA'));
          let matchedRow: Element | null = null;

          for (const row of rows) {
            const rowText = ((row as HTMLElement).innerText || '').toLowerCase();
            if (
              (rowText.includes('elevenlabs') || rowText.includes('eleven labs')) &&
              (rowText.includes('verify') || rowText.includes('action') || (emailPrefix && rowText.includes(emailPrefix)))
            ) {
              matchedRow = row;
              break;
            }
          }

          // Fallback: Jika di halaman search ada baris ElevenLabs, ambil baris pertama (terbaru)
          if (!matchedRow && rows.length > 0) {
            for (const row of rows) {
              const rowText = ((row as HTMLElement).innerText || '').toLowerCase();
              if (rowText.includes('elevenlabs') || rowText.includes('eleven labs')) {
                matchedRow = row;
                break;
              }
            }
          }

          if (matchedRow) {
            const clickTarget = matchedRow.querySelector('.bog, .y6, [role="link"]') || matchedRow;
            (clickTarget as HTMLElement).click();
            return { status: 'clicked_row' };
          }

          // Jika belum ada row cocok, klik tombol Refresh di toolbar Gmail
          const refreshBtn = document.querySelector(
            'div[aria-label*="Refresh" i], div[data-tooltip*="Refresh" i], div[aria-label*="Segarkan" i], div[data-tooltip*="Segarkan" i]'
          );
          if (refreshBtn) {
            try { (refreshBtn as HTMLElement).click(); } catch {}
          }

          return { status: 'waiting' };
        },
        { usedCodes: usedCodesList, targetEmail }
      );

      if (inspectResult) {
        if (inspectResult.status === 'not_logged_in') {
          throw new Error('Sesi Gmail belum login di browser. Silakan inisialisasi login Google terlebih dahulu.');
        }

        if (inspectResult.status === 'found' && inspectResult.verifyUrl) {
          log(`🎉 Link verifikasi baru berhasil didapatkan: ${inspectResult.verifyUrl}`);
          if (inspectResult.oobCode) {
            saveUsedOobCode(inspectResult.oobCode);
          }
          await gmailPage.close().catch(() => {});
          return {
            verifyUrl: inspectResult.verifyUrl,
            oobCode: inspectResult.oobCode,
            subject: 'ElevenLabs Verification',
            receivedAt: new Date().toISOString(),
          };
        }

        if (inspectResult.status === 'clicked_row') {
          log(`Membuka email verifikasi ElevenLabs di Gmail...`);
          await sleep(2500);
          continue;
        }

        if (inspectResult.status === 'inside_thread_waiting') {
          log(`Mengekstrak link di dalam thread email...`);
          await sleep(1500);
          continue;
        }

        if (inspectResult.status === 'inside_thread_old') {
          log(`Thread hanya berisi link lama, kembali ke hasil pencarian...`);
          await sleep(1500);
          continue;
        }
      }

      log(`[${elapsedSec}s] Menunggu email verifikasi masuk ke Gmail (${targetEmail})...`);
      await sleep(pollIntervalMs);
    }

    throw new Error(
      `Link verifikasi ElevenLabs tidak ditemukan di Gmail setelah ${maxWaitSeconds} detik. Pastikan email ElevenLabs benar-benar terkirim.`
    );
  } finally {
    if (!gmailPage.isClosed()) {
      await gmailPage.close().catch(() => {});
    }
  }
}
