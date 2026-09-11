-- ==========================================================
-- Schema Migration: autocontent
-- Dedicated schema for Content Auto (Alur Film Chunks & AI Studio Queue)
-- ==========================================================

-- 1. Pastikan Schema autocontent ada
CREATE SCHEMA IF NOT EXISTS autocontent;

-- 2. Tabel content_sessions (Session Master Film)
CREATE TABLE IF NOT EXISTS autocontent.content_sessions (
    id TEXT PRIMARY KEY,
    title TEXT,
    category TEXT DEFAULT 'alurfilm',
    total_parts INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Tabel content_parts (Chunk Video + AI Studio Prompt & Status)
CREATE TABLE IF NOT EXISTS autocontent.content_parts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id TEXT NOT NULL REFERENCES autocontent.content_sessions(id) ON DELETE CASCADE,
    part_number INTEGER NOT NULL,
    filename TEXT NOT NULL,
    video_path TEXT NOT NULL,
    duration_sec INTEGER,
    size_bytes BIGINT,
    prompt TEXT,
    upload_status TEXT DEFAULT 'pending',
    drive_file_id TEXT,
    drive_url TEXT,
    uploaded_at TIMESTAMPTZ,
    script_status TEXT DEFAULT 'pending',
    script_output JSONB,
    script_done_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_content_parts_content_id_part_number UNIQUE (content_id, part_number)
);

-- 4. Enable Row Level Security (RLS) & Kebijakan Akses Publishable Key
ALTER TABLE autocontent.content_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE autocontent.content_parts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to content_sessions" ON autocontent.content_sessions;
CREATE POLICY "Allow all access to content_sessions"
    ON autocontent.content_sessions FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to content_parts" ON autocontent.content_parts;
CREATE POLICY "Allow all access to content_parts"
    ON autocontent.content_parts FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- 5. Berikan Hak Akses (Grant) ke schema dan table untuk role PostgREST
GRANT USAGE ON SCHEMA autocontent TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA autocontent TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA autocontent TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA autocontent GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA autocontent GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- 6. Reload PostgREST Schema Cache
NOTIFY pgrst, 'reload schema';
