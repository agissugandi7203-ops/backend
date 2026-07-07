import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const baseDir = path.resolve(__dirname, '../../docs/regulations/pdf');

interface RegulationFile {
  url: string;
  destPath: string;
  name: string;
}

const filesToDownload: RegulationFile[] = [
  // 1. Nasional
  {
    name: 'UU Nomor 18 Tahun 2008 tentang Pengelolaan Sampah',
    url: 'https://peraturan.bpk.go.id/Download/28462/UU%20Nomor%2018%20Tahun%202008.pdf',
    destPath: path.join(baseDir, '1_nasional/1_undang_undang/uu_no_18_2008_pengelolaan_sampah.pdf')
  },
  {
    name: 'UU Nomor 32 Tahun 2009 tentang Perlindungan dan Pengelolaan Lingkungan Hidup',
    url: 'https://peraturan.bpk.go.id/Download/38743/UU%20No%2032%20Tahun%202009.pdf',
    destPath: path.join(baseDir, '1_nasional/1_undang_undang/uu_no_32_2009_lingkungan_hidup.pdf')
  },
  {
    name: 'PP Nomor 22 Tahun 2021 tentang Penyelenggaraan Perlindungan Lingkungan Hidup',
    url: 'https://peraturan.bpk.go.id/Download/161852/PP%20No%2022%20Tahun%202021.pdf',
    destPath: path.join(baseDir, '1_nasional/2_peraturan_pemerintah/pp_no_22_2021_perlindungan_lingkungan.pdf')
  },
  {
    name: 'Perpres Nomor 97 Tahun 2017 tentang Jakstranas Pengelolaan Sampah',
    url: 'https://peraturan.bpk.go.id/Download/73225/Perpres%20Nomor%2097%20Tahun%202017.pdf',
    destPath: path.join(baseDir, '1_nasional/2_peraturan_pemerintah/perpres_no_97_2017_jakstranas_sampah.pdf')
  },
  // 2. Daerah (Jawa Barat & Kota Bandung)
  {
    name: 'Perda Kota Bandung Nomor 9 Tahun 2018 tentang Pengelolaan Sampah (Bandung)',
    url: 'https://jdih.bandung.go.id/uploads/dokumen_hukum/peraturan_daerah/2018/PERDA_No.9_Tahun_2018.pdf',
    destPath: path.join(baseDir, '2_daerah/2_kota_kabupaten/perda_bandung_no_9_2018_sampah.pdf')
  },
  {
    name: 'Perda Kota Bandung Nomor 3 Tahun 2019 tentang Kawasan Tanpa Rokok (Bandung)',
    url: 'https://jdih.bandung.go.id/uploads/dokumen_hukum/peraturan_daerah/2019/PERDA_No.3_Tahun_2019.pdf',
    destPath: path.join(baseDir, '2_daerah/2_kota_kabupaten/perda_bandung_no_3_2019_ktr.pdf')
  },
  {
    name: 'Perda Provinsi Jawa Barat Nomor 1 Tahun 2016 tentang Sampah Regional (Jawa Barat)',
    url: 'https://jdih.jabarprov.go.id/uploads/produk_hukum/peraturan_daerah/2016/PERDA_No.1_Tahun_2016.pdf',
    destPath: path.join(baseDir, '2_daerah/1_provinsi/perda_jabar_no_1_2016_sampah_regional.pdf')
  }
];

function downloadFile(file: RegulationFile): Promise<void> {
  return new Promise((resolve, reject) => {
    // Jika file sudah ada di disk, lewati pengunduhan untuk menghemat bandwidth
    if (fs.existsSync(file.destPath)) {
      console.log(`⏭️ Dilewati (Sudah ada): ${path.basename(file.destPath)}`);
      resolve();
      return;
    }

    console.log(`⏳ Mengunduh: ${file.name}...`);
    
    const directory = path.dirname(file.destPath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    const fileStream = fs.createWriteStream(file.destPath);

    // Menggunakan rejectUnauthorized: false untuk mematikan validasi sertifikat SSL/TLS jika situs JDIH daerah kedaluwarsa
    const agent = new https.Agent({
      rejectUnauthorized: false
    });

    const options = {
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };

    https.get(file.url, options, (response) => {
      // Tangani redirect (status code 301, 302, 307, 308)
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
  console.log('📥 DOWNLOADER OTOMATIS: DOKUMEN REGULASI NASIONAL & DAERAH RI');
  console.log('================================================================\n');

  for (const file of filesToDownload) {
    try {
      await downloadFile(file);
    } catch (err: any) {
      console.error(`   └─ ❌ GAGAL: ${err.message}`);
    }
  }

  console.log('\n================================================================');
  console.log('🎉 PROSES DOWNLOAD DOKUMEN SELESAI');
  console.log('================================================================');
}

run().catch(console.error);
