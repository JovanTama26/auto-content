import { chromium } from 'playwright';

async function testInputTextOnly() {
  console.log('\n===============================================================');
  console.log('🧪 VALIDASI INPUT TEXT ONLY (NO AUTO GENERATE)');
  console.log('===============================================================\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Mock halaman Text-to-Speech ElevenLabs dengan editor TipTap / ProseMirror & tombol Generate speech
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head><title>ElevenLabs Text to Speech</title></head>
      <body>
        <div id="editor-wrapper">
          <div data-testid="tts-editor" class="tiptap ProseMirror" contenteditable="true" style="min-height: 100px; border: 1px solid #ccc; padding: 10px;">
            <p>Teks lama yang harus dihapus...</p>
          </div>
        </div>

        <div style="margin-top: 20px;">
          <button id="generate-speech-btn" data-testid="generate-speech-button" style="background: black; color: white; padding: 10px 20px;">
            Generate speech
          </button>
        </div>

        <script>
          window.__GENERATED_CLICK_COUNT = 0;
          document.getElementById('generate-speech-btn').addEventListener('click', () => {
            window.__GENERATED_CLICK_COUNT++;
          });
        </script>
      </body>
    </html>
  `);

  // Evaluasi logika inputNarrationText
  const result = await page.evaluate((textToInput) => {
    const editor = document.querySelector('[data-testid="tts-editor"]');
    if (!editor) return { success: false, error: 'Editor not found' };

    editor.focus();

    // Hapus teks lama
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('delete');

    // Masukkan teks baru
    const inserted = document.execCommand('insertText', false, textToInput);
    if (!inserted || !editor.innerText.trim()) {
      editor.innerHTML = '<p>' + textToInput + '</p>';
    }

    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: textToInput }));
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      success: true,
      editorText: editor.innerText.trim(),
      generateClicked: window.__GENERATED_CLICK_COUNT
    };
  }, 'Film yang satu ini mengisahkan tentang sebuah insiden mematikan [pauses] yang mencekam.');

  console.log('Hasil Uji Input Text Only:');
  console.log(`   - Input Berhasil: ${result.success ? '✅ YA' : '❌ TIDAK'}`);
  console.log(`   - Teks Editor: "${result.editorText.slice(0, 40)}..."`);
  console.log(`   - Tombol Generate Speech Diklik Otomatis: ${result.generateClicked} (Harus 0)`);

  if (result.success && result.editorText.includes('insiden mematikan') && result.generateClicked === 0) {
    console.log('\n🎉 PENGUJIAN INPUT TEXT ONLY 100% SUKSES!');
  } else {
    throw new Error('Validasi Input Text Only gagal!');
  }

  await browser.close();
}

testInputTextOnly().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
