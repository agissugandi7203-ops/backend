import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Global Exception Filter
 *
 * Menjamin seluruh error yang keluar dari aplikasi memiliki format respons
 * yang konsisten, tercatat di log, dan TIDAK membocorkan detail internal
 * (stack trace, query database, dsb) ke client pada mode production.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const isProduction = process.env.NODE_ENV === 'production';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let errorName = 'InternalServerError';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        message = (resObj.message as string | string[]) ?? exception.message;
        errorName = (resObj.error as string) ?? exception.name;
      }
    } else if (exception instanceof Error) {
      // Error tak terduga (bukan HttpException) - jangan bocorkan detail di production
      errorName = exception.name;
      message = isProduction ? 'Internal server error' : exception.message;
    }

    // Log semua error 5xx sebagai error, sisanya sebagai warning
    const logMessage = `${request.method} ${request.url} -> ${status} | ${
      exception instanceof Error ? exception.message : String(exception)
    }`;

    if (status >= 500) {
      this.logger.error(
        logMessage,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(logMessage);
    }

    void response.status(status).send({
      statusCode: status,
      error: errorName,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}