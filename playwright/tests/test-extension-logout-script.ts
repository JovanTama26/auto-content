// playwright/tests/test-extension-logout-script.ts
import { launchBrowser } from '../actions/launch-browser';
import path from 'path';
import fs from 'fs';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('Testing extension executeSignOut logic in Playwright...');
  const session = await launchBrowser({
    headed: false,
    profileName: 'user_1',
  });

  const { page } = session;

  try {
    // 1. Navigate to ElevenLabs
    await page.goto('https://elevenlabs.io/app/speech-synthesis/text-to-speech', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await sleep(5000);

    console.log('Current URL:', page.url());

    // If currently on sign-in, login first
    if (page.url().includes('sign-in')) {
      console.log('Logging in to test executeSignOut...');
      const emailInput = page.locator('input[type="email"], input[name="email"]').first();
      const passInput = page.locator('input[type="password"], input[name="password"]').first();
      const submitBtn = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first();

      if (await emailInput.isVisible().catch(() => false)) {
        await emailInput.fill('jovankonten@gmail.com');
        await sleep(300);
        await passInput.fill('Jovan@1224');
        await sleep(300);
        await submitBtn.click({ force: true });
        await sleep(6000);
        console.log('URL after login:', page.url());
      }
    }

    // 2. Simulate modal opening (create a fake upgrade modal backdrop to test dismissal)
    await page.evaluate(() => {
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('data-state', 'open');
      modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50';
      modal.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
          <h2 class="text-xl font-bold">First Month 50% Off</h2>
          <p>You have 0 credits remaining. Upgrade now to continue generating speech.</p>
          <div class="mt-4 flex justify-end gap-2">
            <button id="test-close-btn" aria-label="Close dialog" class="px-4 py-2 border rounded">Remind Me Later</button>
            <button class="px-4 py-2 bg-blue-600 text-white rounded">Upgrade</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    });

    console.log('Simulated limit modal inserted into DOM.');
    await sleep(1000);

    // 3. Run the exact executeSignOut function we want in elevenlabs-signup.js
    console.log('Running executeSignOut evaluate in page context...');
    let evalError: any = null;
    let result: any = null;
    try {
      result = await page.evaluate(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        function triggerNativeClick(el) {
          if (!el) return;
          try {
            el.focus?.();
            const opts = { bubbles: true, cancelable: true, view: window };
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new PointerEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.click();
          } catch (e) {
            el.click?.();
          }
        }

        console.log('[ElevenLabsSignup] 🚪 Memulai proses Sign Out akun ElevenLabs...');

        // 1. Dismiss any blocking dialogs / upgrade modals
        try {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
          await sleep(200);

          const dismissButtons = Array.from(document.querySelectorAll(
            'button[aria-label*="close" i], button[aria-label*="dismiss" i], button:has-text("Remind Me Later"), button:has-text("Close"), button:has-text("✕")'
          ));
          for (const btn of dismissButtons) {
            triggerNativeClick(btn);
            await sleep(150);
          }

          // Netralkan pointer-events pada modal/backdrop yang masih terbuka
          const overlays = Array.from(document.querySelectorAll('[role="dialog"], [data-state="open"], .fixed.inset-0'));
          for (const o of overlays) {
            const txt = (o.textContent || '').toLowerCase();
            if (txt.includes('upgrade') || txt.includes('credits') || txt.includes('first month')) {
              o.style.pointerEvents = 'none';
            }
          }
        } catch (e) {}

        await sleep(400);

        // 2. Cari tombol avatar / profil
        let profileBtn = document.querySelector('button[data-testid="user-menu-button"], button[aria-label="Your profile"]');
        if (!profileBtn) {
          const buttons = Array.from(document.querySelectorAll('button'));
          profileBtn = buttons.find((b) => {
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            const tid = (b.getAttribute('data-testid') || '').toLowerCase();
            return aria.includes('profile') || tid.includes('user-menu') || aria.includes('account');
          });
        }

        if (profileBtn) {
          console.log('[ElevenLabsSignup] Tombol avatar ditemukan, mengklik...', profileBtn);
          triggerNativeClick(profileBtn);
          await sleep(1000);

          // 3. Cari opsi "Sign out" / "Log out" di menu dropdown yang muncul
          const menuItems = Array.from(
            document.querySelectorAll('[role="menuitem"], [data-radix-collection-item], [role="menu"] button, [role="menu"] a, button, a')
          );

          const signOutBtn = menuItems.find((el) => {
            const txt = (el.textContent || '').trim().toLowerCase();
            return (
              txt === 'sign out' ||
              txt === 'log out' ||
              txt.includes('sign out') ||
              txt.includes('log out') ||
              txt === 'keluar'
            );
          });

          if (signOutBtn) {
            console.log('[ElevenLabsSignup] 🎯 Tombol Sign out ditemukan di dropdown menu! Mengklik...', signOutBtn);
            triggerNativeClick(signOutBtn);
            // Click triggered, navigation begins immediately!
            return { success: true, method: 'ui_menu_click' };
          }
        }

        return { success: false, method: 'none' };
      })()
    `);
    } catch (e: any) {
      if (e.message.includes('navigation') || e.message.includes('destroyed')) {
        console.log('Navigation triggered during evaluate click (expected behavior):', e.message);
      } else {
        throw e;
      }
    }

    console.log('Result of executeSignOut evaluate:', result);

    // 4. Wait for redirect to sign-in
    console.log('Waiting for URL redirect to sign-in...');
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      if (page.url().includes('sign-in') || page.url().includes('login')) {
        console.log('Redirect to sign-in confirmed at second', i + 1, 'URL:', page.url());
        break;
      }
    }

    const finalUrl = page.url();
    console.log('Final URL after test:', finalUrl);
    const passed = finalUrl.includes('sign-in') || finalUrl.includes('login');
    console.log('Extension logic test passed?', passed);

  } catch (err: any) {
    console.error('Error during test:', err.message);
  } finally {
    await session.context.close().catch(() => {});
  }
}

main();
