import { launchBrowser } from './actions/launch-browser';

async function testConfirmUnsub() {
  const targetChannelUrl = 'https://www.youtube.com/@Q5Bioskop';
  const { page, context } = await launchBrowser({ headed: true, profileName: 'user_2' });

  try {
    await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const cards = page.locator('ytd-account-item-renderer');
    await cards.nth(1).click();
    await page.waitForTimeout(3500);

    await page.goto(targetChannelUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const subBtn = page.locator('button:has-text("Disubscribe"), [aria-label*="Disubscribe"]').first();
    if (await subBtn.isVisible().catch(() => false)) {
      console.log('1. Klik Disubscribe...');
      await subBtn.click();
      await page.waitForTimeout(1000);

      console.log('2. Klik Unsubscribe di dropdown...');
      const menuItem = page.locator('ytd-menu-service-item-renderer:has-text("Unsubscribe"), [role="menuitem"]:has-text("Unsubscribe")').first();
      await menuItem.click();
      await page.waitForTimeout(1500);

      console.log('3. Klik tombol Unsubscribe di dalam dialog...');
      const dialogConfirmBtn = page.locator('[role="dialog"] button:has-text("Unsubscribe"), tp-yt-paper-dialog button:has-text("Unsubscribe")').first();
      await dialogConfirmBtn.click();
      await page.waitForTimeout(2500);

      const statusAfter = await page.evaluate(() => {
        const btn = document.querySelector('#subscribe-button button, ytd-subscribe-button-renderer button');
        return btn?.textContent?.trim();
      });
      console.log(`🎉 Status akhir setelah unsubscribe: "${statusAfter}"`);
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await context.close();
  }
}

testConfirmUnsub();
