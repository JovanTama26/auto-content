-- ==========================================================
-- Migration: Add ElevenLabs Accounts Table
-- Schema: autocontent
-- Table: elevenlabs_accounts
-- ==========================================================

-- 1. Buat tabel elevenlabs_accounts jika belum ada
CREATE TABLE IF NOT EXISTS autocontent.elevenlabs_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    status TEXT DEFAULT 'pending_verification', -- 'pending_verification', 'active', 'exhausted', 'disabled'
    credits_remaining INTEGER DEFAULT 10000,
    verification_link TEXT,
    api_key TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Index untuk pencarian cepat berdasarkan status dan email
CREATE INDEX IF NOT EXISTS idx_elevenlabs_accounts_status ON autocontent.elevenlabs_accounts(status);
CREATE INDEX IF NOT EXISTS idx_elevenlabs_accounts_email ON autocontent.elevenlabs_accounts(email);

-- 3. Row Level Security (RLS)
ALTER TABLE autocontent.elevenlabs_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to elevenlabs_accounts" ON autocontent.elevenlabs_accounts;
CREATE POLICY "Allow all access to elevenlabs_accounts"
    ON autocontent.elevenlabs_accounts FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- 4. Berikan Hak Akses ke role PostgREST
GRANT ALL ON TABLE autocontent.elevenlabs_accounts TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA autocontent GRANT ALL ON TABLES TO anon, authenticated, service_role;

-- 5. Reload PostgREST Schema Cache
NOTIFY pgrst, 'reload schema';
