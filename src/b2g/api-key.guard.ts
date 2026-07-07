import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    // Ambil header x-api-key secara case-insensitive
    const apiKey: string | undefined =
      request.headers['x-api-key'] || request.headers['X-API-KEY'];

    // SECURITY: API key WAJIB berasal dari environment variable.
    // Tidak boleh ada fallback hardcoded di dalam kode sumber.
    const validApiKey = process.env.B2G_TRIAL_API_KEY;

    if (!validApiKey) {
      this.logger.error(
        'B2G_TRIAL_API_KEY tidak diset di environment. Endpoint B2G dinonaktifkan.',
      );
      throw new ServiceUnavailableException(
        'Layanan B2G sedang tidak tersedia. Silakan hubungi administrator.',
      );
    }

    if (!apiKey) {
      throw new UnauthorizedException(
        'Kunci API (x-api-key) wajib disertakan pada request header',
      );
    }

    // SECURITY: Gunakan perbandingan timing-safe untuk mencegah timing attack
    if (!this.isKeyValid(apiKey, validApiKey)) {
      this.logger.warn(
        `Percobaan akses B2G dengan API key tidak valid dari IP: ${request.ip}`,
      );
      throw new UnauthorizedException(
        'Kunci API (x-api-key) yang Anda masukkan tidak valid atau telah kedaluwarsa',
      );
    }

    return true;
  }

  private isKeyValid(provided: string, expected: string): boolean {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);

    // timingSafeEqual membutuhkan panjang buffer yang sama
    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(providedBuffer, expectedBuffer);
  }
}