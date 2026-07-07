import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const baseDir = path.resolve(__dirname, '../../docs/regulations/pdf');

interface MinisterFile {
  name: string;
  url: string;
  destPath: string;
}

const filesToDownload: MinisterFile[] = [
  {
    name: 'Permen LHK Nomor 14 Tahun 2021 tentang Bank Sampah',
    url: 'https://peraturan.bpk.go.id/Download/233754/Permen%20LHK%20No%2014%20Tahun%202021.pdf',
    destPath: path.join(baseDir, '1_nasional/3_peraturan_menteri/permen_lhk_no_14_2021_bank_sampah.pdf')
  },
  {
    name: 'Permen LHK Nomor 6 Tahun 2021 tentang Pengelolaan Limbah B3',
    url: 'https://peraturan.bpk.go.id/Download/211000/Permen%20LHK%20No.%206%20Tahun%202021.pdf',
    destPath: path.join(baseDir, '1_nasional/3_peraturan_menteri/permen_lhk_no_6_2021_limbah_b3.pdf')
  }
];

function downloadFile(file: MinisterFile): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(file.destPath)) {
      console.log(`⏭️ Dilewati (Sudah ada): ${path.basename(file.destPath)}`);
      resolve();
      return;
    }

    console.log(`⏳ Mengunduh: ${file.name}...`);
    const fileStream = fs.createWriteStream(file.destPath);
    const agent = new https.Agent({ rejectUnauthorized: false });

    const options = {
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };

    https.get(file.url, options, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
        const redirectUrl = response.headers.location!;
        https.get(redirectUrl, options, (redirectRes) => {
          redirectRes.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            console.log(`   └─ ✅ Sukses menyimpan: ${path.basename(file.destPath)}`);
            resolve();
          });
        }).on('error', (err) => {
          fs.unlink(file.destPath, () => {});
          reject(err);
        });
        return;
      }

      if (response.statusCode !== 200) {
        fs.unlink(file.destPath, () => {});
        reject(new Error(`Gagal mengunduh. Status Code: ${response.statusCode}`));
        return;
      }

      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`   └─ ✅ Sukses menyimpan: ${path.basename(file.destPath)}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(file.destPath, () => {});
      reject(err);
    });
  });
}

async function run() {
  console.log('================================================================');
  console.log('📥 PENGUNDUHAN PERATURAN MENTERI LHK ASLI & VALID');
  console.log('================================================================\n');

  for (const file of filesToDownload) {
    try {
      await downloadFile(file);
    } catch (err: any) {
      console.error(`   └─ ❌ GAGAL: ${err.message}`);
    }
  }

  console.log('\n================================================================');
  console.log('🎉 PROSES SELESAI');
  console.log('================================================================');
}

run().catch(console.error);
