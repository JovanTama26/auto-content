import { launchBrowser } from './actions/launch-browser';

async function testFillForm() {
  const { page, context } = await launchBrowser({ headed: true, profileName: 'user_1' });

  try {
    await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const createBtn = page.locator('a[href*="create_channel"], ytd-button-renderer:has-text("Buat channel"), [aria-label*="Buat channel"]').first();
    await createBtn.click();
    await page.waitForTimeout(2000);

    const dialog = page.locator('ytd-channel-creation-dialog-renderer');
    await dialog.waitFor({ state: 'visible', timeout: 10000 });

    const inputs = dialog.locator('input[type="text"]');
    console.log(`Inputs found: ${await inputs.count()}`);

    const nameInput = inputs.nth(0);
    const testChannelName = 'Nusantara Tech Lab ' + Math.floor(Math.random() * 1000);
    console.log(`Writing channel name: "${testChannelName}"`);
    await nameInput.click();
    await nameInput.fill(testChannelName);
    await page.waitForTimeout(1500);

    // Check second input (handle)
    const handleInput = inputs.nth(1);
    const handleVal = await handleInput.inputValue();
    console.log(`Handle value after typing name: "${handleVal}"`);

    // Check status of "Buat channel" button
    const submitBtn = dialog.locator('button:has-text("Buat channel")');
    const isDisabled = await submitBtn.getAttribute('aria-disabled');
    console.log(`Submit button aria-disabled: ${isDisabled}`);

    // If handle is empty or needed, we can also fill handle
    if (!handleVal || handleVal === '@') {
      const cleanHandle = testChannelName.toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(Math.random() * 100);
      console.log(`Filling handle manually: @${cleanHandle}`);
      await handleInput.click();
      await handleInput.fill(cleanHandle);
      await page.waitForTimeout(1500);
    }

    const isNowDisabled = await submitBtn.getAttribute('aria-disabled');
    console.log(`Submit button aria-disabled after handle: ${isNowDisabled}`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await context.close();
  }
}

testFillForm();
