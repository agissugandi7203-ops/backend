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

// Inisialisasi Supabase Client dengan Service Role Key untuk melewati RLS
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function run() {
  console.log('==================================================');
  console.log('🚀 MENJALANKAN SCRIPT TEST EVENT (HADIAH 10000 EXP)');
  console.log('==================================================\n');

  // 1. Ambil daftar profil untuk ditampilkan kepada user
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, full_name, xp, level')
    .order('xp', { ascending: false });

  if (profileError || !profiles || profiles.length === 0) {
    console.error('❌ Gagal mengambil profil pengguna atau belum ada pengguna terdaftar:', profileError?.message);
    process.exit(1);
  }

  console.log('📋 Daftar Profil Pengguna Saat Ini:');
  profiles.forEach((p, idx) => {
    console.log(`[${idx + 1}] ID: ${p.id} | Username: @${p.username || 'null'} | Nama: ${p.full_name || 'null'} | Level: ${p.level} | XP: ${p.xp}`);
  });
  console.log('');

  // 2. Tentukan target user (dari argumen baris perintah atau user pertama)
  const args = process.argv.slice(2);
  let targetUser = profiles[0];

  if (args.length > 0) {
    const searchKey = args[0];
    const found = profiles.find(
      (p) => p.id === searchKey || p.username?.toLowerCase() === searchKey.toLowerCase() || p.username === searchKey
    );
    if (found) {
      targetUser = found;
      console.log(`🎯 Menargetkan pengguna pilihan: @${targetUser.username} (${targetUser.id})`);
    } else {
      console.log(`⚠️ Pengguna dengan ID atau Username "${searchKey}" tidak ditemukan. Menggunakan pengguna pertama.`);
      console.log(`🎯 Menargetkan pengguna default: @${targetUser.username} (${targetUser.id})`);
    }
  } else {
    console.log(`💡 Tip: Anda bisa menentukan pengguna tertentu dengan menjalankan:`);
    console.log(`   npx ts-node scripts/test-event-10k.ts [username_atau_id]\n`);
    console.log(`🎯 Menargetkan pengguna default (pertama): @${targetUser.username} (${targetUser.id})`);
  }

  const userId = targetUser.id;

  // 3. Pastikan tantangan/event test_event_10k ada di tabel challenges
  console.log('\n🔍 Memeriksa tantangan test_event_10k...');
  const { data: existingChallenge, error: findError } = await supabase
    .from('challenges')
    .select('*')
    .eq('code', 'test_event_10k')
    .maybeSingle();

  let challenge = existingChallenge;

  if (!challenge) {
    console.log('🔍 Mengambil contoh tantangan untuk memeriksa kolom tabel...');
    const { data: sampleChalls } = await supabase
      .from('challenges')
      .select('*')
      .limit(1);

    const availableColumns = sampleChalls && sampleChalls.length > 0 ? Object.keys(sampleChalls[0]) : [];
    console.log('📌 Kolom yang tersedia di tabel challenges:', availableColumns);

    const insertData: any = {
      code: 'test_event_10k',
      title: 'Test Event 10K XP 🎉',
    };

    if (availableColumns.includes('xp')) insertData.xp = 10000;
    if (availableColumns.includes('points')) insertData.points = 10000;
    if (availableColumns.includes('description')) insertData.description = 'Spesial Event Uji Coba berhadiah fantastis 10000 EXP!';
    if (availableColumns.includes('desc')) insertData.desc = 'Spesial Event Uji Coba berhadiah fantastis 10000 EXP!';

    console.log('➕ Membuat tantangan test_event_10k baru...', insertData);
    const { data: newChallenge, error: createError } = await supabase
      .from('challenges')
      .insert(insertData)
      .select()
      .single();

    if (createError || !newChallenge) {
      console.error('❌ Gagal membuat tantangan test_event_10k:', createError?.message);
      process.exit(1);
    }
    challenge = newChallenge;
    console.log('✅ Berhasil membuat tantangan test_event_10k!');
  } else {
    console.log('✅ Tantangan test_event_10k sudah ada.');
  }

  // 4. Bersihkan penyelesaian sebelumnya untuk user ini agar bisa di-test berulang kali
  console.log(`🧹 Membersihkan riwayat penyelesaian test_event_10k sebelumnya untuk @${targetUser.username}...`);
  await supabase
    .from('profile_challenges')
    .delete()
    .eq('profile_id', userId)
    .eq('challenge_id', challenge.id);

  // 5. Catat penyelesaian baru
  console.log(`💾 Mencatat penyelesaian tantangan test_event_10k untuk @${targetUser.username}...`);
  const { error: insertError } = await supabase
    .from('profile_challenges')
    .insert({
      profile_id: userId,
      challenge_id: challenge.id,
      completed_at: new Date().toISOString(),
    });

  if (insertError) {
    console.error('❌ Gagal mencatat penyelesaian tantangan:', insertError.message);
    process.exit(1);
  }

  // 6. Berikan reward ke profil (tambah 10000 EXP & update level)
  console.log(`🎁 Menghitung reward dan memperbarui level & XP untuk @${targetUser.username}...`);
  const currentXp = targetUser.xp || 0;
  const currentLevel = targetUser.level || 1;

  const newXp = currentXp + 10000;
  // Rumus level-up dari gamification.service: Math.floor(newXp / 1000) + 1
  const newLevel = Math.floor(newXp / 1000) + 1;

  const { data: updatedProfile, error: updateError } = await supabase
    .from('profiles')
    .update({
      xp: newXp,
      level: newLevel,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select()
    .single();

  if (updateError || !updatedProfile) {
    console.error('❌ Gagal memperbarui data profil:', updateError?.message);
    process.exit(1);
  }

  // 7. Tambahkan notifikasi in-app
  console.log('🔔 Mengirim notifikasi in-app...');
  const { error: notifError } = await supabase.from('notifications').insert({
    profile_id: userId,
    title: 'Event Test Selesai! 🎉',
    body: `Selamat! Anda berhasil menyelesaikan "Test Event 10K XP" dan memperoleh +10000 EXP!`,
  });

  if (notifError) {
    console.warn('⚠️ Gagal mengirim notifikasi:', notifError.message);
  }

  console.log('\n==================================================');
  console.log('🎉 EVENT TEST BERHASIL DIJALANKAN!');
  console.log('==================================================');
  console.log(`👤 Pengguna : @${targetUser.username} (${userId})`);
  console.log(`📈 XP       : ${currentXp} ➡️ ${updatedProfile.xp} (+10000 XP)`);
  console.log(`🆙 Level    : ${currentLevel} ➡️ ${updatedProfile.level} (${updatedProfile.level - currentLevel > 0 ? `Level Up +${updatedProfile.level - currentLevel}! 🚀` : 'Sama'}`);
  console.log('==================================================\n');
}

run().catch((err) => {
  console.error('💥 Terjadi kesalahan fatal:', err);
});
