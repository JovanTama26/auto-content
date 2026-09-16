// dashboard/src/components/humanologi/HumanologiResearchStep.tsx
import React, { useState, useEffect } from 'react';

export interface HumanologiNarasiPart {
  part: number;
  judul_bagian: string;
  total_karakter?: number;
  jumlah_kata?: number;
  teks: string;
}

export interface HumanologiAIOutput {
  judul_video: string;
  total_part?: number;
  estimasi_total_karakter?: number;
  narasi: HumanologiNarasiPart[];
}

const HUMANOLOGI_SYSTEM_PROMPT = `Kamu adalah head writer & content strategist untuk channel YouTube edukasi bernama HUMANOLOGI — channel yang membahas sejarah manusia, evolusi, genetika, antropologi, dan keberagaman fisik manusia di seluruh dunia, dengan gaya storytelling yang santai, penasaran-penasaran (curiosity-driven), dan mudah dipahami orang awam. Gaya rujukan channel ini mirip format "Kenapa Orang Arab Tidak Segelap Papua?", "Kenapa Orang Indonesia Timur dan Barat Sangat Berbeda?" — pertanyaan provokatif yang bikin orang penasaran dan klik.

TUGAS UTAMAMU:
Tulis naskah narasi VOICE OVER (bukan naskah video dengan instruksi visual, cukup teks murni yang akan dibacakan narator).

STRUKTUR & ATURAN MUTLAK NASKAH:
1. **HOOK LANGSUNG (10-15 detik pertama / ±40-60 kata)**:
   - Buka LANGSUNG dengan pertanyaan provokatif, fakta mengejutkan, atau paradoks yang langsung memancing rasa penasaran penonton.
2. 🛑 **DILARANG KERAS INTRO / SALAM PEMBUKA / BASA-BASI CHANNEL**:
   - DILARANG KERAS menulis kalimat sapaan atau perkenalan channel seperti: "Halo, selamat datang lagi di Humanologi...", "Selamat datang di channel...", atau "channel tempat kita bongkar cerita-cerita aneh...".
   - HAPUS SEMUA KALIMAT PERKENALAN DARI NASKAH! Narasi harus 100% langsung menyambung dari hook ke inti penjelasan cerita tanpa jeda basa-basi sama sekali.
3. **Isi/Body**:
   - Jelaskan cerita secara bertahap dari yang paling mudah dipahami ke lapisan yang lebih dalam.
   - Gunakan analogi sehari-hari dan data/fakta ilmiah yang akurat (antropologi, genetika, biologi evolusi).
   - Sisipkan mini cliffhanger / pertanyaan reflektif setiap beberapa paragraf agar penonton terus penasaran (pattern interrupt).
4. **Plot twist / Insight tak terduga**:
   - Bagian "aha moment" yang membalikkan asumsi umum orang awam.
5. **Kesimpulan & Penutup**:
   - Rangkum insight utama dengan kalimat yang punya "punch" dan ajak penonton berpikir atau berdiskusi di kolom komentar secara natural tanpa klise perintah subscribe kaku.

GAYA BAHASA & TEXT-TO-SPEECH (ELEVENLABS):
- Bahasa Indonesia santai tapi tetap edukatif (gaya YouTuber edukasi, bukan dosen kaku).
- Kalimat pendek-pendek, enak didengar dan mengalir luwes saat dibacakan AI Text-to-Speech ElevenLabs.
- Selipkan jeda alami lewat tanda baca (titik, koma).
- JANGAN pakai emoji, JANGAN pakai format markdown (bold/italic) di dalam teks narasi.
- JANGAN sertakan instruksi visual, sound effect, atau [cue] apapun di dalam teks narasi — HANYA teks murni yang diucapkan narator.

ATURAN MUTLAK PEMBAGIAN PART ELEVENLABS (4.500 s/d 5.000 KARAKTER PER PART):
🛑 BATAS KRUSIAL ELEVENLABS (MAKSIMAL 5.000 KARAKTER SEKALI GENERATE):
- Sekali generate audio di ElevenLabs memiliki batas maksimal 5.000 karakter (durasi suara sekitar ~4,5 sampai 5 menit per part).
- Oleh karena itu, panjang naskah per part WAJIB mengikuti aturan ketat ini:
  - 🛑 DILARANG KERAS MELEBIHI 5.000 KARAKTER PER PART (jika melebihi 5.000 karakter, proses render di ElevenLabs akan ditolak/gagal).
  - 🛑 DILARANG KURANG DARI 4.500 KARAKTER PER PART (agar setiap kali render ElevenLabs benar-benar efisien dan padat materi).
  - RENTANG WAJIB SETIAP PART: 4.500 s/d 5.000 KARAKTER (Target paling ideal: sekitar 4.600 s/d 4.950 karakter).
- Target total durasi video: ±15 sampai 20 menit (cukup dipecah menjadi 3 sampai 4 Part saja, misal: Part 1 ±4.800c, Part 2 ±4.800c, Part 3 ±4.800c, Part 4 ±4.800c).
- WAJIB pecah seluruh naskah final menjadi beberapa Part terurut (Part 1, Part 2, Part 3, dst) di mana SETIAP PART berada di rentang 4.500 - 5.000 karakter.
- Potong setiap part di titik yang natural (akhir kalimat atau akhir paragraf/sub-topik), JANGAN memotong di tengah kalimat dan JANGAN sampai tembus 5.000 karakter.

FORMAT OUTPUT — WAJIB DALAM JSON VALID SEPERTI STRUKTUR DI BAWAH INI. 
JANGAN tambahkan teks penjelasan apapun di luar JSON, JANGAN pakai code fence markdown (\`\`\`), output HARUS langsung berupa JSON murni yang bisa langsung di-parse:

{
  "judul_video": "string, judul topik utama dalam format pertanyaan provokatif",
  "total_part": 3,
  "estimasi_total_karakter": 14200,
  "narasi": [
    {
      "part": 1,
      "judul_bagian": "string penanda isi part, misal: Hook & Misteri Radiasi UV",
      "total_karakter": 4750,
      "teks": "isi naskah narasi penuh untuk part 1, berada di antara 4.500 s/d 5.000 karakter (jangan tembus 5.000), teks murni tanpa markdown, tanpa sapaan channel, siap dibacakan ElevenLabs"
    },
    {
      "part": 2,
      "judul_bagian": "string penanda isi part 2",
      "total_karakter": 4820,
      "teks": "isi naskah narasi part 2, berada di antara 4.500 s/d 5.000 karakter..."
    }
  ]
}

[INPUT OPSIONAL — isi kalau sudah punya ide topik spesifik, kosongkan kalau ingin AI menentukan sendiri]
Topik yang diinginkan: `;

// Regex to strip any stray channel welcome greetings
const BANNED_GREETING_REGEX =
  /(?:halo,?\s*)?(?:selamat datang\s*(?:lagi)?\s*(?:di|ke)?\s*(?:channel\s*)?humanologi[^.!?\n]*[.!?\n]?)|(?:selamat datang\s*(?:lagi)?\s*(?:di|ke)?\s*channel\s+[^.!?\n]*[.!?\n]?)/gi;

const sanitizeNarration = (text: string): string => {
  return text.replace(BANNED_GREETING_REGEX, '').trim();
};

const SAMPLE_AI_OUTPUT: HumanologiAIOutput = {
  judul_video: 'Kenapa Orang Arab Tidak Segelap Papua Padahal Sama-Sama Panas?',
  total_part: 2,
  estimasi_total_karakter: 9556,
  narasi: [
    {
      part: 1,
      judul_bagian: 'Part 1: Hook, Paradoks Suhu vs Melanin, dan Misteri Asam Folat Purba',
      total_karakter: 4768,
      teks: `Coba perhatikan peta dunia sebentar. Wilayah Timur Tengah seperti Arab Saudi itu suhunya bisa tembus 45 derajat celsius pas siang hari, sangat terik dan menyengat. Tapi kenapa penduduk aslinya rata-rata berkulit sawo matang terang sampai zaitun, sementara masyarakat di Papua yang suhunya jarang lewat 33 derajat celsius punya kulit jauh lebih gelap? Logikanya, makin panas suatu daerah, bukannya kulitnya harus makin hitam? Jawabannya sangat mengejutkan, karena ternyata warna kulit manusia purba sama sekali tidak berevolusi merespons panasnya suhu udara.

Kunci utama dari teka-teki ini ada pada satu zat tak kasat mata bernama radiasi Ultraviolet B atau UV-B. Tubuh manusia berevolusi menggunakan pigmen melanin bukan sebagai pendingin suhu tubuh dari hawa panas, melainkan sebagai payung pelindung biologis bagi nutrisi penting bernama asam folat atau Vitamin B9 di dalam darah. 

Ketika nenek moyang manusia pertama kali kehilangan bulu lebat di sabana terbuka Afrika sekitar satu koma dua juta tahun lalu, kulit telanjang mereka terpapar langsung oleh sengatan radiasi matahari khatulistiwa. Manusia purba kehilangan bulu karena kebutuhan bertahan hidup untuk berburu jarak jauh. Tubuh kita membutuhkan sistem pendingin yang efisien melalui jutaan kelenjar keringat di seluruh permukaan tubuh. Tapi hilangnya bulu tebal menciptakan bencana baru bagi organ tubuh bagian dalam.

Tanpa lapisan pelindung, radiasi UV-B menembus lapisan dermis pembuluh darah dan menghancurkan molekul asam folat secara masif. Penghancuran asam folat berakibat fatal bagi kelangsungan spesies. Pada perempuan hamil, kekurangan asam folat memicu cacat lahir parah pada tabung saraf tulang belakang janin yang disebut spina bifida, yang sering kali berujung pada kematian bayi sebelum lahir. Sedangkan pada laki-laki, radiasi UV yang merusak asam folat menyebabkan penurunan drastis kualitas sperma hingga kemandulan total.

Di sinilah seleksi alam bekerja dengan kejam dan tanpa kompromi. Setiap individu purba yang kebetulan terlahir dengan mutasi genetik pengaktif produksi pigmen eumelanin gelap pekat berhasil melindungi cadangan asam folat mereka. Mereka mampu melahirkan bayi-bayi yang sehat dan meneruskan garis keturunannya melintasi generasi. Melanin hitam kecokelatan ini bertindak layaknya kacamata hitam mikro berukuran nanometer yang menyelimuti inti sel kulit, menyerap dan membiaskan radiasi ultraviolet berbahaya sebelum sempat menghancurkan DNA dan asam folat di dalam aliran darah kita.

Banyak orang awam mengira bahwa pigmen gelap pada kulit berfungsi untuk menyerap panas atau mendinginkan badan. Padahal secara fisika dasar, benda berwarna gelap justru menyerap panas lebih banyak daripada benda berwarna terang. Ini membuktikan bahwa alam sama sekali tidak peduli apakah kulit gelap membuat manusia merasa lebih gerah di bawah terik matahari atau tidak. Prioritas nomor satu evolusi adalah melindungi kode genetik reproduksi dari kehancuran fotokimia radiasi ultraviolet.

Tapi pertanyaannya, kalau memang radiasi matahari itu sangat berbahaya dan kulit gelap adalah pelindung biologis paling ampuh yang pernah diciptakan alam, kenapa manusia modern yang bermigrasi keluar benua Afrika tidak mempertahankan kulit gelap mereka selamanya? Kenapa saat sekelompok manusia bergerak melintasi wilayah Timur Tengah, Asia Tengah, dan daratan Eropa, warna kulit mereka perlahan memudar menjadi jauh lebih terang? Jawabannya membawa kita pada sebuah dilema evolusi paling dramatis dalam sejarah biologi manusia.`,
    },
    {
      part: 2,
      judul_bagian: 'Part 2: Dilema Vitamin D, Geografi Khatulistiwa, dan Peta Sejarah Spesies',
      total_karakter: 4788,
      teks: `Sekitar enam puluh ribu tahun yang lalu, sekelompok kecil manusia modern mengambil langkah paling berani dalam sejarah Homo sapiens, yaitu keluar melintasi benua Afrika menuju wilayah utara yang beriklim subtropis dan dingin. Saat mereka mulai menetap di kawasan yang lebih jauh dari garis khatulistiwa, mereka mendadak berhadapan dengan musuh biologis baru yang tak terlihat. 

Di wilayah lintang geografis yang lebih tinggi, matahari tidak lagi bersinar tegak lurus di atas kepala. Sudut kemiringan bumi membuat sinar matahari menempuh lapisan atmosfer yang jauh lebih tebal sebelum menyentuh tanah. Akibatnya, intensitas radiasi UV-B yang mencapai permukaan bumi anjlok drastis, terutama ketika memasuki musim dingin yang panjang dan berkabut.

Di titik inilah keajaiban melanin gelap berbalik menjadi bumerang yang mematikan. Tubuh manusia memerlukan sejumlah kecil radiasi UV-B yang menembus lapisan kulit untuk memicu sintesis Vitamin D3 dari senyawa kolesterol. Vitamin D bukan sekadar vitamin biasa, melainkan hormon kunci yang mengatur penyerapan kalsium di usus agar tulang kita tetap kokoh dan sistem kekebalan tubuh mampu melawan serangan infeksi bakteri maupun virus.

Manusia purba berkulit sangat gelap yang hidup di kawasan ber-UV rendah tidak mampu menyerap cukup sinar matahari karena seluruh radiasi diblokir total oleh lapisan eumelanin pekat mereka. Akibatnya, terjadi wabah rakitis massal di zaman purba. Tulang pinggul perempuan melunak dan membengkok tidak wajar, membuat proses persalinan alami menjadi mustahil dan berujung kematian ibu beserta bayinya. Tulang anak-anak menjadi rapuh dan melengkung, membuat mereka tidak mampu berburu atau melarikan diri dari predator.

Maka seleksi alam berbalik arah seratus delapan puluh derajat. Individu-individu yang membawa mutasi genetik berupa pengurangan produksi melanin justru memiliki tingkat kelangsungan hidup jauh lebih tinggi. Kulit yang lebih terang memungkinkan sinar UV-B yang sangat minim sekalipun untuk menembus jaringan kulit dan memicu pembentukan Vitamin D dalam jumlah cukup demi mempertahankan kekuatan tulang.

Lalu bagaimana dengan perbandingan Arab dan Papua? Meskipun Semenanjung Arab terkenal sangat panas dan gersang, secara garis lintang kawasan ini berada di luar zona tropis murni khatulistiwa, yakni sekitar dua puluh sampai tiga puluh derajat lintang utara. Di wilayah ini terjadi fluktuasi sudut jatuh matahari antar musim dan intensitas UV-B rata-rata tahunan jauh lebih rendah daripada garis khatulistiwa murni. Ditambah lagi, budaya masyarakat gurun mengenakan pakaian jubah panjang tertutup untuk menangkal badai pasir membuat tekanan radiasi langsung ke kulit menjadi berkurang.

Sebaliknya, Pulau Papua berada tepat di bawah garis khatulistiwa nol derajat. Posisi matahari berada tepat di atas kepala secara konstan sepanjang dua belas bulan tanpa pernah ada musim dingin. Hutan hujan tropis yang lembap dengan tutupan kanopi pohon memaksa masyarakat aslinya beraktivitas dengan pakaian minimalis, terpapar langsung pada indeks UV level ekstrem hampir setiap hari.

Jadi, kesimpulan ilmiahnya sangat gamblang. Warna kulit manusia bukanlah tentang siapa yang lebih tahan panas, melainkan hasil kompromi biokimiawi sempurna antara melindungi asam folat dari radiasi berlebih dan menyerap cukup UV demi sintesis Vitamin D. Perbedaan fisik kita adalah peta sejarah adaptasi nenek moyang yang mengagumkan. Menurut kamu, misteri tubuh apa lagi yang perlu kita bedah? Tulis di kolom komentar, dan mari kita diskusikan bersama.`,
    },
  ],
};

const LOCAL_STORAGE_KEY = 'humanologi_pure_narration_v3';
const LOCAL_STORAGE_TOPIC_KEY = 'humanologi_user_topic_v3';

interface HumanologiResearchStepProps {
  onGoToAudio?: () => void;
}

export const HumanologiResearchStep: React.FC<HumanologiResearchStepProps> = ({ onGoToAudio }) => {
  const [userTopic, setUserTopic] = useState<string>('');
  const [systemPrompt, setSystemPrompt] = useState<string>(HUMANOLOGI_SYSTEM_PROMPT);
  const [showPromptPreview, setShowPromptPreview] = useState<boolean>(false);
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);
  const [rawOutput, setRawOutput] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<HumanologiAIOutput | null>(null);
  const [activePartTab, setActivePartTab] = useState<number>(1);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [savedFilePath, setSavedFilePath] = useState<string | null>(null);

  // Load from disk / localStorage on mount
  useEffect(() => {
    (async () => {
      try {
        const savedTopic = localStorage.getItem(LOCAL_STORAGE_TOPIC_KEY);
        if (savedTopic) setUserTopic(savedTopic);

        // Try loading custom prompt from file
        if (window.electronAPI?.getHumanologiPrompt) {
          const pRes = await window.electronAPI.getHumanologiPrompt();
          if (pRes.success && pRes.prompt) {
            setSystemPrompt(pRes.prompt);
          }
        }

        // Try loading latest JSON from input/humanologi/humanologi_narasi.json
        if (window.electronAPI?.getLatestHumanologiNarasi) {
          const jRes = await window.electronAPI.getLatestHumanologiNarasi();
          if (jRes.success && jRes.data?.narasi) {
            setParsedData(jRes.data);
            setRawOutput(JSON.stringify(jRes.data, null, 2));
            setSavedFilePath('input/humanologi/humanologi_narasi.json');
            return;
          }
        }

        // Fallback to localStorage
        const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (savedData) {
          const parsed = JSON.parse(savedData);
          if (parsed?.narasi && Array.isArray(parsed?.narasi)) {
            setParsedData(parsed);
            setRawOutput(JSON.stringify(parsed, null, 2));
          }
        }
      } catch {}
    })();
  }, []);

  const getFullPrompt = (): string => {
    const topicText = userTopic.trim()
      ? userTopic.trim()
      : '[Kosong — AI tentukan sendiri topik provokatif terbaik]';
    return `${systemPrompt}${topicText}`;
  };

  const saveToDisk = async (data: HumanologiAIOutput) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
      localStorage.setItem(LOCAL_STORAGE_TOPIC_KEY, userTopic);
      if (window.electronAPI?.saveHumanologiNarasi) {
        const res = await window.electronAPI.saveHumanologiNarasi(data);
        if (res.success) {
          setSavedFilePath('input/humanologi/humanologi_narasi.json');
        }
      }
    } catch (e) {
      console.error('Error saving to disk:', e);
    }
  };

  const handleCopyPrompt = async () => {
    const fullText = getFullPrompt();
    try {
      if (window.electronAPI?.copyToClipboard) {
        await window.electronAPI.copyToClipboard(fullText);
      } else {
        await navigator.clipboard.writeText(fullText);
      }
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2500);
    } catch (e) {
      console.error('Failed to copy prompt:', e);
    }
  };

  const handleCopyText = async (text: string, key: string) => {
    try {
      if (window.electronAPI?.copyToClipboard) {
        await window.electronAPI.copyToClipboard(text);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (e) {
      console.error('Failed to copy text:', e);
    }
  };

  // Helper to chunk plain text into 4.500 - 5.000 character parts at sentence boundaries
  const chunkPlainText = (text: string): HumanologiNarasiPart[] => {
    const sanitized = sanitizeNarration(text);
    const sentences = sanitized.split(/(?<=[.!?])\s+/);
    const parts: HumanologiNarasiPart[] = [];
    let currentText = '';
    let partNum = 1;

    for (const s of sentences) {
      // If adding this sentence pushes past 4950 chars AND current text is already >= 4400 chars
      if ((currentText + ' ' + s).length > 4950 && currentText.length >= 4400) {
        parts.push({
          part: partNum,
          judul_bagian: `Part ${partNum}: Narasi (${currentText.trim().length.toLocaleString('id-ID')} Karakter)`,
          total_karakter: currentText.trim().length,
          teks: currentText.trim(),
        });
        partNum++;
        currentText = s;
      } else {
        currentText = currentText ? `${currentText} ${s}` : s;
      }
    }

    if (currentText.trim()) {
      parts.push({
        part: partNum,
        judul_bagian: `Part ${partNum}: Narasi (${currentText.trim().length.toLocaleString('id-ID')} Karakter)`,
        total_karakter: currentText.trim().length,
        teks: currentText.trim(),
      });
    }

    return parts;
  };

  const handleProcessOutput = async () => {
    setParseError(null);
    if (!rawOutput.trim()) {
      setParseError('Kolom output masih kosong. Paste teks atau JSON naskah dari AI terlebih dahulu.');
      return;
    }

    let cleaned = rawOutput.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }

    // Try JSON parse first
    try {
      if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
        const parsed = JSON.parse(cleaned);

        let parts: HumanologiNarasiPart[] = [];
        let title = userTopic.trim() || 'Naskah Humanologi';

        if (Array.isArray(parsed)) {
          parts = parsed;
        } else if (Array.isArray(parsed.narasi)) {
          parts = parsed.narasi;
          if (parsed.judul_video) title = parsed.judul_video;
          if (parsed.metadata?.judul_video) title = parsed.metadata.judul_video;
        } else if (typeof parsed.teks === 'string') {
          parts = chunkPlainText(parsed.teks);
        }

        if (parts.length > 0) {
          // Sanitize every part to strip any stray greetings
          const sanitizedParts = parts.map((p, idx) => {
            const cleanTeks = sanitizeNarration(p.teks || '');
            return {
              part: p.part || idx + 1,
              judul_bagian: p.judul_bagian || `Part ${idx + 1}`,
              total_karakter: cleanTeks.length,
              teks: cleanTeks,
            };
          });

          const result: HumanologiAIOutput = {
            judul_video: title,
            total_part: sanitizedParts.length,
            estimasi_total_karakter: sanitizedParts.reduce((acc, p) => acc + (p.total_karakter || 0), 0),
            narasi: sanitizedParts,
          };

          setParsedData(result);
          setActivePartTab(1);
          await saveToDisk(result);
          return;
        }
      }
    } catch {}

    // Fallback: Plain text auto-chunking (4.500 - 5.000 chars per part)
    try {
      const parts = chunkPlainText(cleaned);
      if (parts.length === 0) {
        throw new Error('Tidak dapat mengekstrak teks naskah.');
      }

      const result: HumanologiAIOutput = {
        judul_video: userTopic.trim() || 'Naskah Humanologi (Plain Text)',
        total_part: parts.length,
        estimasi_total_karakter: parts.reduce((acc, p) => acc + (p.total_karakter || 0), 0),
        narasi: parts,
      };

      setParsedData(result);
      setActivePartTab(1);
      await saveToDisk(result);
    } catch (err: any) {
      setParseError(`Gagal memproses naskah: ${err.message}`);
    }
  };

  const handleLoadSample = async () => {
    setRawOutput(JSON.stringify(SAMPLE_AI_OUTPUT, null, 2));
    setParsedData(SAMPLE_AI_OUTPUT);
    setActivePartTab(1);
    setUserTopic('Kenapa orang Arab tidak segelap Papua?');
    setParseError(null);
    await saveToDisk(SAMPLE_AI_OUTPUT);
  };

  const handleClear = () => {
    setRawOutput('');
    setParsedData(null);
    setParseError(null);
    setSavedFilePath(null);
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch {}
  };

  const handlePartTextEdit = (newText: string) => {
    if (!parsedData) return;
    const clean = sanitizeNarration(newText);
    const updatedNarasi = parsedData.narasi.map((p) => {
      if (p.part === activePartTab) {
        return { ...p, teks: clean, total_karakter: clean.length };
      }
      return p;
    });

    const updatedData: HumanologiAIOutput = {
      ...parsedData,
      estimasi_total_karakter: updatedNarasi.reduce((acc, p) => acc + (p.total_karakter || 0), 0),
      narasi: updatedNarasi,
    };

    setParsedData(updatedData);
    saveToDisk(updatedData);
  };

  const currentNarasiPart =
    parsedData?.narasi.find((p) => p.part === activePartTab) || parsedData?.narasi[0];

  const totalChars =
    parsedData?.estimasi_total_karakter ||
    parsedData?.narasi.reduce((acc, p) => acc + (p.teks?.length || 0), 0) ||
    0;

  const totalMinutes = Math.round((totalChars / 1000) * 10) / 10;

  return (
    <div className="space-y-6 animate-fadeIn pb-16">
      {/* ─── SECTION 1: PROMPT GENERATOR & COPY ─────────────────────────── */}
      <div className="rounded-3xl bg-gray-900/90 border border-gray-800 p-6 shadow-2xl backdrop-blur-md relative overflow-hidden space-y-4">
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-800 pb-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-950 border border-emerald-500/30 flex items-center justify-center text-2xl shadow-lg shadow-emerald-950/60">
              🎙️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-white tracking-tight">
                  Prompt Narasi Humanologi (Khusus Voiceover ElevenLabs)
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  4.500 - 5.000 Karakter/Part
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-red-950 text-red-300 border border-red-800/60">
                  Max 5.000 Chars
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-0.5">
                <p className="text-xs text-gray-400">
                  Dioptimasi pas 4.500 - 5.000 karakter per part (~4.5-5 menit per render ElevenLabs) tanpa basa-basi salam channel.
                </p>
                <span className="hidden lg:inline text-[10px] font-mono text-emerald-400/80 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40">
                  📁 dashboard/prompts/humanologi/humanologi-narasi-prompt.md
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPromptPreview(!showPromptPreview)}
              className="px-3 py-2 rounded-xl bg-gray-800/80 hover:bg-gray-800 text-gray-300 border border-gray-700 text-xs font-semibold transition-all flex items-center gap-1.5"
            >
              <span>{showPromptPreview ? '👁️ Tutup Prompt' : '📜 Lihat Full Prompt'}</span>
            </button>
            <button
              onClick={handleCopyPrompt}
              className={`px-5 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg ${
                copiedPrompt
                  ? 'bg-emerald-500 text-gray-950 shadow-emerald-500/40 font-black'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/30 cursor-pointer'
              }`}
            >
              <span>{copiedPrompt ? '✓' : '📋'}</span>
              <span>{copiedPrompt ? 'Prompt Tersalin!' : 'Copy Prompt AI'}</span>
            </button>
          </div>
        </div>

        {/* Optional Topic Customizer Input */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-gray-300 flex items-center gap-2 uppercase tracking-wider">
              <span>🎯</span> Topik yang Diinginkan (Opsional)
            </label>
            <span className="text-[11px] font-mono text-emerald-400">
              *Kosongkan jika ingin AI yang memilihkan topik provokatif terbaik
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={userTopic}
              onChange={(e) => {
                setUserTopic(e.target.value);
                try {
                  localStorage.setItem(LOCAL_STORAGE_TOPIC_KEY, e.target.value);
                } catch {}
              }}
              placeholder='Contoh: "Kenapa Orang Arab Tidak Segelap Papua?", "Kenapa Orang Indonesia Timur dan Barat Berbeda?"'
              className="flex-1 bg-gray-950 border border-gray-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-600 focus:outline-none transition-all font-medium"
            />
            {userTopic && (
              <button
                onClick={() => {
                  setUserTopic('');
                  try {
                    localStorage.removeItem(LOCAL_STORAGE_TOPIC_KEY);
                  } catch {}
                }}
                className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded-xl text-xs transition-all"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Collapsible Prompt Preview */}
        {showPromptPreview && (
          <div className="rounded-2xl bg-gray-950 border border-gray-800 p-4 space-y-2 text-xs font-mono text-gray-300 max-h-72 overflow-y-auto leading-relaxed border-dashed">
            <div className="text-[10px] text-emerald-400 uppercase font-bold tracking-wider sticky top-0 bg-gray-950/90 py-1">
              Teks Prompt yang Akan Disalin ke Clipboard:
            </div>
            <pre className="whitespace-pre-wrap font-sans text-xs text-gray-400">
              {getFullPrompt()}
            </pre>
          </div>
        )}
      </div>

      {/* ─── SECTION 2: INPUT AI NARASI (JSON ATAU TEKS) ────────────────── */}
      <div className="rounded-3xl bg-gray-900/70 border border-gray-800 p-6 shadow-xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>📥</span> Input Naskah Hasil AI
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Paste respon JSON atau teks naskah AI di bawah. Sistem otomatis mengorganisir per 4.500 - 5.000 karakter:
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleLoadSample}
              className="px-3 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-800/60 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>✨</span> Load Contoh Data Demo (2 Part @ ~4.800c)
            </button>
            {rawOutput && (
              <button
                onClick={handleClear}
                className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-red-300 text-xs transition-all cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Error Notification */}
        {parseError && (
          <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-800/80 text-xs text-red-200 flex items-start gap-2.5">
            <span className="text-base leading-none">⚠️</span>
            <div className="flex-1 min-w-0 font-mono">{parseError}</div>
          </div>
        )}

        <textarea
          value={rawOutput}
          onChange={(e) => setRawOutput(e.target.value)}
          placeholder="Paste JSON atau teks naskah AI di sini..."
          rows={5}
          className="w-full bg-gray-950 border border-gray-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-2xl p-4 text-xs font-mono text-emerald-300/90 placeholder-gray-600 focus:outline-none transition-all shadow-inner leading-relaxed"
        />

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] font-mono text-gray-500">
            {rawOutput.length > 0
              ? `${rawOutput.length.toLocaleString('id-ID')} karakter dimasukkan`
              : 'Belum ada teks di-paste'}
          </span>
          <button
            onClick={handleProcessOutput}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black uppercase tracking-wider shadow-lg shadow-emerald-600/30 transition-all flex items-center gap-2 cursor-pointer"
          >
            <span>⚡</span>
            <span>Render Naskah Narasi</span>
          </button>
        </div>
      </div>

      {/* ─── SECTION 3: RENDER KHUSUS NASKAH NARASI (ELEVENLABS BATCH) ─── */}
      {parsedData && parsedData.narasi.length > 0 && (
        <div className="space-y-4 pt-1">
          {/* Header Naskah Overview */}
          <div className="rounded-3xl bg-gradient-to-r from-gray-900 via-gray-900 to-emerald-950/50 border border-emerald-800/40 p-5 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  NASKAH VOICE OVER
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-gray-800 text-gray-300 border border-gray-700">
                  🧩 {parsedData.narasi.length} Part
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-purple-950/80 text-purple-300 border border-purple-800/60">
                  🔤 {totalChars.toLocaleString('id-ID')} Karakter
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-800/60">
                  ⏱️ Estimasi Total Audio: ~{totalMinutes} Menit
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950/70 text-emerald-400 border border-emerald-800/60 flex items-center gap-1">
                  <span>💾</span>
                  <span>input/humanologi/humanologi_narasi.json</span>
                  <span>{savedFilePath ? '✓' : ''}</span>
                </span>
              </div>

              <h2 className="text-lg sm:text-xl font-black text-white leading-tight tracking-tight">
                {parsedData.judul_video}
              </h2>
            </div>

            <button
              onClick={() => {
                const allText = parsedData.narasi.map((p) => `--- PART ${p.part} ---\n${p.teks}`).join('\n\n');
                handleCopyText(allText, 'all_parts_text');
              }}
              className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 text-xs font-bold transition-all flex items-center gap-2 shrink-0 self-start md:self-auto shadow"
            >
              <span>{copiedKey === 'all_parts_text' ? '✓' : '📋'}</span>
              <span>{copiedKey === 'all_parts_text' ? 'Semua Part Disalin!' : 'Copy Semua Part Sekaligus'}</span>
            </button>
          </div>

          {/* Part Selection Bar (Elevated Tabs) */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
            {parsedData.narasi.map((partItem) => {
              const charCount = partItem.total_karakter || partItem.teks.length;
              const isIdeal = charCount >= 4500 && charCount <= 5000;
              const isOver = charCount > 5000;
              const isUnder = charCount < 4500;
              const isActive = activePartTab === partItem.part;

              return (
                <button
                  key={partItem.part}
                  onClick={() => setActivePartTab(partItem.part)}
                  className={`px-4 py-3 rounded-2xl text-left transition-all border shrink-0 flex flex-col gap-0.5 min-w-[190px] ${
                    isActive
                      ? isOver
                        ? 'bg-red-900 border-red-500 text-white shadow-lg shadow-red-900/50'
                        : 'bg-emerald-600 border-emerald-400 text-white shadow-lg shadow-emerald-600/30'
                      : 'bg-gray-900/80 border-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-extrabold text-xs">
                      Part {partItem.part}
                    </span>
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.2 rounded-full font-bold ${
                        isActive
                          ? 'bg-black/30 text-white'
                          : isOver
                          ? 'bg-red-950 text-red-300 border border-red-800/80'
                          : isIdeal
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                          : 'bg-amber-950 text-amber-400 border border-amber-800/60'
                      }`}
                    >
                      {isOver ? '⚠️ >5.000 (Lewat!)' : isIdeal ? '✓ Ideal (4.5k-5k)' : `<4.5k (${charCount}c)`}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono opacity-90 truncate">
                    {charCount.toLocaleString('id-ID')} karakter (~{Math.round((charCount / 1000) * 10) / 10} mnt)
                  </div>
                </button>
              );
            })}
          </div>

          {/* Active Part Narration Studio Card */}
          {currentNarasiPart && (
            <div className="rounded-3xl bg-gray-900/90 border border-gray-800 p-6 shadow-2xl space-y-4">
              {/* Part Header & Quick Copy */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-gray-800">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-xl bg-emerald-950 border border-emerald-700/60 text-emerald-400 font-bold text-xs flex items-center justify-center">
                      {currentNarasiPart.part}
                    </span>
                    <h3 className="text-base font-bold text-white">
                      {currentNarasiPart.judul_bagian || `Part ${currentNarasiPart.part}`}
                    </h3>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-gray-400 font-mono">
                    <span
                      className={`font-bold ${
                        (currentNarasiPart.total_karakter || currentNarasiPart.teks.length) > 5000
                          ? 'text-red-400'
                          : (currentNarasiPart.total_karakter || currentNarasiPart.teks.length) >= 4500
                          ? 'text-emerald-400'
                          : 'text-amber-400'
                      }`}
                    >
                      {(currentNarasiPart.total_karakter || currentNarasiPart.teks.length).toLocaleString('id-ID')} / 5.000 Karakter (Target: 4.500 - 5.000)
                    </span>
                    <span>•</span>
                    <span>
                      Estimasi Suara ElevenLabs:{' '}
                      <strong className="text-white">
                        ~{Math.round(((currentNarasiPart.total_karakter || currentNarasiPart.teks.length) / 1000) * 10) / 10} Menit
                      </strong>
                    </span>
                  </div>
                </div>

                <button
                  onClick={() =>
                    handleCopyText(currentNarasiPart.teks, `part_copy_${currentNarasiPart.part}`)
                  }
                  className={`px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-xl ${
                    copiedKey === `part_copy_${currentNarasiPart.part}`
                      ? 'bg-emerald-500 text-gray-950 shadow-emerald-500/50 scale-105'
                      : (currentNarasiPart.total_karakter || currentNarasiPart.teks.length) > 5000
                      ? 'bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white shadow-red-600/40 cursor-pointer'
                      : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/40 cursor-pointer'
                  }`}
                >
                  <span className="text-base">
                    {copiedKey === `part_copy_${currentNarasiPart.part}` ? '✓' : '🎙️'}
                  </span>
                  <span>
                    {copiedKey === `part_copy_${currentNarasiPart.part}`
                      ? `Part ${currentNarasiPart.part} Berhasil Disalin!`
                      : `Copy Part ${currentNarasiPart.part} (Siap ElevenLabs)`}
                  </span>
                </button>
              </div>

              {/* ElevenLabs Warning if over 5.000 chars */}
              {(currentNarasiPart.total_karakter || currentNarasiPart.teks.length) > 5000 && (
                <div className="p-3.5 rounded-2xl bg-red-950/60 border border-red-800 text-xs text-red-200 flex items-center gap-2.5">
                  <span className="text-lg">🛑</span>
                  <span>
                    <strong>Peringatan Batas ElevenLabs:</strong> Naskah Part ini memiliki{' '}
                    {(currentNarasiPart.total_karakter || currentNarasiPart.teks.length).toLocaleString('id-ID')} karakter (melebihi batas maksimal 5.000 karakter). Mohon potong atau kurangi sedikit kalimat di kotak bawah agar proses generate audio tidak gagal.
                  </span>
                </div>
              )}

              {/* ElevenLabs Batch Meter Progress Bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-gray-400">
                  <span>Target Ideal ElevenLabs: 4.500 s/d 5.000 Karakter (Maksimal 5.000)</span>
                  <span
                    className={
                      (currentNarasiPart.total_karakter || currentNarasiPart.teks.length) > 5000
                        ? 'text-red-400 font-bold'
                        : (currentNarasiPart.total_karakter || currentNarasiPart.teks.length) >= 4500
                        ? 'text-emerald-400 font-bold'
                        : 'text-amber-400'
                    }
                  >
                    {Math.round(
                      ((currentNarasiPart.total_karakter || currentNarasiPart.teks.length) / 5000) * 100
                    )}
                    % dari batas 5.000 char
                  </span>
                </div>
                <div className="w-full h-2.5 bg-gray-950 rounded-full overflow-hidden border border-gray-800 relative">
                  {/* Visual zone marker for 4500-5000 (90% - 100%) */}
                  <div className="absolute top-0 bottom-0 left-[90%] right-0 bg-emerald-500/20 pointer-events-none" />
                  <div
                    className={`h-full transition-all duration-300 rounded-full ${
                      (currentNarasiPart.total_karakter || currentNarasiPart.teks.length) > 5000
                        ? 'bg-gradient-to-r from-amber-500 to-red-500'
                        : (currentNarasiPart.total_karakter || currentNarasiPart.teks.length) >= 4500
                        ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                        : 'bg-gradient-to-r from-amber-600 to-amber-400'
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          5,
                          Math.round(
                            ((currentNarasiPart.total_karakter || currentNarasiPart.teks.length) /
                              5000) *
                              100
                          )
                        )
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {/* Narration Editable Reader View */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span>Teks Narasi Murni (Bebas Markdown, Siap Suara TTS):</span>
                  <span className="text-gray-500 italic">Dapat diedit langsung jika ingin merevisi kata</span>
                </div>

                <textarea
                  value={currentNarasiPart.teks}
                  onChange={(e) => handlePartTextEdit(e.target.value)}
                  rows={15}
                  className="w-full bg-gray-950 border border-gray-800 rounded-2xl p-5 text-sm leading-relaxed text-gray-100 font-sans focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all selection:bg-emerald-600 selection:text-white resize-y shadow-inner"
                />
              </div>

              {/* Bottom Quick Part Navigators */}
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setActivePartTab((prev) => Math.max(1, prev - 1))}
                  disabled={activePartTab === 1}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                    activePartTab > 1
                      ? 'bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700 cursor-pointer'
                      : 'bg-gray-900/40 text-gray-600 border-gray-800/40 cursor-not-allowed opacity-40'
                  }`}
                >
                  ← Part Sebelumnya
                </button>

                <span className="text-xs font-mono text-gray-400">
                  Part {activePartTab} dari {parsedData.narasi.length}
                </span>

                <button
                  onClick={() =>
                    setActivePartTab((prev) => Math.min(parsedData.narasi.length, prev + 1))
                  }
                  disabled={activePartTab === parsedData.narasi.length}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                    activePartTab < parsedData.narasi.length
                      ? 'bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700 cursor-pointer'
                      : 'bg-gray-900/40 text-gray-600 border-gray-800/40 cursor-not-allowed opacity-40'
                  }`}
                >
                  Part Berikutnya →
                </button>
              </div>

              {onGoToAudio && (
                <div className="pt-4 border-t border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-mono text-emerald-400">
                    <span>✓ Naskah {parsedData.narasi.length} Part siap</span>
                    <span className="text-gray-500">•</span>
                    <span className="text-gray-400">Lanjut generate ElevenLabs dan upload audio</span>
                  </div>

                  <button
                    onClick={onGoToAudio}
                    className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold uppercase tracking-wider transition-all shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>Lanjut ke Step 2: Upload Audio Narator</span>
                    <span>🎙️ →</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default HumanologiResearchStep;
