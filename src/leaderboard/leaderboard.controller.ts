import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { LeaderboardService } from './leaderboard.service';

@Controller('leaderboard')
@UseGuards(AuthGuard)
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get('global')
  getGlobalLeaderboard(@Query('limit') limit?: number) {
    const limitVal = limit ? Number(limit) : 100;
    return this.leaderboardService.getGlobalLeaderboard(limitVal);
  }

  @Get('city')
  getCityLeaderboard(@Query('limit') limit?: number) {
    const limitVal = limit ? Number(limit) : 100;
    return this.leaderboardService.getCityLeaderboard(limitVal);
  }
}
