import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class BadgesService {
  constructor(private supabaseService: SupabaseService) {}

  async getAllBadges() {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('badges')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      throw new BadRequestException(
        'Failed to fetch badges catalog: ' + error.message,
      );
    }

    return data || [];
  }

  async awardBadge(userId: string, badgeCode: string) {
    const supabase = this.supabaseService.getClient();
    // 1. Dapatkan badge ID berdasarkan code
    const { data: badge, error: badgeError } = await supabase
      .from('badges')
      .select('id')
      .eq('code', badgeCode)
      .single();

    if (badgeError || !badge) {
      throw new BadRequestException('Badge code not found');
    }

    // 2. Hubungkan ke profile_badges
    const { error: insertError } = await supabase
      .from('profile_badges')
      .insert({ profile_id: userId, badge_id: badge.id });

    if (insertError) {
      throw new BadRequestException(
        'Failed to award badge (already awarded or invalid user): ' +
          insertError.message,
      );
    }

    return {
      success: true,
      message: `Badge ${badgeCode} awarded successfully`,
    };
  }

  async revokeBadge(userId: string, badgeCode: string) {
    const supabase = this.supabaseService.getClient();
    // 1. Dapatkan badge ID berdasarkan code
    const { data: badge, error: badgeError } = await supabase
      .from('badges')
      .select('id')
      .eq('code', badgeCode)
      .single();

    if (badgeError || !badge) {
      throw new BadRequestException('Badge code not found');
    }

    // 2. Hapus dari profile_badges
    const { error: deleteError } = await supabase
      .from('profile_badges')
      .delete()
      .eq('profile_id', userId)
      .eq('badge_id', badge.id);

    if (deleteError) {
      throw new BadRequestException(
        'Failed to revoke badge: ' + deleteError.message,
      );
    }

    return {
      success: true,
      message: `Badge ${badgeCode} revoked successfully`,
    };
  }
}
