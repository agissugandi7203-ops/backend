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
  console.error('❌ Error: SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY tidak ditemukan!');
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
  console.log('👑 CREATING DEDICATED ADMIN USER FOR GENESIS.ID');
  console.log('==================================================\n');

  const adminEmail = 'admin@genesis.id';
  const adminPassword = 'cocArief2510'; // Using the secure pattern seen in reset script
  
  console.log(`🔍 Checking if auth user already exists for ${adminEmail}...`);
  const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
  
  if (listError) {
    console.error('❌ Gagal mengambil daftar pengguna:', listError.message);
    process.exit(1);
  }

  const users = (listData?.users || []) as any[];
  let existingUser = users.find(u => u.email === adminEmail);
  let userId = '';

  if (existingUser) {
    console.log(`✅ Auth user found with ID: ${existingUser.id}`);
    userId = existingUser.id;
  } else {
    console.log(`✨ Creating new auth user for ${adminEmail}...`);
    const { data: { user: newUser }, error: createError } = await supabase.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: {
        full_name: 'Arief Admin',
        username: 'admin_genesis',
      }
    });

    if (createError || !newUser) {
      console.error('❌ Gagal membuat auth user:', createError?.message);
      process.exit(1);
    }

    console.log(`✅ Auth user successfully created with ID: ${newUser.id}`);
    userId = newUser.id;
  }

  console.log(`\n🆙 Upserting profile with 'admin' role in profiles table...`);
  const { data: updatedProfile, error: profileError } = await supabase
    .from('profiles')
    .upsert({
      id: userId,
      username: 'admin_genesis',
      full_name: 'Arief Admin',
      role: 'admin', // Dedicated admin role
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (profileError || !updatedProfile) {
    console.error('❌ Gagal mengupdate role profil:', profileError?.message);
    process.exit(1);
  }

  console.log('==================================================');
  console.log('🎉 DEDICATED ADMIN USER CREATED SUCCESSFULLY!');
  console.log('==================================================');
  console.log(`📧 Email    : ${adminEmail}`);
  console.log(`🔑 Password : ${adminPassword}`);
  console.log(`👤 Nama     : ${updatedProfile.full_name}`);
  console.log(`👑 Role     : ${updatedProfile.role}`);
  console.log('==================================================\n');
}

run().catch((err) => {
  console.error('💥 Kesalahan fatal:', err);
});
