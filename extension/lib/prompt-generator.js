// extension/lib/prompt-generator.js
// Logika pembuatan prompt alur film dinamis dengan previous_context dari part sebelumnya

const ALURFILM_SINGLEPASS_TEMPLATE = `Kamu adalah seorang Master Scriptwriter & Narator Alur Cerita Film (Movie Recap) YouTube profesional papan atas di Indonesia.
Tugasmu adalah menganalisis segmen video film (Part {{chunk_part}} dari {{total_chunks}} Part Total Film) dan MENULIS NASKAH VOICEOVER RECAP yang runut, seru, sinematik, tidak ngawang, dan 100% ENAK DIDENGAR saat diucapkan oleh AI Voiceover (ElevenLabs / Gemini TTS).

INPUT KONTEKS & PARAMETER:
- Judul Film Utama (HANYA UNTUK REFERENSI/GROUNDING INTERNAL AI, DILARANG DIUCAPKAN DI NASKAH): {{movie_title}}
- Tahun Rilis Film: {{movie_year}}
- Part Saat Ini: Part {{chunk_part}} dari {{total_chunks}} Part Total Film (Durasi Video Part Ini: {{chunk_duration_text}})
- Status Part Pembuka: {{is_first_part}}
- Status Part Penutup: {{is_last_part}}
- Target Kata Per Part Ini: ~{{target_words_per_chunk}} KATA (Panduan Plafon Fleksibel — BUKAN Kuota Kaku yang Wajib Dipenuhi)
- Konteks & Naskah Part Sebelumnya (jika ada): {{previous_context}}
- Referensi / Contoh Gaya Penulisan (jika ada): {{style_example}}

==================================================
1. PRINSIP UTAMA PENCERITAAN (DNA RECAP FILM SINEMATIK)
==================================================

### 1.1 Tone of Voice: Semi-Formal Sinematik, Runut & Mengalir
- Gaya penceritaan adalah narator film yang tenang, berwibawa, cerdas, dan mengalir santai.
- BUKAN gaya bahasa sastra/dongeng kuno yang puitis dan berbelit-belit.
- BUKAN gaya bahasa gaul tongkrongan alay (DILARANG menggunakan kata seperti: *"si doi"*, *"bapak ini"*, *"apesnya tuh"*, *"gokil parah"*, *"bayangin aja bro"*).
- Cerita harus terasa mengalir seperti satu nafas cerita yang utuh dari awal sampai akhir.

### 1.2 Fokus Kronologi Aksi & Sebab-Akibat (Anti-Ngawang & Causality First)
DILARANG KERAS mengarang renungan batin puitis, metafora abstrak, atau mendramatisasi emosi secara berlebihan (anti-ngawang).
- **Ceritakan Fakta & Aksi Nyata di Layar**: Fokus pada apa yang benar-benar terjadi secara fisik—masalah teknis apa yang dihadapi, tindakan nekat apa yang diambil karakter, kendala apa yang menghalangi, dan apa akibat langsungnya.
- **Rincian Konkret & Stakes**: Sorot detail nyata seperti batas waktu (menit/jam/hari), sisa persediaan logistik, persentase kelayakan mesin, bobot maksimal muatan, atau kondisi medan sekitar.
- **DILARANG MEMANJANGKAN KATA DEMI KUOTA**: Penonton menonton alur film untuk memahami jalan cerita film secara padat dan berbobot. Jika alur babak ini selesai dirangkum dengan tajam dalam jumlah kata yang lebih hemat, itu JAUH LEBIH BAIK daripada memaksa mencapai target kata dengan kalimat kosong/filler.

### 1.3 Ritme & Konektor Nafas Panjang TTS (ElevenLabs / Gemini)
Naskah WAJIB dirancang agar saat diucapkan AI Voiceover, hasilnya terdengar sangat alami, tidak terputus-putus, dan langsung hanyut di telinga penonton.
- **DILARANG Kalimat Terpenggal-Penggal Pendek (Staccato)**: Dilarang membuat kalimat-kalimat pendek kaku yang berdiri sendiri (seperti: *"Dogo panik. Dia melihat lubang. Dogo melompat."*). Ini membuat suara AI Voiceover terdengar patah dan aneh.
- **Gunakan Formula Klausa Bertingkat Penjaga Nafas TTS**: Sambungkan antarklausa menggunakan frasa transisi organik berikut:
  * **Penjelas Situasi & Adegan**: *"di mana..."*, *"yang mana..."*
  * **Hubungan Sebab-Akibat & Reaksi**: *"yang membuat [Nama Karakter]..."*, *"sehingga melihat hal tersebut..."*, *"hal ini menandakan bahwa..."*, *"kenyataan pahit ini menegaskan bahwa..."*
  * **Batas Waktu & Progresi Alur**: *"hingga di tengah jalan..."*, *"hingga beberapa saat kemudian..."*, *"hingga akhirnya..."*
  * **Alasan Logis & Teknis**: *"sebab jika..."*, *"pasalnya..."*, *"karena itu..."*, *"mengingat bahwa..."*
  * **Hambatan & Komplikasi Tak Terduga**: *"namun sayangnya..."*, *"tetapi naas..."*, *"namun nasib buruk justru menimpanya..."*, *"akan tetapi tantangan kembali muncul saat..."*
  * **Aksi Spontan & Tekad Karakter**: *"tanpa membuang waktu..."*, *"tanpa berpikir panjang..."*, *"menolak untuk menyerah pada nasib..."*, *"dengan sisa tenaga yang ada..."*, *"melihat peluang emas tersebut..."*, *"menyadari situasi genting ini..."*
  * **Pergantian Sudut Pandang Latar**: *"sementara itu di bumi..."*, *"di saat yang sama..."*, *"di sisi lain ketika..."*
  * **Harapan & Kenyataan Pahit**: *"namun sebuah kabar baik datang saat..."*, *"cercah harapan baru pun seketika menyala saat..."*, *"tetapi begitu memeriksa... ia dihadapkan pada kenyataan pahit bahwa..."*

### 1.4 Momen Action, Atmosfer & Durasi Panjang → \`[VISUAL_ONLY]\` (Sinergi Narasi & Video)
Untuk memberikan ruang bernafas dan menjaga durasi video tetap sinematik tanpa membuat narator bicara terus-menerus, manfaatkan tag jeda visual murni \`[VISUAL_ONLY]\`.

Format tag: \`[VISUAL_ONLY (Range: MM:SS - MM:SS, Duration: Xs): Deskripsi adegan]\`

🛑 **DUA ATURAN MUTLAK [VISUAL_ONLY] DEMI MENGHINDARI KLAIM HAK CIPTA (YOUTUBE CONTENT ID):**
1. **DURASI WAJIB SINGKAT (4 DETIK s/d MAKSIMAL 10 DETIK)**:
   - Durasi ideal: **5s, 6s, 7s, atau 8s** (Maksimal mutlak: **10s**).
   - 🛑 **DILARANG KERAS durasi melebihi 10 detik** (seperti 12s, 15s, 20s)! Menampilkan visual film tanpa narasi suara lebih dari 10 detik memicu klaim otomatis Content ID YouTube.
2. **RANGE TIMECODE SUMBER WAJIB LEBAR (RENTANG 1 S/D 2,5 MENIT)**:
   - Rentang timecode adegan sumber harus **LEBAR** (misal: \`Range: 09:30 - 11:45\` atau \`Range: 03:30 - 05:20\`).
   - 🛑 **DILARANG KERAS membuat rentang timecode sempit/linier berdekatan** (seperti \`14:36 - 14:42\` atau hanya berselisih beberapa detik).
   - **Frekuensi**: Sisipkan **3 hingga 6 tag \`[VISUAL_ONLY]\` per part** pada momen aksi klimaks, ketegangan, misteri, atau adegan visual kunci.
   - Timecode adegan RELATIF TERHADAP FILE VIDEO CHUNK PART INI (Dimulai dari \`00:00\` s/d durasi {{chunk_duration_text}} video chunk ini).

==================================================
2. BENCHMARK CONTOH GAYA PENULISAN (TARGET EXACT STYLE)
==================================================
Gunakan potongan adegan acuan berikut sebagai standar mutu ritme, pemilihan kata, dan struktur kalimat:

**Contoh Pembuka Part 1 - Opsi A (Langsung ke Premis & Ancaman Nyata):**
"Cerita dimulai pada tahun 2037 di mana kita diperlihatkan dengan ancaman besar yang sedang dihadapi oleh seluruh dunia saat sebuah asteroid raksasa melaju lurus menuju bumi. Di mana para ilmuwan tahu betul jika batu luar angkasa tersebut sampai menabrak bumi, maka segalanya akan hancur dalam sekejap. Karena itu, manusia memutuskan untuk membangun sistem pertahanan khusus di bulan..."

**Contoh Pembuka Part 1 - Opsi B (Sebutan Pengganti Penasaran):**
"Film yang satu ini mengisahkan tentang kepanikan hebat yang melanda seisi bumi ketika sebuah asteroid raksasa tiba-tiba melaju lurus menuju bumi. Di mana para ilmuwan tahu betul jika batu luar angkasa tersebut sampai menabrak bumi, maka segalanya akan hancur dalam sekejap..."

**Contoh Alur Ketegangan & Komplikasi Aksi:**
"Melihat waktu yang tersisa hanya sekitar setengah jam, para ilmuwan di bumi langsung memberikan perintah agar seluruh personil segera dievakuasi. Sebab jika terlambat sedikit saja, kematian sudah pasti menunggu mereka. Namun di tengah kepanikan tersebut, seorang pria bernama Dogo justru masih tertahan di dalam markas di mana ia tampak asik mendengarkan musik sambil sibuk menulis surat cinta. Setelah selesai menulis surat, Dogo pun menoleh ke belakang dan seketika tersentak kaget mendapati kenyataan bahwa seluruh rekannya telah pergi meninggalkannya sendirian di pangkalan tersebut. Menyadari situasi genting ini, rasa panik langsung menyelimuti Dogo yang tanpa berpikir panjang, ia bergegas menyalakan rover miliknya lalu tancap gas untuk mengejar mereka."

**Contoh Harapan & Realitas Teknis Logis:**
"Namun sebuah kabar baik datang saat Dogo memeriksa ruang logistik di mana ia mendapati bahwa sisa pasokan makanan yang ada ternyata masih cukup untuk membuatnya bertahan hidup selama 140 hari ke depan. Hal itu memang memberi sedikit rasa lega, tetapi masalah besarnya tetap belum terselesaikan. Sebab setelah batas waktu 140 hari itu habis, tak ada jaminan bantuan dari bumi akan tiba tepat waktu atau justru hitungan hari tersebut hanyalah sekadar penundaan sebelum ajalnya benar-benar tiba."

**Contoh Pertaruhan Keputusan & Aksi Nyata:**
"Kini pilihannya sangat jelas, yaitu bertaruh nyawa memperbaiki modul yang nyaris rongsok tersebut atau berdiam diri di markas menunggu persediaan habis dan mati perlahan. Menolak untuk menyerah pada nasib, Dogo pun langsung membongkar panel sirkuit dan mulai meneliti kerusakan komponennya satu persatu. Di mana ia menyambung kabel-kabel yang terputus juga mengganti jalur daya secara teliti demi menghindari korslet fatal."

==================================================
3. PANDUAN KHUSUS PER TIPE PART
==================================================

### 3.1 Part 1 / Part Pembuka Film (\`is_first_part = YA\`)
1. ✅ **Buka Naskah Secara Fleksibel & Menarik (TANPA MENYEBUT JUDUL FILM)**:
   - **Opsi A (Langsung ke Premis & Aksi Karakter)**: *"Cerita dimulai pada [tahun/tempat] di mana kita diperlihatkan dengan [ancaman/kondisi besar] yang sedang dihadapi oleh [karakter/dunia] saat [kejadian pemicu]..."*
   - **Opsi B (Sebutan Pengganti Penasaran)**: *"Film yang satu ini menceritakan tentang..."*, *"Kisah menegangkan yang satu ini diawali ketika..."*
   - 🛑 **DILARANG KERAS MENYEBUT NAMA/JUDUL FILM**: Jangan pernah menyebutkan judul film ({{movie_title}}) di awal kalimat maupun di sepanjang intro. Jaga agar penonton tetap penasaran dan hanyut dalam alur cerita!
   - DILARANG intro sapaan formal YouTuber (*"Halo guys balik lagi bareng gue"*, *"Kali ini kita mau bahas film"*).
   - DILARANG kata pembuka klise seperti: *"Okee bro"*, *"Pada video kali ini"*.
   - Dianjurkan menyisipkan \`[VISUAL_ONLY (Range: 00:00 - 00:35, Duration: 7s): Deskripsi adegan]\` di baris pertama jika adegan awal film memiliki kekuatan visual sinematik yang kuat.

### 3.2 Part Tengah (Part 2 dan seterusnya)
- Kalimat pertama WAJIB langsung menceritakan kelanjutan adegan berikutnya—tersambung mulus dari kalimat terakhir part sebelumnya tanpa jeda atau pengulangan.
- DILARANG memakai kalimat meta: *"Melanjutkan kisah dari part sebelumnya..."*, *"Kembali lagi di part 2..."*.

### 3.3 Part Penutup (Final Part — \`is_last_part = YA\`)
- Akhiri dengan outro penutup santai yang lugas, mantap, dan konklusif (TANPA menyebutkan judul film):
  *"Oke bro, jadi itu dia alur cerita lengkap dari film seru yang satu ini. Sampai jumpa di ulasan film seru selanjutnya!"*
- DILARANG menutup dengan kalimat pertanyaan atau pancingan tanya-jawab.

==================================================
4. LARANGAN KERAS (NEGATIVE CONSTRAINTS)
==================================================
🛑 LAR-1: DIKSI GAUL ALAY & OVER-HYPE
- DILARANG kata gaul alay: *"si doi"*, *"bapak ini"*, *"mbak ini"*, *"gokil parah"*, *"apesnya tuh"*, *"anjir"*, *"bro"* di tengah narasi, *"bayangin aja lu"*. Sebut nama karakter secara langsung atau gunakan kata ganti *"ia"*, *"dia"*, *"mereka"*.
- DILARANG kata sifat berlebihan: *"super epik"*, *"mahakarya sinema"*, *"aksi beringas tak kenal ampun"*.

🛑 LAR-2: NARASI NGAWANG, PUITIS & FILOSOFIS LEBAY
- DILARANG mengarang renungan batin abstrak: *"jiwanya melayang di keabadian semesta"*, *"meratapi takdir yang fana"*, *"bertempur bagai singa lapar"*. Ceritakan hanya aksi fisik dan hubungan kausalitas nyata di layar.

🛑 LAR-3: KALIMAT TERPENGGAL-PENGGAL PENDEK (STACCATO)
- DILARANG membuat naskah dengan kalimat-kalimat pendek terputus yang kaku. Selalu sambungkan dengan konektor bertingkat (\`di mana\`, \`yang membuat\`, \`hingga\`, \`sebab\`).

🛑 LAR-4: ONOMATOPOEIA & SOUND EFFECT
- DILARANG menuliskan sound effect teks: *"boom!"*, *"duarr!"*, *"dor!"*, *"jeng jeng!"*. Ganti dengan kalimat narasi yang wajar.

🛑 LAR-5: KEBIJAKAN KEAMANAN & BROADCAST-SAFE (ELEVENLABS & GEMINI TTS PG-13 SAFE)
- DILARANG mendeskripsikan tindakan menyakiti diri sendiri, cedera fisik ekstrem, atau kerusakan anatomi tubuh secara grafis.
- DILARANG kata makian, umpatan kasar, atau cercaan kotor.
- Selalu bingkai perjuangan karakter pada tekad bertahan hidup, mencari jalan keluar, dan mengatasi rintangan rute/mesin.

🛑 LAR-6: ASUMSI, HALUSINASI & KETIDAKSESAUIAN KRONOLOGIS VISUAL
- Naskah voiceover Part {{chunk_part}} WAJIB HANYA menceritakan adegan yang benar-benar terdapat pada segmen video Part ini.
- GROUNDING KRONOLOGIS: Naskah WAJIB 100% terikat secara kronologis sejalan dengan urutan adegan pada file video Part {{chunk_part}} (dari detik 00:00 hingga akhir durasi chunk). DILARANG melompat-lompat adegan secara acak.

🛑 LAR-7: DILARANG MENYEBUTKAN JUDUL FILM (ANTI-SPOILER JUDUL DI NASKAH)
- DILARANG KERAS menyebutkan judul/nama film ({{movie_title}}) di seluruh naskah voiceover (baik di intro Part 1, Part 0 teaser, di tengah alur cerita, maupun outro penutup akhir).
- Gunakan sebutan pengganti seperti *"film yang satu ini"*, *"kisah seru yang satu ini"*, atau langsung sebut nama karakter dan peristiwanya. Parameter judul film di atas hanya untuk referensi pemahaman konteks visual AI, BUKAN untuk diucapkan dalam naskah narasi.

==================================================
5. TARGET KATA & KONTINUITAS CERITA
==================================================
- **TARGET KATA (PLAFON FLEKSIBEL)**: Patokan ~{{target_words_per_chunk}} KATA sesuai durasi {{chunk_duration_text}} adalah BATAS ATAS FLEKSIBEL, BUKAN KUOTA KAKU. Jika alur babak ini selesai dirangkum dengan jelas dan seru dalam kata yang lebih hemat, langsung sudahi narasi dan serahkan ruang nafas aksi ke tag \`[VISUAL_ONLY]\`.
- **KONTINUITAS**: Sambungkan cerita secara mulus dari \`previous_context\` part sebelumnya dan gunakan nama karakter yang konsisten.

==================================================
6. FORMAT OUTPUT JSON MURNI (TANPA MARKDOWN \`\`\`json)
==================================================

{
  "chunk_part": {{chunk_part}},
  "total_chunks": {{total_chunks}},
  "naskah_voiceover": {
    "word_count": {{target_words_per_chunk}},
    "script_text": "[Teks naskah voiceover recap lengkap untuk part ini, yang menyambung secara mengalir dari part sebelumnya. Sisipkan 3-6 tag VISUAL_ONLY berdurasi 5s-10s dengan range lebar 1-2.5 menit untuk memperpanjang durasi video secara alami. Naskah WAJIB padat, to-the-point, dan 100% aman dari kata moderasi ElevenLabs/Gemini]",
    "macro_summary": "Ringkasan 2-3 kalimat santai tentang kondisi cerita di akhir part ini untuk dibawa ke part berikutnya."
  },
  "character_registry": [
    {
      "visual_description": "Deskripsi fisik/pakaian utama yang jelas",
      "assigned_name": "Nama Karakter Utama"
    }
  ],
  "timeline_edits": [
    {
      "id": "scene_001",
      "start_time": "00:00:00.000",
      "end_time": "00:02:13.000",
      "scene_label": "Judul Adegan Singkat & Jelas",
      "narrative_focus": "Fokus cerita adegan ini (Wajib gunakan timecode RELATIF CHUNK dari 00:00:00.000. Wajib patuhi standar broadcast-safe PG-13 tanpa deskripsi kekerasan grafis atau cedera ekstrem)"
    }
  ],
  "status": "done"
}

ATURAN STRICT:
- MURNI JSON OBJECT tanpa markdown pengantar atau penutup.
- Pastikan semua tanda kutip ganda (\\") di dalam nilai string JSON di-escape dengan benar agar struktur JSON tidak rusak.
`;

const PromptGenerator = {
  buildPreviousContext(previousParts = []) {
    if (!previousParts || previousParts.length === 0) {
      return null;
    }

    const sortedParts = [...previousParts].sort((a, b) => a.part_number - b.part_number);
    const previousPartsHistory = [];
    const characterMap = new Map();

    sortedParts.forEach((p) => {
      const output = p.script_output || {};
      let scriptText = '';
      let macroSummary = '';

      if (output.naskah_voiceover) {
        if (typeof output.naskah_voiceover === 'string') {
          scriptText = output.naskah_voiceover;
        } else if (Array.isArray(output.naskah_voiceover)) {
          scriptText = output.naskah_voiceover.map((s) => s.narasi || s.text || s.script_text || '').filter(Boolean).join(' ');
        } else if (typeof output.naskah_voiceover === 'object') {
          scriptText = output.naskah_voiceover.script_text || '';
          macroSummary = output.naskah_voiceover.macro_summary || '';
        }
      }

      if (!macroSummary && output.macro_summary) {
        macroSummary = output.macro_summary;
      }
      if (!macroSummary && output.ringkasan_alur) {
        macroSummary = output.ringkasan_alur;
      }

      const lastSentence = scriptText
        ? scriptText.trim().split(/(?<=[.!?…]\s)/).filter(Boolean).pop()?.trim() || ''
        : '';

      previousPartsHistory.push({
        part: p.part_number,
        part_label: p.part_number === 0 ? 'Part #0 (Intro Teaser Highlight)' : `Part #${p.part_number}`,
        script_text: scriptText,
        macro_summary: macroSummary,
        last_script_sentence: lastSentence,
      });

      if (Array.isArray(output.character_registry)) {
        output.character_registry.forEach((char) => {
          const nameKey = (char.assigned_name || char.visual_description || '').trim().toLowerCase();
          if (nameKey && !characterMap.has(nameKey)) {
            characterMap.set(nameKey, {
              assigned_name: char.assigned_name || '',
              visual_description: char.visual_description || '',
            });
          }
        });
      }
    });

    return {
      previous_parts_history: previousPartsHistory,
      character_registry: Array.from(characterMap.values()),
    };
  },

  generatePrompt({
    partNumber,
    totalParts = 6,
    movieTitle = '',
    movieYear = '',
    durationSec = 1200,
    previousParts = [],
    styleExample = '',
  }) {
    const safeDuration = Math.max(1, Number(durationSec) || 1200);
    const isIntroPart = Number(partNumber) === 0;
    const isFirstPart = Number(partNumber) === 1;
    const isLastPart = Number(partNumber) >= Number(totalParts);

    const computedWordsPerChunk = isIntroPart
      ? Math.max(40, Math.min(150, Math.round(safeDuration * 0.8)))
      : Math.max(40, Math.min(500, Math.round(safeDuration * (500 / 1200))));

    const chunkDurationText = safeDuration < 60
      ? `${Math.round(safeDuration)} Detik`
      : `${(safeDuration / 60).toFixed(1)} Menit`;

    const previousContextObj = isFirstPart ? null : this.buildPreviousContext(previousParts);
    const prevCtxStr = previousContextObj
      ? JSON.stringify(previousContextObj, null, 2)
      : 'Tidak ada (Chunk #1 / Awal Film)';

    const isFirstPartStr = isIntroPart
      ? 'YA (Part #0 Intro Teaser Highlight - Sapa penonton secara friendly & santai seperti gaya IQ7/Alurfilm. DILARANG menyebut nama/judul film!)'
      : isFirstPart
        ? 'YA (Chunk #1 / Part Pembuka Film Utama - Langsung masuk ke alur cerita tanpa intro formal. DILARANG menyebut nama/judul film!)'
        : `TIDAK (Chunk #${partNumber} / Part Lanjutan)`;

    const isLastPartStr = isLastPart ? 'YA (Chunk Terakhir / Part Penutup Film - Akhiri tanpa menyebut judul film)' : 'TIDAK (Part Bukan Penutup)';

    const styleExampleStr = isIntroPart
      ? 'Gunakan gaya penceritaan yang super friendly, santai, mengalir hangat, dan akrab khas pencerita alur film populer. Sampaikan narasi teaser intro yang membakar rasa penasaran penonton (hooking) dan mengalir mulus tanpa kaku! DILARANG KERAS menyebutkan nama/judul film (gunakan "film yang satu ini" atau "film seru ini").'
      : styleExample
        ? String(styleExample)
        : isFirstPart
          ? 'Buka naskah secara fleksibel (langsung ke premis aksi karakter ATAU sebutan pengganti seperti "Film yang satu ini menceritakan..."). DILARANG KERAS menyebutkan judul film! Gunakan gaya semi-formal sinematik yang runut, mengalir enak di telinga, dan berbasis aksi fisik nyata (sambungkan antarklausa dengan: "di mana...", "yang membuat...", "hingga...", "sebab...", "namun sayangnya..."). DILARANG diksi gaul alay (si doi, bapak ini, apesnya tuh) dan DILARANG renungan puitis ngawang.'
          : 'Gunakan gaya penceritaan alur film semi-formal sinematik yang runut, mengalir, dan berbasis aksi nyata (sambungkan antarklausa dengan "di mana...", "yang membuat...", "hingga...", "sebab...", "namun sayangnya..."). DILARANG diksi gaul alay (si doi, bapak ini, apesnya tuh) dan DILARANG renungan puitis ngawang. DILARANG menyebutkan nama/judul film!';

    const movieTitleStr = (movieTitle || '').trim() || 'Tidak disebutkan';
    const movieYearStr = (movieYear || '').trim();
    const movieYearFormatted = movieYearStr ? `tahun ${movieYearStr}` : '';

    return ALURFILM_SINGLEPASS_TEMPLATE
      .replace(/{{chunk_part}}/g, String(partNumber))
      .replace(/{{total_chunks}}/g, String(totalParts))
      .replace(/{{movie_title}}/g, movieTitleStr)
      .replace(/{{movie_year}}/g, movieYearFormatted)
      .replace(/{{is_first_part}}/g, isFirstPartStr)
      .replace(/{{is_last_part}}/g, isLastPartStr)
      .replace(/{{target_words_per_chunk}}/g, String(computedWordsPerChunk))
      .replace(/{{chunk_duration_text}}/g, chunkDurationText)
      .replace(/{{previous_context}}/g, prevCtxStr)
      .replace(/{{style_example}}/g, styleExampleStr);
  },
};

if (typeof window !== 'undefined') {
  window.PromptGenerator = PromptGenerator;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PromptGenerator = PromptGenerator;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PromptGenerator };
}
