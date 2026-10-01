import { launchBrowser } from './actions/launch-browser';

async function inspectModalByText() {
  const { page, context } = await launchBrowser({ headed: true, profileName: 'user_1' });

  try {
    await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const createBtn = page.locator('a[href*="create_channel"], ytd-button-renderer:has-text("Buat channel"), [aria-label*="Buat channel"]').first();
    await createBtn.click();
    await page.waitForTimeout(3000);

    const info = await page.evaluate(() => {
      // Find element containing "Tampilan profil Anda"
      const allElements = Array.from(document.querySelectorAll('*'));
      const header = allElements.find(el => el.children.length === 0 && el.textContent?.includes('Tampilan profil Anda'));
      if (!header) return { error: 'Header not found' };

      // Find the closest dialog or popup container
      let container: HTMLElement | null = header as HTMLElement;
      while (container && container !== document.body) {
        if (container.tagName.toLowerCase().includes('dialog') || 
            container.tagName.toLowerCase().includes('popup') ||
            container.getAttribute('role') === 'dialog' ||
            container.classList.contains('style-scope') && container.children.length > 3) {
          // Check if this container contains the inputs
          if (container.querySelectorAll('input').length > 0) {
            break;
          }
        }
        container = container.parentElement;
      }

      if (!container) container = header.parentElement?.parentElement?.parentElement as HTMLElement;

      const inputs = Array.from(container?.querySelectorAll('input') || []).map(inp => ({
        tag: inp.tagName,
        type: inp.type,
        id: inp.id,
        name: inp.name,
        placeholder: inp.placeholder,
        value: inp.value,
        ariaLabel: inp.getAttribute('aria-label'),
        className: inp.className,
        parentTag: inp.parentElement?.tagName
      }));

      const buttons = Array.from(container?.querySelectorAll('button, [role="button"]') || []).map(b => ({
        tag: b.tagName,
        text: b.textContent?.trim(),
        id: b.id,
        role: b.getAttribute('role'),
        ariaDisabled: b.getAttribute('aria-disabled'),
        className: b.className
      }));

      return {
        containerTag: container?.tagName,
        containerClass: container?.className,
        inputs,
        buttons
      };
    });

    console.log('Result:', JSON.stringify(info, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await context.close();
  }
}

inspectModalByText();
