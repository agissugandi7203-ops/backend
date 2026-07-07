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

  const testCases = [
    {
      name: 'Case 1: Only functionDeclarations',
      tools: [{
        functionDeclarations: [{
          name: 'getGamificationStats',
          description: 'Get stats',
          parameters: { type: 'OBJECT', properties: {} } as any
        }]
      }]
    },
    {
      name: 'Case 2: Only codeExecution',
      tools: [{ codeExecution: {} }]
    },
    {
      name: 'Case 3: Both functionDeclarations and codeExecution',
      tools: [
        {
          functionDeclarations: [{
            name: 'getGamificationStats',
            description: 'Get stats',
            parameters: { type: 'OBJECT', properties: {} } as any
          }]
        },
        { codeExecution: {} }
      ]
    },
    {
      name: 'Case 4: Combined in single tool object (as array)',
      tools: [{
        functionDeclarations: [{
          name: 'getGamificationStats',
          description: 'Get stats',
          parameters: { type: 'OBJECT', properties: {} } as any
        }],
        codeExecution: {}
      } as any]
    }
  ];

  for (const tc of testCases) {
    console.log(`\n--- Running ${tc.name} ---`);
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: 'Halo Geni!' }] }],
        config: {
          tools: tc.tools
        }
      });
      console.log('Result: Success!', response.text?.substring(0, 100));
    } catch (err: any) {
      console.error('Result: Failed!', err.message || err);
    }
  }
}

run();
