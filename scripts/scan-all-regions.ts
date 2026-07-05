import { Client } from 'pg';

const regions = [
  'ap-southeast-1', // Singapore
  'ap-southeast-2', // Sydney
  'ap-southeast-3', // Jakarta
  'ap-northeast-1', // Tokyo
  'ap-northeast-2', // Seoul
  'ap-northeast-3', // Osaka
  'ap-south-1',     // Mumbai
  'ap-south-2',     // Hyderabad
  'us-east-1',      // N. Virginia
  'us-east-2',      // Ohio
  'us-west-1',      // N. California
  'us-west-2',      // Oregon
  'ca-central-1',   // Central Canada
  'eu-west-1',      // Ireland
  'eu-west-2',      // London
  'eu-west-3',      // Paris
  'eu-central-1',   // Frankfurt
  'eu-central-2',   // Zurich
  'eu-north-1',     // Stockholm
  'eu-south-1',     // Milan
  'sa-east-1',      // São Paulo
  'me-central-1',   // Bahrain
  'af-south-1',     // Cape Town
];

async function testRegion(region: string) {
  const host = `aws-0-${region}.pooler.supabase.com`;
  const connectionString = `postgresql://postgres.uvwkhwryfofnteffrmxe:cocArief2510@${host}:6543/postgres`;
  
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 2000,
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
    if (!error.message.includes('not found') && !error.message.includes('timeout')) {
      console.log(`👉 Region ${region} returned other error (possible match!): ${error.message.trim()}`);
    }
    try {
      await client.end();
    } catch {}
    return false;
  }
}

async function run() {
  console.log('Scanning all Supabase regions for pooler...');
  for (const region of regions) {
    const success = await testRegion(region);
    if (success) {
      console.log(`\nFound working pooler: aws-0-${region}.pooler.supabase.com`);
      break;
    }
  }
  console.log('Scan completed.');
}

run();
