import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { GetUser } from '../auth/get-user.decorator';
import { GamificationService } from './gamification.service';

@Controller('gamification')
@UseGuards(AuthGuard)
export class GamificationController {
  constructor(private readonly gamificationService: GamificationService) {}

  @Post('events')
  @UseGuards(RolesGuard)
  @Roles('admin')
  createEvent(
    @Body('title') title: string,
    @Body('description') description: string,
    @Body('points') points: number,
  ) {
    const pointsVal = points ? Number(points) : 0;
    return this.gamificationService.createEvent(title, description, pointsVal);
  }

  @Get('events')
  getEvents() {
    return this.gamificationService.getEvents();
  }

  @Get('notifications')
  getNotifications(@GetUser('id') userId: string) {
    return this.gamificationService.getNotifications(userId);
  }

  @Get('challenges')
  getDailyChallenges(@GetUser('id') userId: string) {
    return this.gamificationService.getDailyChallenges(userId);
  }

  @Post('challenges/complete')
  completeChallenge(@GetUser('id') userId: string, @Body('code') code: string) {
    return this.gamificationService.completeChallenge(userId, code);
  }
}
