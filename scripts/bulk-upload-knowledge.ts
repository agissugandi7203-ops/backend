import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// Usage: npx ts-node scripts/bulk-upload-knowledge.ts [directory-path]
const args = process.argv.slice(2);
let dirPath = args[0];

// Load environment variables manually to avoid dependency issues
function loadEnv() {
  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../backend/.env')
  ];

  let envFileContent = '';
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      envFileContent = fs.readFileSync(p, 'utf-8');
      console.log(`Loaded environment from: ${p}`);
      break;
    }
  }

  if (!envFileContent) {
    console.warn('⚠️ file .env tidak ditemukan di jalur manapun. Menggunakan process.env bawaan.');
    return;
  }

  const lines = envFileContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const firstEquals = trimmed.indexOf('=');
    if (firstEquals === -1) continue;
    const key = trimmed.substring(0, firstEquals).trim();
    const value = trimmed.substring(firstEquals + 1).trim();
    // Remove potential surrounding quotes
    const cleanedValue = value.replace(/^['"]|['"]$/g, '');
    process.env[key] = cleanedValue;
  }
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_EMBEDDING_MODEL = process.env.OPENROUTER_EMBEDDING_MODEL || 'google/gemini-embedding-2';
const RAG_CHUNK_SIZE = Number(process.env.RAG_CHUNK_SIZE) || 800;
const RAG_CHUNK_OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP) || 150;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di environment!');
  process.exit(1);
}

if (!OPENROUTER_API_KEY) {
  console.error('❌ Error: OPENROUTER_API_KEY tidak ditemukan di environment!');
  process.exit(1);
}

// Default to docs/regulations relative to root if not provided
if (!dirPath) {
  const possiblePaths = [
    path.resolve(process.cwd(), '../docs/regulations'),
    path.resolve(__dirname, '../../docs/regulations'),
    path.resolve(process.cwd(), 'docs/regulations'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      dirPath = p;
      break;
    }
  }
}

if (!dirPath) {
  console.error('❌ Error: Direktori dokumen tidak ditentukan dan tidak dapat dideteksi secara otomatis!');
  console.log('Penggunaan: npx ts-node scripts/bulk-upload-knowledge.ts <directory-path>');
  process.exit(1);
}

const absoluteDirPath = path.resolve(dirPath);
if (!fs.existsSync(absoluteDirPath)) {
  console.error(`❌ Error: Direktori "${absoluteDirPath}" tidak ditemukan.`);
  process.exit(1);
}

// Inisialisasi Supabase Client dengan Service Role Key
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Helper to chunk text
function chunkText(text: string, chunkSize: number = 800, chunkOverlap: number = 150): string[] {
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    let end = start + chunkSize;
    if (end >= text.length) {
      end = text.length;
      chunks.push(text.substring(start, end).trim());
      break;
    }
    
    // Cari spasi terdekat agar pemotongan rapi (tidak memotong kata)
    const nextSpace = text.indexOf(' ', end);
    if (nextSpace !== -1 && nextSpace - end < 50) {
      end = nextSpace;
    }
    
    chunks.push(text.substring(start, end).trim());
    start = end - chunkOverlap;
    if (start <= 0 || start >= text.length) break;
  }
  
  return chunks.filter(c => c.length > 0);
}

// Helper to get embeddings from OpenRouter
async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_EMBEDDING_MODEL,
      input: text,
      dimensions: 768,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter Embeddings API returned status ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const embedding = result.data?.[0]?.embedding;
  if (!embedding || !Array.isArray(embedding)) {
    throw new Error('Invalid embedding response format from OpenRouter');
  }

  return embedding;
}

async function bulkUpload() {
  const files = fs.readdirSync(absoluteDirPath).filter(
    file => file.endsWith('.txt') || file.endsWith('.md')
  );
  
  if (files.length === 0) {
    console.log(`ℹ️ Tidak ditemukan berkas .txt atau .md di "${absoluteDirPath}"`);
    return;
  }

  console.log('======================================================');
  console.log('🤖 BULK UPLOAD KNOWLEDGE BASE DIRECT TO SUPABASE');
  console.log('======================================================');
  console.log(`📂 Direktori Sumber: ${absoluteDirPath}`);
  console.log(`🔗 Target Supabase: ${SUPABASE_URL}`);
  console.log(`📑 Total Berkas Ditemukan: ${files.length}`);
  console.log(`📏 Chunk Size: ${RAG_CHUNK_SIZE}, Overlap: ${RAG_CHUNK_OVERLAP}`);
  console.log('------------------------------------------------------');

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

    const chunks = chunkText(content, RAG_CHUNK_SIZE, RAG_CHUNK_OVERLAP);
    console.log(`   - Terbagi menjadi ${chunks.length} chunk.`);

    for (let i = 0; i < chunks.length; i++) {
      const chunkContent = chunks[i];
      const chunkTitle = chunks.length > 1 ? `${title} - Bagian ${i + 1}` : title;

      console.log(`   ⏳ Membuat embedding untuk chunk ${i + 1}/${chunks.length}...`);
      try {
        const embedding = await getEmbedding(chunkContent);
        
        console.log(`   📤 Menyimpan ke Supabase 'knowledge_base'...`);
        const { data, error } = await supabase
          .from('knowledge_base')
          .insert({
            title: chunkTitle,
            content: chunkContent,
            embedding,
            metadata: {
              source_file: file,
              original_title: title,
              chunk_index: i,
              total_chunks: chunks.length,
              imported_via: 'Bulk_Upload_Script_Direct',
              imported_at: new Date().toISOString(),
            },
          })
          .select('id, title')
          .single();

        if (error) {
          console.error(`   ❌ Error Supabase di chunk ${i + 1}: ${error.message}`);
        } else {
          console.log(`   ✅ Berhasil menyimpan chunk ${i + 1} (${data.title})`);
        }
      } catch (err: any) {
        console.error(`   ❌ Gagal memproses chunk ${i + 1}: ${err.message}`);
      }
    }
    console.log('------------------------------------------------------');
  }
}

bulkUpload()
  .then(() => console.log('\n🎉 Proses unggah massal selesai.'))
  .catch(err => console.error('❌ Terjadi kesalahan fatal:', err));
