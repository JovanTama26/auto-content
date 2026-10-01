import { launchBrowser } from './actions/launch-browser';
import fs from 'fs';
import path from 'path';

async function testChannelSwitcherCards() {
  console.log('🚀 Checking channel switcher for user_2...');
  const { page, context } = await launchBrowser({ headed: true, profileName: 'user_2' });

  try {
    await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const debugDir = path.join(process.cwd(), 'playwright', 'debug');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    await page.screenshot({ path: path.join(debugDir, 'channel_switcher_user2.png'), fullPage: true });

    const channelList = await page.evaluate(() => {
      // Find all channel items / links
      const items = Array.from(document.querySelectorAll('ytd-account-item-renderer, a#channel-title, [role="link"], a[href*="channel_switcher"]'));
      
      // Let's find all cards in channel switcher
      const cards = Array.from(document.querySelectorAll('ytd-account-item-renderer')).map((el, idx) => {
        const titleEl = el.querySelector('#channel-title, yt-formatted-string#title, yt-formatted-string');
        const byline = el.querySelector('#byline, #email');
        const link = el.querySelector('a');
        return {
          index: idx,
          title: titleEl?.textContent?.trim(),
          byline: byline?.textContent?.trim(),
          href: link?.getAttribute('href'),
          isSelected: el.getAttribute('aria-selected') === 'true' || !!el.querySelector('[aria-label*="dipilih"], [aria-label*="selected"], [icon="yt-icons:check"]')
        };
      });

      return cards;
    });

    console.log(`Ditemukan ${channelList.length} channel cards di switcher:`);
    console.log(JSON.stringify(channelList.slice(0, 10), null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await page.waitForTimeout(4000);
    await context.close();
  }
}

testChannelSwitcherCards();
