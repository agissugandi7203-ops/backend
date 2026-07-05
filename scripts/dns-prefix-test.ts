import * as dns from 'dns';

dns.resolve4('aws-0-ap-southeast-1.pooler.supabase.com', (err, addresses) => {
  console.log('aws-0-ap-southeast-1:', err ? err.message : addresses);
});

dns.resolve4('aws-1-ap-southeast-1.pooler.supabase.com', (err, addresses) => {
  console.log('aws-1-ap-southeast-1:', err ? err.message : addresses);
});

dns.resolve4('aws-2-ap-southeast-1.pooler.supabase.com', (err, addresses) => {
  console.log('aws-2-ap-southeast-1:', err ? err.message : addresses);
});
