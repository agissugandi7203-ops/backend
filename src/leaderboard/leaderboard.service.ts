import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class LeaderboardService {
  constructor(private supabaseService: SupabaseService) {}

  async getGlobalLeaderboard(limit = 100, city?: string, province?: string) {
    const supabase = this.supabaseService.getClient();
    let query = supabase
      .from('profiles')
      .select(
        'id, username, full_name, avatar_url, xp, level, report_count, province, city_or_district',
      )
      .eq('role', 'citizen')
      .order('xp', { ascending: false });

    if (city) {
      query = query.eq('city_or_district', city);
    } else if (province) {
      query = query.eq('province', province);
    }

    const { data, error } = await query.limit(limit);

    if (error) {
      throw new BadRequestException(
        'Failed to fetch global leaderboard: ' + error.message,
      );
    }

    // Hitung rank dinamis berdasarkan posisi (index + 1)
    return (data || []).map((user, index) => ({
      ...user,
      rank: index + 1,
    }));
  }

  async getCityLeaderboard(limit = 100) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('city_leaderboard')
      .select('*')
      .limit(limit);

    if (error) {
      throw new BadRequestException(
        'Failed to fetch city leaderboard: ' + error.message,
      );
    }

    return data || [];
  }
}
