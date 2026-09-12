// dashboard/src/lib/supabaseSync.ts
import { supabase, SUPABASE_SCHEMA } from './supabase';
import type { AlurfilmChunk } from '../electron-api';

export interface SyncChunkItem {
  part: number;
  name: string;
  filePath: string;
  size?: number;
  durationSec?: number;
  duration?: number;
  prompt?: string;
}

export interface SyncedPartRecord {
  id: string;
  content_id: string;
  part_number: number;
  filename: string;
  video_path: string;
  duration_sec?: number;
  size_bytes?: number;
  prompt?: string | null;
  mapping_prompt?: string | null;
  mapping_status?: string;
  mapping_output?: any;
  mapping_done_at?: string;
  upload_status: string;
  script_status: string;
  updated_at: string;
}

/**
 * Menyimpan atau memperbarui data chunk video ke schema autocontent di Supabase
 */
export async function syncChunksToSupabase(params: {
  contentId: string;
  title?: string;
  chunks: (AlurfilmChunk | SyncChunkItem)[];
  totalParts?: number;
  getPromptFn?: (partNum: number, totalChunks: number, chunk?: AlurfilmChunk | SyncChunkItem) => Promise<string>;
  onlyFirstPartPrompt?: boolean;
}): Promise<{ success: boolean; count: number; error?: string }> {
  const { contentId, title, chunks, totalParts, getPromptFn, onlyFirstPartPrompt = true } = params;

  if (!contentId) {
    throw new Error('Content ID tidak boleh kosong.');
  }
  if (!chunks || chunks.length === 0) {
    throw new Error('Tidak ada chunk video untuk disimpan.');
  }

  try {
    // 1. Ambil session yang sudah ada untuk menjaga total_parts agar tidak tertimpa angka lebih kecil
    const { data: existingSess } = await supabase
      .from('content_sessions')
      .select('total_parts')
      .eq('id', contentId)
      .maybeSingle();

    const existingTotal = existingSess?.total_parts || 0;
    const computedTotal = totalParts || Math.max(chunks.length, ...chunks.map((c) => c.part || 1));
    const effectiveTotalParts = Math.max(existingTotal, computedTotal);

    // Upsert Content Session ke autocontent.content_sessions
    const { error: sessionError } = await supabase
      .from('content_sessions')
      .upsert(
        {
          id: contentId,
          title: title || contentId,
          category: 'alurfilm',
          total_parts: effectiveTotalParts,
          status: 'active',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );

    if (sessionError) {
      console.error('[SupabaseSync] Session upsert error:', sessionError);
      throw new Error(`Gagal menyimpan session: ${sessionError.message}`);
    }

    // 2. Siapkan baris data per part untuk autocontent.content_parts
    const rows = await Promise.all(
      chunks.map(async (chunk) => {
        let partPrompt: string | null = ('prompt' in chunk && chunk.prompt) ? chunk.prompt : null;

        // Ambil prompt otomatis jika tersedia generator function dan belum ada prompt.
        // Default: hanya Part 1 yang di-generate prompt awal, karena Part 2 ke atas
        // membutuhkan metadata dinamis (previous_context dsb.) dari hasil output part sebelumnya.
        const shouldGeneratePrompt = !partPrompt && getPromptFn && (!onlyFirstPartPrompt || chunk.part === 1);
        if (shouldGeneratePrompt) {
          try {
            partPrompt = (await getPromptFn(chunk.part, chunks.length, chunk)) || null;
          } catch (e) {
            console.warn(`[SupabaseSync] Gagal generate prompt part #${chunk.part}:`, e);
          }
        }

        const durSec = Math.round(
          chunk.durationSec || ('duration' in chunk && chunk.duration) || 1200
        );

        return {
          content_id: contentId,
          part_number: chunk.part,
          filename: chunk.name,
          video_path: chunk.filePath,
          duration_sec: durSec,
          size_bytes: chunk.size || 0,
          prompt: partPrompt,
          upload_status: 'pending',
          script_status: 'pending',
          updated_at: new Date().toISOString(),
        };
      })
    );

    // 3. Upsert data parts ke autocontent.content_parts
    const { data, error: partsError } = await supabase
      .from('content_parts')
      .upsert(rows, { onConflict: 'content_id,part_number' })
      .select('id, part_number');

    if (partsError) {
      console.error('[SupabaseSync] Parts upsert error:', partsError);
      throw new Error(`Gagal menyimpan parts: ${partsError.message}`);
    }

    return {
      success: true,
      count: data?.length || rows.length,
    };
  } catch (err: any) {
    console.error('[SupabaseSync] Sync error:', err);
    throw err;
  }
}

/**
 * Mengambil daftar part yang sudah tersinkronisasi di schema autocontent
 */
export async function getSyncedChunks(
  contentId: string
): Promise<SyncedPartRecord[]> {
  try {
    // Try selecting with mapping fields, fall back if mapping_prompt does not exist
    let query = 'id, content_id, part_number, filename, video_path, duration_sec, size_bytes, prompt, upload_status, script_status, updated_at';
    try {
      const testRes = await supabase
        .from('content_parts')
        .select('id, content_id, part_number, filename, video_path, duration_sec, size_bytes, prompt, mapping_prompt, mapping_status, mapping_output, mapping_done_at, upload_status, script_status, updated_at')
        .eq('content_id', contentId)
        .order('part_number', { ascending: true });

      if (!testRes.error && Array.isArray(testRes.data)) {
        return (testRes.data as unknown as SyncedPartRecord[]);
      }
    } catch {}

    const { data, error } = await supabase
      .from('content_parts')
      .select(query)
      .eq('content_id', contentId)
      .order('part_number', { ascending: true });

    if (error) {
      console.warn(`[SupabaseSync] Schema ${SUPABASE_SCHEMA} getSyncedChunks error:`, error.message);
      return [];
    }

    return (data as unknown as SyncedPartRecord[]) || [];
  } catch (e) {
    return [];
  }
}

/**
 * Menyimpan / memperbarui dynamic mapping prompt per video chunk ke Supabase
 */
export async function syncMappingPromptsToSupabase(params: {
  contentId: string;
  prompts: Record<number, string>;
}): Promise<{ success: boolean; count: number; error?: string }> {
  const { contentId, prompts } = params;

  if (!contentId) {
    throw new Error('Content ID tidak boleh kosong.');
  }
  const partNums = Object.keys(prompts)
    .map(Number)
    .filter((n) => !isNaN(n));
  if (partNums.length === 0) {
    throw new Error('Tidak ada prompt mapping untuk disimpan.');
  }

  try {
    let successCount = 0;
    let supportsMappingPromptCol = true;

    for (const partNum of partNums) {
      const promptText = prompts[partNum];
      if (!promptText) continue;

      if (supportsMappingPromptCol) {
        const { error: errMap } = await supabase
          .from('content_parts')
          .update({
            mapping_prompt: promptText,
            mapping_status: 'pending',
            updated_at: new Date().toISOString(),
          })
          .eq('content_id', contentId)
          .eq('part_number', partNum);

        if (!errMap) {
          successCount++;
          continue;
        }

        if (errMap.code === '42703' || errMap.message?.includes('mapping_prompt')) {
          supportsMappingPromptCol = false;
        } else {
          console.warn(`[SupabaseSync] Warning updating mapping_prompt part #${partNum}:`, errMap.message);
        }
      }

      // Fallback: simpan di prompt column agar otomasi tetap berjalan mulus
      const { error: fallbackErr } = await supabase
        .from('content_parts')
        .update({
          prompt: promptText,
          updated_at: new Date().toISOString(),
        })
        .eq('content_id', contentId)
        .eq('part_number', partNum);

      if (!fallbackErr) {
        successCount++;
      } else {
        console.warn(`[SupabaseSync] Warning fallback updating prompt part #${partNum}:`, fallbackErr.message);
      }
    }

    return {
      success: true,
      count: successCount,
    };
  } catch (err: any) {
    console.error('[SupabaseSync] syncMappingPrompts error:', err);
    throw err;
  }
}

