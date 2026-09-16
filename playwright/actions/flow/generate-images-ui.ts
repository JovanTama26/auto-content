import { Page, Response } from 'playwright';
import { config } from '../../config';

export interface GenerateUiOptions {
  projectId: string;
  promptText: string;
  modelName?: string; // default: 'Nano Banana Pro'
  timeoutMs?: number;
  ensureSingleImage?: boolean;
}

export interface UiImageResult {
  success: boolean;
  images: Array<{
    url?: string;
    mediaId?: string;
    dimensions?: { width: number; height: number };
    prompt?: string;
  }>;
  rawResponse?: any;
  error?: string;
}

/**
 * Dismisses any Google Flow onboarding popups, welcome modals, or cookie banners.
 */
export async function dismissOverlayModals(page: Page): Promise<void> {
  try {
    const modalButtons = [
      'button:has-text("Got it")',
      'button:has-text("Mengerti")',
      'button:has-text("Tutup")',
      'button:has-text("Dismiss")',
      'button:has-text("Lanjutkan")',
      'button:has-text("Accept")',
    ];

    for (const selector of modalButtons) {
      const btn = await page.$(selector);
      if (btn && (await btn.isVisible())) {
        console.log(`[Playwright Action] Dismissing overlay popup: "${selector}"`);
        await btn.click();
        await page.waitForTimeout(400);
      }
    }
  } catch {}
}

/**
 * Ensures the 'Agen' / 'Agent' button is DEACTIVATED (toggled OFF).
 */
export async function ensureAgentModeDisabled(page: Page): Promise<void> {
  try {
    const agentBtnSelectors = [
      'button:has-text("Agen")',
      'button:has-text("Agent")',
      'div:has-text("Agen")',
      '[aria-label*="Agen"]',
    ];

    for (const selector of agentBtnSelectors) {
      const btn = await page.$(selector);
      if (btn && (await btn.isVisible())) {
        const isActive = await btn.evaluate((el) => {
          const bg = window.getComputedStyle(el).backgroundColor;
          const ariaPressed = el.getAttribute('aria-pressed');
          const isWhiteBg = bg.includes('255, 255, 255') || bg.includes('rgb(255') || bg.includes('#fff') || bg === 'white';
          return ariaPressed === 'true' || isWhiteBg || el.classList.contains('active') || el.classList.contains('selected');
        });

        if (isActive) {
          console.log(`[Playwright Action] "Agen" button is active. Clicking to turn it OFF...`);
          await btn.click();
          await page.waitForTimeout(400);
        }
        break;
      }
    }
  } catch (err) {
    console.warn('[Playwright Action] Warning checking Agent button state:', err);
  }
}

/**
 * Ensures Google Flow UI settings (Model: Nano Banana Pro / Banana 2, Count: x1).
 */
export async function ensureModelAndSettings(
  page: Page,
  options: { modelName?: string; ensureSingleImage?: boolean } = {}
): Promise<void> {
  const targetModel = options.modelName || 'Nano Banana 2';

  try {
    // 1. Locate settings pill button
    const pillBtn = await page.$('button[aria-haspopup="menu"]:has-text("Banana"), button[aria-haspopup="menu"]:has-text("x1"), button[aria-haspopup="menu"]:has-text("x2"), button:has-text("Banana")');
    if (!pillBtn) {
      return;
    }

    const currentPillText = (await pillBtn.textContent()) || '';
    const needsModelChange = !currentPillText.includes(targetModel);
    const needsCountChange = !currentPillText.includes('x1');

    if (!needsModelChange && !needsCountChange) {
      return;
    }

    console.log(`[Playwright Action] Opening settings popover (Current: "${currentPillText.trim()}", Target: "${targetModel}")...`);
    await pillBtn.click();
    await page.waitForTimeout(800);

    // 2. Select Model if needed
    if (needsModelChange) {
      const modelDropdownBtn = await page.$('div[role="menu"] button:has-text("Banana"), [role="menu"] button:has-text("Nano")');
      if (modelDropdownBtn && (await modelDropdownBtn.isVisible())) {
        await modelDropdownBtn.click();
        await page.waitForTimeout(800);

        const option = await page.$(`div[role="menuitem"]:has-text("${targetModel}"), button:has-text("${targetModel}")`);
        if (option && (await option.isVisible())) {
          await option.click();
          await page.waitForTimeout(500);
        } else {
          await page.evaluate((target) => {
            const els = Array.from(document.querySelectorAll('div[role="menuitem"], button, div, span'));
            for (const el of els) {
              const txt = el.textContent?.trim() || '';
              if (txt.includes(target) || txt.includes(`🍌 ${target}`)) {
                (el as HTMLElement).click();
                return true;
              }
            }
            return false;
          }, targetModel);
          await page.waitForTimeout(500);
        }
      }
    }

    // 3. Select 'x1' count tab inside popover
    if (needsCountChange) {
      const x1Tab = await page.$('div[role="menu"] button[role="tab"]:has-text("x1"), button:has-text("x1")');
      if (x1Tab && (await x1Tab.isVisible())) {
        await x1Tab.click();
        await page.waitForTimeout(300);
      }
    }

    // 4. Close popover by pressing Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  } catch (err) {
    console.warn('[Playwright Action] Warning during ensureModelAndSettings:', err);
  }
}

/**
 * Action: Generates images by typing prompt into Google Flow UI and intercepting the 200 OK batchGenerateImages response JSON.
 */
export async function generateFlowImagesUiAction(
  page: Page,
  options: GenerateUiOptions
): Promise<UiImageResult> {
  const {
    projectId,
    promptText,
    modelName = 'Nano Banana Pro',
    timeoutMs = 120000,
    ensureSingleImage = true,
  } = options;

  console.log(`[Playwright Action] Intercepting UI Image Generation for Project: ${projectId}`);

  let capturedResponseJson: any = null;
  let responsePromiseResolve: (json: any) => void;
  const responsePromise = new Promise<any>((resolve) => {
    responsePromiseResolve = resolve;
  });

  const responseHandler = async (response: Response) => {
    const url = response.url();
    if (url.includes('flowMedia:batchGenerateImages') || url.includes('batchGenerateImages')) {
      if (response.status() === 200) {
        try {
          const json = await response.json();
          capturedResponseJson = json;
          responsePromiseResolve(json);
        } catch (e) {
          console.warn('[Playwright Action] Failed to parse intercepted response JSON:', e);
        }
      }
    }
  };

  page.on('response', responseHandler);

  try {
    const currentUrl = page.url();
    if (!currentUrl.includes(projectId)) {
      const projectUrl = `https://labs.google/fx/id/tools/flow/project/${projectId}`;
      await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: config.defaultTimeout });
    }

    await dismissOverlayModals(page);
    const inputSelectorCombined = 'div[contenteditable="true"], [contenteditable="true"], div[role="textbox"]';

    await page.waitForSelector(inputSelectorCombined, { timeout: 30000, state: 'visible' });
    await page.waitForTimeout(800);

    await ensureAgentModeDisabled(page);
    await ensureModelAndSettings(page, { modelName, ensureSingleImage });

    const inputElement = await page.$(inputSelectorCombined);
    if (!inputElement) {
      throw new Error('Prompt input field could not be found on Google Flow page.');
    }

    const cleanedPromptText = promptText.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    await inputElement.click();
    await page.waitForTimeout(200);

    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);

    await page.keyboard.insertText(cleanedPromptText);
    await page.waitForTimeout(400);

    const arrowBtn = await page.$('button:has(i:has-text("arrow_forward"))');
    if (arrowBtn && (await arrowBtn.isVisible())) {
      await arrowBtn.click({ force: true });
    } else {
      await inputElement.focus();
      await page.keyboard.press('Enter');
    }

    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs)
    );

    const jsonResult = await Promise.race([responsePromise, timeoutPromise]);
    page.off('response', responseHandler);

    if (!jsonResult) {
      return {
        success: false,
        images: [],
        error: `Timed out after ${timeoutMs / 1000}s waiting for batchGenerateImages API response.`,
      };
    }

    let extractedImages: Array<{ url?: string; mediaId?: string; dimensions?: { width: number; height: number }; prompt?: string }> = [];
    if (jsonResult?.media && Array.isArray(jsonResult.media)) {
      extractedImages = jsonResult.media.map((item: any) => {
        const genImg = item?.image?.generatedImage;
        const dims = item?.image?.dimensions;
        return {
          url: genImg?.fifeUrl,
          mediaId: genImg?.mediaId || item?.name,
          dimensions: dims,
          prompt: genImg?.prompt,
        };
      });
    }

    return {
      success: extractedImages.length > 0,
      images: extractedImages,
      rawResponse: jsonResult,
    };
  } catch (error: any) {
    page.off('response', responseHandler);
    return {
      success: false,
      images: [],
      error: error?.message || String(error),
    };
  }
}
