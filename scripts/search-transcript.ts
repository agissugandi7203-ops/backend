import * as fs from 'fs';
import * as readline from 'readline';

const filePath = 'C:/Users/arief/.gemini/antigravity/brain/0d0ee1a3-fd5c-4ddf-8267-31d104eb28b6/.system_generated/logs/transcript.jsonl';

async function search() {
  if (!fs.existsSync(filePath)) {
    console.log('File not found:', filePath);
    return;
  }
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (line.includes('Average API Response Latency')) {
      console.log('Found match:', line);
    }
  }
}

search();
