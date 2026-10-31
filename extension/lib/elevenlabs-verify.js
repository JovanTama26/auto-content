kita // extension/lib/elevenlabs-verify.js
// Client helper & in-browser automation untuk mengambil link verifikasi ElevenLabs langsung dari Gmail
// 100% di dalam ekstensi via tab Gmail, tanpa looping rumit & tanpa n8n webhook.

const DEFAULT_USED_CODES = [
  'nY-MgWeglzZEQbZJAbWtqpu0jgXRBBjEpoaUcYslbjsAAAGglotM7g',
  '8nCwsQblOiZACzOi95yJWRzY9AEbSDGoNj3tkJTikNoAAAGgwAuraQ',
  'Ru3IkzItA4O4Pu0flY3PGQ5KOCFtJMHH4cHrbu18EtEAAAGgwAJB1A',
  'ZSTx1xd0OT9mizgB1ihY2teZMWGbMAtkqmVabMn702QAAAGgv_5urQ',
  '0pWCT1TiAtN8WDrAV38-C9TD86Kw1nVlz4v2uJsdBwQAAAGgvYm5vA',
  'WvDJSfcGtU5W4BlTptcSRjtcQWU0z3a05YvNdlFtOb4AAAGgvYDjGg',
  'IZguDPAez8Ync3si2XGutkOnOIYNrH2gZwklG81MRn8AAAGgvW9eEw',
  'eX4BPBbJKlbZf2vbeE70SgUIo6Fm2a2D1ZQXBXez6-4AAAGgvUzOng',
  '-rCp362zjYMV3jDe7uKVDk29f8FDjIgwhNCOiPhtR4UAAAGgvLgwNA',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mengambil daftar oobCode yang sudah pernah terpakai dari storage
 */
async function getUsedCodes() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get('elevenlabs_used_oob_codes');
      const list = data.elevenlabs_used_oob_codes || [];
      return Array.from(new Set([...DEFAULT_USED_CODES, ...list]));
    }
  } catch (e) {
    console.warn('[ElevenLabsVerify] Error baca storage used codes:', e);
  }
  return DEFAULT_USED_CODES;
}

/**
 * Menyimpan oobCode baru ke storage agar tidak pernah dipakai ulang
 */
async function markCodeAsUsed(oobCode) {
  if (!oobCode) return;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const list = await getUsedCodes();
      if (!list.includes(oobCode)) {
        list.push(oobCode);
        await chrome.storage.local.set({ elevenlabs_used_oob_codes: list });
        console.log(`[ElevenLabsVerify] oobCode disimpan ke storage sebagai sudah terpakai: ${oobCode}`);
      }
    }
  } catch (e) {
    console.warn('[ElevenLabsVerify] Error simpan storage used codes:', e);
  }
}

/**
 * Fungsi yang di-inject ke dalam tab Gmail via chrome.scripting.executeScript
 * Berjalan di konteks DOM tab Gmail untuk memeriksa email masuk dan mengekstrak tautan verifikasi.
 */
async function inTabInspectGmail(usedCodes = [], targetEmail = '') {
  // 1. Deteksi jika belum login
  const bodyText = (document.body ? document.body.innerText : '').toLowerCase();
  if (
    window.location.hostname.includes('accounts.google.com') ||
    bodyText.includes('sign in to continue to gmail') ||
    bodyText.includes('masuk untuk melanjutkan ke gmail')
  ) {
    return { status: 'not_logged_in', error: 'Sesi Gmail belum login di browser.' };
  }

  const emailPrefix = targetEmail ? targetEmail.split('@')[0].toLowerCase() : '';

  // 2. Periksa apakah sudah ada link verifikasi di halaman (baik di dalam thread email maupun terbuka)
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  const candidates = [];

  for (const a of anchors) {
    const href = a.href || '';
    const text = (a.innerText || a.textContent || '').trim().toLowerCase();

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

  // Cari link fresh yang belum pernah dipakai (dari urutan paling bawah / pesan terbaru)
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

  // 3. Deteksi jika saat ini sedang di dalam tampilan thread email
  const h2Subject = document.querySelector('h2.hP');
  const isInsideEmailThread = !!h2Subject || window.location.hash.split('/').length >= 3;

  if (isInsideEmailThread) {
    // Buka konten terlipat jika ada
    const expandables = document.querySelectorAll(
      'div[role="listitem"] [aria-expanded="false"], span[aria-label*="Expand" i], div[aria-label*="Show trimmed content" i], [aria-label*="Lihat konten yang dipangkas" i]'
    );
    expandables.forEach((el) => {
      try { el.click(); } catch {}
    });

    const listItems = Array.from(document.querySelectorAll('div[role="listitem"]'));
    const lastItem = listItems[listItems.length - 1];
    if (lastItem && lastItem.getAttribute('aria-expanded') === 'false') {
      try { lastItem.click(); } catch {}
    }

    // Jika thread ini hanya berisi link lama yang sudah terpakai, klik kembali ke daftar pesan
    if (candidates.length > 0 && candidates.every((c) => c.isUsed)) {
      const backBtn = document.querySelector(
        'div[aria-label*="Back" i], div[aria-label*="Kembali" i], div[data-tooltip*="Back" i], div[data-tooltip*="Kembali" i]'
      );
      if (backBtn) {
        try { backBtn.click(); } catch {}
      }
      return { status: 'inside_thread_old' };
    }

    return { status: 'inside_thread_waiting' };
  }

  // 4. Jika sedang di daftar list email (tabel tr.zA)
  const rows = Array.from(document.querySelectorAll('tr.zA, [role="row"].zA'));
  let matchedRow = null;

  for (const row of rows) {
    const rowText = (row.innerText || '').toLowerCase();
    if (
      (rowText.includes('elevenlabs') || rowText.includes('eleven labs')) &&
      (rowText.includes('verify') || rowText.includes('action') || (emailPrefix && rowText.includes(emailPrefix)))
    ) {
      matchedRow = row;
      break;
    }
  }

  // Jika di halaman search ada baris email dari ElevenLabs, ambil baris pertama (terbaru)
  if (!matchedRow && rows.length > 0) {
    for (const row of rows) {
      const rowText = (row.innerText || '').toLowerCase();
      if (rowText.includes('elevenlabs') || rowText.includes('eleven labs')) {
        matchedRow = row;
        break;
      }
    }
  }

  if (matchedRow) {
    const clickTarget = matchedRow.querySelector('.bog, .y6, [role="link"]') || matchedRow;
    clickTarget.click();
    return { status: 'clicked_row' };
  }

  // 5. Jika belum ada row cocok, klik tombol Refresh di toolbar Gmail
  const refreshBtn = document.querySelector(
    'div[aria-label*="Refresh" i], div[data-tooltip*="Refresh" i], div[aria-label*="Segarkan" i], div[data-tooltip*="Segarkan" i]'
  );
  if (refreshBtn) {
    try { refreshBtn.click(); } catch {}
  }

  return { status: 'waiting' };
}

/**
 * Eksekusi pencarian link verifikasi dari tab background Gmail.
 * Dibuka di tab browser, diekstrak, dan langsung ditutup otomatis setelah selesai.
 */
async function fetchVerificationFromGmailTab(options = {}) {
  const maxWaitSeconds = options.maxWaitSeconds || 90;
  const pollIntervalMs = options.pollIntervalMs || 3000;
  const targetEmail = options.email || '';
  const onProgress = options.onProgress || (() => {});

  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.scripting) {
    throw new Error('Chrome Extension API (tabs & scripting) tidak tersedia di konteks ini.');
  }

  // Query pencarian awal sebelum looping: ElevenLabs [prefix]
  const emailPrefix = targetEmail ? targetEmail.split('@')[0] : '';
  const searchQuery = emailPrefix
    ? `ElevenLabs ${emailPrefix}`
    : (targetEmail ? `ElevenLabs ${targetEmail}` : 'ElevenLabs in:anywhere');
  const searchUrl = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(searchQuery)}`;

  onProgress(`Membuka Gmail untuk memeriksa email verifikasi...`);

  // Cari apakah tab Gmail sudah ada atau buat tab baru
  const existingTabs = await chrome.tabs.query({ url: '*://mail.google.com/*' });
  let tabId;
  let shouldCloseTab = false;

  if (existingTabs.length > 0) {
    tabId = existingTabs[0].id;
    await chrome.tabs.update(tabId, { url: searchUrl, active: true });
    if (existingTabs[0].windowId) {
      try {
        await chrome.windows.update(existingTabs[0].windowId, { focused: true });
      } catch {}
    }
  } else {
    const tab = await chrome.tabs.create({ url: searchUrl, active: true });
    tabId = tab.id;
    shouldCloseTab = true;
    if (tab.windowId) {
      try {
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch {}
    }
  }

  try {
    // Tunggu tab selesai memuat awal
    await new Promise((resolve) => {
      let timeoutId;
      function listener(tid, changeInfo) {
        if (tid === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeoutId);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
      timeoutId = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 12000);
    });

    await sleep(2000);

    const startTime = Date.now();
    const maxWaitMs = maxWaitSeconds * 1000;

    while (Date.now() - startTime < maxWaitMs) {
      // Cek apakah tab masih ada
      try {
        const checkTab = await chrome.tabs.get(tabId);
        if (!checkTab) throw new Error('Tab Gmail tertutup.');
      } catch (tabErr) {
        throw new Error('Tab Gmail tertutup oleh pengguna.');
      }

      const usedCodes = await getUsedCodes();

      let results;
      try {
        results = await chrome.scripting.executeScript({
          target: { tabId },
          func: inTabInspectGmail,
          args: [usedCodes, targetEmail],
        });
      } catch (scriptErr) {
        console.warn(`[ElevenLabsVerify] Scripting warning:`, scriptErr.message);
        await sleep(pollIntervalMs);
        continue;
      }

      const res = results && results[0] ? results[0].result : null;

      if (res) {
        if (res.status === 'not_logged_in') {
          throw new Error('Akun Gmail belum login di browser. Silakan login ke Gmail terlebih dahulu.');
        }

        if (res.status === 'found' && res.verifyUrl) {
          onProgress(`Link verifikasi berhasil didapatkan!`);
          await markCodeAsUsed(res.oobCode);
          return {
            success: true,
            verifyUrl: res.verifyUrl,
            oobCode: res.oobCode,
            receivedAt: new Date().toISOString(),
          };
        }

        if (res.status === 'clicked_row') {
          onProgress(`Membuka email verifikasi ElevenLabs...`);
          await sleep(2500);
          continue;
        }

        if (res.status === 'inside_thread_waiting') {
          onProgress(`Mengekstrak link di dalam email...`);
          await sleep(1500);
          continue;
        }
      }

      onProgress(`Menunggu email verifikasi masuk ke Gmail (${targetEmail})...`);
      await sleep(pollIntervalMs);
    }

    throw new Error(
      `Link verifikasi ElevenLabs tidak ditemukan di Gmail setelah ${maxWaitSeconds} detik. Pastikan email ElevenLabs benar-benar terkirim ke Gmail.`
    );
  } finally {
    // Jika tab baru dibuka khusus untuk verifikasi, tutup otomatis agar rapi
    if (shouldCloseTab) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {}
    }
  }
}

const VPS_MAIL_API_BASE = 'http://43.129.43.29:8888';

/**
 * Mengambil link verifikasi ElevenLabs langsung dari server VPS penangkap email
 * Polling API: http://43.129.43.29:8888/api/get-link?email=...
 * 100% mandiri tanpa membuka tab Gmail & tanpa captcha!
 */
async function fetchVerificationFromVps(email, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const maxWaitSeconds = options.maxWaitSeconds || 75;
  const pollIntervalMs = options.pollIntervalMs || 2000;
  const initialDelayMs = options.initialDelayMs !== undefined ? options.initialDelayMs : 1500;

  if (initialDelayMs > 0) {
    onProgress(`Menunggu ${Math.round(initialDelayMs / 1000)}s sebelum memeriksa server VPS...`);
    await sleep(initialDelayMs);
  }

  const startTime = Date.now();
  const maxMs = maxWaitSeconds * 1000;
  const usedCodes = await getUsedCodes();
  const targetEmail = (email || '').trim().toLowerCase();

  console.log(`[ElevenLabsVerify] 🚀 Memulai polling ke server VPS (${VPS_MAIL_API_BASE}) untuk email: ${targetEmail}`);
  onProgress(`Menghubungi VPS server untuk memantau email ${targetEmail}...`);

  while (Date.now() - startTime < maxMs) {
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    try {
      const apiUrl = `${VPS_MAIL_API_BASE}/api/get-link?email=${encodeURIComponent(targetEmail)}`;
      const res = await fetch(apiUrl, { method: 'GET', cache: 'no-store' });

      if (res.ok) {
        const data = await res.json();
        if (data && data.status === 'found' && data.verify_url) {
          const verifyUrl = data.verify_url;
          let code = '';
          try {
            const parsed = new URL(verifyUrl);
            code =
              parsed.searchParams.get('oobCode') ||
              parsed.searchParams.get('ticket') ||
              parsed.searchParams.get('token') ||
              '';
          } catch (e) { }

          if (code && usedCodes.includes(code)) {
            console.warn(`[ElevenLabsVerify] Link lama/terpakai terdeteksi di VPS (${code}), menunggu link baru...`);
            onProgress(`Link lama terdeteksi, menunggu link verifikasi baru dari VPS (${elapsedSec}s)...`);
          } else {
            if (code) await markCodeAsUsed(code);
            console.log(`[ElevenLabsVerify] [✓] Link verifikasi berhasil didapatkan dari server VPS!`, verifyUrl);
            onProgress(`Link verifikasi berhasil didapatkan dari server VPS!`);
            return {
              success: true,
              verifyUrl,
              code,
              source: 'vps_mail_api',
            };
          }
        }
      }
    } catch (err) {
      console.warn('[ElevenLabsVerify] Warning saat polling VPS:', err.message);
    }

    onProgress(`Menunggu email verifikasi masuk di server VPS (${elapsedSec}/${maxWaitSeconds}s)...`);
    await sleep(pollIntervalMs);
  }

  throw new Error(`Waktu tunggu email verifikasi di server VPS habis (${maxWaitSeconds}s).`);
}

/**
 * Objek utama ElevenLabsVerify yang diekspos ke sidepanel & background
 */
const ElevenLabsVerify = {
  getUsedCodes,
  markCodeAsUsed,
  fetchVerificationFromVps,
  fetchVerificationFromGmailTab,

  /**
   * Mengambil URL verifikasi
   * Secara default memprioritaskan polling ke Server VPS (port 8888) tanpa perlu buka Gmail
   */
  async pollForVerifyUrl(email, options = {}) {
    const onProgress = options.onProgress || (() => {});
    const targetEmail = (email || '').trim().toLowerCase();

    // Jika bukan secara eksplisit dipaksa useGmail: true, gunakan server VPS (jauh lebih cepat & tanpa tab Gmail)
    if (options.useGmail !== true) {
      try {
        return await fetchVerificationFromVps(targetEmail, options);
      } catch (vpsErr) {
        console.warn('[ElevenLabsVerify] Polling VPS gagal atau timeout, fallback ke Gmail jika tersedia:', vpsErr.message);
        if (options.fallbackGmail === true) {
          return await fetchVerificationFromGmailTab({
            email: targetEmail,
            maxWaitSeconds: options.maxWaitSeconds || 60,
            pollIntervalMs: options.pollIntervalMs || 3000,
            onProgress,
          });
        }
        throw vpsErr;
      }
    }

    // Jalur Gmail jika opsi useGmail === true
    return await fetchVerificationFromGmailTab({
      email: targetEmail,
      maxWaitSeconds: options.maxWaitSeconds || 90,
      pollIntervalMs: options.pollIntervalMs || 3000,
      onProgress,
    });
  },

  async getVerifyUrl(email, options = {}) {
    return await this.pollForVerifyUrl(email, options);
  },
};

if (typeof window !== 'undefined') {
  window.ElevenLabsVerify = ElevenLabsVerify;
}
if (typeof globalThis !== 'undefined') {
  globalThis.ElevenLabsVerify = ElevenLabsVerify;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ElevenLabsVerify };
}
