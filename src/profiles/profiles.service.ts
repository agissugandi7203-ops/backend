import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { OnboardProfileDto } from './dto/onboard-profile.dto';
import { AdjustGamificationDto } from './dto/adjust-gamification.dto';

@Injectable()
export class ProfilesService {
  constructor(private supabaseService: SupabaseService) {}

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

    // 2. Update profil onboarding
    const { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .update({
        username: dto.username,
        full_name: dto.full_name,
        province: dto.province,
        city_or_district: dto.city_or_district,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (updateError || !updatedProfile) {
      throw new BadRequestException('Failed to update profile onboarding: ' + updateError?.message);
    }

    return this.getProfile(userId);
  }

  async getAllProfiles() {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new BadRequestException('Failed to fetch profiles: ' + error.message);
    }
    return data || [];
  }

  async deleteProfile(userId: string) {
    const supabase = this.supabaseService.getClient();

    // Gunakan admin auth API dari Supabase untuk menghapus pengguna secara menyeluruh
    const { error } = await supabase.auth.admin.deleteUser(userId);

    if (error) {
      throw new BadRequestException('Failed to delete user account: ' + error.message);
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
      throw new BadRequestException('Failed to adjust user gamification data: ' + error?.message);
    }

    return this.getProfile(userId);
  }
}
