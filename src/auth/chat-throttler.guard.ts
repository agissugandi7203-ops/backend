import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class ChatThrottlerGuard implements CanActivate {
  // Map untuk menyimpan riwayat timestamp request per user
  // Key: userId (UUID), Value: array timestamp (epoch millisecond)
  private readonly userRequestHistory = new Map<string, number[]>();
  private readonly WINDOW_MS = 60000; // 1 menit (60 detik)
  private readonly MAX_LIMIT = 10; // Maksimal 10 request per menit

  constructor(private supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Jika user tidak terautentikasi (AuthGuard terlewati tapi user undefined), tolak
    if (!user || !user.id) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    try {
      const supabase = this.supabaseService.getClient();

      // Ambil role user dari tabel profiles
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      // Jika terjadi error atau user adalah admin, bypass rate-limiting
      if (error || !profile || profile.role === 'admin') {
        return true;
      }

      const now = Date.now();
      const userId = user.id;

      // Ambil riwayat request user, jika belum ada inisialisasi array kosong
      let timestamps = this.userRequestHistory.get(userId) || [];

      // Filter: Buang timestamp yang sudah di luar rentang waktu 1 menit terakhir
      timestamps = timestamps.filter((time) => now - time < this.WINDOW_MS);

      // Cek apakah jumlah request dalam 1 menit terakhir melebihi limit
      if (timestamps.length >= this.MAX_LIMIT) {
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
      // Fallback jika terjadi error database/sistem: biarkan request lewat tapi log warning
      return true;
    }
  }
}
