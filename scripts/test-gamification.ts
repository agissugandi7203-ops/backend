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

const projectId = process.env.GCS_PROJECT_ID || 'arief-fajar';
const keyFilePath = process.env.GCS_KEY_FILE_PATH;
if (keyFilePath && fs.existsSync(keyFilePath)) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFilePath;
}

async function run() {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: projectId,
    location: 'asia-southeast1',
  });

  const model = 'gemini-2.5-flash';

  console.log('Testing role: "tool"...');
  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        { role: 'user', parts: [{ text: 'Berapa level saya?' }] },
        { role: 'model', parts: [{ functionCall: { name: 'getGamificationStats', args: {} } }] },
        { 
          role: 'tool', 
          parts: [{ 
            functionResponse: { 
              name: 'getGamificationStats', 
              response: { result: { level: 5, xp: 120, username: 'arief' } } 
            } 
          }] 
        }
      ] as any,
      config: {
        tools: [{
          functionDeclarations: [{
            name: 'getGamificationStats',
            description: 'Get stats',
            parameters: { type: 'OBJECT', properties: {} } as any
          }]
        }]
      }
    });
    console.log('Role "tool" succeeded!', response.text);
  } catch (err: any) {
    console.error('Role "tool" failed:', err.message || err);
  }

  console.log('\nTesting role: "user" (fallback)...');
  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        { role: 'user', parts: [{ text: 'Berapa level saya?' }] },
        { role: 'model', parts: [{ functionCall: { name: 'getGamificationStats', args: {} } }] },
        { 
          role: 'user', 
          parts: [{ 
            functionResponse: { 
              name: 'getGamificationStats', 
              response: { result: { level: 5, xp: 120, username: 'arief' } } 
            } 
          }] 
        }
      ] as any,
      config: {
        tools: [{
          functionDeclarations: [{
            name: 'getGamificationStats',
            description: 'Get stats',
            parameters: { type: 'OBJECT', properties: {} } as any
          }]
        }]
      }
    });
    console.log('Role "user" succeeded!', response.text);
  } catch (err: any) {
    console.error('Role "user" failed:', err.message || err);
  }
}

run();
