import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class LeaderboardService {
  constructor(private supabaseService: SupabaseService) {}

  async getGlobalLeaderboard(limit = 100) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('global_leaderboard')
      .select('*')
      .limit(limit);

    if (error) {
      throw new BadRequestException('Failed to fetch global leaderboard: ' + error.message);
    }

    return data || [];
  }

  async getCityLeaderboard(limit = 100) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('city_leaderboard')
      .select('*')
      .limit(limit);

    if (error) {
      throw new BadRequestException('Failed to fetch city leaderboard: ' + error.message);
    }

    return data || [];
  }
}
