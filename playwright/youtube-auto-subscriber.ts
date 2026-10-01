import { launchBrowser } from './actions/launch-browser';
import fs from 'fs';
import path from 'path';

interface SubscriptionResult {
  index: number;
  channelName: string;
  status: 'subscribed' | 'already_subscribed' | 'failed';
  timestamp: string;
  error?: string;
}

function sleepRandom(minSeconds: number, maxSeconds: number): Promise<void> {
  const ms = Math.floor((minSeconds + Math.random() * (maxSeconds - minSeconds)) * 1000);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadExistingReport(filePath: string): Map<string, SubscriptionResult> {
  const map = new Map<string, SubscriptionResult>();
  if (!fs.existsSync(filePath)) return map;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const items: SubscriptionResult[] = JSON.parse(raw);
    for (const item of items) {
      if (item.status === 'subscribed' || item.status === 'already_subscribed') {
        map.set(item.channelName.toLowerCase(), item);
      }
    }
  } catch {}
  return map;
}

export async function runAutoSubscriber(options: {
  targetChannelUrl?: string;
  profileName?: string;
  minDelay?: number;
  maxDelay?: number;
  watchVideo?: boolean;
}) {
  const targetChannelUrl = options.targetChannelUrl ?? 'https://www.youtube.com/@Q5Bioskop';
  const profileName = options.profileName ?? 'user_2';
  const minDelay = options.minDelay ?? 3;
  const maxDelay = options.maxDelay ?? 6;
  const watchVideo = options.watchVideo ?? false;

  const reportDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `subscribers_report_${profileName}.json`);

  console.log('====================================================');
  console.log('🔔 YOUTUBE MULTI-CHANNEL AUTO SUBSCRIBER (PROTECTED)');
  console.log('====================================================');
  console.log(`🎯 Target Channel   : ${targetChannelUrl}`);
  console.log(`📁 Profile Browser   : ${profileName}`);
  console.log(`💾 Laporan Hasil     : ${reportPath}`);
  console.log(`🛡️ Anti-Unsubscribe  : AKTIF (Strict Guard)`);
  console.log('====================================================\n');

  const successfulMap = loadExistingReport(reportPath);
  const { page, context } = await launchBrowser({ headed: true, profileName });
  const results: SubscriptionResult[] = [];

  try {
    console.log('🧭 Membaca seluruh sub-channel di https://www.youtube.com/channel_switcher...');
    await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(4000);

    const cards = page.locator('ytd-account-item-renderer');
    const totalChannels = await cards.count();
    console.log(`📊 Terdeteksi ${totalChannels} sub-channel yang siap diproses.\n`);

    if (totalChannels === 0) {
      console.warn('⚠️ Tidak ada sub-channel yang ditemukan.');
      return;
    }

    const channelNames: string[] = [];
    for (let i = 0; i < totalChannels; i++) {
      const name = await cards.nth(i).locator('#channel-title, yt-formatted-string#title').textContent();
      channelNames.push(name?.trim() || `Channel ${i + 1}`);
    }

    for (let i = 0; i < totalChannels; i++) {
      if (page.isClosed()) {
        console.warn('⚠️ Browser ditutup oleh pengguna. Menghentikan loop.');
        break;
      }

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
        await page.waitForTimeout(3500);

        // Buka target channel
        console.log(`🧭 Membuka target: ${targetChannelUrl}...`);
        try {
          await page.goto(targetChannelUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
        } catch {
          if (page.isClosed()) break;
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 35000 });
        }
        await page.waitForTimeout(3000);

        // Evaluasi status tombol subscribe secara presisi
        const subButtonInfo = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button')).filter((b) => {
            const txt = (b.textContent || '').toLowerCase();
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            return (
              txt.includes('scribe') ||
              txt.includes('langgan') ||
              aria.includes('scribe') ||
              aria.includes('langgan')
            );
          });

          if (btns.length === 0) return null;
          const targetBtn = btns[0];
          const text = (targetBtn.textContent || '').trim().toLowerCase();
          const aria = (targetBtn.getAttribute('aria-label') || '').toLowerCase();

          // Deteksi apakah sudah berstatus subscribe
          const isSubscribed =
            text.includes('disubscribe') ||
            text.includes('subscribed') ||
            aria.includes('disubscribe') ||
            aria.includes('subscribed') ||
            aria.includes('notifikasi');

          // Deteksi apakah tombol murni tombol baru "Subscribe" / "Langganan"
          const isReadyToSubscribe =
            (text === 'subscribe' || text === 'langganan') && !isSubscribed;

          return {
            text,
            aria,
            isSubscribed,
            isReadyToSubscribe,
          };
        });

        if (!subButtonInfo) {
          console.warn(`⚠️ Tombol subscribe tidak terdeteksi untuk "${currentName}".`);
          continue;
        }

        // ====================================================
        // STRICT GUARD: JIKA SUDAH DISUBSCRIBE -> SKIP TOTAL!
        // ====================================================
        if (subButtonInfo.isSubscribed) {
          console.log(`🛡️ [${i + 1}/${totalChannels}] "${currentName}" SUDAH AKTIF DISUBSCRIBE. JANGAN KLIK APAPUN! (Lewati)`);
          const record: SubscriptionResult = {
            index: i + 1,
            channelName: currentName,
            status: 'already_subscribed',
            timestamp: new Date().toISOString(),
          };
          results.push(record);
          successfulMap.set(currentName.toLowerCase(), record);
          fs.writeFileSync(reportPath, JSON.stringify(Array.from(successfulMap.values()), null, 2), 'utf-8');
          continue;
        }

        // ====================================================
        // HANYA KLIK JIKA BENAR-BENAR BELUM SUBSCRIBE
        // ====================================================
        if (subButtonInfo.isReadyToSubscribe) {
          console.log(`🚀 Mengklik tombol Subscribe untuk "${currentName}"...`);
          const subBtnLocator = page.locator('button:has-text("Subscribe"), button:has-text("Langganan")').first();
          await subBtnLocator.click();
          await page.waitForTimeout(2500);

          console.log(`🎉 [${i + 1}/${totalChannels}] "${currentName}" BERHASIL SUBSCRIBE! ✅`);
          const record: SubscriptionResult = {
            index: i + 1,
            channelName: currentName,
            status: 'subscribed',
            timestamp: new Date().toISOString(),
          };
          results.push(record);
          successfulMap.set(currentName.toLowerCase(), record);
          fs.writeFileSync(reportPath, JSON.stringify(Array.from(successfulMap.values()), null, 2), 'utf-8');
        }

      } catch (err: any) {
        if (page.isClosed()) break;
        console.error(`❌ Error pada channel "${currentName}":`, err?.message);
      }

      if (i < totalChannels - 1 && !page.isClosed()) {
        await sleepRandom(minDelay, maxDelay);
      }
    }

  } catch (err: any) {
    console.error('Fatal error dalam auto subscriber:', err);
  } finally {
    console.log('\n====================================================');
    console.log('🏁 SELESAI PROSES AUTO SUBSCRIBE');
    const finalItems = Array.from(successfulMap.values());
    const subCount = finalItems.filter((r) => r.status === 'subscribed' || r.status === 'already_subscribed').length;
    console.log(`📊 Total Channel Berstatus Langganan: ${subCount}`);
    console.log(`💾 File Laporan: ${reportPath}`);
    console.log('====================================================\n');
    if (!page.isClosed()) {
      await context.close().catch(() => {});
    }
  }

  return results;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let targetChannelUrl = 'https://www.youtube.com/@Q5Bioskop';
  let profileName = 'user_2';
  let minDelay = 3;
  let maxDelay = 6;
  let watchVideo = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      targetChannelUrl = args[i + 1];
    }
    if (args[i] === '--profile' && args[i + 1]) {
      profileName = args[i + 1];
    }
    if (args[i] === '--min-delay' && args[i + 1]) {
      minDelay = parseInt(args[i + 1], 10);
    }
    if (args[i] === '--max-delay' && args[i + 1]) {
      maxDelay = parseInt(args[i + 1], 10);
    }
    if (args[i] === '--watch') {
      watchVideo = true;
    }
  }

  runAutoSubscriber({ targetChannelUrl, profileName, minDelay, maxDelay, watchVideo }).catch((err) => {
    console.error('Fatal Error:', err);
    process.exit(1);
  });
}
