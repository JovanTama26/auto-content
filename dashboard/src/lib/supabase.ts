import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://supabase.riztama.my.id';

const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  '';

const rawSchema =
  import.meta.env.VITE_SUPABASE_SCHEMA ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_SCHEMA ||
  'autocontent';

// Auto-correct 'auticontent' typo to database-exposed 'autocontent' schema
export const SUPABASE_SCHEMA = rawSchema === 'auticontent' ? 'autocontent' : rawSchema;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  db: {
    schema: SUPABASE_SCHEMA,
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export default supabase;
