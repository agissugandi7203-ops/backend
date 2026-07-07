import * as dotenv from 'dotenv';
import * as path from 'path';
import { GoogleAuth } from 'google-auth-library';

dotenv.config();

const projectId = process.env.GCS_PROJECT_ID || 'arief-fajar';
const keyFilePath = process.env.GCS_KEY_FILE_PATH || 'arief-fajar-4d5200590e95.json';
const datastoreId = process.env.VERTEX_AI_DATASTORE_ID;

async function run() {
  console.log('================================================================');
  console.log('🔍 MEMERIKSA STATUS DOKUMEN DI VERTEX AI DATA STORE');
  console.log('================================================================\n');

  if (!datastoreId) {
    console.error('❌ ERROR: VERTEX_AI_DATASTORE_ID belum disetel di file .env!');
    return;
  }

  try {
    const keyPath = path.resolve(__dirname, '..', keyFilePath);
    
    // Inisialisasi Google Auth
    const auth = new GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken = tokenResponse.token;

    if (!accessToken) {
      throw new Error('Gagal mendapatkan access token Google Cloud.');
    }

    console.log('✅ Access Token berhasil dibuat.');
    console.log(`📡 Menghubungi Discovery Engine API untuk Data Store: ${datastoreId}...`);

    // Endpoint REST API Discovery Engine untuk me-list dokumen
    const url = `https://discoveryengine.googleapis.com/v1/projects/${projectId}/locations/global/collections/default_collection/dataStores/${datastoreId}/branches/0/documents`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json() as any;

    if (response.status !== 200) {
      throw new Error(`API returned status ${response.status}: ${JSON.stringify(data)}`);
    }

    console.log('\n================================================================');
    console.log('📊 DETAIL DOKUMEN YANG TERINJEKSI:');
    console.log('================================================================');

    const documents = data.documents || [];
    console.log(`📄 Jumlah Dokumen Terdaftar: ${documents.length}`);

    if (documents.length === 0) {
      console.log('\n⚠️  KOSONG: Dokumen belum di-indeks. GCP sedang memproses file PDF di latar belakang.');
      console.log('Silakan tunggu beberapa menit lalu jalankan skrip ini kembali.');
    } else {
      console.log('\nDaftar Berkas Terdeteksi:');
      documents.forEach((doc: any, index: number) => {
        const uri = doc.content?.uri || 'N/A';
        const docName = doc.name.split('/').pop();
        console.log(`${index + 1}. ID: ${docName}`);
        console.log(`   🔗 URI GCS: ${uri}`);
      });
      console.log('\n✅ Indeksasi berhasil! RAG siap membalas dengan sitasi.');
    }
    console.log('================================================================');

  } catch (error: any) {
    console.error(`❌ GAGAL MEMBACA DATA STORE: ${error.message}`);
  }
}

run().catch(console.error);
