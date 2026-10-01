import { launchBrowser } from './actions/launch-browser';

async function inspectChannelHeader() {
  const { page, context } = await launchBrowser({ headed: true, profileName: 'user_2' });

  try {
    await page.goto('https://www.youtube.com/@Q5Bioskop', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const buttons = await page.evaluate(() => {
      // Find all buttons in header
      const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
      return allButtons.map(b => ({
        tag: b.tagName,
        text: b.textContent?.trim(),
        ariaLabel: b.getAttribute('aria-label'),
        className: b.className
      })).filter(b => b.text?.includes('scribe') || b.text?.includes('Langgan') || b.ariaLabel?.includes('scribe') || b.ariaLabel?.includes('Langgan'));
    });

    console.log('Sub buttons found:', JSON.stringify(buttons, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await context.close();
  }
}

inspectChannelHeader();
