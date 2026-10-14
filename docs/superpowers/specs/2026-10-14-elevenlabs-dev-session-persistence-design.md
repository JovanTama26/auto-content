# Design Spec: ElevenLabs Dev Session Persistence & Direct Dashboard Runner

## Problem Statement
Saat mengembangkan fitur otomasi ElevenLabs (seperti konfigurasi TTS, pemilihan model AI Eleven v3, pemilihan voice Dany Saputra, pengaturan stability, hingga download audio), menjalankan seluruh alur dari `auto-signup` (mendaftarkan email baru, menyelesaikan puzzle hCaptcha, dan mengekstrak email konfirmasi di Gmail) membutuhkan waktu 60-120 detik per iterasi.

Untuk mempercepat siklus development modul TTS dan modul lainnya, diperlukan mekanisme penyimpanan sesi login aktif (*session persistence*) ke file storage state dan script runner dev yang langsung membuka halaman Text-to-Speech ElevenLabs menggunakan sesi tersimpan tanpa perlu mendaftar ulang.

## Goals
1. Menyediakan modul penyimpanan sesi ElevenLabs (`saveElevenLabsSession`) yang mengekspor cookies dan localStorage ke file JSON (`elevenlabs_session.json`).
2. Mengintegrasikan penyimpanan sesi otomatis ke dalam `auto-signup`, sehingga akun baru yang berhasil mencapai dashboard langsung tersimpan sesinya.
3. Menyediakan runner dev (`playwright/dev-elevenlabs-session.ts` / `npm run elevenlabs:dev`) yang langsung membuka browser dengan profil sesi aktif dan menavigasi ke `https://elevenlabs.io/app/speech-synthesis/text-to-speech`.
4. Memvalidasi status sesi (apakah login aktif atau kedaluwarsa) dan memberikan log diagnostik yang jelas.
5. Menyiapkan fondasi untuk modul Text-to-Speech (konfigurasi Model AI, Voice, Stability, dan input naskah).

## Non-Goals
- Menggantikan alur produksi multi-akun auto-signup. Ini adalah utilitas akselerasi development lokal.
- Mengotori git repository dengan file kredensial/sesi (`elevenlabs_session.json` harus berada di direktori `playwright/user_data/` yang sudah diabaikan di `.gitignore`).

## Architecture & Components

```
                    ┌────────────────────────────┐
                    │ npm run elevenlabs:signup  │
                    └─────────────┬──────────────┘
                                  │ (Saat sukses di Dashboard)
                                  ▼
                    ┌────────────────────────────┐
                    │  saveElevenLabsSession()   │
                    └─────────────┬──────────────┘
                                  │
                                  ▼
            ┌──────────────────────────────────────────────┐
            │ playwright/user_data/elevenlabs_session.json │
            └─────────────────────┬────────────────────────┘
                                  │
                                  │ (Digunakan untuk dev)
                                  ▼
                    ┌────────────────────────────┐
                    │   npm run elevenlabs:dev   │
                    └─────────────┬──────────────┘
                                  │
                                  ▼
      Direct Navigation: https://elevenlabs.io/app/speech-synthesis/text-to-speech
                                  │
                                  ▼
      Kesiapan Modul TTS: Konfigurasi Model v3 -> Voice -> Stability
```

### 1. `playwright/actions/elevenlabs/session.ts`
- **`SESSION_FILE_PATH`**: `playwright/user_data/elevenlabs_session.json`.
- **`saveElevenLabsSession(context: BrowserContext, filePath?: string): Promise<string>`**:
  Mengekstrak storage state browser aktif via `await context.storageState({ path: targetPath })` dan menyimpannya.
- **`isElevenLabsSessionActive(page: Page): Promise<boolean>`**:
  Mengecek URL tab dan elemen DOM untuk memastikan pengguna tidak diarahkan ke rute login (`/sign-in`, `/sign-up`, `/login`, dll.) dan berada di lingkungan `/app`.

### 2. Integrasi ke `playwright/actions/elevenlabs/auto-signup.ts`
- Di akhir eksekusi yang berstatus `SUCCESS` (Langkah 6), panggil `saveElevenLabsSession(context)` secara otomatis.

### 3. Runner Dev `playwright/dev-elevenlabs-session.ts`
- Menginisialisasi browser via `launchBrowser({ profileName: 'user_1', headed: true, storageStatePath: SESSION_FILE_PATH })`.
- Membuka halaman `https://elevenlabs.io/app/speech-synthesis/text-to-speech`.
- Menutup dialog/modal tutorial ElevenLabs jika muncul.
- Memeriksa apakah sesi terautentikasi:
  - Jika aktif: Menampilkan status sukses sesi aktif dan menjaga browser tetap terbuka atau siap dihubungkan ke pipeline konfigurasi TTS.
  - Jika tidak aktif: Menampilkan instruksi untuk menjalankan `npm run elevenlabs:signup`.

### 4. NPM Script di `package.json`
- `"elevenlabs:dev"`: `npx tsx playwright/dev-elevenlabs-session.ts`
- `"elevenlabs:save-session"`: `npx tsx playwright/dev-elevenlabs-session.ts --save-current`

## Verification & Testing
1. Uji penangkapan sesi saat ini dari profile `user_1` ke `elevenlabs_session.json`.
2. Uji peluncuran browser dengan `npm run elevenlabs:dev` dan verifikasi bahwa halaman langsung mendarat di Dashboard Text-to-Speech dalam keadaan terautentikasi.
3. Jalankan `npx tsc --noEmit` untuk memastikan tidak ada kesalahan TypeScript.
