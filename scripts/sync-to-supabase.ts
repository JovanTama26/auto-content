// scripts/sync-to-supabase.ts
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Automatically load .env in Node.js environment
if (typeof process !== 'undefined' && typeof process.loadEnvFile === 'function') {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {}
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://supabase.riztama.my.id';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
const SUPABASE_SCHEMA = 'autocontent'; // Explicitly use autocontent schema

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: {
    schema: SUPABASE_SCHEMA,
  },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function main() {
  const targetContentId = process.argv[2] || 'WV-FILM-20260911-FOMM';
  console.log(`[Sync] Starting sync to Supabase (Schema: ${SUPABASE_SCHEMA}) for Content ID: ${targetContentId}...`);

  const chunksDir = path.resolve('input/alurfilm/chunks');
  if (!fs.existsSync(chunksDir)) {
    console.error(`Directory ${chunksDir} not found.`);
    process.exit(1);
  }

  const files = fs.readdirSync(chunksDir)
    .filter(f => f.startsWith(targetContentId) && f.endsWith('.mp4'))
    .sort();

  if (files.length === 0) {
    console.warn(`No chunk files found for ${targetContentId} in ${chunksDir}`);
    process.exit(0);
  }

  console.log(`[Sync] Found ${files.length} chunk files on disk.`);

  // 1. Upsert Session
  const { data: sData, error: sErr } = await supabase
    .from('content_sessions')
    .upsert({
      id: targetContentId,
      title: `Alur Film ${targetContentId}`,
      category: 'alurfilm',
      total_parts: files.length,
      status: 'active',
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' })
    .select();

  if (sErr) {
    console.error('[Sync] Error upserting session:', sErr);
    process.exit(1);
  }
  console.log('[Sync] Session registered:', sData?.[0]?.id);

  // 2. Prepare Parts
  const parts = files.map((f, idx) => {
    const fullPath = path.join(chunksDir, f);
    const stat = fs.statSync(fullPath);
    const partMatch = f.match(/part_(\d+)/);
    const partNum = partMatch ? parseInt(partMatch[1], 10) : idx + 1;
    return {
      content_id: targetContentId,
      part_number: partNum,
      filename: f,
      video_path: fullPath,
      size_bytes: stat.size,
      duration_sec: partNum === 6 ? 714 : 1200,
      upload_status: 'pending',
      script_status: 'pending',
      updated_at: new Date().toISOString()
    };
  });

  // 3. Upsert Parts
  const { data: pData, error: pErr } = await supabase
    .from('content_parts')
    .upsert(parts, { onConflict: 'content_id,part_number' })
    .select('id, part_number, filename, video_path');

  if (pErr) {
    console.error('[Sync] Error upserting parts:', pErr);
    process.exit(1);
  }

  console.log(`[Sync] Successfully saved ${pData?.length || 0} parts to Supabase!`);
  console.log(pData);
}

main().catch((err) => {
  console.error('[Sync] Fatal error:', err);
  process.exit(1);
});
