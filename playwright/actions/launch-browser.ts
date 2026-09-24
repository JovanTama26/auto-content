import { chromium, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

export interface LaunchOptions {
  headed?: boolean;
  userDataDir?: string;
  profileName?: string; // e.g. 'user_1', 'user_2'
  storageStatePath?: string;
  slowMo?: number;
}

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  isPersistent: boolean;
  profileName: string;
}

/**
 * Returns available user profiles in playwright/user_data/ (e.g. ['user_1', 'user_2'])
 */
export function getAvailableProfiles(): string[] {
  const baseDir = path.join(process.cwd(), 'playwright', 'user_data');
  if (!fs.existsSync(baseDir)) return ['user_1', 'user_2'];

  const dirs = fs.readdirSync(baseDir).filter((name) => {
    return name.startsWith('user_') && fs.statSync(path.join(baseDir, name)).isDirectory();
  });

  dirs.sort((a, b) => a.localeCompare(b));
  return dirs.length > 0 ? dirs : ['user_1', 'user_2'];
}

/**
 * Action: Launches a persistent browser session.
 */
export async function launchBrowser(options: LaunchOptions = {}): Promise<BrowserSession> {
  const headed = options.headed ?? true;
  const availableProfiles = getAvailableProfiles();
  const profileName = options.profileName || availableProfiles[0] || 'user_1';

  const userDataDir = options.userDataDir || path.join(process.cwd(), 'playwright', 'user_data', profileName);
  const storageStatePath = options.storageStatePath || config.storageStatePath;

  // Ensure directories exist
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  // Remove stale SingletonLock files if present
  const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
  for (const lockFile of lockFiles) {
    const lockPath = path.join(userDataDir, lockFile);
    if (fs.existsSync(lockPath)) {
      try {
        fs.unlinkSync(lockPath);
      } catch {}
    }
  }

  // Look for extension in several potential paths
  const extensionCandidates = [
    path.join(process.cwd(), 'extension'),
    path.join(process.cwd(), 'playwright', 'extension'),
  ];
  const validExtension = extensionCandidates.find((p) => fs.existsSync(p) && fs.existsSync(path.join(p, 'manifest.json')));

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--no-first-run',
    '--no-default-browser-check',
  ];

  if (validExtension) {
    launchArgs.push(
      `--disable-extensions-except=${validExtension}`,
      `--load-extension=${validExtension}`
    );
  }

  console.log(`[Playwright Action] Launching browser (profile: ${profileName}, headed: ${headed})`);

  // Check if official Google Chrome exists on system
  const hasSystemChrome = fs.existsSync('/usr/bin/google-chrome') || fs.existsSync('/usr/bin/google-chrome-stable');

  if (!headed) {
    // Chrome extension support in headless requires --headless=new
    launchArgs.push('--headless=new');
  }

  const launchOptions: any = {
    headless: false, // Must be false when using --headless=new to load extensions
    viewport: config.viewport,
    args: launchArgs,
    ignoreDefaultArgs: ['--enable-automation'],
    slowMo: options.slowMo ?? 0,
    acceptDownloads: true,
  };

  if (hasSystemChrome) {
    launchOptions.channel = 'chrome';
  }

  if (fs.existsSync(storageStatePath)) {
    launchOptions.storageState = storageStatePath;
  }

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  } catch (err: any) {
    // If launching with channel 'chrome' fails (e.g. process lock or version mismatch), fallback without channel
    if (launchOptions.channel) {
      console.warn(`[Playwright Action] Launch with channel 'chrome' failed, retrying with default chromium:`, err?.message);
      delete launchOptions.channel;
      context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    } else {
      throw err;
    }
  }

  // Stealth evasion script to mask navigator.webdriver
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  page.setDefaultTimeout(config.defaultTimeout);

  return { context, page, isPersistent: true, profileName };
}
