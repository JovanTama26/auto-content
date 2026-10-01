import { launchBrowser } from './actions/launch-browser';
import fs from 'fs';
import path from 'path';

async function testUnsubscribeOne() {
  const targetChannelUrl = 'https://www.youtube.com/@Q5Bioskop';
  console.log(`Testing unsubscribe on channel index 1...`);
  const { page, context } = await launchBrowser({ headed: true, profileName: 'user_2' });

  try {
    await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const cards = page.locator('ytd-account-item-renderer');
    const targetCard = cards.nth(1);
    const cardTitle = (await targetCard.locator('#channel-title, yt-formatted-string#title').textContent())?.trim();
    console.log(`Switch ke channel: "${cardTitle}"...`);
    await targetCard.click();
    await page.waitForTimeout(3500);

    await page.goto(targetChannelUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Cari tombol Disubscribe
    const subBtn = page.locator('button:has-text("Disubscribe"), [aria-label*="Disubscribe"]').first();
    const isSubbed = await subBtn.isVisible().catch(() => false);
    console.log(`Apakah tombol Disubscribe terlihat? ${isSubbed}`);

    if (isSubbed) {
      console.log('👆 Mengklik tombol Disubscribe untuk memunculkan dialog konfirmasi...');
      await subBtn.click();
      await page.waitForTimeout(1500);

      const debugDir = path.join(process.cwd(), 'playwright', 'debug');
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
      await page.screenshot({ path: path.join(debugDir, 'unsubscribe_dialog.png') });

      // Cek tombol konfirmasi batalkan langganan
      const confirmBtn = page.locator(
        'button:has-text("Batalkan langganan"), button:has-text("Unsubscribe"), yt-confirm-dialog-renderer button#confirm-button'
      ).first();

      const hasConfirm = await confirmBtn.isVisible().catch(() => false);
      console.log(`Apakah tombol konfirmasi "Batalkan langganan" muncul? ${hasConfirm}`);

      if (hasConfirm) {
        console.log('🚀 Mengklik tombol "Batalkan langganan"...');
        await confirmBtn.click();
        await page.waitForTimeout(2500);

        // Cek status setelah klik konfirmasi
        const afterText = await page.locator('button:has-text("Subscribe"), button:has-text("Langganan")').first().textContent().catch(() => 'Belum berubah');
        console.log(`🏁 Status tombol setelah unsubscribe: "${afterText?.trim()}"`);
      }
    } else {
      console.log('Channel ini belum dalam status subscribe.');
    }

  } catch (err) {
    console.error('Error test unsubscribe:', err);
  } finally {
    await context.close();
  }
}

testUnsubscribeOne();
