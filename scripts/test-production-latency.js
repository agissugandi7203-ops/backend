const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
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
    console.warn('⚠️ File .env tidak ditemukan. Menggunakan env bawaan.');
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
const BACKEND_URL = 'https://genesishub.my.id';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di file .env');
  process.exit(1);
}

async function testEndpoint(name, url, options = {}) {
  const startTime = Date.now();
  try {
    const response = await fetch(url, options);
    const duration = Date.now() - startTime;
    const text = await response.text();
    let bodySize = text.length;
    return { status: response.status, duration, size: bodySize, success: response.ok };
  } catch (err) {
    const duration = Date.now() - startTime;
    return { status: 0, duration, size: 0, success: false, error: err.message };
  }
}

async function run() {
  console.log('========================================================================');
  console.log('⚡  PENGUJIAN LATENSI & KINERJA API GENESIS.ID DARI INDONESIA           ⚡');
  console.log(`📡 Server Backend (Singapura) : ${BACKEND_URL}`);
  console.log(`🔑 Project Supabase            : ${SUPABASE_URL}`);
  console.log('========================================================================\n');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const results = [];

  // ----------------------------------------------------
  // PHASE 1: AUTHENTICATION FLOW (Supabase Auth Client)
  // ----------------------------------------------------
  console.log('🔐 [Fase 1] Menguji Proses Autentikasi Pengguna...');

  const tempEmail = `test_latency_${Date.now()}@genesis.id`;
  const tempPassword = 'TempPassword123!';
  
  // 1. Registrasi Akun Warga Baru
  console.log(`👉 Membuat akun warga baru (Supabase Admin API)...`);
  const signupStart = Date.now();
  const { data: userData, error: createError } = await supabase.auth.admin.createUser({
    email: tempEmail,
    password: tempPassword,
    email_confirm: true
  });
  const signupDuration = Date.now() - signupStart;
  const isCreated = !createError && userData && userData.user;
  console.log(`   └─ Hasil: ${isCreated ? '✅ Berhasil' : '❌ Gagal'} | Latensi: ${signupDuration} ms`);
  results.push({ name: 'Supabase Register (Admin)', type: 'Auth Flow', status: isCreated ? 201 : 500, latency: signupDuration, notes: 'Registrasi & Konfirmasi Akun' });

  if (!isCreated) {
    console.error('❌ Gagal membuat user untuk tes. Menghentikan pengujian.', createError?.message);
    return;
  }

  const userId = userData.user.id;

  // 2. Sign-In (Login) Akun Warga
  console.log('👉 Melakukan login (Sign-In) untuk mendapatkan JWT Bearer token...');
  const signinStart = Date.now();
  const { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({
    email: tempEmail,
    password: tempPassword
  });
  const signinDuration = Date.now() - signinStart;
  const isAuthenticated = !signInError && sessionData && sessionData.session;
  console.log(`   └─ Hasil: ${isAuthenticated ? '✅ Berhasil' : '❌ Gagal'} | Latensi: ${signinDuration} ms`);
  results.push({ name: 'Supabase Sign-In (JWT)', type: 'Auth Flow', status: isAuthenticated ? 200 : 401, latency: signinDuration, notes: 'Pertukaran kredensial -> Token JWT' });

  if (!isAuthenticated) {
    console.error('❌ Gagal melakukan autentikasi login.', signInError?.message);
    await supabase.auth.admin.deleteUser(userId);
    return;
  }

  const token = sessionData.session.access_token;
  const authHeaders = { 'Authorization': `Bearer ${token}` };


  // ----------------------------------------------------
  // PHASE 2: AUTHENTICATED ENDPOINTS
  // ----------------------------------------------------
  console.log('\n🛡️ [Fase 2] Menguji Endpoint Data & Profil (Memerlukan Login)...');

  // 1. GET /auth/verify
  console.log('👉 Menguji GET /auth/verify...');
  const rVerify = await testEndpoint('GET /auth/verify', `${BACKEND_URL}/auth/verify`, { headers: authHeaders });
  console.log(`   └─ Hasil: ${rVerify.success ? '✅ OK' : '❌ Gagal'} | Latensi: ${rVerify.duration} ms`);
  results.push({ name: 'GET /auth/verify', type: 'Profile & Auth', status: rVerify.status, latency: rVerify.duration, notes: 'Verifikasi validitas token JWT' });

  // 2. POST /profiles/onboard
  console.log('👉 Menguji POST /profiles/onboard...');
  const onboardPayload = {
    username: `user_${Date.now()}`,
    full_name: 'Tester Indonesia',
    province: 'Jawa Barat',
    city_or_district: 'Kota Bandung'
  };
  const onboardStart = Date.now();
  const onboardResponse = await fetch(`${BACKEND_URL}/profiles/onboard`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders
    },
    body: JSON.stringify(onboardPayload)
  });
  const onboardDuration = Date.now() - onboardStart;
  await onboardResponse.text();
  console.log(`   └─ Hasil: ${onboardResponse.ok ? '✅ OK' : '❌ Gagal'} | Latensi: ${onboardDuration} ms | Status: ${onboardResponse.status}`);
  results.push({ name: 'POST /profiles/onboard', type: 'Profile & Auth', status: onboardResponse.status, latency: onboardDuration, notes: 'Pendaftaran username & lokasi' });

  // 3. GET /profiles/me
  console.log('👉 Menguji GET /profiles/me...');
  const rProfileMe = await testEndpoint('GET /profiles/me', `${BACKEND_URL}/profiles/me`, { headers: authHeaders });
  console.log(`   └─ Hasil: ${rProfileMe.success ? '✅ OK' : '❌ Gagal'} | Latensi: ${rProfileMe.duration} ms`);
  results.push({ name: 'GET /profiles/me', type: 'Profile & Auth', status: rProfileMe.status, latency: rProfileMe.duration, notes: 'Membaca detail profil terhubung' });

  // 4. GET /badges
  console.log('👉 Menguji GET /badges...');
  const rBadges = await testEndpoint('GET /badges', `${BACKEND_URL}/badges`, { headers: authHeaders });
  console.log(`   └─ Hasil: ${rBadges.success ? '✅ OK' : '❌ Gagal'} | Latensi: ${rBadges.duration} ms`);
  results.push({ name: 'GET /badges', type: 'Data Feed', status: rBadges.status, latency: rBadges.duration, notes: 'Membaca katalog lencana gamifikasi' });

  // 5. GET /leaderboard/global
  console.log('👉 Menguji GET /leaderboard/global...');
  const rGlobalLb = await testEndpoint('GET /leaderboard/global', `${BACKEND_URL}/leaderboard/global?limit=10`, { headers: authHeaders });
  console.log(`   └─ Hasil: ${rGlobalLb.success ? '✅ OK' : '❌ Gagal'} | Latensi: ${rGlobalLb.duration} ms`);
  results.push({ name: 'GET /leaderboard/global', type: 'Data Feed', status: rGlobalLb.status, latency: rGlobalLb.duration, notes: 'Mengambil papan peringkat global' });

  // 6. GET /leaderboard/city
  console.log('👉 Menguji GET /leaderboard/city...');
  const rCityLb = await testEndpoint('GET /leaderboard/city', `${BACKEND_URL}/leaderboard/city?limit=10`, { headers: authHeaders });
  console.log(`   └─ Hasil: ${rCityLb.success ? '✅ OK' : '❌ Gagal'} | Latensi: ${rCityLb.duration} ms`);
  results.push({ name: 'GET /leaderboard/city', type: 'Data Feed', status: rCityLb.status, latency: rCityLb.duration, notes: 'Mengambil peringkat kota terbersih' });

  // 7. GET /reports
  console.log('👉 Menguji GET /reports...');
  const rReports = await testEndpoint('GET /reports', `${BACKEND_URL}/reports`, { headers: authHeaders });
  console.log(`   └─ Hasil: ${rReports.success ? '✅ OK' : '❌ Gagal'} | Latensi: ${rReports.duration} ms`);
  results.push({ name: 'GET /reports', type: 'Data Feed', status: rReports.status, latency: rReports.duration, notes: 'Membaca daftar semua laporan warga' });

  // 8. POST /reports (Upload Laporan Baru)
  console.log('👉 Menguji POST /reports (Multipart Form Upload - Memicu AI)...');
  const dummyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const dummyPngBuffer = Buffer.from(dummyPngBase64, 'base64');
  
  const randLat = (-6.914744 + (Math.random() - 0.5) * 0.05).toFixed(6);
  const randLng = (107.609810 + (Math.random() - 0.5) * 0.05).toFixed(6);

  const formData = new FormData();
  formData.append('latitude', randLat);
  formData.append('longitude', randLng);
  formData.append('description', 'Uji coba performa / reports dari skrip latensi Indonesia.');
  const fileBlob = new Blob([dummyPngBuffer], { type: 'image/png' });
  formData.append('file', fileBlob, 'test_image.png');

  const reportStart = Date.now();
  try {
    const reportResponse = await fetch(`${BACKEND_URL}/reports`, {
      method: 'POST',
      headers: authHeaders,
      body: formData
    });
    const reportDuration = Date.now() - reportStart;
    const reportJson = await reportResponse.json();
    const isDup = reportJson?.isDuplicate;
    console.log(`   └─ Hasil: ${reportResponse.ok ? '✅ OK' : '❌ Gagal'} | Latensi: ${reportDuration} ms | Duplikat: ${isDup ? 'Ya' : 'Tidak (Memicu AI & GCS)'}`);
    results.push({ 
      name: 'POST /reports (Upload)', 
      type: 'Reports Flow', 
      status: reportResponse.status, 
      latency: reportDuration, 
      notes: isDup ? 'Tergabung laporan serupa (cepat)' : 'Proses lengkap (Vision API + GCS + Gemini)'
    });
  } catch (err) {
    const reportDuration = Date.now() - reportStart;
    console.log(`   └─ Hasil: ❌ Gagal | Latensi: ${reportDuration} ms | Eror: ${err.message}`);
    results.push({ name: 'POST /reports (Upload)', type: 'Reports Flow', status: 0, latency: reportDuration, notes: `Eror: ${err.message}` });
  }


  // ----------------------------------------------------
  // PHASE 3: CHATBOT AI (RAG & OpenRouter API Integration)
  // ----------------------------------------------------
  console.log('\n🤖 [Fase 3] Menguji Kinerja Chatbot AI (OpenRouter & RAG)...');

  // 1. POST /chat (Instant / Non-streaming)
  console.log('👉 Menguji POST /chat (Jawaban AI Instan - Menunggu Full Output)...');
  const chatStart = Date.now();
  try {
    const chatResponse = await fetch(`${BACKEND_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      },
      body: JSON.stringify({
        message: 'Bagaimana sanksi membuang sampah sembarangan menurut perda?',
        model: 'google/gemini-2.5-flash-lite'
      })
    });
    const chatDuration = Date.now() - chatStart;
    const chatJson = await chatResponse.json();
    console.log(`   └─ Hasil: ${chatResponse.ok ? '✅ OK' : '❌ Gagal'} | Latensi: ${chatDuration} ms`);
    console.log(`   └─ Cuplikan Balasan: "${chatJson?.reply ? chatJson.reply.substring(0, 100).replace(/\n/g, ' ') : ''}..."`);
    results.push({ 
      name: 'POST /chat (Instant AI)', 
      type: 'AI Chatbot', 
      status: chatResponse.status, 
      latency: chatDuration, 
      notes: `Menunggu jawaban penuh (${chatJson?.reply?.length || 0} karakter)` 
    });
  } catch (err) {
    const chatDuration = Date.now() - chatStart;
    console.log(`   └─ Hasil: ❌ Gagal | Latensi: ${chatDuration} ms | Eror: ${err.message}`);
    results.push({ name: 'POST /chat (Instant AI)', type: 'AI Chatbot', status: 0, latency: chatDuration, notes: `Eror: ${err.message}` });
  }

  // 2. POST /chat/stream (SSE Streaming)
  console.log('👉 Menguji POST /chat/stream (Streaming SSE - Mengukur Waktu ke Token Pertama)...');
  const streamStart = Date.now();
  try {
    const streamResponse = await fetch(`${BACKEND_URL}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      },
      body: JSON.stringify({
        message: 'Bagaimana sanksi membuang sampah sembarangan menurut perda?',
        model: 'google/gemini-2.5-flash-lite'
      })
    });

    if (streamResponse.ok && streamResponse.body) {
      const reader = streamResponse.body.getReader();
      const decoder = new TextDecoder();
      let firstChunkTime = null;
      let fullText = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (firstChunkTime === null) {
          firstChunkTime = Date.now();
        }
        const textChunk = decoder.decode(value, { stream: true });
        fullText += textChunk;
      }
      
      const streamEnd = Date.now();
      const ttft = firstChunkTime ? (firstChunkTime - streamStart) : 0;
      const totalStreamTime = streamEnd - streamStart;
      console.log(`   └─ Hasil: ✅ OK | Waktu Token Pertama (TTFT): ${ttft} ms | Durasi Aliran Total: ${totalStreamTime} ms`);
      
      results.push({ 
        name: 'POST /chat/stream (TTFT)', 
        type: 'AI Chatbot (SSE)', 
        status: 200, 
        latency: ttft, 
        notes: 'UX Vital: Waktu tunggu hingga huruf pertama muncul' 
      });
      results.push({ 
        name: 'POST /chat/stream (Total)', 
        type: 'AI Chatbot (SSE)', 
        status: 200, 
        latency: totalStreamTime, 
        notes: 'Waktu dari kirim hingga selesai streaming' 
      });
    } else {
      console.log(`   └─ Hasil: ❌ Gagal | Status: ${streamResponse.status}`);
      results.push({ name: 'POST /chat/stream (TTFT)', type: 'AI Chatbot (SSE)', status: streamResponse.status, latency: 0, notes: 'Aliran stream gagal' });
    }
  } catch (err) {
    const streamDuration = Date.now() - streamStart;
    console.log(`   └─ Hasil: ❌ Gagal | Latensi: ${streamDuration} ms | Eror: ${err.message}`);
    results.push({ name: 'POST /chat/stream (TTFT)', type: 'AI Chatbot (SSE)', status: 0, latency: streamDuration, notes: `Eror: ${err.message}` });
  }


  // ----------------------------------------------------
  // CLEANUP
  // ----------------------------------------------------
  console.log('\n🧹 Membersihkan akun uji coba...');
  const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.warn(`   ⚠️ Gagal menghapus akun uji coba ${tempEmail}: ${deleteError.message}`);
  } else {
    console.log(`   ✅ Akun warga uji coba ${tempEmail} telah dihapus.`);
  }

  printSummary(results);
}

function printSummary(results) {
  console.log('\n========================================================================================');
  console.log('                          LAPORAN RINGKASAN LATENSI DAN KINERJA');
  console.log('========================================================================================');
  console.log(
    String('Nama Layanan / Endpoint').padEnd(30) + ' | ' + 
    String('Tipe Layanan').padEnd(16) + ' | ' + 
    String('Status').padEnd(6) + ' | ' + 
    String('Latensi').padEnd(10) + ' | ' + 
    String('Keterangan / Detail')
  );
  console.log('─'.repeat(105));

  for (const r of results) {
    const latencyStr = r.latency > 0 ? `${r.latency} ms` : '-';
    console.log(
      r.name.padEnd(30) + ' | ' +
      r.type.padEnd(16) + ' | ' +
      String(r.status).padEnd(6) + ' | ' +
      latencyStr.padEnd(10) + ' | ' +
      r.notes
    );
  }
  console.log('========================================================================================');
  console.log('💡 Catatan Performa:');
  console.log('  1. Latensi Jaringan: Server berada di Singapura (AP-Southeast-1) dan klien diuji dari Indonesia.');
  console.log('  2. TTFT (Time to First Token) adalah indikator utama kenyamanan chat AI.');
  console.log('  3. Laporan Non-Duplikat (POST /reports) memerlukan waktu lebih lama karena memicu Google Vision API,');
  console.log('     upload file ke GCS, dan klasifikasi AI Gemini.');
  console.log('========================================================================================\n');
}

run().catch((err) => {
  console.error('💥 Terjadi kesalahan fatal:', err);
});
