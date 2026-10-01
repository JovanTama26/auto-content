import { launchBrowser } from './actions/launch-browser';
import fs from 'fs';
import path from 'path';

async function testSubscribeOne() {
  const targetChannelUrl = 'https://www.youtube.com/@Q5Bioskop';
  console.log(`🎯 Testing switch to channel index 1 and subscribe to ${targetChannelUrl}...`);
  const { page, context } = await launchBrowser({ headed: true, profileName: 'user_2' });

  try {
    // 1. Go to switcher
    console.log('🧭 Ke channel switcher...');
    await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const cards = page.locator('ytd-account-item-renderer');
    const totalCards = await cards.count();
    console.log(`Ditemukan ${totalCards} channel.`);

    // Pilih channel index 1 (misal channel kedua di list)
    const targetCard = cards.nth(1);
    const cardTitle = await targetCard.locator('#channel-title, yt-formatted-string#title').textContent();
    console.log(`👆 Mengklik channel: "${cardTitle?.trim()}"...`);
    await targetCard.click();

    // Tunggu navigasi setelah switch channel
    await page.waitForTimeout(4000);
    console.log(`URL setelah switch: ${page.url()}`);

    // 2. Navigasi ke channel target @Q5Bioskop
    console.log(`🧭 Membuka target: ${targetChannelUrl}...`);
    await page.goto(targetChannelUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const debugDir = path.join(process.cwd(), 'playwright', 'debug');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    await page.screenshot({ path: path.join(debugDir, 'before_subscribe_q5.png'), fullPage: true });

    // 3. Cek tombol Subscribe
    const subBtnLocator = page.locator(
      'ytd-subscribe-button-renderer button, #subscribe-button button, [aria-label*="Subscribe"], [aria-label*="Langganan"], [aria-label*="Disubscribe"]'
    ).first();

    const btnText = await subBtnLocator.textContent();
    const ariaLabel = await subBtnLocator.getAttribute('aria-label');
    console.log(`🔘 Tombol subscribe ditemukan: Text="${btnText?.trim()}", aria-label="${ariaLabel}"`);

    if (btnText?.includes('Disubscribe') || btnText?.includes('Subscribed') || ariaLabel?.includes('Disubscribe')) {
      console.log('✅ Sudah dalam status Subscribe!');
    } else {
      console.log('🚀 Mengklik tombol Subscribe / Langganan...');
      await subBtnLocator.click();
      await page.waitForTimeout(2500);

      const afterText = await subBtnLocator.textContent();
      console.log(`🏁 Status tombol setelah klik: "${afterText?.trim()}"`);
      await page.screenshot({ path: path.join(debugDir, 'after_subscribe_q5.png'), fullPage: true });
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await page.waitForTimeout(3000);
    await context.close();
  }
}

testSubscribeOne();
