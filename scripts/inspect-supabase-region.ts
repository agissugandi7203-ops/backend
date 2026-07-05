import * as dns from 'dns';

async function run() {
  const url = 'https://uvwkhwryfofnteffrmxe.supabase.co';
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: {
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2d2tod3J5Zm9mbnRlZmZybXhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxOTUxNTAsImV4cCI6MjA5ODc3MTE1MH0.6eVqtU3A7dsWb9Z1Zn8U0XzL8OT7ixbtOCbJbPHdKAE',
      }
    });
    console.log('Status:', res.status);
    console.log('Headers:');
    res.headers.forEach((value, key) => {
      console.log(`  ${key}: ${value}`);
    });
  } catch (e: any) {
    console.error('Error fetching headers:', e.message);
  }

  dns.resolve4('uvwkhwryfofnteffrmxe.supabase.co', (err, addresses) => {
    if (err) {
      console.error('DNS resolve failed:', err);
    } else {
      console.log('Resolved IPs:', addresses);
    }
  });
}

run();
