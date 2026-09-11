# Content Auto - AI Studio Extension Bridge

Pondasi ekstensi browser (Manifest V3) untuk menghubungkan Google AI Studio dengan database Supabase (schema `autocontent`).

## Cara Pasang di Brave / Chrome (20 Detik):

1. Buka browser Brave atau Chrome kamu.
2. Buka tab baru dan ketik alamat:
   ```text
   brave://extensions   (atau chrome://extensions)
   ```
3. Di pojok kanan atas, aktifkan tombol **Developer mode** (Mode pengembang).
4. Klik tombol **Load unpacked** (Muat yang belum dibongkar) di pojok kiri atas.
5. Pilih folder ini:
   ```text
   /home/jovan/project/content-auto/extension
   ```
6. Selesai! Ikon petir **Content Auto** akan langsung muncul di ekstensi browser kamu.

---

## Fitur Pondasi Saat Ini:
1. **Popup Menu Ekstensi**:
   - Memeriksa koneksi langsung ke Supabase (`https://supabase.riztama.my.id`, schema `autocontent`).
   - Menampilkan sesi aktif (`content_sessions`) dan daftar part (`content_parts`).
   - Tombol copy local video path per part.
   - Tombol 1-klik untuk membuka Google AI Studio.
2. **Floating Bridge di Google AI Studio**:
   - Saat kamu membuka `aistudio.google.com`, muncul badge kecil elegan di pojok kanan bawah.
   - Menunjukkan status koneksi ke Supabase, sesi aktif, dan jumlah part pending.
   - Tombol cepat untuk copy prompt part berikutnya.
