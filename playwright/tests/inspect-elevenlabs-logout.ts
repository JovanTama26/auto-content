import { launchBrowser } from '../actions/launch-browser';
import path from 'path';
import fs from 'fs';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('Testing launch browser and checking ElevenLabs UI...');
  const session = await launchBrowser({
    headed: false,
    profileName: 'user_1',
  });

  const { page, context } = session;

  page.on('console', (msg) => console.log('[Browser Console]', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('[Browser PageError]', err.message));

  try {
    console.log('Navigating to https://elevenlabs.io/app/speech-synthesis/text-to-speech...');
    await page.goto('https://elevenlabs.io/app/speech-synthesis/text-to-speech', {
      waitUntil: 'networkidle',
      timeout: 60000,
    }).catch((e) => console.log('goto catch:', e.message));
    await sleep(6000);

    console.log('Finding and clicking user-menu-button...');
    const userMenuBtn = page.locator('button[data-testid="user-menu-button"], button[aria-label="Your profile"]').first();
    await userMenuBtn.waitFor({ state: 'visible', timeout: 10000 });
    await userMenuBtn.click({ force: true });
    await sleep(1500);

    const screenshotsDir = path.resolve(process.cwd(), 'playwright', 'screenshots');
    await page.screenshot({ path: path.join(screenshotsDir, 'user-menu-open.png') });
    console.log('Screenshot of menu captured!');

    // Inspect dropdown menu items
    const menuItemsInfo = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[role="menuitem"], [data-radix-collection-item], [role="menu"] button, [role="menu"] a, div[role="menu"] *')).map((el) => {
        return {
          tag: el.tagName,
          text: (el.textContent || '').trim().replace(/\s+/g, ' '),
          ariaLabel: el.getAttribute('aria-label') || '',
          testid: el.getAttribute('data-testid') || '',
          role: el.getAttribute('role') || '',
          className: (el.className || '').slice(0, 50),
        };
      }).filter((x) => x.text.length > 0 && x.text.length < 50);

      // Find logout item specifically
      const logoutItem = items.find((x) => {
        const lower = x.text.toLowerCase();
        return lower.includes('log out') || lower.includes('sign out') || lower.includes('keluar');
      });

      return {
        totalItems: items.length,
        items,
        logoutItem,
      };
    });

    console.log('Menu items info:', JSON.stringify(menuItemsInfo, null, 2));

    // Now test clicking logout
    const logoutBtn = page.locator('[role="menuitem"], button, a').filter({ hasText: /log\s*out|sign\s*out/i }).first();
    if (await logoutBtn.isVisible().catch(() => false)) {
      console.log('Logout button is visible! Clicking logout button...');
      await logoutBtn.click({ force: true });
      await sleep(4000);

      console.log('After logout click URL:', page.url());
      await page.screenshot({ path: path.join(screenshotsDir, 'after-logout.png') });

      // Check if logged out (e.g. sign in button visible or url changed)
      const isLoggedOut = page.url().includes('sign-in') || page.url().includes('login') || page.url() === 'https://elevenlabs.io/';
      console.log('Logout success verified?', isLoggedOut);
    } else {
      console.log('Logout button not found in visible menu!');
    }
  } catch (err: any) {
    console.error('Error during test:', err.message);
  } finally {
    await session.context.close().catch(() => {});
  }
}

main();
