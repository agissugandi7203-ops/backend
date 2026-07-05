import * as dns from 'dns';

dns.lookup('db.uvwkhwryfofnteffrmxe.supabase.co', { all: true }, (err, addresses) => {
  if (err) {
    console.error('dns.lookup failed:', err);
  } else {
    console.log('dns.lookup results:', addresses);
  }
});
