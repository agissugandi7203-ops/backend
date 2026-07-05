import { Client } from 'pg';

async function test(port: number) {
  const host = 'aws-0-ap-southeast-1.pooler.supabase.com';
  const connectionString = `postgresql://postgres.uvwkhwryfofnteffrmxe:cocArief2510@${host}:${port}/postgres`;
  
  console.log(`Testing connection to ${host}:${port}...`);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log(`🎉 SUCCESS on port ${port}!`);
    await client.end();
    return true;
  } catch (error: any) {
    console.log(`❌ Failed on port ${port}: ${error.message}`);
    try {
      await client.end();
    } catch {}
    return false;
  }
}

async function run() {
  await test(5432);
  await test(6543);
}

run();
