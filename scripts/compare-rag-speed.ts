import { createClient } from '@supabase/supabase-js';
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

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY as string;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENROUTER_API_KEY) {
  console.error('Missing credentials in .env');
  process.exit(1);
}

const models = [
  'google/gemini-2.5-flash-lite',
  'google/gemini-3.5-flash',
  'google/gemini-2.5-flash'
];

async function run() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const promptText = 'Tolong jelaskan secara singkat apa sanksi membuang sampah sembarangan menurut perda Kota Genesis.';
  console.log(`Starting RAG benchmarking for prompt: "${promptText}"\n`);

  for (const model of models) {
    console.log(`=========================================`);
    console.log(`TESTING MODEL: ${model}`);
    console.log(`=========================================`);

    try {
      // Step 1: Generate Embedding
      console.log(`1. Generating embedding for query...`);
      const embedStart = Date.now();
      const embedResponse = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`
        },
        body: JSON.stringify({
          model: 'google/gemini-embedding-2',
          input: promptText,
          dimensions: 768
        })
      });

      if (!embedResponse.ok) {
        throw new Error(`Embedding API failed: ${await embedResponse.text()}`);
      }
      const embedJson = await embedResponse.json();
      const embedding = embedJson.data?.[0]?.embedding;
      const embedEnd = Date.now();
      const embedDuration = (embedEnd - embedStart) / 1000;
      console.log(`   - Done in ${embedDuration.toFixed(2)} seconds`);

      // Step 2: Supabase Query
      console.log(`2. Searching Supabase Vector DB...`);
      const dbStart = Date.now();
      const { data: documents, error: dbError } = await supabase.rpc('match_documents', {
        query_embedding: embedding,
        match_threshold: 0.35,
        match_count: 3
      });

      if (dbError) {
        throw new Error(`Supabase query failed: ${dbError.message}`);
      }
      const dbEnd = Date.now();
      const dbDuration = (dbEnd - dbStart) / 1000;
      console.log(`   - Done in ${dbDuration.toFixed(2)} seconds (found ${documents?.length || 0} docs)`);

      const contextText = documents && documents.length > 0 
        ? documents.map((doc: any, idx: number) => `[Doc ${idx + 1}] ${doc.title}: ${doc.content}`).join('\n\n')
        : 'Tidak ada regulasi khusus.';

      // Step 3: LLM Completion
      console.log(`3. Sending prompt + context to LLM...`);
      const systemPrompt = `Anda adalah Geni, asisten hukum Kota Genesis. Jawab pertanyaan warga berdasarkan konteks berikut secara singkat:\n\n${contextText}`;
      
      const llmStart = Date.now();
      const llmResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: promptText }
          ]
        })
      });

      if (!llmResponse.ok) {
        throw new Error(`LLM API failed: ${await llmResponse.text()}`);
      }

      const llmJson = await llmResponse.json();
      const reply = llmJson.choices?.[0]?.message?.content || '';
      const llmEnd = Date.now();
      const llmDuration = (llmEnd - llmStart) / 1000;
      const totalDuration = (llmEnd - embedStart) / 1000;

      console.log(`   - Done in ${llmDuration.toFixed(2)} seconds`);
      console.log(`\n--- BENCHMARK SUMMARY FOR ${model} ---`);
      console.log(`  * Embedding Time : ${embedDuration.toFixed(2)}s`);
      console.log(`  * Database Time  : ${dbDuration.toFixed(2)}s`);
      console.log(`  * LLM Gen Time   : ${llmDuration.toFixed(2)}s`);
      console.log(`  * TOTAL TIME     : ${totalDuration.toFixed(2)}s`);
      console.log(`  * Char count     : ${reply.length}`);
      console.log(`-----------------------------------------\n`);

    } catch (err: any) {
      console.error(`❌ Error testing ${model}:`, err.message);
    }
  }
}

run();
