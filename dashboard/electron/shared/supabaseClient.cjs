// dashboard/electron/shared/supabaseClient.cjs
const fs = require('fs');
const path = require('path');

// ─── Polyfill WebSocket for Node 20 / Electron main process ──
if (typeof globalThis !== 'undefined' && !globalThis.WebSocket) {
  try {
    globalThis.WebSocket = require('ws');
  } catch (e) {
    globalThis.WebSocket = class DummyWebSocket {
      constructor() {}
      close() {}
      send() {}
      addEventListener() {}
      removeEventListener() {}
    };
  }
}

const { createClient } = require('@supabase/supabase-js');

// ─── Environment Configuration ──────────────────────────
function loadEnvIfAvailable() {
  const candidatePaths = [
    path.resolve(__dirname, '..', '..', '..', '.env'),
    path.resolve(__dirname, '..', '..', '.env'),
  ];

  for (const envPath of candidatePaths) {
    if (fs.existsSync(envPath)) {
      if (typeof process.loadEnvFile === 'function') {
        try {
          process.loadEnvFile(envPath);
        } catch {}
      } else {
        try {
          const content = fs.readFileSync(envPath, 'utf-8');
          content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const idx = trimmed.indexOf('=');
            if (idx !== -1) {
              const key = trimmed.slice(0, idx).trim();
              const val = trimmed.slice(idx + 1).trim();
              if (!process.env[key]) {
                process.env[key] = val;
              }
            }
          });
        } catch {}
      }
    }
  }
}

loadEnvIfAvailable();

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://supabase.riztama.my.id';

const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_TuuasLbN1zmVVbD_wmviZ2_pwLKyHYX';

const rawSchema =
  process.env.NEXT_PUBLIC_SUPABASE_SCHEMA ||
  process.env.VITE_SUPABASE_SCHEMA ||
  process.env.SUPABASE_SCHEMA ||
  'autocontent';

const supabaseSchema = rawSchema === 'auticontent' ? 'autocontent' : rawSchema;

let supabase = null;
try {
  supabase = createClient(supabaseUrl, supabaseKey, {
    db: {
      schema: supabaseSchema,
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      transport: globalThis.WebSocket,
    },
  });
} catch (err) {
  console.warn('[supabaseClient] Warning initializing Supabase client:', err.message);
}

/**
 * Check if two script analysis objects have identical narrative and structural content.
 */
function isScriptEqual(a, b) {
  if (!a || !b) return false;
  const textA = (a.naskah_voiceover?.script_text || a.script_text || '').trim();
  const textB = (b.naskah_voiceover?.script_text || b.script_text || '').trim();
  if (textA !== textB) return false;

  const summaryA = (a.naskah_voiceover?.macro_summary || '').trim();
  const summaryB = (b.naskah_voiceover?.macro_summary || '').trim();
  if (summaryA !== summaryB) return false;

  const scenesA = (a.timeline_edits || []).length;
  const scenesB = (b.timeline_edits || []).length;
  if (scenesA !== scenesB) return false;

  const charsA = (a.character_registry || []).length;
  const charsB = (b.character_registry || []).length;
  if (charsA !== charsB) return false;

  return true;
}

/**
 * Normalize and ensure proper structure for analysis JSON object.
 */
function normalizeScriptData(data, partNum, fallbackStatus = 'done') {
  if (!data || typeof data !== 'object') return null;
  const normalized = { ...data };
  normalized.chunk_part = typeof normalized.chunk_part === 'number' ? normalized.chunk_part : partNum;
  normalized.status = normalized.status || fallbackStatus;
  normalized.naskah_voiceover = normalized.naskah_voiceover || {};
  if (typeof normalized.naskah_voiceover.script_text === 'string') {
    if (!normalized.naskah_voiceover.word_count) {
      normalized.naskah_voiceover.word_count = normalized.naskah_voiceover.script_text.split(/\s+/).filter(Boolean).length;
    }
  }
  normalized.timeline_edits = Array.isArray(normalized.timeline_edits) ? normalized.timeline_edits : [];
  normalized.character_registry = Array.isArray(normalized.character_registry) ? normalized.character_registry : [];
  return normalized;
}

/**
 * Fetch, synchronize, and match analyses between local disk and Supabase content_parts table:
 * 1. If only in Supabase -> write to local disk.
 * 2. If only in Local disk -> upload/sync to Supabase.
 * 3. If in both -> compare contents. If there is a discrepancy, resolve using latest modified timestamp
 *    so local and cloud are 100% matched and consistent.
 *
 * @param {string} contentId - Content session ID (e.g. WV-FILM-20260911-FOMM)
 * @param {string} alurfilmDir - Directory where analysis JSONs are stored (p.ALURFILM_DIR)
 * @param {Object} [options]
 * @param {boolean} [options.force=false] - If true, overwrites existing local files with Supabase data
 * @returns {Promise<Array<{ name: string, filePath: string, data: Object, part: number, newlyWritten: boolean }>>}
 */
async function syncAnalysesFromSupabase(contentId, alurfilmDir, options = {}) {
  const force = !!options.force;
  if (!contentId) return [];

  if (!fs.existsSync(alurfilmDir)) {
    fs.mkdirSync(alurfilmDir, { recursive: true });
  }

  // ─── 1. Scan Local Disk Files for this contentId ────────
  const localMap = new Map(); // partNum -> { filePath, fileName, data, mtimeMs }
  try {
    const diskFiles = fs.readdirSync(alurfilmDir);
    diskFiles
      .filter(f => f.startsWith(contentId) && f.includes('_analysis_part_') && f.endsWith('.json'))
      .forEach(f => {
        const fullPath = path.join(alurfilmDir, f);
        try {
          const stat = fs.statSync(fullPath);
          const raw = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
          const partMatch = f.match(/_part_(\d+)/);
          const rawNum = typeof raw.chunk_part === 'number' ? raw.chunk_part : (partMatch ? parseInt(partMatch[1], 10) : null);
          if (rawNum !== null) {
            localMap.set(rawNum, {
              filePath: fullPath,
              fileName: f,
              data: raw,
              mtimeMs: stat.mtimeMs || (stat.mtime ? new Date(stat.mtime).getTime() : 0),
            });
          }
        } catch {}
      });
  } catch (err) {
    console.warn('[SupabaseSync] Warning scanning local directory:', err.message);
  }

  if (!supabase) {
    // If Supabase client failed to initialize, return existing local analyses
    return Array.from(localMap.values()).map(item => ({
      name: item.fileName,
      filePath: item.filePath,
      data: item.data,
      part: item.data.chunk_part,
      newlyWritten: false,
    }));
  }

  // ─── 2. Fetch Cloud Parts from Supabase ─────────────────
  let cloudParts = [];
  try {
    const { data, error } = await supabase
      .from('content_parts')
      .select('id, content_id, part_number, script_status, script_output, updated_at, script_done_at')
      .eq('content_id', contentId)
      .order('part_number', { ascending: true });

    if (error) {
      console.warn(`[SupabaseSync] Warning querying content_parts for ${contentId}:`, error.message);
    } else if (Array.isArray(data)) {
      cloudParts = data;
    }
  } catch (err) {
    console.warn(`[SupabaseSync] Error querying Supabase:`, err.message);
  }

  const cloudMap = new Map(); // partNum -> row
  cloudParts.forEach(p => {
    const pNum = Number(p.part_number);
    if (!isNaN(pNum)) {
      cloudMap.set(pNum, p);
    }
  });

  // ─── 3. Match and Synchronize All Parts (Local & Cloud) ──
  const allPartNums = new Set([...localMap.keys(), ...cloudMap.keys()]);
  const results = [];

  for (const partNum of Array.from(allPartNums).sort((a, b) => a - b)) {
    const partStr = String(partNum).padStart(2, '0');
    const standardFileName = `${contentId}_analysis_part_${partStr}.json`;
    const standardFilePath = path.join(alurfilmDir, standardFileName);

    const localEntry = localMap.get(partNum);
    const cloudRow = cloudMap.get(partNum);

    let cloudData = null;
    if (cloudRow?.script_output) {
      if (typeof cloudRow.script_output === 'string') {
        try { cloudData = JSON.parse(cloudRow.script_output); } catch {}
      } else if (typeof cloudRow.script_output === 'object') {
        cloudData = cloudRow.script_output;
      }
    }
    if (cloudData) {
      cloudData = normalizeScriptData(cloudData, partNum, cloudRow.script_status || 'done');
    }

    let localData = localEntry?.data ? normalizeScriptData(localEntry.data, partNum) : null;
    const targetFilePath = localEntry?.filePath || standardFilePath;
    const targetFileName = localEntry?.fileName || standardFileName;

    // Case 1: Exists ONLY in Cloud -> write to Local disk
    if (cloudData && !localData) {
      fs.writeFileSync(targetFilePath, JSON.stringify(cloudData, null, 2), 'utf-8');
      console.log(`[SupabaseSync] Part #${partNum} missing locally -> saved from cloud: ${targetFileName}`);
      results.push({
        name: targetFileName,
        filePath: targetFilePath,
        data: cloudData,
        part: partNum,
        newlyWritten: true,
      });
      continue;
    }

    // Case 2: Exists ONLY in Local -> push to Cloud Supabase
    if (localData && (!cloudRow || !cloudData)) {
      if (cloudRow) {
        // Update existing row in Supabase
        supabase
          .from('content_parts')
          .update({
            script_output: localData,
            script_status: localData.status || 'done',
            script_done_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', cloudRow.id)
          .then(() => {
            console.log(`[SupabaseSync] Part #${partNum} missing in cloud -> uploaded local to Supabase.`);
          })
          .catch((e) => console.warn('[SupabaseSync] Warning uploading local to cloud:', e.message));
      }
      results.push({
        name: targetFileName,
        filePath: targetFilePath,
        data: localData,
        part: partNum,
        newlyWritten: false,
      });
      continue;
    }

    // Case 3: Exists in BOTH Local and Cloud -> Match and ensure zero discrepancy
    if (localData && cloudData) {
      let finalData = localData;
      let fileUpdated = false;

      if (force) {
        // Force overwrite from cloud
        finalData = cloudData;
        fs.writeFileSync(targetFilePath, JSON.stringify(cloudData, null, 2), 'utf-8');
        fileUpdated = true;
      } else {
        const identical = isScriptEqual(localData, cloudData);
        if (!identical) {
          // Compare timestamps to find latest update
          const cloudTime = cloudRow.updated_at
            ? new Date(cloudRow.updated_at).getTime()
            : (cloudRow.script_done_at ? new Date(cloudRow.script_done_at).getTime() : 0);
          const localTime = localEntry.mtimeMs || 0;

          if (cloudTime > localTime) {
            // Cloud is newer -> update local file
            finalData = cloudData;
            fs.writeFileSync(targetFilePath, JSON.stringify(cloudData, null, 2), 'utf-8');
            fileUpdated = true;
            console.log(`[SupabaseSync] Part #${partNum} matched: updated local disk from newer cloud version.`);
          } else {
            // Local is newer -> update cloud row
            finalData = localData;
            supabase
              .from('content_parts')
              .update({
                script_output: localData,
                script_status: localData.status || 'done',
                script_done_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', cloudRow.id)
              .then(() => {
                console.log(`[SupabaseSync] Part #${partNum} matched: updated cloud from newer local version.`);
              })
              .catch((e) => console.warn('[SupabaseSync] Warning updating cloud from local:', e.message));
          }
        }
      }

      results.push({
        name: targetFileName,
        filePath: targetFilePath,
        data: finalData,
        part: partNum,
        newlyWritten: fileUpdated,
      });
    }
  }

  return results;
}

module.exports = {
  supabase,
  supabaseUrl,
  supabaseSchema,
  syncAnalysesFromSupabase,
};
