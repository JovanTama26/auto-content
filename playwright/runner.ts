import { Page, BrowserContext, Response } from 'playwright';
import { launchBrowser } from './actions/launch-browser';
import { createFlowProjectAction, extractProjectIdFromUrl } from './actions/flow/create-project';
import { dismissOverlayModals, ensureModelAndSettings, ensureAgentModeDisabled } from './actions/flow/generate-images-ui';
import path from 'path';
import fs from 'fs';

const PROJECT_ROOT = path.resolve(__dirname, '..');

export interface BatchRunnerItem {
  segment_id: number;
  prompt: string;
  output_path?: string;
}

export interface BatchRunnerOptions {
  projectId?: string;
  items: BatchRunnerItem[];
  concurrency?: number;
  profiles?: string[];
  models?: string[];
  headed?: boolean;
  onItemStart?: (segmentId: number) => void;
  onItemLog?: (segmentId: number, text: string) => void;
  onItemSuccess?: (segmentId: number, result: any) => void;
  onItemError?: (segmentId: number, error: string) => void;
}

export function getImageKey(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return url.split('?')[0];
  }
}

export function extractFlowUrls(text: string): string[] {
  if (!text) return [];
  const normalized = text.replace(/\\\//g, '/');
  const regex = /https:\/\/(?:flow-content\.google\/image\/|flow\.google\.com\/asb\/)[^"'\s\n\r<>]+/g;
  const rawMatches = normalized.match(regex) || [];
  const results: string[] = [];
  for (const m of rawMatches) {
    let clean = m
      .replace(/\\u0026/g, '&')
      .replace(/\\u003d/g, '=')
      .replace(/\\u0025/g, '%')
      .replace(/\\/g, '');
    clean = clean.replace(/[,;]+$/, '');
    if (clean.startsWith('http')) {
      results.push(clean);
    }
  }
  return results;
}

async function downloadImageBuffer(
  page: Page | null,
  context: BrowserContext | null,
  url: string
): Promise<Buffer | null> {
  // Method 1: Playwright context API request with authenticated Google session
  if (context) {
    try {
      const resp = await context.request.get(url, {
        headers: {
          'Referer': 'https://flow.google.com/',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
        timeout: 20000,
      });
      if (resp.ok()) {
        const buf = await resp.body();
        if (buf && buf.length > 500) {
          return buf;
        }
      } else {
        console.warn(`[Batch Engine] context.request.get status: ${resp.status()}`);
      }
    } catch (e: any) {
      console.warn('[Batch Engine] context.request.get error:', e.message);
    }
  }

  // Method 2: In-browser evaluate fetch & canvas extraction fallback
  if (page && !page.isClosed()) {
    try {
      const dataUrl = await page.evaluate(async (imgUrl) => {
        // Attempt 2A: fetch inside page context
        try {
          const res = await fetch(imgUrl);
          if (res.ok) {
            const blob = await res.blob();
            return await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          }
        } catch {}

        // Attempt 2B: Canvas extraction from DOM <img>
        try {
          const key = imgUrl.split('?')[0];
          const imgEl = Array.from(document.querySelectorAll('img')).find(
            (i) => i.src && (i.src === imgUrl || i.src.split('?')[0] === key)
          ) as HTMLImageElement | undefined;
          if (imgEl && imgEl.naturalWidth > 0) {
            const canvas = document.createElement('canvas');
            canvas.width = imgEl.naturalWidth;
            canvas.height = imgEl.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(imgEl, 0, 0);
              return canvas.toDataURL('image/png');
            }
          }
        } catch {}

        return null;
      }, url);

      if (dataUrl && dataUrl.includes(',')) {
        const base64 = dataUrl.split(',')[1];
        const buf = Buffer.from(base64, 'base64');
        if (buf.length > 500) {
          return buf;
        }
      }
    } catch (e: any) {
      console.warn('[Batch Engine] page.evaluate fetch/canvas error:', e.message);
    }
  }

  return null;
}

async function detectDailyLimit(page: Page): Promise<boolean> {
  try {
    if (page.isClosed()) return false;
    const limitTexts = [
      'batas harian',
      'daily limit',
      'reach the daily limit',
      'telah mencapai batas',
      'gunakan model lain',
      'use another model',
    ];
    return await page.evaluate((texts) => {
      const pageText = document.body.innerText.toLowerCase();
      return texts.some((t) => pageText.includes(t));
    }, limitTexts);
  } catch {
    return false;
  }
}

async function deleteFailedLimitCards(page: Page): Promise<void> {
  console.log('[Batch Engine] Locating and deleting failed limit card...');
  try {
    if (page.isClosed()) return;
    const card = page.locator('div').filter({ hasText: /batas harian|daily limit|telah mencapai batas/i }).first();
    if (await card.isVisible({ timeout: 1500 })) {
      const buttons = card.locator('button');
      const count = await buttons.count();
      if (count > 0) {
        await buttons.last().click({ timeout: 1500 });
        console.log('[Batch Engine] Clicked delete button on failed card.');
        await page.waitForTimeout(500);
      }
    }
  } catch (err: any) {
    console.warn('[Batch Engine] Warning: Failed to delete card:', err.message);
  }
}

interface ActiveSlot {
  segment_id: number;
  prompt: string;
  cleanedText: string;
  item: BatchRunnerItem;
  resolve: (url: string) => void;
  reject: (err: Error) => void;
  timeoutId: NodeJS.Timeout;
}

function getSavedProjectId(profileName: string): string | null {
  const mapPath = path.join(PROJECT_ROOT, 'playwright', 'user_data', 'projects_map.json');
  if (fs.existsSync(mapPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
      return data[profileName] || null;
    } catch {}
  }
  return null;
}

function saveProjectId(profileName: string, projectId: string): void {
  const mapPath = path.join(PROJECT_ROOT, 'playwright', 'user_data', 'projects_map.json');
  let data: Record<string, string> = {};
  if (fs.existsSync(mapPath)) {
    try {
      data = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    } catch {}
  }
  data[profileName] = projectId;
  fs.writeFileSync(mapPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[Batch Engine] Saved Project UUID "${projectId}" for profile "${profileName}"`);
}

async function initSessionForProfile(
  profileName: string,
  options: BatchRunnerOptions,
  activeSlots: Map<number, ActiveSlot>,
  seenImageUrls: Set<string>,
  dispatchNewImage: (url: string) => void
) {
  const userDataDir = path.join(PROJECT_ROOT, 'playwright', 'user_data', profileName);
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const session = await launchBrowser({
    headed: options.headed ?? true,
    userDataDir,
  });
  const context = session.context;
  const page = session.page;
  const INPUT_SELECTOR = 'div[contenteditable="true"], [contenteditable="true"], div[role="textbox"], textarea';

  const savedProjectId = options.projectId || getSavedProjectId(profileName);
  let loadedSavedSuccess = false;

  if (savedProjectId) {
    console.log(`[Batch Engine] Profile "${profileName}" using Project ID "${savedProjectId}". Opening existing project...`);
    const targetUrl = `https://flow.google.com/project/${savedProjectId}`;
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await dismissOverlayModals(page);
      await page.waitForSelector(INPUT_SELECTOR, { state: 'visible', timeout: 15000 });
      console.log(`[Batch Engine] Successfully opened project "${savedProjectId}" for profile "${profileName}"!`);
      loadedSavedSuccess = true;
    } catch (e) {
      console.warn(`[Batch Engine] Project "${savedProjectId}" could not be loaded directly. Will try creating or recovering project.`);
    }
  }

  if (!loadedSavedSuccess) {
    console.log(`[Batch Engine] Creating or detecting project for profile "${profileName}"...`);
    const createRes = await createFlowProjectAction(page);
    if (createRes.success && createRes.projectId) {
      console.log(`[Batch Engine] Fresh project created for profile "${profileName}": ${createRes.projectId}`);
      saveProjectId(profileName, createRes.projectId);
    } else {
      await page.goto('https://flow.google.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
      const currentId = extractProjectIdFromUrl(page.url());
      if (currentId) {
        saveProjectId(profileName, currentId);
      }
    }

    await dismissOverlayModals(page);
    try {
      await page.waitForSelector(INPUT_SELECTOR, { state: 'visible', timeout: 20000 });
    } catch (e) {
      await dismissOverlayModals(page);
      await page.waitForSelector(INPUT_SELECTOR, { timeout: 20000 });
    }
  }

  await ensureAgentModeDisabled(page);

  // Initialize seenImageUrls with any existing images on canvas
  try {
    const existingImgs = await page.evaluate(() => {
      const imgs = Array.from(
        document.querySelectorAll('img[alt*="Tile displaying"], img[src*="flow-content.google"], img[src*="/asb/"]')
      ) as HTMLImageElement[];
      return imgs.map((i) => i.src).filter((s) => s && s.startsWith('http'));
    });
    for (const src of existingImgs) {
      seenImageUrls.add(getImageKey(src));
    }
    console.log(`[Batch Engine] Initialized with ${seenImageUrls.size} existing canvas image(s).`);
  } catch {}

  // Setup network response listener for image generation
  page.on('response', async (response: Response) => {
    const url = response.url();
    const status = response.status();

    if (status === 200) {
      // 1. Direct flow-content image URL
      if (url.includes('flow-content.google/image/') || url.includes('/asb/')) {
        dispatchNewImage(url);
        return;
      }

      // 2. batchexecute RPC containing generated image URL
      if (url.includes('batchexecute')) {
        try {
          const text = await response.text();
          const urls = extractFlowUrls(text);
          for (const u of urls) {
            dispatchNewImage(u);
          }
        } catch {}
      }

      // 3. Legacy batchGenerateImages fallback
      if (url.includes('flowMedia:batchGenerateImages') || url.includes('batchGenerateImages')) {
        try {
          const json = await response.json();
          if (json?.media && Array.isArray(json.media)) {
            for (const mediaItem of json.media) {
              const genImg = mediaItem?.image?.generatedImage;
              const fifeUrl = genImg?.fifeUrl;
              if (fifeUrl) dispatchNewImage(fifeUrl);
            }
          }
        } catch {}
      }
    }
  });

  return { context, page, INPUT_SELECTOR };
}

/**
 * Rolling Concurrent Queue Google Flow Batch Generator.
 * Submits prompts into Google Flow input box concurrently up to targetConcurrency (default 5),
 * maintaining active concurrent jobs in a single Chromium browser context.
 * Automatically switches AI model to "Banana 2" and profile to "user_2" if daily limit is reached.
 */
export async function runBatchPersistentQueue(options: BatchRunnerOptions): Promise<void> {
  const {
    items,
    headed = true,
    concurrency = 5,
    profiles = ['user_1', 'user_2'],
    models = ['Nano Banana 2', 'Banana 2', 'Nano Banana Pro'],
  } = options;
  const targetConcurrency = Math.max(1, concurrency);
  let profileIdx = 0;
  let modelIdx = 0;

  console.log(
    `[Batch Engine] Starting batch generation for ${items.length} item(s) (Concurrency: ${targetConcurrency}, Profiles: ${profiles.join(', ')}, Models: ${models.join(', ')})...`
  );

  const activeSlots = new Map<number, ActiveSlot>();
  const seenImageUrls = new Set<string>();
  const pendingDownloads = new Set<Promise<any>>();
  let pendingQueue = [...items];
  let isTyping = false;

  function dispatchNewImage(imageUrl: string) {
    if (!imageUrl) return;
    const key = getImageKey(imageUrl);
    if (seenImageUrls.has(key)) return;
    seenImageUrls.add(key);

    if (activeSlots.size > 0) {
      const segId = activeSlots.keys().next().value;
      if (segId !== undefined) {
        const slot = activeSlots.get(segId);
        if (slot) {
          console.log(`[Batch Engine] 🎯 Intercepted image for scene #${segId}: ${imageUrl.substring(0, 100)}...`);
          activeSlots.delete(segId);
          clearTimeout(slot.timeoutId);
          slot.resolve(imageUrl);
        }
      }
    }
  }

  let currentProfile = profiles[profileIdx] || 'user_1';
  let currentModel = models[modelIdx] || 'Nano Banana 2';

  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let INPUT_SELECTOR = 'div[contenteditable="true"], [contenteditable="true"], div[role="textbox"], textarea';

  try {
    const sessionData = await initSessionForProfile(
      currentProfile,
      options,
      activeSlots,
      seenImageUrls,
      dispatchNewImage
    );
    context = sessionData.context;
    page = sessionData.page;
    INPUT_SELECTOR = sessionData.INPUT_SELECTOR;

    if (page && !page.isClosed()) {
      await ensureModelAndSettings(page, { modelName: currentModel, ensureSingleImage: true });
    }

    while (pendingQueue.length > 0 || activeSlots.size > 0 || pendingDownloads.size > 0) {
      // Continuous DOM Canvas Check: If activeSlots > 0, inspect canvas tiles for newly rendered images
      if (page && !page.isClosed() && activeSlots.size > 0) {
        try {
          const canvasImgs = await page.evaluate(() => {
            const imgs = Array.from(
              document.querySelectorAll('img[alt*="Tile displaying"], img[src*="flow-content.google"], img[src*="/asb/"]')
            ) as HTMLImageElement[];
            return imgs.map((i) => i.src).filter((s) => s && s.startsWith('http'));
          });
          for (const src of canvasImgs) {
            dispatchNewImage(src);
          }
        } catch {}
      }

      // Check daily limit on active page
      if (page && !page.isClosed()) {
        const isLimit = await detectDailyLimit(page);
        if (isLimit) {
          console.warn(`[Batch Engine] 🛑 Daily limit detected on profile "${currentProfile}" (Model: ${currentModel})!`);
          await deleteFailedLimitCards(page);

          // Return active slots back to pending queue in exact original order so no work is lost
          const interruptedItems = Array.from(activeSlots.values()).map((s) => s.item).filter(Boolean);
          for (const [segId, slot] of activeSlots.entries()) {
            clearTimeout(slot.timeoutId);
          }
          activeSlots.clear();
          pendingQueue = [...interruptedItems, ...pendingQueue];

          // Phase 1 Fallback: Try next AI model on the current profile
          modelIdx++;
          if (modelIdx < models.length) {
            currentModel = models[modelIdx];
            console.log(`[Batch Engine] 🔄 Model limit hit on profile "${currentProfile}". Switching AI Model to "${currentModel}" (${pendingQueue.length} items remaining)...`);
            if (options.onItemLog) {
              options.onItemLog(
                0,
                `🛑 Batas harian ${models[modelIdx - 1]} tercapai pada ${currentProfile}. 🔄 Mengubah Model AI ke "${currentModel}"...`
              );
            }

            try {
              if (page && !page.isClosed()) {
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                await dismissOverlayModals(page);
              }
            } catch (err: any) {
              console.warn('[Batch Engine] Warning: Page reload failed, continuing with model switch:', err.message);
            }

            if (page && !page.isClosed()) {
              await ensureModelAndSettings(page, { modelName: currentModel, ensureSingleImage: true });
              await page.waitForTimeout(1000);
            }
            continue;
          }

          // Phase 2 Fallback: All models exhausted on current profile -> switch to next profile
          modelIdx = 0;
          currentModel = models[0];

          if (context) {
            try { await context.close(); } catch {}
            context = null;
            page = null;
          }

          profileIdx++;
          if (profileIdx < profiles.length) {
            currentProfile = profiles[profileIdx];
            console.log(`[Batch Engine] 🔄 Profile exhausted. Auto-switching to Profile "${currentProfile}" (${pendingQueue.length} items remaining)...`);
            if (options.onItemLog) {
              options.onItemLog(
                0,
                `🛑 Batas harian tercapai pada ${profiles[profileIdx - 1]}. 🔄 Mengalihkan ke Profile ${currentProfile}...`
              );
            }

            const newSession = await initSessionForProfile(
              currentProfile,
              options,
              activeSlots,
              seenImageUrls,
              dispatchNewImage
            );
            context = newSession.context;
            page = newSession.page;
            INPUT_SELECTOR = newSession.INPUT_SELECTOR;
            await ensureModelAndSettings(page, { modelName: currentModel, ensureSingleImage: true });
            await page.waitForTimeout(1500);
            continue;
          } else {
            console.error(`[Batch Engine] ❌ All profiles and models reached daily limit!`);
            for (const item of pendingQueue) {
              if (item && options.onItemError) {
                options.onItemError(
                  item.segment_id,
                  'LIMIT_REACHED: Semua Profile Chrome dan Model AI telah mencapai batas harian Google Flow.'
                );
              }
            }
            pendingQueue = [];
            break;
          }
        }
      }

      // If active pool has capacity and queue has items and no typing in progress:
      if (page && !page.isClosed() && activeSlots.size < targetConcurrency && pendingQueue.length > 0 && !isTyping) {
        const item = pendingQueue.shift();
        if (!item || !item.prompt) continue;

        const cleanedText = item.prompt.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

        if (options.onItemStart) {
          options.onItemStart(item.segment_id);
        }

        // Create promise for this item
        const itemPromise = new Promise<string>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            activeSlots.delete(item.segment_id);
            reject(new Error('TIMEOUT'));
          }, 90000);

          activeSlots.set(item.segment_id, {
            segment_id: item.segment_id,
            prompt: item.prompt,
            cleanedText,
            item,
            resolve: (url: string) => {
              clearTimeout(timeoutId);
              resolve(url);
            },
            reject: (err: Error) => {
              clearTimeout(timeoutId);
              reject(err);
            },
            timeoutId,
          });
        });

        const downloadTask = itemPromise.then(
          async (fifeUrl) => {
            console.log(`[Batch Engine] Scene #${item.segment_id} completed successfully (${currentProfile} — ${currentModel}).`);
            if (options.onItemLog) {
              options.onItemLog(item.segment_id, `🎉 Berhasil digenerate (${currentProfile} — ${currentModel})! Mengunduh gambar...`);
            }

            let savedPath: string | undefined = undefined;

            try {
              const buffer = await downloadImageBuffer(page, context, fifeUrl);
              if (buffer && buffer.length > 500) {
                if (item.output_path) {
                  const outDir = path.dirname(item.output_path);
                  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
                  fs.writeFileSync(item.output_path, buffer);
                  savedPath = item.output_path;
                  console.log(`[Batch Engine] 💾 Saved scene #${item.segment_id} to ${savedPath} (${buffer.length} bytes)`);
                }
              }
            } catch (dlErr: any) {
              console.warn(`[Batch Engine] Warning: Direct download failed for scene #${item.segment_id}:`, dlErr.message);
            }

            if (options.onItemSuccess) {
              options.onItemSuccess(item.segment_id, {
                success: true,
                images: [{ url: fifeUrl, filePath: savedPath }],
              });
            }
          },
          (err) => {
            console.warn(`[Batch Engine] Scene #${item.segment_id} failed:`, err?.message || err);
            if (options.onItemError) options.onItemError(item.segment_id, err?.message || String(err));
          }
        ).finally(() => {
          pendingDownloads.delete(downloadTask);
        });
        pendingDownloads.add(downloadTask);

        // Submit prompt into Google Flow textbox
        isTyping = true;
        try {
          if (options.onItemLog) options.onItemLog(item.segment_id, '✍️ Menyiapkan prompt...');
          await ensureModelAndSettings(page, { modelName: currentModel, ensureSingleImage: true });

          const input = await page.$(INPUT_SELECTOR);
          if (!input) throw new Error('Prompt input field not found on Google Flow page');

          await input.click();
          await page.keyboard.press('Control+A');
          await page.keyboard.press('Backspace');
          await page.waitForTimeout(50);

          if (options.onItemLog) {
            options.onItemLog(
              item.segment_id,
              `📋 Paste prompt scene #${item.segment_id} [${currentProfile} — ${currentModel}] (slot aktif: ${activeSlots.size}/${targetConcurrency})...`
            );
          }

          // Instant paste insertion without key-by-key delay:
          await page.keyboard.insertText(cleanedText);
          await page.waitForTimeout(100);

          // Fallback check: if text is empty, set textContent & dispatch events
          const currentVal = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            return el ? el.textContent || '' : '';
          }, INPUT_SELECTOR);

          if (!currentVal.trim()) {
            await page.evaluate(
              ({ sel, text }) => {
                const el = document.querySelector(sel) as HTMLElement;
                if (el) {
                  el.focus();
                  el.textContent = text;
                  el.dispatchEvent(new InputEvent('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                }
              },
              { sel: INPUT_SELECTOR, text: cleanedText }
            );
            await page.waitForTimeout(100);
          }

          console.log(`[Batch Engine] Submitting scene #${item.segment_id} to Google AI [${currentProfile} — ${currentModel}] (Active slots: ${activeSlots.size})...`);
          const arrowBtn = await page.$('button:has(i:has-text("arrow_forward"))');
          if (arrowBtn && (await arrowBtn.isVisible())) {
            await arrowBtn.click({ force: true });
          } else {
            await page.keyboard.press('Enter');
          }

          if (options.onItemLog) {
            options.onItemLog(item.segment_id, `📩 Prompt Submitted [${currentProfile} — ${currentModel}]! Menunggu hasil gambar...`);
          }

          // Brief pause after submission before pasting next prompt
          await page.waitForTimeout(400);
        } catch (err: any) {
          console.warn(`[Batch Engine] Error typing prompt for scene #${item.segment_id}:`, err.message);
          const slot = activeSlots.get(item.segment_id);
          if (slot) {
            activeSlots.delete(item.segment_id);
            slot.reject(err);
          }
        } finally {
          isTyping = false;
        }
      }

      await page?.waitForTimeout(200);
    }
  } catch (err: any) {
    console.error('[Batch Engine] Global Exception:', err);
  } finally {
    if (pendingDownloads.size > 0) {
      console.log(`[Batch Engine] Waiting for ${pendingDownloads.size} pending download(s) to finish...`);
      await Promise.allSettled(Array.from(pendingDownloads));
    }
    if (context) {
      console.log('[Batch Engine] Queue complete. Closing browser context...');
      try {
        await context.close();
      } catch {}
    }
  }
}
