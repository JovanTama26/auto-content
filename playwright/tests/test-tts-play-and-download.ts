// playwright/tests/test-tts-play-and-download.ts
import { chromium } from 'playwright';

async function testPlayAndDownload() {
  console.log('\n===============================================================');
  console.log('🧪 VALIDASI PLAY PREVIEW GEN 2 & SINGLE-TRIGGER DOWNLOAD');
  console.log('===============================================================\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Simulasikan halaman Text-to-Speech ElevenLabs dengan 2 Generation card bersebelahan
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head><title>ElevenLabs Text to Speech</title></head>
      <body>
        <div id="editor-container">
          <div class="generations-wrapper flex gap-4 p-4 border rounded-xl">
            <!-- Kartu Generation 1 -->
            <div id="card-gen-1" class="gen-card p-4 border rounded-lg">
              <span class="text-sm font-semibold">Generation 1</span>
              <div class="controls flex items-center gap-2 mt-2">
                <button id="play-btn-1" aria-label="Pause" class="rounded-full bg-black text-white p-2">Pause</button>
                <div class="waveform">||||||||||||</div>
                <button id="thumb-up-1" aria-label="Thumbs up">👍</button>
                <button id="thumb-down-1" aria-label="Thumbs down">👎</button>
                <button id="dl-btn-1" aria-label="Download" class="dl-btn">⬇️</button>
              </div>
            </div>

            <!-- Kartu Generation 2 -->
            <div id="card-gen-2" class="gen-card p-4 border rounded-lg">
              <span class="text-sm font-semibold">Generation 2</span>
              <div class="controls flex items-center gap-2 mt-2">
                <button id="play-btn-2" aria-label="Play" class="rounded-full bg-black text-white p-2">Play</button>
                <div class="waveform">||||||||||||</div>
                <button id="thumb-up-2" aria-label="Thumbs up">👍</button>
                <button id="thumb-down-2" aria-label="Thumbs down">👎</button>
                <button id="dl-btn-2" aria-label="Download" class="dl-btn">⬇️</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Bottom Player Bar (saat ini memutar Gen 1) -->
        <footer class="fixed bottom-0 bg-white border-t p-2">
          <span>Film yang satu ini...</span>
          <span id="player-label">Generation 1</span>
          <button id="bottom-play-pause">Pause</button>
        </footer>

        <script>
          window.__CLICKS = {
            playGen1: 0,
            playGen2: 0,
            dlGen1: 0,
            dlGen2: 0
          };

          document.getElementById('play-btn-1').addEventListener('click', () => {
            window.__CLICKS.playGen1++;
          });
          document.getElementById('play-btn-2').addEventListener('click', () => {
            window.__CLICKS.playGen2++;
            document.getElementById('player-label').innerText = 'Generation 2';
          });
          document.getElementById('dl-btn-1').addEventListener('click', () => {
            window.__CLICKS.dlGen1++;
          });
          document.getElementById('dl-btn-2').addEventListener('click', () => {
            window.__CLICKS.dlGen2++;
          });
        </script>
      </body>
    </html>
  `);

  // Evaluasi logika getGenerationCard, playGenerationPreview, dan downloadGeneration yang baru
  const result = await page.evaluate(`
    (() => {
      function getGenerationCard(generationNumber) {
        const otherNumber = generationNumber === 2 ? 1 : 2;
        const targetLabel = 'generation ' + generationNumber;
        const otherLabel = 'generation ' + otherNumber;

        const candidates = Array.from(
          document.body.querySelectorAll('*:not(script):not(style)')
        ).filter((el) => {
          if (el.closest('.fixed.bottom-0, footer, [data-testid="audio-player"]')) return false;
          const txt = (el.textContent || '').trim().toLowerCase();
          return txt === targetLabel || (txt.includes(targetLabel) && !txt.includes(otherLabel));
        });

        if (candidates.length === 0) return null;

        const leaf = candidates.find(
          (el) => !Array.from(el.children).some((c) => (c.textContent || '').toLowerCase().includes(targetLabel))
        ) || candidates[0];

        let bestCard = leaf.parentElement;
        let cur = leaf.parentElement;
        while (cur && cur !== document.body) {
          const t = (cur.textContent || '').toLowerCase();
          if (t.includes(otherLabel)) break;
          if (cur.querySelectorAll('button').length >= 2) {
            bestCard = cur;
          }
          cur = cur.parentElement;
        }

        return bestCard;
      }

      function playPreview(genNum) {
        const card = getGenerationCard(genNum);
        if (!card) return false;
        const buttons = Array.from(card.querySelectorAll('button'));
        const playBtn = buttons.find((b) => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          return aria.includes('play') || aria.includes('pause');
        }) || buttons[0];

        if (playBtn) {
          playBtn.click();
          return true;
        }
        return false;
      }

      function download(genNum) {
        const card = getGenerationCard(genNum);
        if (!card) return false;
        const buttons = Array.from(card.querySelectorAll('button'));
        const dlBtn = buttons.find((b) => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          return aria.includes('download') || aria.includes('unduh');
        }) || buttons[buttons.length - 1];

        if (dlBtn) {
          dlBtn.click();
          return true;
        }
        return false;
      }

      const played = playPreview(2);
      const downloaded = download(2);

      return {
        played: played,
        downloaded: downloaded,
        clicks: window.__CLICKS,
        currentPlayingLabel: document.getElementById('player-label')?.innerText
      };
    })()
  `);

  console.log('Hasil Pengujian:');
  console.log(`   - Play Gen 2 Berhasil: ${result.played ? '✅ YA' : '❌ TIDAK'}`);
  console.log(`   - Download Gen 2 Berhasil: ${result.downloaded ? '✅ YA' : '❌ TIDAK'}`);
  console.log(`   - Play Gen 1 Klik: ${result.clicks.playGen1} (Harus 0)`);
  console.log(`   - Play Gen 2 Klik: ${result.clicks.playGen2} (Harus 1)`);
  console.log(`   - Download Gen 1 Klik: ${result.clicks.dlGen1} (Harus 0)`);
  console.log(`   - Download Gen 2 Klik: ${result.clicks.dlGen2} (Harus 1)`);
  console.log(`   - Current Playing Audio: "${result.currentPlayingLabel}" (Harus Generation 2)\n`);

  if (
    result.clicks.playGen1 === 0 &&
    result.clicks.playGen2 === 1 &&
    result.clicks.dlGen1 === 0 &&
    result.clicks.dlGen2 === 1 &&
    result.currentPlayingLabel === 'Generation 2'
  ) {
    console.log('🎉 PENGUJIAN PLAY PREVIEW GEN 2 & SINGLE DOWNLOAD 100% SUKSES!');
  } else {
    throw new Error('Pengujian Play / Download Gen 2 gagal!');
  }

  await browser.close();
}

testPlayAndDownload().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
