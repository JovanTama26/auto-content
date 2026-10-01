import { launchBrowser } from './actions/launch-browser';

async function auditAllSubscriptions() {
  console.log('🔍 Mengaudit status langganan seluruh 37 channel ke @Q5Bioskop...');
  const { page, context } = await launchBrowser({ headed: true, profileName: 'user_2' });

  try {
    await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const cards = page.locator('ytd-account-item-renderer');
    const total = await cards.count();
    console.log(`Total channel cards: ${total}`);

    const auditResults: { name: string; isSubscribed: boolean; buttonText: string }[] = [];

    for (let i = 0; i < total; i++) {
      if (!page.url().includes('channel_switcher')) {
        await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
      }

      const card = page.locator('ytd-account-item-renderer').nth(i);
      const title = (await card.locator('#channel-title, yt-formatted-string#title').textContent())?.trim() || `Channel ${i+1}`;
      
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await card.click();
      await page.waitForTimeout(2500);

      await page.goto('https://www.youtube.com/@Q5Bioskop', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      const status = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button')).filter(b => 
          b.textContent?.includes('scribe') || b.textContent?.includes('Langgan') ||
          b.getAttribute('aria-label')?.includes('scribe') || b.getAttribute('aria-label')?.includes('Langgan')
        );
        const subBtn = btns[0];
        const text = subBtn?.textContent?.trim() || 'NOT_FOUND';
        const isSubbed = text.includes('Disubscribe') || text.includes('Subscribed') || subBtn?.getAttribute('aria-label')?.includes('Disubscribe') || false;
        return { text, isSubbed };
      });

      console.log(`[${i+1}/${total}] "${title}" -> ${status.isSubbed ? '✅ DISUBSCRIBE (Aktif Langganan)' : '❌ BELUM Langganan (' + status.text + ')'}`);
      auditResults.push({ name: title, isSubscribed: status.isSubbed, buttonText: status.text });
    }

    const subbedCount = auditResults.filter(r => r.isSubscribed).length;
    console.log('\n====================================================');
    console.log(`📊 HASIL AUDIT: ${subbedCount} dari ${total} channel BERSTATUS LANGGANAN (Disubscribe)!`);
    console.log('====================================================');

  } catch (err) {
    console.error('Audit error:', err);
  } finally {
    await context.close();
  }
}

auditAllSubscriptions();
