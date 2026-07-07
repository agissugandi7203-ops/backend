import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const baseDir = path.resolve(__dirname, '../../docs/regulations/pdf');

interface TargetReg {
  name: string;
  detailsUrl: string;
  destPath: string;
  downloadPattern: RegExp;
}

const targets: TargetReg[] = [
  {
    name: 'Permen LHK Nomor 14 Tahun 2021 (Bank Sampah)',
    detailsUrl: 'https://peraturan.bpk.go.id/Details/233754/permen-lhk-no-14-tahun-2021',
    destPath: path.join(baseDir, '1_nasional/3_peraturan_menteri/permen_lhk_no_14_2021_bank_sampah.pdf'),
    downloadPattern: /\/Download\/233754\/[^"'\s>]+/i
  },
  {
    name: 'Permen LHK Nomor 6 Tahun 2021 (Pengelolaan Limbah B3)',
    detailsUrl: 'https://peraturan.bpk.go.id/Details/211000/permen-lhk-no-6-tahun-2021',
    destPath: path.join(baseDir, '1_nasional/3_peraturan_menteri/permen_lhk_no_6_2021_limbah_b3.pdf'),
    downloadPattern: /\/Download\/211000\/[^"'\s>]+/i
  }
];

function fetchHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const options = {
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };

    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        fetchHtml(res.headers.location!).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch HTML. Status: ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function downloadBinary(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(dest);
    const agent = new https.Agent({ rejectUnauthorized: false });
    const options = {
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };

    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        https.get(res.headers.location!, options, (redirectRes) => {
          redirectRes.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });
        }).on('error', err => {
          fs.unlink(dest, () => {});
          reject(err);
        });
        return;
      }

      if (res.statusCode !== 200) {
        fs.unlink(dest, () => {});
        reject(new Error(`Failed download binary. Status: ${res.statusCode}`));
        return;
      }

      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
    }).on('error', err => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function run() {
  console.log('================================================================');
  console.log('🔍 AUTO-RESOLVER & DOWNLOADER DOKUMEN RESMI BPK');
  console.log('================================================================\n');

  for (const target of targets) {
    console.log(`📁 Memproses: ${target.name}`);
    try {
      console.log(`   1. Membaca halaman detail untuk mencari link download...`);
      const html = await fetchHtml(target.detailsUrl);
      const match = html.match(target.downloadPattern);
      
      if (!match) {
        console.error(`   └─ ❌ Link download tidak ditemukan di halaman detail.`);
        continue;
      }

      const rawDownloadPath = match[0]; // /Download/ID/filename.pdf
      const fullDownloadUrl = `https://peraturan.bpk.go.id${rawDownloadPath}`;
      console.log(`   2. Menemukan link download: ${fullDownloadUrl}`);
      
      const dir = path.dirname(target.destPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      console.log(`   3. Memulai pengunduhan file PDF...`);
      await downloadBinary(fullDownloadUrl, target.destPath);
      console.log(`   └─ ✅ Sukses menyimpan: ${path.basename(target.destPath)}`);
    } catch (err: any) {
      console.error(`   └─ ❌ GAGAL: ${err.message}`);
    }
  }

  console.log('\n================================================================');
  console.log('🎉 PROSES SELESAI');
  console.log('================================================================');
}

run().catch(console.error);
