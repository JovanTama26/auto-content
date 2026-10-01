import { launchBrowser } from './actions/launch-browser';
import fs from 'fs';
import path from 'path';

async function testClickCreate() {
  console.log('🚀 [Test 2] Testing click "Buat channel"...');
  const { page, context } = await launchBrowser({ headed: true, profileName: 'user_1' });

  try {
    console.log('🧭 Navigasi ke https://www.youtube.com/channel_switcher...');
    await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const debugDir = path.join(process.cwd(), 'playwright', 'debug');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

    // Click "Buat channel"
    const createBtn = page.locator('a[href*="create_channel"], ytd-button-renderer:has-text("Buat channel"), [aria-label*="Buat channel"]').first();
    console.log('👆 Mengklik tombol Buat channel...');
    await createBtn.click();

    // Tunggu navigasi atau modal
    console.log('⏳ Menunggu hasil klik...');
    await page.waitForTimeout(5000);

    console.log(`📍 URL sekarang: ${page.url()}`);
    await page.screenshot({ path: path.join(debugDir, 'create_channel_page.png'), fullPage: true });
    console.log('📸 Screenshot tersimpan di playwright/debug/create_channel_page.png');

    // Analisa elemen form di halaman create channel
    const formElements = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).map(el => ({
        tag: el.tagName,
        type: (el as HTMLInputElement).type,
        id: el.id,
        name: (el as HTMLInputElement).name,
        placeholder: (el as HTMLInputElement).placeholder,
        ariaLabel: el.getAttribute('aria-label')
      }));

      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]')).map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim().slice(0, 50),
        id: el.id,
        type: (el as any).type,
        ariaLabel: el.getAttribute('aria-label')
      })).filter(b => b.text || b.ariaLabel);

      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"], [role="checkbox"], tp-yt-paper-checkbox')).map(el => ({
        tag: el.tagName,
        id: el.id,
        checked: (el as any).checked,
        ariaChecked: el.getAttribute('aria-checked'),
        text: el.parentElement?.textContent?.trim().slice(0, 100)
      }));

      return { inputs, buttons, checkboxes };
    });

    console.log('📝 Elemen form yang terdeteksi:');
    console.log('Inputs:', JSON.stringify(formElements.inputs, null, 2));
    console.log('Checkboxes:', JSON.stringify(formElements.checkboxes, null, 2));
    console.log('Buttons:', JSON.stringify(formElements.buttons.slice(0, 10), null, 2));

  } catch (err) {
    console.error('❌ Error during click create test:', err);
  } finally {
    console.log('\nClosing in 5 seconds...');
    await page.waitForTimeout(5000);
    await context.close();
  }
}

testClickCreate();
