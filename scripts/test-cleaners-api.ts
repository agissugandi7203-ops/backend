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
  console.log('🔍 TESTING GARBAGE COLLECTORS (CLEANERS) API LOGIC');
  console.log('==================================================\n');

  // 1. Ambil 1 user admin atau citizen untuk dijadikan reporter_id jika kita butuh insert dummy
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .limit(1);

  if (profileError || !profiles || profiles.length === 0) {
    console.error('❌ Gagal mengambil profil untuk pengujian:', profileError?.message);
    process.exit(1);
  }

  const testUser = profiles[0];
  console.log(`👤 Menggunakan profil uji: ${testUser.full_name} (${testUser.id})`);

  // 2. Cek apakah ada laporan berstatus 'approved'
  let { data: approvedReports, error: queryError } = await supabase
    .from('reports')
    .select('id, status, location')
    .eq('status', 'approved');

  if (queryError) {
    console.error('❌ Gagal mengambil data laporan:', queryError.message);
    process.exit(1);
  }

  console.log(`📝 Ditemukan ${approvedReports?.length || 0} laporan berstatus 'approved' di database.`);

  // 3. Jika tidak ada, insert 1 laporan dummy 'approved' untuk pengujian koordinat
  if (!approvedReports || approvedReports.length === 0) {
    console.log('➕ Tidak ada laporan approved. Membuat laporan approved dummy...');
    
    // Bandung Coordinates: Lat -6.914744, Lng 107.609810
    const dummyLat = -6.914744;
    const dummyLng = 107.609810;

    const { data: newReport, error: insertError } = await supabase
      .from('reports')
      .insert({
        reporter_id: testUser.id,
        image_url: 'https://raw.githubusercontent.com/arief/genesis-badges/main/dummy_report.png',
        description: 'Tumpukan botol plastik di pinggir jalan dekat Alun-Alun Bandung.',
        location: `SRID=4326;POINT(${dummyLng} ${dummyLat})`,
        status: 'approved',
        confidence_score: 95.5,
        waste_type: 'Plastik / Anorganik',
        danger_level: 'medium',
      })
      .select()
      .single();

    if (insertError || !newReport) {
      console.error('❌ Gagal membuat laporan dummy:', insertError?.message);
      process.exit(1);
    }

    console.log('✅ Laporan dummy berhasil dibuat!');
    approvedReports = [newReport];
  }

  // 4. Jalankan logika parsing dan pencetakan koordinat
  console.log('\n🗺️ Hasil Pemrosesan Laporan untuk Petugas Kebersihan:');
  console.log('--------------------------------------------------');

  const { data: finalReports, error: fetchError } = await supabase
    .from('reports')
    .select('*, profiles(username, full_name, avatar_url)')
    .eq('status', 'approved')
    .order('created_at', { ascending: false });

  if (fetchError || !finalReports) {
    console.error('❌ Gagal mengambil rincian laporan:', fetchError?.message);
    process.exit(1);
  }

  const mapped = finalReports.map((report: any) => {
    let latitude = 0.0;
    let longitude = 0.0;

    if (report.location && report.location.coordinates) {
      longitude = report.location.coordinates[0];
      latitude = report.location.coordinates[1];
    } else if (typeof report.location === 'string') {
      // Handle WKT string format if returned as string
      const match = RegExp(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i).exec(report.location);
      if (match) {
        longitude = parseFloat(match[1]);
        latitude = parseFloat(match[2]);
      }
    }

    const google_maps_url = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;

    return {
      id: report.id,
      reporter: report.profiles?.full_name || 'Warga',
      waste_type: report.waste_type,
      danger_level: report.danger_level,
      latitude,
      longitude,
      google_maps_url,
      description: report.description,
    };
  });

  mapped.forEach((m, idx) => {
    console.log(`[Laporan #${idx + 1}]`);
    console.log(`🆔 ID             : ${m.id}`);
    console.log(`👤 Pelapor       : ${m.reporter}`);
    console.log(`♻️ Jenis Sampah   : ${m.waste_type}`);
    console.log(`⚠️ Bahaya         : ${m.danger_level}`);
    console.log(`📍 Koordinat     : ${m.latitude}, ${m.longitude}`);
    console.log(`🔗 Navigasi Maps : ${m.google_maps_url}`);
    console.log(`📝 Deskripsi     : ${m.description}\n`);
  });

  console.log('==================================================');
  console.log('🎉 PENGUJIAN SELESAI DENGAN SUKSES!');
  console.log('==================================================');
}

run().catch((err) => {
  console.error('💥 Kesalahan tidak terduga:', err);
});
