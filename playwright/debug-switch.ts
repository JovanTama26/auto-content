import { launchBrowser } from './actions/launch-browser';

async function debugSwitching() {
  const { page, context } = await launchBrowser({ headed: true, profileName: 'user_2' });

  try {
    await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const cards = page.locator('ytd-account-item-renderer');
    const count = await cards.count();
    console.log(`Cards count: ${count}`);

    // Check first 3 cards
    for (let i = 0; i < Math.min(3, count); i++) {
      console.log(`\nTesting Card ${i}...`);
      if (!page.url().includes('channel_switcher')) {
        await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
      }

      const card = page.locator('ytd-account-item-renderer').nth(i);
      const cardTitle = (await card.locator('#channel-title, yt-formatted-string#title').textContent())?.trim();
      console.log(`Card ${i} title: "${cardTitle}"`);

      // Inspect link and onclick on the card
      const cardHTML = await card.evaluate(el => ({
        tag: el.tagName,
        outerHTML: el.outerHTML.slice(0, 300),
        aHref: el.querySelector('a')?.getAttribute('href'),
        role: el.getAttribute('role'),
        tabIndex: el.getAttribute('tabindex')
      }));
      console.log(`Card ${i} structure:`, cardHTML);

      // Click card
      console.log(`Clicking Card ${i}...`);
      await card.click();
      await page.waitForTimeout(4000);

      // Check current channel identity on YouTube
      const identity = await page.evaluate(() => {
        const ytcfg = (window as any).ytcfg;
        const channelId = ytcfg ? ytcfg.get('CHANNEL_ID') : null;
        const userEmail = ytcfg ? ytcfg.get('USER_EMAIL') : null;
        const delegatedContextId = ytcfg ? ytcfg.get('DELEGATED_SESSION_ID') : null;
        return { channelId, userEmail, delegatedContextId, currentUrl: window.location.href };
      });
      console.log(`Identity after switch ${i}:`, identity);

      // Now go to @Q5Bioskop
      await page.goto('https://www.youtube.com/@Q5Bioskop', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      // Check Subscribe button exact state
      const subState = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button')).filter(b => 
          b.textContent?.includes('scribe') || b.textContent?.includes('Langgan') ||
          b.getAttribute('aria-label')?.includes('scribe') || b.getAttribute('aria-label')?.includes('Langgan')
        );
        return btns.map(b => ({
          text: b.textContent?.trim(),
          ariaLabel: b.getAttribute('aria-label'),
          ariaPressed: b.getAttribute('aria-pressed'),
          classes: b.className
        }));
      });
      console.log(`Sub state on @Q5Bioskop for Card ${i}:`, subState);
    }

  } catch (err) {
    console.error('Debug error:', err);
  } finally {
    await context.close();
  }
}

debugSwitching();
