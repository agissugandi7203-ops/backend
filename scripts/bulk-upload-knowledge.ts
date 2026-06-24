import * as fs from 'fs';
import * as path from 'path';

// Usage: npx ts-node scripts/bulk-upload-knowledge.ts <directory-path> <jwt-token> [backend-url]
const args = process.argv.slice(2);
const dirPath = args[0];
const jwtToken = args[1];
const backendUrl = args[2] || 'http://localhost:3000';

if (!dirPath || !jwtToken) {
  console.log('\n❌ Input Tidak Valid!');
  console.log('Penggunaan: npx ts-node scripts/bulk-upload-knowledge.ts <directory-path> <jwt-token> [backend-url]\n');
  process.exit(1);
}

async function bulkUpload() {
  const absoluteDirPath = path.resolve(dirPath);
  if (!fs.existsSync(absoluteDirPath)) {
    console.error(`❌ Error: Direktori "${absoluteDirPath}" tidak ditemukan.`);
    process.exit(1);
  }

  const files = fs.readdirSync(absoluteDirPath).filter(
    file => file.endsWith('.txt') || file.endsWith('.md')
  );
  
  if (files.length === 0) {
    console.log(`ℹ️ Tidak ditemukan berkas .txt atau .md di "${absoluteDirPath}"`);
    return;
  }

  console.log(`\n🚀 Mulai unggah massal ${files.length} dokumen dari: ${absoluteDirPath}`);
  console.log(`🔗 Backend URL: ${backendUrl}\n`);

  for (const file of files) {
    const filePath = path.join(absoluteDirPath, file);
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    
    // Gunakan nama file sebagai judul default dokumen
    const title = path.basename(file, path.extname(file)).replace(/_/g, ' ');

    if (!content) {
      console.log(`⚠️ Melewati berkas kosong: "${file}"`);
      continue;
    }

    console.log(`📤 Mengunggah: "${title}" (${content.length} karakter)...`);

    try {
      const response = await fetch(`${backendUrl}/knowledge-base`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`,
        },
        body: JSON.stringify({
          title,
          content,
          metadata: {
            source_file: file,
            imported_at: new Date().toISOString(),
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Gagal mengunggah "${file}": Status ${response.status} - ${errorText}`);
      } else {
        const result = await response.json();
        console.log(`✅ Berhasil: ${result.message}`);
      }
    } catch (error: any) {
      console.error(`❌ Error koneksi saat mengunggah "${file}": ${error.message}`);
    }
    console.log('---');
  }
}

bulkUpload()
  .then(() => console.log('\n🎉 Proses unggah massal selesai.'))
  .catch(err => console.error('❌ Terjadi kesalahan fatal:', err));
