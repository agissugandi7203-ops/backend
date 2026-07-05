import { Client } from 'pg';

const regions = [
  'ap-southeast-1', // Singapore
  'ap-southeast-2', // Sydney
  'ap-northeast-1', // Tokyo
  'ap-northeast-2', // Seoul
  'us-east-1',      // N. Virginia
  'eu-central-1',   // Frankfurt
];

async function testRegion(region: string) {
  const host = `aws-0-${region}.pooler.supabase.com`;
  const connectionString = `postgresql://postgres.uvwkhwryfofnteffrmxe:cocArief2510@${host}:6543/postgres`;
  
  console.log(`Testing region: ${region} (${host})...`);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 3000,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log(`🎉 SUCCESS! Connected to Supabase PostgreSQL at region: ${region}`);
    await client.query('SELECT 1');
    console.log('Query executed successfully!');
    await client.end();
    return true;
  } catch (error: any) {
    console.log(`❌ Failed for region ${region}: ${error.message.trim()}`);
    try {
      await client.end();
    } catch {}
    return false;
  }
}

async function run() {
  for (const region of regions) {
    const success = await testRegion(region);
    if (success) {
      console.log(`\nFound working pooler: aws-0-${region}.pooler.supabase.com`);
      break;
    }
  }
}

run();
