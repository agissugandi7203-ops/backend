import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class ChatThrottlerGuard implements CanActivate {
  private readonly logger = new Logger(ChatThrottlerGuard.name);

  // Map untuk menyimpan riwayat timestamp request per user (limit per menit)
  // Key: userId (UUID), Value: array timestamp (epoch millisecond)
  private readonly userRequestHistory = new Map<string, number[]>();
  private readonly WINDOW_MS = 60000; // 1 menit (60 detik)
  private readonly MAX_LIMIT = 10; // Maksimal 10 request per menit

  // Pelacak batas harian fallback in-memory (jika tabel DB tidak ada/error)
  private readonly userDailyHistoryFallback = new Map<
    string,
    { count: number; dateStr: string }
  >();
  private readonly DAILY_LIMIT = 50; // Batas maksimal 50 request per hari

  // Cache role user untuk mengurangi query database berulang setiap request chat
  private readonly roleCache = new Map<
    string,
    { role: string; cachedAt: number }
  >();
  private readonly ROLE_CACHE_TTL_MS = 5 * 60 * 1000; // Cache role selama 5 menit

  // Batas maksimal entri Map untuk mencegah memory leak (unbounded growth)
  private readonly MAX_TRACKED_USERS = 10000;

  constructor(private supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Jika user tidak terautentikasi (AuthGuard terlewati tapi user undefined), tolak
    if (!user || !user.id) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    try {
      const role = await this.getUserRole(user.id);

      // Admin bypass rate-limiting
      if (role === 'admin') {
        return true;
      }

      const now = Date.now();
      const userId = user.id;

      // Bersihkan entri lama jika Map sudah terlalu besar (anti memory leak)
      this.cleanupStaleEntries(now);

      // 1. Cek Batas Per Menit (10 request/menit)
      let timestamps = this.userRequestHistory.get(userId) || [];
      timestamps = timestamps.filter((time) => now - time < this.WINDOW_MS);

      if (timestamps.length >= this.MAX_LIMIT) {
        this.logger.warn(
          `Rate limit per menit terlampaui untuk user ${userId} (${timestamps.length} req/menit)`,
        );
        throw new HttpException(
          'Too Many Requests: Anda telah mencapai batas maksimal 10 obrolan per menit. Silakan tunggu beberapa saat.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // 2. Cek Batas Harian (50 request/hari)
      const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
      const isDailyExceeded = await this.isDailyLimitExceeded(userId, today);
      if (isDailyExceeded) {
        this.logger.warn(
          `Daily limit exceeded untuk user ${userId} (50 req/hari)`,
        );
        throw new HttpException(
          'Too Many Requests: Anda telah mencapai batas maksimal 50 obrolan per hari. Silakan coba lagi besok.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Catat request menit saat ini
      timestamps.push(now);
      this.userRequestHistory.set(userId, timestamps);

      return true;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Fallback jika terjadi error database/sistem: biarkan request lewat, tapi CATAT di log
      this.logger.warn(
        `ChatThrottlerGuard fail-open karena error sistem: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return true;
    }
  }

  /**
   * Memeriksa dan mengupdate batas obrolan harian user (Maksimal 50 per hari).
   * Menggunakan tabel database `chat_usage` jika ada, dan fall back ke in-memory jika tidak ada.
   */
  private async isDailyLimitExceeded(userId: string, today: string): Promise<boolean> {
    try {
      const supabase = this.supabaseService.getClient();

      // Ambil data penggunaan chat hari ini
      const { data, error } = await supabase
        .from('chat_usage')
        .select('chat_count')
        .eq('user_id', userId)
        .eq('usage_date', today)
        .maybeSingle();

      if (error) {
        // Jika tabel tidak ditemukan atau ada error database, lemparkan ke catch block untuk diproses oleh fallback
        throw error;
      }

      const currentCount = data?.chat_count ?? 0;
      if (currentCount >= this.DAILY_LIMIT) {
        return true; // Limit terlampaui
      }

      // Update / insert penggunaan chat
      const newCount = currentCount + 1;
      const { error: upsertError } = await supabase
        .from('chat_usage')
        .upsert(
          {
            user_id: userId,
            usage_date: today,
            chat_count: newCount,
          },
          { onConflict: 'user_id,usage_date' },
        );

      if (upsertError) {
        this.logger.warn(`Gagal upsert chat_usage untuk user ${userId}: ${upsertError.message}`);
        // Jika gagal simpan ke DB, fall back ke in-memory
        return this.checkDailyLimitFallback(userId, today);
      }

      return false; // Limit belum terlampaui dan berhasil disimpan ke DB
    } catch (err: any) {
      // Jika terjadi error (misalnya tabel `chat_usage` belum dibuat/migration belum dijalankan),
      // gunakan pelacak in-memory sebagai fallback agar aplikasi tetap berjalan aman.
      this.logger.warn(
        `Gagal memeriksa database chat_usage (mungkin tabel belum dibuat). Menggunakan fallback in-memory: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return this.checkDailyLimitFallback(userId, today);
    }
  }

  /**
   * Pelacak batas harian in-memory sebagai fallback ketika tabel DB tidak ditemukan/gagal diakses
   */
  private checkDailyLimitFallback(userId: string, today: string): boolean {
    const record = this.userDailyHistoryFallback.get(userId);
    if (record && record.dateStr === today) {
      if (record.count >= this.DAILY_LIMIT) {
        return true;
      }
      record.count += 1;
      this.userDailyHistoryFallback.set(userId, record);
    } else {
      this.userDailyHistoryFallback.set(userId, { count: 1, dateStr: today });
    }
    return false;
  }

  /**
   * Mengambil role user dengan cache in-memory (TTL 5 menit)
   * untuk mengurangi beban query database di setiap request chat.
   */
  private async getUserRole(userId: string): Promise<string> {
    const cached = this.roleCache.get(userId);
    if (cached && Date.now() - cached.cachedAt < this.ROLE_CACHE_TTL_MS) {
      return cached.role;
    }

    const supabase = this.supabaseService.getClient();
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    const role = error || !profile ? 'citizen' : profile.role;
    this.roleCache.set(userId, { role, cachedAt: Date.now() });
    return role;
  }

  /**
   * Membersihkan entri kadaluarsa dari Map ketika ukurannya melebihi batas,
   * mencegah pertumbuhan memori tanpa batas (memory leak) pada uptime panjang.
   */
  private cleanupStaleEntries(now: number): void {
    if (this.userRequestHistory.size >= this.MAX_TRACKED_USERS) {
      for (const [userId, timestamps] of this.userRequestHistory) {
        const active = timestamps.filter((t) => now - t < this.WINDOW_MS);
        if (active.length === 0) {
          this.userRequestHistory.delete(userId);
        } else {
          this.userRequestHistory.set(userId, active);
        }
      }
    }

    // Bersihkan juga fallback harian yang tidak sesuai tanggal hari ini
    const today = new Date().toISOString().split('T')[0];
    if (this.userDailyHistoryFallback.size >= this.MAX_TRACKED_USERS) {
      for (const [userId, record] of this.userDailyHistoryFallback) {
        if (record.dateStr !== today) {
          this.userDailyHistoryFallback.delete(userId);
        }
      }
    }

    // Bersihkan juga role cache yang sudah kadaluarsa
    for (const [userId, entry] of this.roleCache) {
      if (now - entry.cachedAt >= this.ROLE_CACHE_TTL_MS) {
        this.roleCache.delete(userId);
      }
    }
  }
}