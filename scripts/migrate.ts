// scripts/migrate.ts
import postgres from 'postgres';
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

async function runMigration() {
  const dbUrl = process.argv[2] || process.env.DATABASE_URL;

  if (!dbUrl) {
    console.log(`
======================================================================
  MIGRASI SCHEMA AUTOCONTENT KE SUPABASE VIA CODINGAN
======================================================================

Script ini akan membuat schema "autocontent" beserta tabel:
  - autocontent.content_sessions
  - autocontent.content_parts
lengkap dengan RLS policy dan hak akses PostgREST secara otomatis.

Untuk menjalankannya, masukkan DATABASE_URL (Connection String):
  
  Cara 1: Lewat argument terminal:
    npx tsx scripts/migrate.ts "postgresql://postgres:PASSWORD@HOST:PORT/postgres"

  Cara 2: Pasang di file .env:
    DATABASE_URL=postgresql://postgres:PASSWORD@HOST:PORT/postgres
    Lalu jalankan:
    npm run db:migrate

Catatan: Connection string bisa didapat dengan klik tombol "Connect" 
di pojok kiri atas dashboard Supabase kamu.
======================================================================
    `);
    process.exit(1);
  }

  console.log('[Migrate] Menghubungkan ke database PostgreSQL Supabase...');
  const sql = postgres(dbUrl, {
    max: 1,
    ssl: { rejectUnauthorized: false },
    connect_timeout: 10,
  });

  try {
    const sqlFilePath = path.resolve('scripts/schema-autocontent.sql');
    if (!fs.existsSync(sqlFilePath)) {
      throw new Error(`File ${sqlFilePath} tidak ditemukan.`);
    }

    const sqlContent = fs.readFileSync(sqlFilePath, 'utf-8');
    console.log('[Migrate] Menjalankan script migrasi scripts/schema-autocontent.sql...');

    await sql.unsafe(sqlContent);

    console.log('[Migrate] Memverifikasi tabel di schema autocontent...');
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'autocontent'
      ORDER BY table_name;
    `;

    console.log('[Migrate] ✅ Berhasil! Tabel di schema autocontent saat ini:');
    tables.forEach(t => console.log(`  - autocontent.${t.table_name}`));
    console.log('[Migrate] 🎉 Semua tabel dan hak akses siap dipakai oleh aplikasi dan ekstensi AI Studio!');

  } catch (err: any) {
    console.error('[Migrate] ❌ Terjadi error saat migrasi:', err.message);
  } finally {
    await sql.end();
  }
}

runMigration();
