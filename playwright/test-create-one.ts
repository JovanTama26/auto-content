import { launchBrowser } from './actions/launch-browser';
import fs from 'fs';
import path from 'path';

async function testCreateOneChannel() {
  const { page, context } = await launchBrowser({ headed: true, profileName: 'user_1' });

  try {
    console.log('🧭 Navigasi ke https://www.youtube.com/channel_switcher...');
    await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const createBtn = page.locator('a[href*="create_channel"], ytd-button-renderer:has-text("Buat channel"), [aria-label*="Buat channel"]').first();
    console.log('👆 Klik Buat channel...');
    await createBtn.click();
    await page.waitForTimeout(2500);

    // Dapatkan input nama
    const inputs = page.locator('ytd-channel-creation-dialog-renderer input');
    console.log(`Jumlah input terdeteksi: ${await inputs.count()}`);

    const nameInput = inputs.first();
    const testName = 'Nusantara Vibe ' + Math.floor(100 + Math.random() * 900);
    console.log(`✍️ Mengisi nama channel: "${testName}"...`);
    await nameInput.click();
    // Gunakan pressSequentially agar event ketikan terpicu alami seperti user asli
    await nameInput.pressSequentially(testName, { delay: 60 });
    await page.waitForTimeout(2000);

    // Ambil nilai handle otomatis
    const handleInput = inputs.nth(1);
    const handleVal = await handleInput.inputValue();
    console.log(`🏷️ Handle otomatis terisi: "${handleVal}"`);

    // Cari tombol submit Buat channel
    const submitBtn = page.locator('ytd-channel-creation-dialog-renderer button:has-text("Buat channel"), ytd-channel-creation-dialog-renderer button:has-text("Create channel")').first();
    const disabledAttr = await submitBtn.getAttribute('aria-disabled');
    console.log(`🔘 Status aria-disabled tombol Buat channel: ${disabledAttr}`);

    const debugDir = path.join(process.cwd(), 'playwright', 'debug');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    await page.screenshot({ path: path.join(debugDir, 'before_submit_channel.png') });

    if (disabledAttr === 'false' || disabledAttr === null) {
      console.log('🚀 Mengklik tombol "Buat channel"...');
      await submitBtn.click();

      console.log('⏳ Menunggu respon pembuatan channel...');
      // Tunggu hingga URL berubah atau modal tertutup
      await page.waitForTimeout(8000);

      const finalUrl = page.url();
      console.log(`🏁 URL setelah submit: ${finalUrl}`);
      await page.screenshot({ path: path.join(debugDir, 'after_submit_channel.png'), fullPage: true });

      // Cek apakah ada error banner atau SMS challenge
      const hasError = await page.locator('.error-message, [role="alert"]').count();
      if (hasError > 0) {
        const errorText = await page.locator('.error-message, [role="alert"]').first().textContent();
        console.log(`⚠️ Alert/Error terdeteksi: ${errorText}`);
      } else {
        console.log('🎉 Pembuatan 1 channel berhasil!');
      }
    } else {
      console.log('❌ Tombol Buat channel masih disabled.');
    }

  } catch (err) {
    console.error('❌ Terjadi kesalahan:', err);
  } finally {
    console.log('\nBrowser akan ditutup dalam 5 detik...');
    await page.waitForTimeout(5000);
    await context.close();
  }
}

testCreateOneChannel();
