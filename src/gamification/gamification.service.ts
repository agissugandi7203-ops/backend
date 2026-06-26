import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class GamificationService {
  constructor(private supabaseService: SupabaseService) {}

  async createEvent(title: string, description: string, points: number) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('events')
      .insert({ title, description, points })
      .select()
      .single();

    if (error) {
      throw new BadRequestException('Gagal membuat event: ' + error.message);
    }
    return data;
  }

  async getEvents() {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new BadRequestException('Gagal mengambil event: ' + error.message);
    }
    return data || [];
  }

  async getNotifications(userId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .or(`profile_id.eq.${userId},profile_id.is.null`)
      .order('created_at', { ascending: false });

    if (error) {
      throw new BadRequestException(
        'Gagal mengambil notifikasi: ' + error.message,
      );
    }
    return data || [];
  }

  async getDailyChallenges(userId: string) {
    const supabase = this.supabaseService.getClient();

    // 1. Ambil semua tantangan master
    const { data: challenges, error: chalError } = await supabase
      .from('challenges')
      .select('*');

    if (chalError || !challenges) {
      throw new BadRequestException(
        'Gagal mengambil tantangan master: ' + chalError?.message,
      );
    }

    // 2. Ambil penyelesaian hari ini (tanggal lokal user)
    const todayStr = new Date().toISOString().split('T')[0];
    const { data: completions, error: compError } = await supabase
      .from('profile_challenges')
      .select('challenge_id')
      .eq('profile_id', userId)
      .gte('completed_at', `${todayStr}T00:00:00Z`)
      .lte('completed_at', `${todayStr}T23:59:59Z`);

    const completedIds = new Set(
      (completions || []).map((c) => c.challenge_id),
    );

    return challenges.map((ch) => ({
      ...ch,
      isCompleted: completedIds.has(ch.id),
    }));
  }

  async completeChallenge(userId: string, code: string) {
    const supabase = this.supabaseService.getClient();

    // 1. Ambil tantangan berdasarkan code
    const { data: challenge, error: chalError } = await supabase
      .from('challenges')
      .select('*')
      .eq('code', code)
      .single();

    if (chalError || !challenge) {
      throw new BadRequestException('Tantangan tidak ditemukan');
    }

    // 2. Cek apakah sudah diselesaikan hari ini
    const todayStr = new Date().toISOString().split('T')[0];
    const { data: existingCompletion } = await supabase
      .from('profile_challenges')
      .select('*')
      .eq('profile_id', userId)
      .eq('challenge_id', challenge.id)
      .gte('completed_at', `${todayStr}T00:00:00Z`)
      .lte('completed_at', `${todayStr}T23:59:59Z`)
      .maybeSingle();

    if (existingCompletion) {
      return {
        success: false,
        message: 'Tantangan ini sudah diselesaikan hari ini',
        challenge,
      };
    }

    // 3. Catat penyelesaian
    const { error: insertError } = await supabase
      .from('profile_challenges')
      .insert({
        profile_id: userId,
        challenge_id: challenge.id,
        completed_at: new Date().toISOString(),
      });

    if (insertError) {
      throw new BadRequestException(
        'Gagal mencatat penyelesaian: ' + insertError.message,
      );
    }

    // 4. Berikan reward XP ke profil
    const { data: profile } = await supabase
      .from('profiles')
      .select('xp, level')
      .eq('id', userId)
      .single();

    if (profile) {
      const newXp = profile.xp + challenge.xp;
      const newLevel = Math.floor(newXp / 1000) + 1;

      await supabase
        .from('profiles')
        .update({
          xp: newXp,
          level: newLevel,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
    }

    // 5. Tambahkan notifikasi in-app
    await supabase.from('notifications').insert({
      profile_id: userId,
      title: 'Tantangan Selesai! 🎉',
      body: `Anda menyelesaikan "${challenge.title}" dan mendapatkan +${challenge.xp} XP!`,
    });

    return {
      success: true,
      message: `Berhasil menyelesaikan tantangan: ${challenge.title}`,
      xpAwarded: challenge.xp,
      pointsAwarded: challenge.points,
    };
  }
}
