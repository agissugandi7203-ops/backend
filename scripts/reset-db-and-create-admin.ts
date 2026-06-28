import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load environment variables manually
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
      console.log(`Loaded environment from: ${p}`);
      break;
    }
  }

  if (!envFileContent) {
    console.warn('⚠️ file .env tidak ditemukan. Menggunakan process.env bawaan.');
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

// Inisialisasi Supabase Client dengan Service Role Key
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function run() {
  console.log('==================================================');
  console.log('🚨 RESET DATABASE & CREATING SPECIAL ADMIN USER');
  console.log('==================================================\n');

  // 1. Ambil semua users saat ini untuk dihapus
  console.log('🔍 Mengambil daftar pengguna dari auth...');
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
  
  if (listError) {
    console.error('❌ Gagal mengambil daftar pengguna:', listError.message);
    process.exit(1);
  }

  console.log(`👤 Ditemukan ${users.length} pengguna terdaftar.`);

  // 2. Hapus semua users satu per satu via Admin API
  if (users.length > 0) {
    console.log('🧹 Menghapus semua pengguna secara permanen...');
    for (const u of users) {
      const { error: deleteError } = await supabase.auth.admin.deleteUser(u.id);
      if (deleteError) {
        console.error(`   ❌ Gagal menghapus user ${u.email}:`, deleteError.message);
      } else {
        console.log(`   ✅ Berhasil menghapus user: ${u.email}`);
      }
    }
  }

  // 3. Bersihkan tabel-tabel relasi secara eksplisit agar bersih total
  console.log('\n🗑️ Membersihkan sisa tabel relasi (reports, profile_challenges, profile_badges, notifications)...');
  
  // Karena RLS dilewati oleh Service Role Key, kita bisa membersihkan tabel langsung
  const tables = ['reports', 'profile_challenges', 'profile_badges', 'notifications', 'profiles'];
  for (const table of tables) {
    const { error: clearError } = await supabase
      .from(table)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows
    
    if (clearError) {
      console.warn(`   ⚠️ Info/Warning saat membersihkan tabel ${table}:`, clearError.message);
    } else {
      console.log(`   ✅ Tabel "${table}" berhasil dibersihkan.`);
    }
  }

  // 4. Buat User Spesial Baru: adminmarhas@gmail.com
  console.log('\n✨ Membuat pengguna baru: adminmarhas@gmail.com...');
  const email = 'adminmarhas@gmail.com';
  const password = 'cocArief2510';

  const { data: { user: newUser }, error: createError } = await supabase.auth.admin.createUser({
    email: email,
    password: password,
    email_confirm: true, // Otomatis konfirmasi email
    user_metadata: {
      full_name: 'Admin Marhas',
      username: 'adminmarhas',
    }
  });

  if (createError || !newUser) {
    console.error('❌ Gagal membuat user baru:', createError?.message);
    process.exit(1);
  }

  console.log(`   ✅ Akun berhasil dibuat! ID: ${newUser.id}`);

  // 5. Update Profile dengan Level Maksimal (99), 98000 XP, dan Laporan Selesai 999
  console.log('\n🆙 Mengonfigurasi Profil Spesial (Level 99, XP 98000, Laporan Selesai 999)...');
  
  const MAX_LEVEL = 99;
  const MAX_XP = 98000;
  const REPORTS_COUNT = 999;

  // Supabase trigger on_auth_user_created mungkin sudah otomatis membuat record profiles.
  // Kita gunakan upsert untuk meng-update field gamifikasi secara spesifik.
  const { data: updatedProfile, error: profileUpdateError } = await supabase
    .from('profiles')
    .upsert({
      id: newUser.id,
      username: 'adminmarhas',
      full_name: 'Admin Marhas',
      xp: MAX_XP,
      level: MAX_LEVEL,
      report_count: REPORTS_COUNT,
      role: 'citizen', // Diatur sebagai citizen agar bisa login & tampil lengkap di app Flutter
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (profileUpdateError || !updatedProfile) {
    console.error('❌ Gagal memperbarui data profil gamifikasi:', profileUpdateError?.message);
    process.exit(1);
  }

  console.log('   ✅ Profil berhasil di-upgrade!');

  // 6. Anugerahkan semua lencana (badges) ke user baru ini
  console.log('\n🏅 Menganugerahkan semua lencana yang tersedia...');
  const { data: badges, error: badgeError } = await supabase
    .from('badges')
    .select('id, code, name');

  if (badgeError || !badges || badges.length === 0) {
    console.warn('   ⚠️ Lencana master belum dibuat di database atau gagal dibaca.');
  } else {
    const relations = badges.map((b) => ({
      profile_id: newUser.id,
      badge_id: b.id,
      earned_at: new Date().toISOString(),
    }));

    const { error: awardError } = await supabase
      .from('profile_badges')
      .insert(relations);

    if (awardError) {
      console.error('   ❌ Gagal menganugerahkan lencana:', awardError.message);
    } else {
      console.log(`   ✅ Berhasil menganugerahkan ${badges.length} lencana lengkap!`);
      badges.forEach((b) => console.log(`      - [🏅] ${b.name} (${b.code})`));
    }
  }

  // 7. Kirim Notifikasi Selamat Datang Spesial
  console.log('\n🔔 Mengirim notifikasi in-app penyambutan...');
  try {
    await supabase.from('notifications').insert({
      profile_id: newUser.id,
      title: 'Selamat Datang Admin Marhas! 👑',
      body: 'Akun spesial Anda telah siap digunakan dengan Level 99, 999 laporan selesai, dan lencana lengkap!',
    });
  } catch (e) {
    // Abaikan error notifikasi
  }

  console.log('\n==================================================');
  console.log('🎉 PROSES RESET & PEMBUATAN AKUN SUKSES!');
  console.log('==================================================');
  console.log(`📧 Email    : ${email}`);
  console.log(`🔑 Password : ${password}`);
  console.log(`👤 Nama     : Admin Marhas`);
  console.log(`🆙 Level    : ${updatedProfile.level}`);
  console.log(`📈 XP       : ${updatedProfile.xp}`);
  console.log(`📝 Laporan  : ${updatedProfile.report_count}`);
  console.log('==================================================\n');
}

run().catch((err) => {
  console.error('💥 Terjadi kesalahan fatal:', err);
});
