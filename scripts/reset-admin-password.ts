import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load .env
const envPath = path.resolve(process.cwd(), '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
envContent.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const idx = trimmed.indexOf('=');
  if (idx === -1) return;
  const key = trimmed.substring(0, idx).trim();
  const value = trimmed.substring(idx + 1).trim().replace(/^['"]|['"]$/g, '');
  process.env[key] = value;
});

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const ADMIN_EMAIL = 'admin@genesis.id';
const ADMIN_PASSWORD = 'cocArief2510';

async function run() {
  console.log('==============================================');
  console.log('🔐 RESETTING ADMIN PASSWORD - Genesis.id');
  console.log('==============================================\n');

  const { data: list, error: listError } = await sb.auth.admin.listUsers();
  if (listError) { console.error('ERROR listing users:', listError.message); return; }

  const user = list.users.find((u: any) => u.email === ADMIN_EMAIL);
  if (!user) {
    console.log('❌ User admin@genesis.id tidak ditemukan. Membuat ulang...');
    const { data: created, error: createError } = await sb.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (createError) { console.error('ERROR creating user:', createError.message); return; }
    console.log('✅ User baru dibuat dengan ID:', created.user.id);
    return;
  }

  console.log('👤 User ditemukan | ID:', user.id);
  const { error: updateError } = await sb.auth.admin.updateUserById(user.id, {
    password: ADMIN_PASSWORD,
    email_confirm: true,
  });

  if (updateError) {
    console.error('❌ ERROR reset password:', updateError.message);
  } else {
    console.log('✅ PASSWORD BERHASIL DIRESET!');
    console.log('📧 Email    :', ADMIN_EMAIL);
    console.log('🔑 Password :', ADMIN_PASSWORD);
    console.log('\nSilakan login kembali di website admin sekarang.');
  }
}

run().catch(console.error);
