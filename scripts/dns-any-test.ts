import * as dns from 'dns';

function resolveAny(domain: string) {
  console.log(`Resolving records for ${domain}...`);
  
  dns.resolveCname(domain, (err, addresses) => {
    if (err) console.log('CNAME failed:', err.message);
    else console.log('CNAME:', addresses);
  });

  dns.resolveSrv('_postgres._tcp.' + domain, (err, addresses) => {
    if (err) console.log('SRV failed:', err.message);
    else console.log('SRV:', addresses);
  });

  dns.resolveTxt(domain, (err, addresses) => {
    if (err) console.log('TXT failed:', err.message);
    else console.log('TXT:', addresses);
  });
}

resolveAny('db.uvwkhwryfofnteffrmxe.supabase.co');
resolveAny('uvwkhwryfofnteffrmxe.supabase.co');
