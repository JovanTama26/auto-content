// extension/lib/supabase.js
// Lightweight REST client untuk Supabase Schema "autocontent"
// Tidak membutuhkan bundler atau node_modules, langsung berjalan di browser extension.

const SUPABASE_CONFIG = {
  url: 'https://supabase.riztama.my.id',
  key: 'sb_publishable_TuuasLbN1zmVVbD_wmviZ2_pwLKyHYX',
  schema: 'autocontent',
};

const SupabaseBridge = {
  /**
   * Helper request generik ke PostgREST Supabase
   */
  async request(endpoint, options = {}) {
    const url = `${SUPABASE_CONFIG.url}/rest/v1/${endpoint}`;
    const headers = {
      'apikey': SUPABASE_CONFIG.key,
      'Authorization': `Bearer ${SUPABASE_CONFIG.key}`,
      'Accept-Profile': SUPABASE_CONFIG.schema,
      'Content-Profile': SUPABASE_CONFIG.schema,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Supabase Error (${res.status}): ${errText}`);
    }

    // Tangani response kosong jika 204 No Content
    if (res.status === 204) return null;
    return await res.json();
  },

  /**
   * Test koneksi ke schema autocontent
   */
  async testConnection() {
    try {
      const data = await this.request('content_sessions?select=id&limit=1');
      return { success: true, connected: true, data };
    } catch (err) {
      return { success: false, connected: false, error: err.message };
    }
  },

  /**
   * Mengambil daftar session film aktif
   */
  async getSessions(limit = 10) {
    return await this.request(`content_sessions?select=*&order=created_at.desc&limit=${limit}`);
  },

  /**
   * Mengambil video chunks / parts untuk content ID tertentu
   */
  async getParts(contentId) {
    if (!contentId) return [];
    return await this.request(
      `content_parts?content_id=eq.${encodeURIComponent(contentId)}&order=part_number.asc`
    );
  },

  /**
   * Mengambil part yang statusnya masih 'pending' untuk segera dikerjakan AI Studio
   */
  async getPendingParts(contentId) {
    if (!contentId) return [];
    return await this.request(
      `content_parts?content_id=eq.${encodeURIComponent(contentId)}&script_status=eq.pending&order=part_number.asc`
    );
  },

  /**
   * Update status atau hasil script pada suatu part
   */
  async updatePart(partId, updates = {}) {
    return await this.request(`content_parts?id=eq.${encodeURIComponent(partId)}`, {
      method: 'PATCH',
      headers: {
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        ...updates,
        updated_at: new Date().toISOString(),
      }),
    });
  },
};

// Export untuk berbagai environment (window context di extension atau module)
if (typeof window !== 'undefined') {
  window.SupabaseBridge = SupabaseBridge;
  window.SUPABASE_CONFIG = SUPABASE_CONFIG;
}
if (typeof globalThis !== 'undefined') {
  globalThis.SupabaseBridge = SupabaseBridge;
  globalThis.SUPABASE_CONFIG = SUPABASE_CONFIG;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SupabaseBridge, SUPABASE_CONFIG };
}
