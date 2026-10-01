// playwright/actions/gmail/fetch-verification.ts
import { BrowserContext } from 'playwright';

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

const usedOobCodes = new Set<string>([
  'nY-MgWeglzZEQbZJAbWtqpu0jgXRBBjEpoaUcYslbjsAAAGglotM7g',
  '8nCwsQblOiZACzOi95yJWRzY9AEbSDGoNj3tkJTikNoAAAGgwAuraQ',
  'Ru3IkzItA4O4Pu0flY3PGQ5KOCFtJMHH4cHrbu18EtEAAAGgwAJB1A',
  'ZSTx1xd0OT9mizgB1ihY2teZMWGbMAtkqmVabMn702QAAAGgv_5urQ',
  '0pWCT1TiAtN8WDrAV38-C9TD86Kw1nVlz4v2uJsdBwQAAAGgvYm5vA',
  'WvDJSfcGtU5W4BlTptcSRjtcQWU0z3a05YvNdlFtOb4AAAGgvYDjGg',
  'IZguDPAez8Ync3si2XGutkOnOIYNrH2gZwklG81MRn8AAAGgvW9eEw',
  'eX4BPBbJKlbZf2vbeE70SgUIo6Fm2a2D1ZQXBXez6-4AAAGgvUzOng',
  '-rCp362zjYMV3jDe7uKVDk29f8FDjIgwhNCOiPhtR4UAAAGgvLgwNA',
]);

/**
 * Searches Gmail for the latest ElevenLabs verification email and extracts the verification URL.
 */
export async function fetchVerificationLinkFromGmail(
  context: BrowserContext,
  options: FetchVerificationOptions = {}
): Promise<VerificationResult> {
  const maxWaitSeconds = options.maxWaitSeconds ?? 90;
  const pollIntervalMs = options.pollIntervalMs ?? 3500;
  const targetEmail = options.targetEmail;
  const log = options.onLog || ((msg: string) => console.log(`[Gmail Verifier] ${msg}`));

  log(`Membuka tab Gmail untuk memantau email verifikasi ElevenLabs...`);

  const gmailPage = await context.newPage();
  gmailPage.setDefaultTimeout(35000);

  const startTime = Date.now();
  const maxWaitMs = maxWaitSeconds * 1000;

  try {
    const emailPrefix = targetEmail ? targetEmail.split('@')[0] : '';
    const searchQuery = emailPrefix
      ? `ElevenLabs ${emailPrefix}`
      : (targetEmail ? `ElevenLabs ${targetEmail}` : 'ElevenLabs in:anywhere');
    const searchUrl = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(searchQuery)}`;
    log(`Navigasi ke: ${searchUrl}`);
    await gmailPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

    let attempt = 0;
    while (Date.now() - startTime < maxWaitMs) {
      attempt++;
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      log(`[Attempt ${attempt} / ${elapsedSec}s] Memeriksa email masuk di Gmail...`);

      await sleep(2500);

      // Coba klik tombol refresh Gmail
      try {
        const refreshBtn = await gmailPage.$(
          'div[aria-label*="Refresh" i], div[data-tooltip*="Refresh" i], div[aria-label*="Segarkan" i], div[data-tooltip*="Segarkan" i]'
        );
        if (refreshBtn) {
          await refreshBtn.click({ timeout: 1500 });
          await sleep(1500);
        }
      } catch {}

      // Cari baris email yang relevan
      const emailRows = await gmailPage.$$('tr.zA');
      let candidateRow = null;

      for (const row of emailRows) {
        try {
          const text = await row.innerText();
          if (
            (text.includes('ElevenLabs') || text.includes('Eleven Labs')) &&
            (text.includes('Verify your email') || text.includes('Verify') || text.includes('action'))
          ) {
            candidateRow = row;
            break;
          }
        } catch {}
      }

      if (candidateRow) {
        // Klik baris email untuk memeriksa link di dalamnya
        await candidateRow.click();
        await sleep(3000);

        // Buka semua pesan terlipat jika thread memiliki banyak pesan
        try {
          const expandables = await gmailPage.$$(
            'div[role="listitem"] [aria-expanded="false"], span[aria-label*="Expand" i], div[aria-label*="Show trimmed content" i], [aria-label*="Lihat konten yang dipangkas" i]'
          );
          for (const exp of expandables) {
            await exp.click().catch(() => {});
            await sleep(400);
          }
        } catch {}

        // Ekstrak semua anchor link dari email
        const links = await gmailPage.$$eval('a[href]', (anchors) => {
          return anchors.map((a) => ({
            href: a.href,
            text: (a.innerText || a.textContent || '').trim(),
          }));
        });

        const verifyCandidates = links.filter((item) => {
          const href = item.href || '';
          const text = item.text.toLowerCase();
          return (
            href.includes('elevenlabs.io') &&
            (href.includes('mode=verifyEmail') ||
             href.includes('oobCode') ||
             text.includes('verify email') ||
             text.includes('verify'))
          );
        });

        // Loop dari yang paling bawah (terbaru)
        for (let i = verifyCandidates.length - 1; i >= 0; i--) {
          const candidate = verifyCandidates[i];
          const href = candidate.href;

          let oobCode = '';
          try {
            const parsed = new URL(href);
            oobCode = parsed.searchParams.get('oobCode') || '';
          } catch {}

          if (oobCode && usedOobCodes.has(oobCode)) {
            // Ini link lama yang sudah pernah dipakai
            continue;
          }

          if (oobCode) {
            usedOobCodes.add(oobCode);
          }

          log(`🎉 Link verifikasi baru dan fresh berhasil didapat: ${href}`);
          await gmailPage.close().catch(() => {});
          return {
            verifyUrl: href,
            oobCode,
            subject: 'ElevenLabs Verification',
            receivedAt: new Date().toISOString(),
          };
        }

        // Jika belum ada link fresh, kembali ke search
        log('Link verifikasi fresh belum masuk di thread ini, kembali memantau...');
        await gmailPage.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await sleep(1500);
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(
      `Gagal menemukan email verifikasi ElevenLabs baru di Gmail setelah ${maxWaitSeconds} detik.`
    );
  } finally {
    if (!gmailPage.isClosed()) {
      await gmailPage.close().catch(() => {});
    }
  }
}
