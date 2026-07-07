import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Authentication token is missing');
    }

    try {
      const supabase = this.supabaseService.getClient();
      const { data, error } = await supabase.auth.getUser(token);

      if (error || !data.user) {
        throw new UnauthorizedException(
          'Invalid or expired authentication token',
        );
      }

      // Simpan data user dari Supabase ke object request
      request['user'] = data.user;
      return true;
    } catch (err) {
      // Jangan menelan exception yang sudah spesifik (anti silent-catch)
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      // Error tak terduga (mis. Supabase down) - log detail untuk debugging
      this.logger.error(
        `Unexpected error during token verification: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new UnauthorizedException('Failed to authenticate token');
    }
  }

  private extractTokenFromHeader(request: {
    headers?: { authorization?: string };
  }): string | undefined {
    const authHeader = request.headers?.authorization;
    if (!authHeader) return undefined;

    const [type, token] = authHeader.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}