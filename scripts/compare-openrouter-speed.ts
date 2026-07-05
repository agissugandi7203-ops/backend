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

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.error('Missing OPENROUTER_API_KEY in .env');
  process.exit(1);
}

const models = [
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',
  'google/gemini-3.5-flash', // We will see if OpenRouter supports this identifier
  'google/gemini-2.0-flash-lite:free' // Adding this as a popular alternative
];

async function testModel(modelName: string): Promise<{ success: boolean; duration: number; error?: string; chars?: number; text?: string }> {
  const startTime = Date.now();
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: 'Tolong jelaskan secara singkat dalam 2 paragraf tentang keindahan alam Indonesia.' }]
      })
    });

    const duration = (Date.now() - startTime) / 1000;

    if (!response.ok) {
      const errText = await response.text();
      return { success: false, duration, error: `HTTP ${response.status}: ${errText}` };
    }

    const json: any = await response.json();
    const text = json.choices?.[0]?.message?.content || '';
    return { success: true, duration, chars: text.length, text };
  } catch (err: any) {
    const duration = (Date.now() - startTime) / 1000;
    return { success: false, duration, error: err.message };
  }
}

async function run() {
  console.log('Starting OpenRouter model speed comparison...');
  console.log('Sending identical prompts to different models...\n');

  const results: Record<string, any> = {};

  for (const model of models) {
    console.log(`Testing model: ${model}...`);
    const res = await testModel(model);
    results[model] = res;
    if (res.success) {
      console.log(`✅ Success: ${res.duration.toFixed(2)}s | Received ${res.chars} chars`);
    } else {
      console.log(`❌ Failed: ${res.duration.toFixed(2)}s | Error: ${res.error}`);
    }
    console.log('-------------------------------------------');
  }

  console.log('\n=============================================================');
  console.log('               SPEED COMPARISON RESULTS');
  console.log('=============================================================');
  
  for (const model of models) {
    const res = results[model];
    if (res.success) {
      const speed = res.chars / res.duration;
      console.log(`Model: ${model}`);
      console.log(`  - Status: SUCCESS`);
      console.log(`  - Duration: ${res.duration.toFixed(2)} seconds`);
      console.log(`  - Char count: ${res.chars}`);
      console.log(`  - Generation Speed: ${speed.toFixed(1)} chars/sec`);
    } else {
      console.log(`Model: ${model}`);
      console.log(`  - Status: FAILED`);
      console.log(`  - Duration: ${res.duration.toFixed(2)} seconds`);
      console.log(`  - Error: ${res.error?.substring(0, 100)}...`);
    }
    console.log('-------------------------------------------------------------');
  }
}

run();
