import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { OnboardProfileDto } from './dto/onboard-profile.dto';
import { AdjustGamificationDto } from './dto/adjust-gamification.dto';
import { GamificationService } from '../gamification/gamification.service';

@Injectable()
export class ProfilesService {
  constructor(
    private supabaseService: SupabaseService,
    private gamificationService: GamificationService,
  ) {}

  async getProfile(userId: string) {
    const supabase = this.supabaseService.getClient();

    // 1. Ambil data profil dasar
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      throw new NotFoundException('Profile not found');
    }

    // Query rank secara dinamis dari view global_leaderboard
    const { data: rankData } = await supabase
      .from('global_leaderboard')
      .select('rank')
      .eq('id', userId)
      .maybeSingle();

    // 2. Ambil data lencana (badges) yang diperoleh
    const { data: badgesData, error: badgesError } = await supabase
      .from('profile_badges')
      .select('earned_at, badges(*)')
      .eq('profile_id', userId);

    const earnedBadges = badgesError
      ? []
      : (badgesData || []).map((pb: any) => ({
          earned_at: pb.earned_at,
          ...pb.badges,
        }));

    return {
      ...profile,
      rank: rankData?.rank || 1,
      badges: earnedBadges,
    };
  }

  async onboard(userId: string, dto: OnboardProfileDto) {
    const supabase = this.supabaseService.getClient();

    // 1. Cek ketersediaan username (harus unik)
    const { data: existingUser, error: checkError } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', dto.username)
      .neq('id', userId)
      .maybeSingle();

    if (existingUser) {
      throw new BadRequestException('Username is already taken');
    }

    // 2. Update profil onboarding (gunakan upsert agar otomatis terbuat jika baris data belum ada)
    const { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        username: dto.username,
        full_name: dto.full_name,
        province: dto.province,
        city_or_district: dto.city_or_district,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (updateError || !updatedProfile) {
      throw new BadRequestException(
        'Failed to update profile onboarding: ' + updateError?.message,
      );
    }

    return this.getProfile(userId);
  }

  async getAllProfiles() {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('*, profile_badges(earned_at, badges(*))')
      .order('created_at', { ascending: false });

    if (error) {
      throw new BadRequestException(
        'Failed to fetch profiles: ' + error.message,
      );
    }

    // Reshape data to match frontend's expected format (flatten badges)
    const reshaped = (data || []).map((p: any) => {
      const earnedBadges = (p.profile_badges || []).map((pb: any) => ({
        earned_at: pb.earned_at,
        ...pb.badges,
      }));
      // Create a shallow copy and remove the nested raw relation field
      const profileCopy = { ...p };
      delete profileCopy.profile_badges;
      return {
        ...profileCopy,
        badges: earnedBadges,
      };
    });

    return reshaped;
  }

  async deleteProfile(userId: string) {
    const supabase = this.supabaseService.getClient();

    // Gunakan admin auth API dari Supabase untuk menghapus pengguna secara menyeluruh
    const { error } = await supabase.auth.admin.deleteUser(userId);

    if (error) {
      throw new BadRequestException(
        'Failed to delete user account: ' + error.message,
      );
    }

    return {
      success: true,
      message: `User with ID ${userId} has been successfully deleted`,
    };
  }

  async adjustGamification(userId: string, dto: AdjustGamificationDto) {
    const supabase = this.supabaseService.getClient();

    // Update data gamifikasi profil
    const { data, error } = await supabase
      .from('profiles')
      .update({
        ...dto,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error || !data) {
      throw new BadRequestException(
        'Failed to adjust user gamification data: ' + error?.message,
      );
    }

    return this.getProfile(userId);
  }

  async awardReportRewards(userId: string) {
    // 1. Selesaikan tantangan harian 'report_1_waste' secara backend jika belum diselesaikan hari ini
    try {
      await this.gamificationService.completeChallenge(userId, 'report_1_waste');
    } catch (err) {
      Logger.error(
        `Failed to complete daily challenge 'report_1_waste' for user ${userId}: ${err.message}`,
        'ProfilesService',
      );
    }

    const supabase = this.supabaseService.getClient();

    // 2. Fetch current gamification state (setelah challenge selesai, agar XP terupdate dibaca)
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('xp, level, report_count, current_streak, last_report_date')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      throw new BadRequestException(
        'Gagal mengambil data profil untuk reward: ' + error?.message,
      );
    }

    const currentXp = profile.xp;
    const currentLevel = profile.level;
    const currentReportCount = profile.report_count;
    const currentStreak = profile.current_streak;
    const lastReportDate = profile.last_report_date;

    // 3. Calculate new values (reward approval report = +100 XP)
    const newXp = currentXp + 100;
    const newLevel = Math.floor(newXp / 1000) + 1;
    const newReportCount = currentReportCount + 1;

    // Calculate streak
    let newStreak = 1;
    const todayStr = new Date().toISOString().split('T')[0];

    if (lastReportDate) {
      const lastDate = new Date(lastReportDate);
      const todayDate = new Date(todayStr);
      // Calculate diff in days (ignore timezone by comparing dates)
      const diffTime = todayDate.getTime() - lastDate.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        newStreak = currentStreak + 1;
      } else if (diffDays === 0) {
        newStreak = currentStreak; // Already reported today
      } else {
        newStreak = 1; // Broke streak
      }
    }

    // 3. Update profile
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        xp: newXp,
        level: newLevel,
        report_count: newReportCount,
        current_streak: newStreak,
        last_report_date: todayStr,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (updateError) {
      throw new BadRequestException(
        'Gagal memperbarui reward profil: ' + updateError.message,
      );
    }

    // 4. Check & award badges
    try {
      if (newReportCount === 1) {
        await this.awardBadgeIfMissing(userId, 'first_report');
      }
      if (newStreak === 3) {
        await this.awardBadgeIfMissing(userId, 'streak_3');
      }
      if (newStreak === 7) {
        await this.awardBadgeIfMissing(userId, 'streak_7');
      }
      if (newXp >= 1000 && currentXp < 1000) {
        await this.awardBadgeIfMissing(userId, 'green_hero');
      }
    } catch (badgeErr) {
      // Ignore badge awarding errors
    }

    return {
      xp: newXp,
      level: newLevel,
      report_count: newReportCount,
      current_streak: newStreak,
      levelUp: newLevel > currentLevel,
    };
  }

  private async awardBadgeIfMissing(userId: string, badgeCode: string) {
    const supabase = this.supabaseService.getClient();
    // Check if user already has this badge
    const { data: badge } = await supabase
      .from('badges')
      .select('id')
      .eq('code', badgeCode)
      .single();

    if (!badge) return;

    const { data: hasBadge } = await supabase
      .from('profile_badges')
      .select('profile_id')
      .eq('profile_id', userId)
      .eq('badge_id', badge.id)
      .maybeSingle();

    if (!hasBadge) {
      await supabase
        .from('profile_badges')
        .insert({ profile_id: userId, badge_id: badge.id });
    }
  }
}
