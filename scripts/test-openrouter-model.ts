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

async function run() {
  const requestedModel = 'google/gemini-2.5-flash-lite';
  console.log(`Sending request to OpenRouter with model: "${requestedModel}"...`);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: requestedModel,
        messages: [{ role: 'user', content: 'test. reply with one word.' }]
      })
    });

    console.log(`HTTP Status: ${response.status}`);
    const json: any = await response.json();
    console.log('\n--- OPENROUTER RESPONSE ---');
    console.log(JSON.stringify(json, null, 2));
    console.log('---------------------------\n');
    console.log(`Actual model used: ${json.model}`);
  } catch (err) {
    console.error('Error querying OpenRouter:', err);
  }
}

run();
