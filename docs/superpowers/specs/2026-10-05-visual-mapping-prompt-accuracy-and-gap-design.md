# Design Spec: Pengetatan Akurasi Visual Klip vs Transkrip & Aturan Sampling Gap Anti-Hak Cipta (Content ID)

**Date:** 2026-10-05  
**Status:** Approved for Implementation  
**Topic:** Visual Mapping Prompt Optimization (`alurfilm-mapping-prompt.md`)  

---

## 📌 Executive Summary

Dalam pipeline pembuatan video Alur Cerita Film (Movie Recap), tahap **Visual Mapping** bertugas mencocokkan setiap kalimat transkrip Voice Over (VO) dan segmen jeda aksi (`visual_only`) ke timecode potongan video sumber (`source_start_seconds`).

Dua masalah kritis yang terjadi pada prompt sebelumnya:
1. **Ketidakakuratan & Klip Melebar (Lack of Transcript Grounding)**: AI sering menafsirkan kebebasan memilih klip secara liar sehingga mengambil potongan video dari babak cerita lain yang tidak relevan, atau sekadar memilih klip yang "secara metaforis/simbolis menggambarkan suasana" alih-alih menampilkan peristiwa nyata yang sedang diceritakan dalam transkrip.
2. **Risiko Klaim Hak Cipta (YouTube Content ID)**: Pengambilan potongan video tanpa jeda (*gap*) yang cukup (misalnya potongan video mentah yang berurutan/berdempetan atau continuous stream) menyebabkan algoritma sidik jari YouTube mendeteksi kecocokan video dan memicu *copyright claim*.

Dokumen ini mendefinisikan perubahan klausul pada [alurfilm-mapping-prompt.md](file:///home/jovan/project/content-auto/dashboard/prompts/longform/alurfilm-mapping-prompt.md) untuk memastikan **akurasi literal transkrip** dan **keamanan mutlak dari deteksi Content ID**.

---

## 🎯 Requirements & Key Decisions

### 1. Transkrip Adalah Acuan Mutlak Peristiwa Nyata (Strict Event Accuracy)
* **Klip Wajib Menampilkan Kejadian Nyata di Transkrip**: Jika narator berucap *"Polisi mendobrak pintu gudang"*, visual wajib klip polisi mendobrak pintu gudang di adegan tersebut.
* **Dilarang Visual "Asal Menggambarkan / Metaforis"**: Dilarang keras memilih klip yang hanya secara abstrak/simbolis mirip (misal: mengambil tokoh menatap sedih di awal film untuk menggambarkan kesedihan di akhir film).
* **Bounded Freedom (Kebebasan Terikat Rentang Adegan)**: Kebebasan memilih variasi sudut kamera, ekspresi wajah, reaksi lawan bicara, dan insert shot HANYA diizinkan di dalam batas rentang adegan yang sedang diceritakan.
* **Hard Scene Lock (Anti-Melebar Lintas Babak)**: Dilarang mengambil frame sebelum adegan dimulai atau melompat ke adegan setelahnya sebelum narator benar-benar mengantarkan cerita ke lokasi/babak tersebut.

### 2. Aturan Sampling Gap Anti-Hak Cipta (Anti-Content ID Bypass)
* **Segmen `visual_only`**:
  * Tipe visual: 100% `video_cut` (kecepatan normal 1.0x).
  * Durasi klip: Maksimal **2.0 detik** per klip.
  * **Sampling Gap Wajib**: Setiap klip wajib melompat maju berjarak **+3.0s s/d +6.0s** di video sumber. Dilarang keras mengambil klip berurutan yang saling menempel (contoh salah: 10.0s-12.0s lalu 12.0s-14.0s).
* **Segmen `narration`**:
  * Durasi raw footage mentah per klip dibatasi maksimal **1.0s s/d 2.0s**.
  * **Anti-Contiguous Raw Sampling**: Ketika mendaur ulang shot di adegan yang sama, dilarang mengambil frame mentah yang bersebelahan langsung tanpa jeda sampling (*gap*).
  * **Wajib Transformasi Visual**: Setiap klip wajib diubah karakternya menggunakan **Ultra Slow-Motion (0.20x - 0.35x)** atau **Mirror Cut (`horizontal`)** serta pergeseran sudut framing (*angle jump*) agar sidik jari temporal & spasial YouTube terpecah total.

---

## 🏛️ Changes in Target File

### Target: `dashboard/prompts/longform/alurfilm-mapping-prompt.md`

1. **Bagian 1: HUKUM MUTLAK KONTINUITAS ADEGAN & AKURASI TRANSKRIP**:
   - Menambahkan pasal: **TRANSKRIP ADALAH ACUAN MUTLAK PERISTIWA NYATA**.
   - Melarang klip "yang penting menggambarkan". Klip wajib adegan asli yang terjadi di film sesuai kronologi transkrip.
   - Menegaskan bahwa kebebasan non-linier hunting klip HANYA berlaku di dalam babak adegan tersebut, dilarang melebar ke segmen lain.

2. **Bagian 2: FORMULA FAIR USE & CONTENT ID BYPASS (MANDATORY SAMPLING GAP)**:
   - Menambahkan aturan eksplisit tentang **Gap Pengambilan Klip (Sampling Gap)**:
     - Dilarang mengambil potongan video mentah yang berurutan/berdekatan tanpa jeda.
     - Jarak gap minimal sampling antar klip mentah untuk memutus deteksi continuous stream.
     - Penegasan aturan gap baik pada segmen `narration` maupun `visual_only`.

3. **Bagian 3: ATURAN STRICT DI OUTPUT JSON**:
   - Menambahkan poin verifikasi: memastikan setiap klip memiliki sampling gap yang aman dan akurasi 100% terhadap teks transkrip.

---

## 🧪 Verification & Acceptance Criteria

1. **Konsistensi Prompt**:
   - Teks prompt jelas, tegas, dan tidak memiliki kontradiksi antara kebebasan kreatif (*creative hunting*) dengan batas adegan (*scene lock*).
2. **Kesesuaian dengan Parser**:
   - Struktur JSON yang diharapkan tetap kompatibel 100% dengan `AlurfilmMappingStep.tsx` dan backend render FFmpeg.
