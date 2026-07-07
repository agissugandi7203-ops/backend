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

async function run() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const tables = ['profiles', 'badges', 'profile_badges'];

  for (const table of tables) {
    console.log(`\n=================== ${table} Columns ===================`);
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .limit(1);

    if (error) {
      console.error(`Error querying ${table}:`, error.message);
      // Fallback: query from information_schema
      const { data: cols, error: errCols } = await supabase
        .rpc('get_table_columns', { table_name: table }); // if RPC exists
      if (errCols) {
        // Run SQL via direct select information_schema (doesn't work easily via Postgrest unless RPC is defined)
      }
    } else if (data && data.length > 0) {
      console.log('Columns:', Object.keys(data[0]));
    } else {
      console.log('No data found, but table exists.');
      // Let's get columns from pg_attribute if possible
    }
  }
}

run();
