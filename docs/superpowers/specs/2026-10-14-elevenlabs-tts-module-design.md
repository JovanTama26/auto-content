# Design Spec: ElevenLabs Text-to-Speech (TTS) Automation Module

## Problem Statement
Dalam alur produksi konten otomatis (khususnya alur film dan video pendek), proses konversi naskah narasi menjadi audio voiceover di ElevenLabs membutuhkan konfigurasi parameter yang konsisten:
- Model AI: **Eleven v3**
- Karakter Suara: **Dany Saputra**
- Pengaturan Stability: **Robust (1.0)**
- Naskah: Teks narasi per part/babak
- Output Audio: File `.mp3` yang langsung tersimpan di direktori audio yang digunakan oleh dashboard Electron (`input/alurfilm/audio/`).

Sebelumnya, pengujian fitur ini memerlukan siklus penuh dari pendaftaran akun (auto-signup) yang memakan waktu lama. Dengan adanya persistensi sesi dev (`playwright/user_data/elevenlabs_session.json`), kita dapat langsung masuk ke dashboard Text-to-Speech untuk mengonfigurasi dan men-generate suara secara cepat tanpa perlu mendaftar ulang.

---

## Goals
1. Menyediakan modul mandiri `playwright/actions/elevenlabs/tts.ts` (dan mengekspos fungsi yang bersih) untuk otomasi Text-to-Speech di ElevenLabs.
2. Menerapkan **Smart State-Check** sebelum interaksi: jika Model sudah `Eleven v3` dan Voice sudah `Dany Saputra`, skrip melewati dropdown untuk memangkas waktu eksekusi.
3. Menangani penyesuaian slider Stability ke posisi **Robust (1.0)** demi intonasi narasi yang stabil dan konsisten.
4. Memasukkan teks naskah ke TipTap/ProseMirror editor secara cepat dan andal (mendukung direct text injection / clipboard paste untuk naskah panjang).
5. Memicu tombol **Generate speech**, menangkap event download Playwright, dan menyimpan file `.mp3` langsung ke direktori audio Electron (`input/alurfilm/audio/` atau `input/assets/`).
6. Menyediakan skrip CLI dev `npm run elevenlabs:tts` dengan flag `--text`, `--part`, dan `--headed` untuk kemudahan pengujian mandiri oleh developer.

## Non-Goals
- Tidak mengotomasi pemecahan naskah panjang menjadi potongan kecil (script chunking ditangani di level pipeline atau script parser).
- Tidak memanipulasi pengaturan lanjutan yang tidak relevan (seperti style exaggeration atau speaker boost berlebihan di luar preset Robust).

---

## Architecture & Directory Structure

```
                    ┌──────────────────────────────────────────────┐
                    │ playwright/user_data/elevenlabs_session.json │
                    └──────────────────────┬───────────────────────┘
                                           │ (Sesi Dev Aktif)
                                           ▼
                    ┌──────────────────────────────────────────────┐
                    │   playwright/actions/elevenlabs/tts.ts       │
                    │   generateElevenLabsSpeech(page, options)    │
                    └──────────────────────┬───────────────────────┘
                                           │
       ┌───────────────────────────────────┴──────────────────────────────────┐
       ▼                                                                      ▼
┌───────────────────────────────┐                            ┌───────────────────────────────┐
│ Smart UI Check & Config       │                            │ Input Teks & Generate         │
│ • Model: Eleven v3            │                            │ • Input naskah TipTap         │
│ • Voice: Dany Saputra         │                            │ • Klik "Generate speech"      │
│ • Stability: Robust (1.0)     │                            │ • Tangkap download event      │
└──────────────┬────────────────┘                            └───────────────┬───────────────┘
               │                                                             │
               └──────────────────────────────┬──────────────────────────────┘
                                              ▼
                             ┌───────────────────────────────────┐
                             │ Target Audio Output (Electron):   │
                             │ • input/alurfilm/audio/*.mp3      │
                             │ • input/assets/*.mp3 (opsional)   │
                             └───────────────────────────────────┘
```

---

## API & Interface Specification

```typescript
export interface TTSOptions {
  text: string;                             // Naskah narasi yang akan diucapkan
  voiceName?: string;                       // Default: 'Dany Saputra'
  modelName?: string;                       // Default: 'Eleven v3'
  stability?: 'robust' | number;            // Default: 'robust' (1.0)
  targetCategory?: 'alurfilm' | 'assets';   // Default: 'alurfilm'
  outputDir?: string;                       // Default: input/alurfilm/audio/
  outputFilename?: string;                  // Format: alurfilm_part_XX_<timestamp>.mp3
  partNumber?: number;                      // Nomor part (jika untuk part alurfilm)
  onLog?: (msg: string) => void;            // Log callback
}

export interface TTSResult {
  success: boolean;
  audioPath: string;                        // Path absolut file audio tersimpan
  filename: string;                         // Nama file output
  voice: string;                            // Voice terpilih
  model: string;                            // Model terpilih
  stability: string;                        // Stability terpilih
  characterCount: number;                   // Jumlah karakter naskah
  durationEstimateSeconds?: number;
}
```

---

## Step-by-Step UI Automation Flow

1. **Navigasi & Validasi Sesi**:
   - Buka `https://elevenlabs.io/app/speech-synthesis/text-to-speech`.
   - Pastikan URL tidak dialihkan ke `/sign-in` atau `/login`.
2. **Pembersihan Modal & Popups**:
   - Tutup modal promosi ("What's new in Eleven v3", upgrade modal, onboarding dialog).
   - Netralkan atribut `pointerEvents` pada backdrop overlay jika ada yang menutupi layar.
   - Pastikan tab **Settings** aktif (bukan tab History).
3. **Smart Check & Konfigurasi Model**:
   - Baca label pada `[data-testid="tts-model-selector"]`.
   - Jika belum mengandung `Eleven v3`, klik selector, pilih radio button `Eleven v3`, dan tangani dialog konfirmasi v3 bila muncul.
4. **Smart Check & Konfigurasi Voice**:
   - Baca label pada `[data-testid="tts-voice-selector"]`.
   - Jika belum `Dany Saputra`, klik selector voice, ketik "Dany Saputra" pada input pencarian voice, dan pilih voice tersebut.
5. **Konfigurasi Stability Slider**:
   - Pastikan slider stability diatur maksimal ke posisi 1.0 (Robust).
6. **Input Naskah Narasi**:
   - Fokus ke elemen editor TipTap (`[contenteditable="true"]`, `.tiptap.ProseMirror`).
   - Bersihkan isi editor yang ada sebelumnya.
   - Masukkan teks naskah baru menggunakan injeksi teks langsung atau keyboard typing yang dioptimasi.
7. **Generate & Tangkap Download**:
   - Siapkan promise `page.waitForEvent('download', { timeout: 60000 })`.
   - Klik tombol **"Generate speech"**.
   - Tunggu hingga audio selesai digenerate dan file download terpicu.
   - Simpan audio ke folder `outputDir` (default: `input/alurfilm/audio/`).
   - Verifikasi file audio ada dan berukuran > 0 bytes.

---

## Error Handling & Resilience
- **Overlays / Backdrops**: Modul memitigasi overlay transparan modal v3 dengan menetralkan `pointer-events: none` pada elemen backdrop yang memblokir klik.
- **Selector State Mismatch**: Jika pengecekan teks aria-label gagal dibaca, modul fallback ke eksekusi klik dropdown eksplisit.
- **Download Timeout**: Jika event download tidak terpicu dalam 60 detik (misal ElevenLabs sedang antre render audio), modul akan mencari tombol download manual pada kartu generasi audio terbaru (`Generation X`).
- **Target Folder Creation**: Modul secara otomatis membuat direktori tujuan (`input/alurfilm/audio/` atau `input/assets/`) jika belum ada menggunakan `fs.mkdirSync(..., { recursive: true })`.

---

## Verification & Testing Plan
1. **Unit / Action Test**:
   - Jalankan `npx tsx playwright/actions/elevenlabs/tts.ts` dengan naskah pendek ("Halo, ini adalah pengujian suara Dany Saputra menggunakan model Eleven v3.")
   - Verifikasi bahwa file `.mp3` berhasil masuk ke `input/alurfilm/audio/`.
2. **Dev Runner Script**:
   - Jalankan `npm run elevenlabs:tts -- --text="Pengujian CLI runner" --part=1 --headed`
   - Pastikan browser terbuka dalam mode visual dan menghasilkan file audio di direktori target.
3. **TypeScript Build Verification**:
   - Jalankan `npx tsc --noEmit` untuk memastikan tidak ada type error pada modul baru maupun modul yang mengimpornya.
