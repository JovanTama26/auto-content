import { launchBrowser } from './actions/launch-browser';

async function testInputSelectors() {
  const { page, context } = await launchBrowser({ headed: true, profileName: 'user_1' });

  try {
    await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const createBtn = page.locator('a[href*="create_channel"], ytd-button-renderer:has-text("Buat channel"), [aria-label*="Buat channel"]').first();
    await createBtn.click();
    await page.waitForTimeout(3000);

    // Let's test different selectors
    const selectors = [
      'ytd-channel-creation-dialog-renderer input',
      'tp-yt-paper-dialog input',
      'ytd-modal-with-dimmed-background-renderer input',
      'tp-yt-paper-input input',
      'input[type="text"]',
      '#channel-name input',
      '#input-1',
      '#input-2'
    ];

    for (const sel of selectors) {
      const count = await page.locator(sel).count();
      console.log(`Selector "${sel}" -> count: ${count}`);
    }

    // Also inspect with evaluate
    const testEval = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('ytd-channel-creation-dialog-renderer input, tp-yt-paper-dialog input, input'));
      return inputs.map((inp, idx) => ({
        index: idx,
        type: inp.type,
        visible: (inp as HTMLElement).offsetParent !== null,
        outerHTML: inp.outerHTML.slice(0, 100),
        parent: inp.parentElement?.tagName
      }));
    });
    console.log('Eval inputs:', JSON.stringify(testEval, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await context.close();
  }
}

testInputSelectors();
