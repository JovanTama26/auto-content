// extension/lib/elevenlabs-verify.js
// Client helper untuk ElevenLabs Email Verify API via n8n webhook
// Endpoint: https://n8n.riztama.my.id/webhook/elevenlabs-verify

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
   * Polling email verifikasi secara periodik sampai email fresh ditemukan
   * @param {string} email
   * @param {Object} options
   * @param {number} options.maxAttempts - Maksimal polling (default: 22 / ~90 detik)
   * @param {number} options.intervalMs - Jeda antar polling (default: 4000 ms)
   * @param {number} options.initialDelayMs - Jeda awal sebelum poll pertama (default: 5000 ms)
   * @param {Function} options.onProgress - Callback progress log (message, attempt)
   */
  async pollForVerifyUrl(email, options = {}) {
    const maxAttempts = options.maxAttempts || 22;
    const intervalMs = options.intervalMs || 4000;
    const initialDelayMs = options.initialDelayMs !== undefined ? options.initialDelayMs : 5000;
    const onProgress = options.onProgress || (() => {});

    if (initialDelayMs > 0) {
      onProgress(`Menunggu ${Math.round(initialDelayMs / 1000)}s agar email verifikasi sampai di inbox...`, 0);
      await new Promise((r) => setTimeout(r, initialDelayMs));
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        onProgress(`Mengecek inbox Gmail via n8n (${attempt}/${maxAttempts})...`, attempt);
        const data = await this.fetchVerifyEmail(email);

        if (data && data.success && data.verifyUrl) {
          // Validasi apakah email fresh (< 10 menit / ageSeconds <= 600)
          const isFresh = data.isFresh || (data.ageSeconds !== undefined && data.ageSeconds <= 600);
          if (isFresh) {
            return {
              success: true,
              verifyUrl: data.verifyUrl,
              oobCode: data.oobCode,
              isFresh: true,
              data,
            };
          } else {
            console.warn(`[ElevenLabsVerify] Ditemukan email lama (${data.ageSeconds}s lalu), menunggu email baru...`);
          }
        }
      } catch (err) {
        console.warn(`[ElevenLabsVerify] Attempt ${attempt} warning:`, err.message);
      }

      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }

    throw new Error(`Timeout 90 detik: Belum menerima email verifikasi ElevenLabs untuk ${email}. Coba klik tombol Verifikasi Ulang.`);
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
