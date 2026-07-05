import { Client } from 'pg';

async function testHost(host: string) {
  const connectionString = `postgresql://postgres.uvwkhwryfofnteffrmxe:cocArief2510@${host}:6543/postgres`;
  console.log(`Testing connection to ${host}:6543...`);
  
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log(`🎉 SUCCESS on ${host}!`);
    await client.end();
    return true;
  } catch (error: any) {
    console.log(`❌ Failed on ${host}: ${error.message}`);
    try {
      await client.end();
    } catch {}
    return false;
  }
}

async function run() {
  await testHost('aws-0-ap-southeast-1.pooler.supabase.com');
  await testHost('aws-1-ap-southeast-1.pooler.supabase.com');
}

run();
