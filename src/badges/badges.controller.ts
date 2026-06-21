import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BadgesService } from './badges.service';

@Controller('badges')
@UseGuards(AuthGuard)
export class BadgesController {
  constructor(private readonly badgesService: BadgesService) {}

  @Get()
  getAllBadges() {
    return this.badgesService.getAllBadges();
  }

  // --- Kontrol Lencana Khusus Admin ---

  @Post('award')
  @UseGuards(RolesGuard)
  @Roles('admin')
  awardBadge(
    @Body('userId') userId: string,
    @Body('badgeCode') badgeCode: string,
  ) {
    return this.badgesService.awardBadge(userId, badgeCode);
  }

  @Delete('revoke')
  @UseGuards(RolesGuard)
  @Roles('admin')
  revokeBadge(
    @Body('userId') userId: string,
    @Body('badgeCode') badgeCode: string,
  ) {
    return this.badgesService.revokeBadge(userId, badgeCode);
  }
}
