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
  console.log('🚀 MEMBERIKAN LEVEL MAX KE SEMUA USER DAFTAR HARI INI');
  console.log('==================================================\n');

  // Tentukan batas waktu: Hari ini (2026-06-26T00:00:00Z karena server waktu UTC)
  // Ator batas waktu 24 jam terakhir agar aman terhadap perbedaan zona waktu (WIB vs UTC)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const todayLocalStart = new Date();
  todayLocalStart.setHours(0, 0, 0, 0);
  const todayUtcStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())).toISOString();

  console.log(`⏰ Waktu saat ini (Lokal): ${new Date().toLocaleString()}`);
  console.log(`📅 Batas Waktu 24 Jam Lalu: ${new Date(twentyFourHoursAgo).toLocaleString()}`);
  console.log(`📅 Batas Waktu Hari ini (UTC): ${new Date(todayUtcStart).toLocaleString()}\n`);

  // 1. Ambil semua profile dari Supabase
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, full_name, xp, level, created_at')
    .order('created_at', { ascending: false });

  if (profileError || !profiles || profiles.length === 0) {
    console.error('❌ Gagal mengambil profil pengguna atau belum ada pengguna terdaftar:', profileError?.message);
    process.exit(1);
  }

  // Filter profil yang terdaftar "Hari Ini" atau dalam 24 jam terakhir
  // Kita deteksi jika created_at >= twentyFourHoursAgo ATAU created_at >= todayUtcStart
  const usersToday = profiles.filter((p) => {
    const createdAt = new Date(p.created_at).getTime();
    const limitTime24h = new Date(twentyFourHoursAgo).getTime();
    const limitTimeTodayUtc = new Date(todayUtcStart).getTime();
    return createdAt >= limitTime24h || createdAt >= limitTimeTodayUtc;
  });

  if (usersToday.length === 0) {
    console.log('ℹ️ Tidak ditemukan pengguna baru yang mendaftar hari ini (dalam 24 jam terakhir).');
    console.log('📋 Menampilkan pengguna terbaru yang terdaftar sebagai gantinya:');
    profiles.slice(0, 5).forEach((p, idx) => {
      console.log(`[${idx + 1}] @${p.username || 'null'} (Daftar: ${new Date(p.created_at).toLocaleString()})`);
    });
    return;
  }

  console.log(`🎯 Ditemukan ${usersToday.length} pengguna yang mendaftar hari ini:\n`);

  // Max Level Definition: Level 99 dengan 98,000 XP
  // Dihitung dengan rumus: Level = Math.floor(xp / 1000) + 1
  // Jika XP = 98000, maka Level = Math.floor(98000/1000) + 1 = 99
  const MAX_LEVEL = 99;
  const MAX_XP = 98000;

  for (const user of usersToday) {
    console.log(`👤 Memproses @${user.username || 'null'} (${user.id})...`);
    console.log(`   - Level/XP Sekarang : Lvl ${user.level} (${user.xp} XP)`);

    const { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .update({
        xp: MAX_XP,
        level: MAX_LEVEL,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .select()
      .single();

    if (updateError || !updatedProfile) {
      console.error(`   ❌ Gagal memperbarui @${user.username}:`, updateError?.message);
    } else {
      console.log(`   ✅ BERHASIL ➡️ Level ${updatedProfile.level} (${updatedProfile.xp} XP)! 🚀`);
      
      // Kirim notifikasi in-app
      try {
        await supabase.from('notifications').insert({
          profile_id: user.id,
          title: 'Level Maksimum Dicapai! 👑',
          body: `Selamat! Admin memberikan Anda peringkat Level Maksimum ${MAX_LEVEL}! Nikmati fiturnya!`,
        });
      } catch (notifErr) {
        // Abaikan error notifikasi
      }
    }
    console.log('');
  }

  console.log('==================================================');
  console.log('🎉 PROSES SELESAI!');
  console.log('==================================================');
}

run().catch((err) => {
  console.error('💥 Terjadi kesalahan fatal:', err);
});
