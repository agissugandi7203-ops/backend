import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load env
function loadEnv() {
  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../backend/.env')
  ];

  let envFileContent = '';
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      envFileContent = fs.readFileSync(p, 'utf-8');
      break;
    }
  }

  if (!envFileContent) {
    console.warn('⚠️ file .env tidak ditemukan.');
    return;
  }

  const lines = envFileContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const firstEquals = trimmed.indexOf('=');
    if (firstEquals === -1) continue;
    const key = trimmed.substring(0, firstEquals).trim();
    const value = trimmed.substring(firstEquals + 1).trim();
    const cleanedValue = value.replace(/^['"]|['"]$/g, '');
    process.env[key] = cleanedValue;
  }
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di environment!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function run() {
  console.log('==================================================');
  console.log('🔍 INSPECTING SUPABASE DATABASE');
  console.log('==================================================\n');

  console.log('1. Fetching auth users...');
  const { data: authData, error: authError } = await supabase.auth.admin.listUsers();
  if (authError) {
    console.error('❌ Gagal list auth users:', authError.message);
  } else {
    const users = (authData?.users || []) as any[];
    console.log(`👤 Ada ${users.length} auth users:`);
    users.forEach(u => {
      console.log(`- Email: ${u.email}, ID: ${u.id}, CreatedAt: ${u.created_at}`);
    });
  }

  console.log('\n2. Fetching profiles table...');
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('*');
  
  if (profileError) {
    console.error('❌ Gagal fetch profiles:', profileError.message);
  } else {
    console.log(`👤 Ada ${profiles?.length || 0} profiles di tabel:`);
    profiles?.forEach(p => {
      console.log(`- ID: ${p.id}, Username: ${p.username}, FullName: ${p.full_name}, Role: ${p.role}, XP: ${p.xp}, Level: ${p.level}`);
    });
  }

  console.log('\n3. Fetching reports...');
  const { count: reportsCount, error: reportsError } = await supabase
    .from('reports')
    .select('*', { count: 'exact', head: true });
  if (reportsError) {
    console.error('❌ Gagal fetch reports:', reportsError.message);
  } else {
    console.log(`📝 Total laporan di DB: ${reportsCount}`);
  }

  console.log('\n4. Fetching knowledge base...');
  const { count: kbCount, error: kbError } = await supabase
    .from('knowledge_base')
    .select('*', { count: 'exact', head: true });
  if (kbError) {
    console.error('❌ Gagal fetch knowledge_base:', kbError.message);
  } else {
    console.log(`📚 Total dokumen RAG di DB: ${kbCount}`);
  }
}

run();
