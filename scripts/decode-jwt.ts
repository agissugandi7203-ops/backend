import * as fs from 'fs';
import * as path from 'path';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.substring(0, idx).trim();
    const val = trimmed.substring(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = val;
  }
}

loadEnv();

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.log('No SUPABASE_SERVICE_ROLE_KEY found in .env');
  process.exit(1);
}

const parts = key.split('.');
if (parts.length !== 3) {
  console.log('Invalid JWT format');
  process.exit(1);
}

const payload = Buffer.from(parts[1], 'base64').toString('utf-8');
console.log('JWT Payload:', JSON.parse(payload));
