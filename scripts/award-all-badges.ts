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
  console.log('🚀 PENGANUGERAHAN BADGE (LENCANA) MASSAL');
  console.log('==================================================\n');

  // 1. Ambil daftar semua lencana (badges) yang tersedia
  const { data: badges, error: badgeError } = await supabase
    .from('badges')
    .select('id, code, name, description');

  if (badgeError || !badges || badges.length === 0) {
    console.error('❌ Gagal mengambil daftar lencana atau lencana belum terisi:', badgeError?.message);
    process.exit(1);
  }

  console.log(`🏅 Daftar Lencana yang Tersedia (${badges.length}):`);
  badges.forEach((b, idx) => {
    console.log(`   [${idx + 1}] Kode: ${b.code} | Nama: "${b.name}" | Deskripsi: ${b.description || 'null'}`);
  });
  console.log('');

  // 2. Ambil semua profile dari Supabase
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, full_name')
    .eq('role', 'citizen');

  if (profileError || !profiles || profiles.length === 0) {
    console.error('❌ Gagal mengambil profil warga atau belum ada warga terdaftar:', profileError?.message);
    process.exit(1);
  }

  console.log(`👤 Jumlah Pengguna (Citizen) Terdaftar: ${profiles.length}`);

  // 3. Ambil relasi profile_badges yang sudah ada untuk menghindari duplikasi
  const { data: existingRelations, error: relError } = await supabase
    .from('profile_badges')
    .select('profile_id, badge_id');

  if (relError) {
    console.error('❌ Gagal mengambil relasi lencana pengguna saat ini:', relError.message);
    process.exit(1);
  }

  // Buat set untuk pencarian cepat kombinasi "profileId_badgeId"
  const existingSet = new Set(
    (existingRelations || []).map((r) => `${r.profile_id}_${r.badge_id}`)
  );

  // 4. Siapkan payload insert massal
  const newAwards: any[] = [];
  profiles.forEach((p) => {
    badges.forEach((b) => {
      const key = `${p.id}_${b.id}`;
      if (!existingSet.has(key)) {
        newAwards.push({
          profile_id: p.id,
          badge_id: b.id,
          earned_at: new Date().toISOString(),
        });
      }
    });
  });

  if (newAwards.length === 0) {
    console.log('✨ Semua pengguna sudah memiliki semua lencana yang tersedia! Tidak perlu pembaruan.');
    console.log('==================================================\n');
    return;
  }

  console.log(`✍️ Menambahkan ${newAwards.length} lencana baru ke profil para pengguna...`);

  // Lakukan insert dalam chunk agar aman jika data sangat banyak
  const chunkSize = 100;
  for (let i = 0; i < newAwards.length; i += chunkSize) {
    const chunk = newAwards.slice(i, i + chunkSize);
    const { error: insertError } = await supabase
      .from('profile_badges')
      .insert(chunk);

    if (insertError) {
      console.error(`❌ Gagal memasukkan chunk dari indeks ${i}:`, insertError.message);
    } else {
      console.log(`   ✅ Berhasil memasukkan ${chunk.length} lencana...`);
    }
  }

  // Kirim notifikasi ke pengguna yang mendapatkan lencana baru
  console.log('\n🔔 Mengirimkan notifikasi in-app kepada pengguna yang mendapatkan lencana baru...');
  const notifiedUsers = new Set<string>();
  for (const award of newAwards) {
    if (!notifiedUsers.has(award.profile_id)) {
      notifiedUsers.add(award.profile_id);
      const user = profiles.find((p) => p.id === award.profile_id);
      try {
        await supabase.from('notifications').insert({
          profile_id: award.profile_id,
          title: 'Koleksi Lencana Lengkap! 🏅',
          body: `Selamat ${user?.full_name || `@${user?.username}` || 'Warga'}! Admin menganugerahi Anda seluruh lencana penghargaan resmi Genesis.id!`,
        });
      } catch (e) {
        // Abaikan error notifikasi
      }
    }
  }

  console.log('\n==================================================');
  console.log('🎉 PENGANUGERAHAN SELESAI!');
  console.log(`🏅 Total Lencana Ditambahkan : ${newAwards.length}`);
  console.log(`👤 Pengguna Terpengaruh       : ${notifiedUsers.size} pengguna`);
  console.log('==================================================\n');
}

run().catch((err) => {
  console.error('💥 Terjadi kesalahan fatal:', err);
});
