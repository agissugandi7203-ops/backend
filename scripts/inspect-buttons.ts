import * as https from 'https';

const url = 'https://peraturan.bpk.go.id/Details/5313/pp-no-81-tahun-2012';

const agent = new https.Agent({ rejectUnauthorized: false });
const options = {
  agent,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
};

https.get(url, options, (res) => {
  let html = '';
  res.on('data', chunk => html += chunk);
  res.on('end', () => {
    const regex = /<a[^>]*class="[^"]*download-file[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    console.log('--- ALL DOWNLOAD BUTTONS ---');
    while ((match = regex.exec(html)) !== null) {
      console.log(`Href: ${match[1]}`);
      console.log(`Content: ${match[2].trim().substring(0, 100)}`);
      console.log('---------------------------');
    }
  });
}).on('error', console.error);
