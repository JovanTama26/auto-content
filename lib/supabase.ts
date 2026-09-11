import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Automatically load .env in Node.js environment if present
if (typeof process !== 'undefined' && typeof process.loadEnvFile === 'function') {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Ignore if already loaded
    }
  }
}

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://supabase.riztama.my.id';

const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  '';

const rawSchema =
  process.env.NEXT_PUBLIC_SUPABASE_SCHEMA ||
  process.env.VITE_SUPABASE_SCHEMA ||
  process.env.SUPABASE_SCHEMA ||
  'autocontent';

// Auto-correct 'auticontent' typo to database-exposed 'autocontent' schema
export const SUPABASE_SCHEMA = rawSchema === 'auticontent' ? 'autocontent' : rawSchema;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  db: {
    schema: SUPABASE_SCHEMA,
  },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export default supabase;
