import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
  providers: [AppService],
})
export class AppModule {}
