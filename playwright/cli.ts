import { Command } from 'commander';
import { runBatchPersistentQueue } from './runner';

const program = new Command();

program
  .name('playwright-flow-cli')
  .description('CLI tool for Playwright Google Flow Automation')
  .version('1.0.0');

program
  .command('batch-runner')
  .description('Run a batch queue of prompts in a single persistent browser tab')
  .option('-p, --project <id>', 'Google Flow Project UUID')
  .option('-j, --items-json <json>', 'JSON string of items array [{segment_id, prompt}]')
  .option('-f, --items-file <path>', 'JSON file path containing items array [{segment_id, prompt}]')
  .option('-c, --concurrency <number>', 'Number of concurrent generations in Flow (default: 5)', '5')
  .option('--profiles <list>', 'Comma-separated profile names for auto-failover', 'user_1,user_2')
  .option('--models <list>', 'Comma-separated model names for auto-failover', 'Nano Banana 2,Banana 2')
  .option('--headed', 'Run browser in visible GUI mode', true)
  .option('--no-headed', 'Run browser in headless mode')
  .action(async (options) => {
    try {
      let items: any[] = [];
      if (options.itemsFile) {
        const fs = await import('fs');
        const content = fs.readFileSync(options.itemsFile, 'utf-8');
        items = JSON.parse(content);
      } else if (options.itemsJson) {
        items = JSON.parse(options.itemsJson);
      }

      const concurrency = parseInt(options.concurrency || '5', 10);
      const profiles = (options.profiles || 'user_1,user_2')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
      const models = (options.models || 'Nano Banana 2,Banana 2')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);

      console.log(`[CLI] Running batch for ${items.length} items (concurrency: ${concurrency})...`);

      await runBatchPersistentQueue({
        projectId: options.project || undefined,
        items,
        concurrency,
        profiles,
        models,
        headed: options.headed !== false,
        onItemStart: (segmentId) => {
          console.log(`[ITEM_START] ${segmentId}`);
        },
        onItemLog: (segmentId, text) => {
          console.log(`[ITEM_LOG] ${segmentId} | ${text}`);
        },
        onItemSuccess: (segmentId, result) => {
          console.log(`[ITEM_SUCCESS] ${segmentId} | ${JSON.stringify(result.images[0] || {})}`);
        },
        onItemError: (segmentId, error) => {
          console.log(`[ITEM_ERROR] ${segmentId} | ${error}`);
        },
      });

      console.log('[CLI] Batch execution completed.');
      process.exit(0);
    } catch (err: any) {
      console.error('[CLI] Batch runner error:', err?.message || err);
      process.exit(1);
    }
  });

program.parse(process.argv);
