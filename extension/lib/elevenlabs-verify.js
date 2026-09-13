// extension/lib/elevenlabs-verify.js
// Client helper untuk ElevenLabs Email Verify API via n8n webhook
// Endpoint: https://n8n.riztama.my.id/webhook/elevenlabs-verify

function extractVerifyData(raw) {
  if (!raw) return null;
  const item = raw.result || raw;
  const verifyUrl = item.verifyUrl || null;
  const oobCode = item.oobCode || null;
  const success = item.success ?? !!verifyUrl;
  const isFresh = item.isFresh ?? true;
  const ageSeconds = item.ageSeconds ?? 0;
  const message = item.message || '';

  return {
    success: !!(success && verifyUrl),
    verifyUrl,
    oobCode,
    isFresh,
    ageSeconds,
    message,
    raw: item,
  };
}

const ElevenLabsVerify = {
  ENDPOINT: 'https://n8n.riztama.my.id/webhook/elevenlabs-verify',

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
   * Eksekusi terisolasi (sekali tembak) untuk mengambil link verifikasi email
   * @param {string} email
   */
  async getVerifyUrl(email) {
    const raw = await this.fetchVerifyEmail(email);
    const parsed = extractVerifyData(raw);
    if (parsed && parsed.success && parsed.verifyUrl) {
      return parsed;
    }
    throw new Error(parsed?.message || `Link verifikasi tidak ditemukan untuk ${email}`);
  },

  /**
   * Polling email verifikasi secara periodik
   * @param {string} email
   * @param {Object} options
   * @param {number} options.maxAttempts - Maksimal polling (default: 15)
   * @param {number} options.intervalMs - Jeda antar polling (default: 3000 ms)
   * @param {number} options.initialDelayMs - Jeda awal sebelum poll pertama (default: 3000 ms)
   * @param {boolean} options.requireFresh - Apakah wajib fresh (default: false agar tidak terblokir jika ageSeconds > 600)
   * @param {Function} options.onProgress - Callback progress log (message, attempt)
   */
  async pollForVerifyUrl(email, options = {}) {
    const maxAttempts = options.maxAttempts || 15;
    const intervalMs = options.intervalMs || 3000;
    const initialDelayMs = options.initialDelayMs !== undefined ? options.initialDelayMs : 3000;
    const requireFresh = options.requireFresh ?? false;
    const onProgress = options.onProgress || (() => {});

    if (initialDelayMs > 0) {
      onProgress(`Menunggu ${Math.round(initialDelayMs / 1000)}s sebelum mengecek inbox...`, 0);
      await new Promise((r) => setTimeout(r, initialDelayMs));
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        onProgress(`Mengecek inbox via n8n webhook (${attempt}/${maxAttempts})...`, attempt);
        const raw = await this.fetchVerifyEmail(email);
        const parsed = extractVerifyData(raw);

        // Jika link verifyUrl ditemukan dan sukses, langsung ambil!
        if (parsed && parsed.success && parsed.verifyUrl) {
          if (!requireFresh || parsed.isFresh || attempt >= 3) {
            return parsed;
          }
          console.warn(`[ElevenLabsVerify] Link ditemukan tapi belum fresh (${parsed.ageSeconds}s), mencoba kembali...`);
        }
      } catch (err) {
        console.warn(`[ElevenLabsVerify] Attempt ${attempt} warning:`, err.message);
      }

      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }

    throw new Error(`Belum menerima link verifikasi untuk ${email} (dicoba ${maxAttempts}x).`);
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
