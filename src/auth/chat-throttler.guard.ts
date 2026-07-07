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

  // Map untuk menyimpan riwayat timestamp request per user
  // Key: userId (UUID), Value: array timestamp (epoch millisecond)
  private readonly userRequestHistory = new Map<string, number[]>();
  private readonly WINDOW_MS = 60000; // 1 menit (60 detik)
  private readonly MAX_LIMIT = 10; // Maksimal 10 request per menit

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

      // Ambil riwayat request user, jika belum ada inisialisasi array kosong
      let timestamps = this.userRequestHistory.get(userId) || [];

      // Filter: Buang timestamp yang sudah di luar rentang waktu 1 menit terakhir
      timestamps = timestamps.filter((time) => now - time < this.WINDOW_MS);

      // Cek apakah jumlah request dalam 1 menit terakhir melebihi limit
      if (timestamps.length >= this.MAX_LIMIT) {
        this.logger.warn(
          `Rate limit exceeded untuk user ${userId} (${timestamps.length} req/menit)`,
        );
        throw new HttpException(
          'Too Many Requests: Anda telah mencapai batas maksimal 10 obrolan per menit. Silakan tunggu beberapa saat.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Catat request saat ini
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
    if (this.userRequestHistory.size < this.MAX_TRACKED_USERS) return;

    for (const [userId, timestamps] of this.userRequestHistory) {
      const active = timestamps.filter((t) => now - t < this.WINDOW_MS);
      if (active.length === 0) {
        this.userRequestHistory.delete(userId);
      } else {
        this.userRequestHistory.set(userId, active);
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