import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load env
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const firstEquals = trimmed.indexOf('=');
    if (firstEquals === -1) continue;
    const key = trimmed.substring(0, firstEquals).trim();
    const value = trimmed.substring(firstEquals + 1).trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

async function run() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const email = `temp_bot_${Date.now()}@genesis.id`;
  const password = 'TempPassword123!';

  console.log(`Creating temp user: ${email}...`);
  const { data: userData, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (createError || !userData.user) {
    console.error('Error creating user:', createError);
    return;
  }

  const userId = userData.user.id;

  try {
    console.log('Signing in to get JWT token...');
    const { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (signInError || !sessionData.session) {
      console.error('Error signing in:', signInError);
      return;
    }

    const token = sessionData.session.access_token;
    console.log('Token retrieved successfully.');

    const testCases = [
      {
        name: 'TEST 1: Sapaan Basa-Basi / Chit-Chat (Ekspektasi: Bypass RAG & Super Cepat)',
        message: 'Halo Geni!',
        history: [],
        webSearch: false
      },
      {
        name: 'TEST 2: Pertanyaan Kredit Tim Pengembang (Ekspektasi: Menjawab Nama Tim & Sekolah)',
        message: 'Geni dibuat oleh siapa saja?',
        history: [],
        webSearch: false
      },
      {
        name: 'TEST 3: Pertanyaan Regulasi / RAG (Ekspektasi: Menggunakan Database Perda)',
        message: 'Tolong jelaskan singkat apa sanksi membuang sampah sembarangan menurut perda Kota Genesis.',
        history: [],
        webSearch: false
      },
      {
        name: 'TEST 4: Pertanyaan Pencarian Web / Grounding (Ekspektasi: Menggunakan Google Search & Muncul Link Sumber)',
        message: 'Kapan ulang tahun Kota Bandung dan siapa Walikota Bandung saat ini?',
        history: [],
        webSearch: true
      }
    ];

    for (const testCase of testCases) {
      console.log(`\n==================================================`);
      console.log(testCase.name);
      console.log(`==================================================`);
      console.log(`Sending: "${testCase.message}"`);

      const startTime = Date.now();
      const response = await fetch('https://backend-12178843429.asia-southeast1.run.app/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message: testCase.message,
          history: testCase.history,
          model: "google/gemini-2.5-flash-lite",
          webSearch: testCase.webSearch
        })
      });

      console.log(`HTTP Status: ${response.status}`);
      if (!response.ok) {
        const errText = await response.text();
        console.error('API Error:', errText);
        continue;
      }

      if (!response.body) {
        console.error('Response body is null');
        continue;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let firstChunkTime: number | null = null;
      let chunkCount = 0;
      let fullResponse = '';

      process.stdout.write('Response: ');
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (firstChunkTime === null) {
          firstChunkTime = Date.now();
        }

        chunkCount++;
        const textChunk = decoder.decode(value, { stream: true });
        fullResponse += textChunk;
        
        // Output clean delta text if possible
        const lines = textChunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const dataStr = line.substring(5).trim();
            if (dataStr === '[DONE]') continue;
            try {
              const data = JSON.parse(dataStr);
              const content = data.choices?.[0]?.delta?.content;
              const annotations = data.choices?.[0]?.delta?.annotations;
              if (content) {
                process.stdout.write(content);
              }
              if (annotations && annotations.length > 0) {
                process.stdout.write(`\n[LINK RUJUKAN: ${JSON.stringify(annotations)}]\n`);
              }
            } catch (_) {}
          }
        }
      }
      console.log(); // New line after stream ends

      const endTime = Date.now();
      const ttft = (firstChunkTime! - startTime) / 1000;
      const totalDuration = (endTime - startTime) / 1000;

      console.log(`  * Time to First Token (TTFT): ${ttft.toFixed(2)} seconds`);
      console.log(`  * Total stream duration: ${totalDuration.toFixed(2)} seconds`);
    }
    console.log('\n==================================================\n');

  } catch (err) {
    console.error('Execution error:', err);
  } finally {
    console.log(`Cleaning up: Deleting temp user ${email}...`);
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error('Error deleting user:', deleteError);
    } else {
      console.log('User deleted successfully. Cleanup complete.');
    }
  }
}

run();
