import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ChatService } from '../src/chat/chat.service';
import { ChatRequestDto } from '../src/chat/dto/chat-request.dto';
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

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const chatService = app.get(ChatService);

  // Get a citizen user
  const supabase = chatService['supabaseService'].getClient();
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('role', 'citizen')
    .limit(1);

  if (!profiles || profiles.length === 0) {
    console.error('No citizen user found in DB');
    await app.close();
    return;
  }

  const userId = profiles[0].id;
  console.log(`Using citizen: ${profiles[0].username} (ID: ${userId})`);

  const testQueries = [
    'Siapa 5 besar leaderboard saat ini?',
    'Berapa level dan XP saya sekarang?',
    'Tampilkan profil saya',
  ];

  for (const query of testQueries) {
    console.log(`\n==================================================`);
    console.log(`USER: "${query}"`);
    console.log(`==================================================`);

    try {
      const dto = new ChatRequestDto();
      dto.message = query;
      dto.history = [];
      dto.webSearch = false;

      const result = await chatService.processChat(dto, userId);
      console.log(`BOT:`, result.reply);
    } catch (e: any) {
      console.error(`ERROR:`, e.message || e);
    }
  }

  await app.close();
}

run();
