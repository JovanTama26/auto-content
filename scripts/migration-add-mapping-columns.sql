-- ==========================================================
-- Migration: Add Video Mapping Automation Columns
-- Schema: autocontent
-- Table: content_parts
-- ==========================================================

ALTER TABLE autocontent.content_parts ADD COLUMN IF NOT EXISTS mapping_prompt TEXT;
ALTER TABLE autocontent.content_parts ADD COLUMN IF NOT EXISTS mapping_status TEXT DEFAULT 'pending';
ALTER TABLE autocontent.content_parts ADD COLUMN IF NOT EXISTS mapping_output JSONB;
ALTER TABLE autocontent.content_parts ADD COLUMN IF NOT EXISTS mapping_done_at TIMESTAMPTZ;

-- Refresh PostgREST Schema Cache
NOTIFY pgrst, 'reload schema';
