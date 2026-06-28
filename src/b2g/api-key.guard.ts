import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    // Ambil header x-api-key secara case-insensitive
    const apiKey = request.headers['x-api-key'] || request.headers['X-API-KEY'];

    const validApiKey = process.env.B2G_TRIAL_API_KEY ?? 'genesis_trial_key_2026';

    if (!apiKey) {
      throw new UnauthorizedException(
        'Kunci API (x-api-key) wajib disertakan pada request header',
      );
    }

    if (apiKey !== validApiKey) {
      throw new UnauthorizedException(
        'Kunci API (x-api-key) yang Anda masukkan tidak valid atau telah kedaluwarsa',
      );
    }

    return true;
  }
}
