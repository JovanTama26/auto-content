// extension/lib/elevenlabs-verify.js
// Client helper untuk ElevenLabs Email Verify API via n8n webhook
// Endpoint: https://n8n.riztama.my.id/webhook/elevenlabs-verify

// Set untuk melacak oobCode yang sudah pernah dipakai / kadaluarsa agar tidak pernah dipakai ulang
const usedOobCodes = new Set([
  'nY-MgWeglzZEQbZJAbWtqpu0jgXRBBjEpoaUcYslbjsAAAGglotM7g' // Stale oobCode dari kemarin
]);

function extractVerifyData(raw) {
  if (!raw) return null;
  const item = raw.result || raw;
  const verifyUrl = item.verifyUrl || null;
  const oobCode = item.oobCode || null;
  const success = item.success ?? !!verifyUrl;
  const isFresh = item.isFresh ?? true;
  const ageSeconds = item.ageSeconds ?? 0;
  const message = item.message || '';

  // Validasi ketat: tautan hanya valid jika fresh (< 5 menit) dan oobCode belum pernah dipakai
  const isCodeUsed = oobCode ? usedOobCodes.has(oobCode) : false;
  const isActuallyFresh = isFresh && ageSeconds <= 300 && !isCodeUsed;

  return {
    success: !!(success && verifyUrl),
    verifyUrl,
    oobCode,
    isFresh: isActuallyFresh,
    rawIsFresh: isFresh,
    ageSeconds,
    isCodeUsed,
    message,
    raw: item,
  };
}

const ElevenLabsVerify = {
  ENDPOINT: 'https://n8n.riztama.my.id/webhook/elevenlabs-verify',
  usedOobCodes,

  markCodeAsUsed(oobCode) {
    if (oobCode) {
      usedOobCodes.add(oobCode);
      console.log(`[ElevenLabsVerify] oobCode ditandai sudah dipakai: ${oobCode}`);
    }
  },

  /**
   * Request link verifikasi ke webhook n8n
   * @param {string} email - Alamat email tujuan
   * @returns {Promise<Object>} Response dari webhook
   */
  async fetchVerifyEmail(email) {
    const res = await fetch(this.ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: email }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Webhook Error (${res.status}): ${errText}`);
    }

    return await res.json();
  },

  /**
   * Eksekusi terisolasi untuk mengambil link verifikasi email
   * Wajib memastikan link benar-benar fresh dan belum pernah terpakai
   * @param {string} email
   */
  async getVerifyUrl(email, options = {}) {
    const requireFresh = options.requireFresh ?? true;
    const raw = await this.fetchVerifyEmail(email);
    const parsed = extractVerifyData(raw);

    if (parsed && parsed.success && parsed.verifyUrl) {
      if (requireFresh && (!parsed.isFresh || parsed.isCodeUsed)) {
        throw new Error(
          `Link verifikasi di inbox adalah link lama (${parsed.ageSeconds}s lalu / sudah terpakai). Menunggu email baru dari ElevenLabs...`
        );
      }
      this.markCodeAsUsed(parsed.oobCode);
      return parsed;
    }
    throw new Error(parsed?.message || `Link verifikasi belum ditemukan untuk ${email}`);
  },

  /**
   * Polling email verifikasi secara periodik
   * Hanya mengembalikan link jika BENAR-BENAR FRESH (< 5 menit) dan bukan link terpakai
   * @param {string} email
   * @param {Object} options
   * @param {number} options.maxAttempts - Maksimal polling (default: 35 -> 105 detik)
   * @param {number} options.intervalMs - Jeda antar polling (default: 3000 ms)
   * @param {number} options.initialDelayMs - Jeda awal sebelum poll pertama (default: 3000 ms)
   * @param {Function} options.onProgress - Callback progress log (message, attempt)
   */
  async pollForVerifyUrl(email, options = {}) {
    const maxAttempts = options.maxAttempts || 35;
    const intervalMs = options.intervalMs || 3000;
    const initialDelayMs = options.initialDelayMs !== undefined ? options.initialDelayMs : 3000;
    const onProgress = options.onProgress || (() => {});

    if (initialDelayMs > 0) {
      onProgress(`Menunggu ${Math.round(initialDelayMs / 1000)}s sebelum mengecek inbox Gmail...`, 0);
      await new Promise((r) => setTimeout(r, initialDelayMs));
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const elapsedSec = Math.round((attempt * intervalMs) / 1000);
        onProgress(`Mengecek inbox via n8n webhook (${attempt}/${maxAttempts} - ${elapsedSec}s)... Biarkan email tetap 'Unread' di Gmail`, attempt);
        const raw = await this.fetchVerifyEmail(email);
        const parsed = extractVerifyData(raw);

        // Hanya terima jika link fresh (< 5 menit) dan belum pernah digunakan!
        if (parsed && parsed.success && parsed.verifyUrl) {
          if (parsed.isFresh && !parsed.isCodeUsed) {
            this.markCodeAsUsed(parsed.oobCode);
            return parsed;
          }
          console.warn(
            `[ElevenLabsVerify] Menolak link lama/terpakai (age: ${parsed.ageSeconds}s, used: ${parsed.isCodeUsed}). Menunggu email baru...`
          );
        }
      } catch (err) {
        console.warn(`[ElevenLabsVerify] Attempt ${attempt} warning:`, err.message);
      }

      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }

    throw new Error(`Email verifikasi baru untuk ${email} belum masuk ke inbox (dicoba ${maxAttempts}x / ${Math.round((maxAttempts * intervalMs) / 1000)}s). Jika email sudah masuk di Gmail, pastikan statusnya 'Belum dibaca' (Unread) atau tempel link verifikasinya secara manual.`);
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
