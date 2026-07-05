import * as dns from 'dns';

dns.resolve4('db.uvwkhwryfofnteffrmxe.supabase.co', (err, addresses) => {
  if (err) {
    console.error('Failed to resolve db.uvwkhwryfofnteffrmxe.supabase.co:', err.message);
  } else {
    console.log('Resolved db.uvwkhwryfofnteffrmxe.supabase.co:', addresses);
  }
});

dns.resolve4('aws-0-ap-southeast-1.pooler.supabase.com', (err, addresses) => {
  if (err) {
    console.error('Failed to resolve pooler:', err.message);
  } else {
    console.log('Resolved pooler:', addresses);
  }
});
