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
  getPromptFn?: (partNum: number, totalChunks: number) => Promise<string>;
}): Promise<{ success: boolean; count: number; error?: string }> {
  const { contentId, title, chunks, getPromptFn } = params;

  if (!contentId) {
    throw new Error('Content ID tidak boleh kosong.');
  }
  if (!chunks || chunks.length === 0) {
    throw new Error('Tidak ada chunk video untuk disimpan.');
  }

  try {
    // 1. Upsert Content Session ke autocontent.content_sessions
    const { error: sessionError } = await supabase
      .from('content_sessions')
      .upsert(
        {
          id: contentId,
          title: title || contentId,
          category: 'alurfilm',
          total_parts: chunks.length,
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
        let partPrompt = ('prompt' in chunk && chunk.prompt) ? chunk.prompt : null;

        // Ambil prompt otomatis jika tersedia generator function dan belum ada prompt
        if (!partPrompt && getPromptFn) {
          try {
            partPrompt = await getPromptFn(chunk.part, chunks.length);
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
    const { data, error } = await supabase
      .from('content_parts')
      .select('id, content_id, part_number, filename, video_path, duration_sec, size_bytes, upload_status, script_status, updated_at')
      .eq('content_id', contentId)
      .order('part_number', { ascending: true });

    if (error) {
      console.warn(`[SupabaseSync] Schema ${SUPABASE_SCHEMA} getSyncedChunks error:`, error.message);
      return [];
    }

    return (data as SyncedPartRecord[]) || [];
  } catch (e) {
    return [];
  }
}
