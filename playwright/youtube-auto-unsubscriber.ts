import { launchBrowser } from './actions/launch-browser';
import fs from 'fs';
import path from 'path';

export async function runAutoUnsubscriber(options: {
  targetChannelUrl?: string;
  profileName?: string;
  minDelay?: number;
  maxDelay?: number;
}) {
  const targetChannelUrl = options.targetChannelUrl ?? 'https://www.youtube.com/@Q5Bioskop';
  const profileName = options.profileName ?? 'user_2';
  const minDelay = options.minDelay ?? 2;
  const maxDelay = options.maxDelay ?? 4;

  console.log('====================================================');
  console.log('🔄 YOUTUBE MULTI-CHANNEL AUTO UNSUBSCRIBER');
  console.log('====================================================');
  console.log(`🎯 Target Channel  : ${targetChannelUrl}`);
  console.log(`📁 Profile Browser  : ${profileName}`);
  console.log(`⏱️ Jeda per channel : ${minDelay}s - ${maxDelay}s`);
  console.log('====================================================\n');

  const { page, context } = await launchBrowser({ headed: true, profileName });

  try {
    console.log('🧭 Membaca seluruh sub-channel di https://www.youtube.com/channel_switcher...');
    await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    const cards = page.locator('ytd-account-item-renderer');
    const totalChannels = await cards.count();
    console.log(`📊 Terdeteksi ${totalChannels} sub-channel untuk diperiksa.\n`);

    if (totalChannels === 0) {
      console.warn('⚠️ Tidak ada sub-channel yang ditemukan.');
      return;
    }

    const channelNames: string[] = [];
    for (let i = 0; i < totalChannels; i++) {
      const name = await cards.nth(i).locator('#channel-title, yt-formatted-string#title').textContent();
      channelNames.push(name?.trim() || `Channel ${i + 1}`);
    }

    let unsubscribedCount = 0;
    let notSubbedCount = 0;

    for (let i = 0; i < totalChannels; i++) {
      if (page.isClosed()) break;
      const currentName = channelNames[i];
      console.log(`----------------------------------------------------`);
      console.log(`▶️ [Channel ${i + 1}/${totalChannels}] Switch ke: "${currentName}"`);
      console.log(`----------------------------------------------------`);

      try {
        if (!page.url().includes('channel_switcher')) {
          await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(2500);
        }

        const currentCards = page.locator('ytd-account-item-renderer');
        const targetCard = currentCards.nth(i);
        await targetCard.scrollIntoViewIfNeeded().catch(() => {});
        await targetCard.click();
        await page.waitForTimeout(3000);

        // Buka target channel
        console.log(`🧭 Membuka target: ${targetChannelUrl}...`);
        await page.goto(targetChannelUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await page.waitForTimeout(2500);

        // Cek apakah ada tombol Disubscribe
        const disubscribeBtn = page.locator('button:has-text("Disubscribe"), [aria-label*="Disubscribe"]').first();
        const isCurrentlySubbed = await disubscribeBtn.isVisible().catch(() => false);

        if (isCurrentlySubbed) {
          console.log(`Terdeteksi status langganan aktif. Memproses unsubscribe untuk "${currentName}"...`);
          // 1. Klik tombol Disubscribe dropdown
          await disubscribeBtn.click();
          await page.waitForTimeout(1000);

          // 2. Klik opsi "Unsubscribe" di menu popup
          const menuItem = page.locator(
            'ytd-menu-service-item-renderer:has-text("Unsubscribe"), tp-yt-paper-item:has-text("Unsubscribe"), [role="menuitem"]:has-text("Unsubscribe")'
          ).first();

          if (await menuItem.isVisible().catch(() => false)) {
            await menuItem.click();
            await page.waitForTimeout(1200);

            // 3. Klik tombol konfirmasi Unsubscribe di modal dialog
            const confirmBtn = page.locator(
              '[role="dialog"] button:has-text("Unsubscribe"), [role="dialog"] button:has-text("Batalkan langganan"), tp-yt-paper-dialog button:has-text("Unsubscribe")'
            ).first();

            if (await confirmBtn.isVisible().catch(() => false)) {
              await confirmBtn.click();
              await page.waitForTimeout(2000);
              console.log(`✅ [${i + 1}/${totalChannels}] "${currentName}" BERHASIL DI-UNSUBSCRIBE!`);
              unsubscribedCount++;
            } else {
              console.warn(`⚠️ Tombol konfirmasi dialog tidak ditemukan.`);
            }
          } else {
            console.warn(`⚠️ Menu item Unsubscribe tidak muncul.`);
          }
        } else {
          console.log(`ℹ️ [${i + 1}/${totalChannels}] "${currentName}" memang BELUM / SUDAH TIDAK langganan.`);
          notSubbedCount++;
        }

      } catch (err: any) {
        if (page.isClosed()) break;
        console.error(`❌ Gagal pada channel "${currentName}":`, err?.message);
      }

      const ms = Math.floor((minDelay + Math.random() * (maxDelay - minDelay)) * 1000);
      await page.waitForTimeout(ms);
    }

    console.log('\n====================================================');
    console.log('🏁 SELESAI PROSES AUTO UNSUBSCRIBE');
    console.log(`📊 Berhasil di-Unsubscribe : ${unsubscribedCount} channel`);
    console.log(`📊 Sudah Tidak Langganan   : ${notSubbedCount} channel`);
    console.log('====================================================\n');

  } catch (err: any) {
    console.error('Fatal error dalam unsubscriber:', err);
  } finally {
    if (!page.isClosed()) {
      await context.close().catch(() => {});
    }
  }
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  let targetChannelUrl = 'https://www.youtube.com/@Q5Bioskop';
  let profileName = 'user_2';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      targetChannelUrl = args[i + 1];
    }
    if (args[i] === '--profile' && args[i + 1]) {
      profileName = args[i + 1];
    }
  }

  runAutoUnsubscriber({ targetChannelUrl, profileName }).catch((err) => {
    console.error('Fatal Error:', err);
    process.exit(1);
  });
}
