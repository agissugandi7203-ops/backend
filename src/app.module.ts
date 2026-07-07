import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { ProfilesModule } from './profiles/profiles.module';
import { BadgesModule } from './badges/badges.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { StorageModule } from './storage/storage.module';
import { ReportsModule } from './reports/reports.module';
import { OpenRouterModule } from './openrouter/openrouter.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { ChatModule } from './chat/chat.module';
import { GamificationModule } from './gamification/gamification.module';
import { B2gModule } from './b2g/b2g.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // SECURITY: Rate limiting global per-IP untuk seluruh endpoint
    // (100 request per menit) sebagai perlindungan brute-force & DoS dasar.
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // Jendela waktu 1 menit
        limit: 100, // Maksimal 100 request per IP per menit
      },
    ]),
    SupabaseModule,
    AuthModule,
    ProfilesModule,
    BadgesModule,
    LeaderboardModule,
    StorageModule,
    ReportsModule,
    OpenRouterModule,
    KnowledgeBaseModule,
    ChatModule,
    GamificationModule,
    B2gModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
