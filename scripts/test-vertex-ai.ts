import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

// Load env
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const firstEquals = trimmed.indexOf('=');
    if (firstEquals === -1) continue;
    const key = trimmed.substring(0, firstEquals).trim();
    const value = trimmed.substring(firstEquals + 1).trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }
}

const GCS_PROJECT_ID = process.env.GCS_PROJECT_ID;
const GCS_KEY_FILE_PATH = process.env.GCS_KEY_FILE_PATH;

if (!GCS_PROJECT_ID || !GCS_KEY_FILE_PATH) {
  console.error('Missing GCS_PROJECT_ID or GCS_KEY_FILE_PATH in .env');
  process.exit(1);
}

// Resolve key file path relative to backend folder
const absoluteKeyPath = path.isAbsolute(GCS_KEY_FILE_PATH)
  ? GCS_KEY_FILE_PATH
  : path.resolve(process.cwd(), GCS_KEY_FILE_PATH);

if (!fs.existsSync(absoluteKeyPath)) {
  console.error(`GCP Key file not found at: ${absoluteKeyPath}`);
  process.exit(1);
}

// Set standard GCP environment variables for SDK authentication
process.env.GOOGLE_APPLICATION_CREDENTIALS = absoluteKeyPath;
process.env.GCLOUD_PROJECT = GCS_PROJECT_ID;

console.log(`=========================================`);
console.log(`   TESTING GOOGLE CLOUD VERTEX AI`);
console.log(`=========================================`);
console.log(`Project ID : ${GCS_PROJECT_ID}`);
console.log(`Key File   : ${absoluteKeyPath}`);
console.log(`Credentials verified. Initializing GoogleGenAI...\n`);

async function run() {
  try {
    // Initialize unified Google GenAI SDK for Vertex AI
    const ai = new GoogleGenAI({
      vertexai: true,
      project: GCS_PROJECT_ID,
      location: 'asia-southeast1'
    });

    // 1. Test Text Embedding
    console.log('1. Testing Vertex AI Embeddings (text-embedding-004)...');
    const embedStart = Date.now();
    const embedResult = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: 'Tolong jelaskan secara singkat apa sanksi membuang sampah sembarangan menurut perda Kota Genesis.'
    });
    
    const embedEnd = Date.now();
    const embedDuration = (embedEnd - embedStart) / 1000;
    
    // In SDK version 2.9+, embedResult returns 'embeddings' (plural) containing values
    const firstEmbedding = Array.isArray(embedResult.embeddings) 
      ? embedResult.embeddings[0] 
      : (embedResult as any).embedding;

    if (firstEmbedding && firstEmbedding.values) {
      console.log(`   ✅ Success!`);
      console.log(`   - Dimensions: ${firstEmbedding.values.length}`);
      console.log(`   - Time taken: ${embedDuration.toFixed(2)} seconds`);
    } else {
      throw new Error('No embedding values returned');
    }

    console.log('-----------------------------------------');

    // 2. Test Chat Completion
    console.log('2. Testing Vertex AI Chat Completion (gemini-2.5-flash)...');
    const chatStart = Date.now();
    const chatResult = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Halo! Tolong sebutkan 3 sanksi utama membuang sampah sembarangan secara singkat.'
    });

    const chatEnd = Date.now();
    const chatDuration = (chatEnd - chatStart) / 1000;

    console.log(`   ✅ Success!`);
    console.log(`   - Response  : ${chatResult.text?.trim()}`);
    console.log(`   - Time taken: ${chatDuration.toFixed(2)} seconds`);
    console.log('=========================================');

  } catch (err: any) {
    console.error('\n❌ Vertex AI Testing Failed!');
    console.error('Error Details:', err.message || err);
    console.log('\nTips: Pastikan service account di file JSON Anda memiliki role "Vertex AI User" di GCP Console dan API Vertex AI telah diaktifkan di project Anda.');
    console.log('=========================================');
  }
}

run();
