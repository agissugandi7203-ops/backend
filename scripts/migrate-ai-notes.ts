import { Client } from 'pg';

const connectionString = 'postgresql://postgres.uvwkhwryfofnteffrmxe:cocArief2510@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres';

async function run() {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('Connecting to Supabase PostgreSQL database via Pooler (aws-1)...');
    await client.connect();
    console.log('Connected! Executing migration...');

    await client.query(`
      ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS ai_notes TEXT;
      COMMENT ON COLUMN public.reports.ai_notes IS 'Catatan penjelasan atau alasan keputusan klasifikasi yang di-generate otomatis oleh AI (Gemini)';
    `);

    console.log('🎉 Migration successful! Added column "ai_notes" to table "public.reports".');
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message || error);
  } finally {
    await client.end();
  }
}

run();
