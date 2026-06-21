import { Body, Controller, Get, Delete, Param, Patch, Post, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { GetUser } from '../auth/get-user.decorator';
import { ProfilesService } from './profiles.service';
import { OnboardProfileDto } from './dto/onboard-profile.dto';
import { AdjustGamificationDto } from './dto/adjust-gamification.dto';

@Controller('profiles')
@UseGuards(AuthGuard)
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get('me')
  getProfile(@GetUser('id') userId: string) {
    return this.profilesService.getProfile(userId);
  }

  @Post('onboard')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  onboard(@GetUser('id') userId: string, @Body() onboardDto: OnboardProfileDto) {
    return this.profilesService.onboard(userId, onboardDto);
  }

  // --- Endpoint Khusus Admin ---

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  getAllProfiles() {
    return this.profilesService.getAllProfiles();
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  deleteProfile(@Param('id') userId: string) {
    return this.profilesService.deleteProfile(userId);
  }

  @Patch(':id/gamification')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  adjustGamification(
    @Param('id') userId: string,
    @Body() adjustDto: AdjustGamificationDto,
  ) {
    return this.profilesService.adjustGamification(userId, adjustDto);
  }
}
