import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
      bodyLimit: 15 * 1024 * 1024, // 15MB payload limit
      trustProxy: true, // Diperlukan agar rate-limiter membaca IP asli di belakang reverse proxy
    }),
  );

  const isProduction = process.env.NODE_ENV === 'production';

  // === SECURITY: HTTP Security Headers (Helmet) ===
  await app.register(helmet, {
    // CSP dilonggarkan hanya agar Swagger UI tetap berfungsi
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [`'self'`],
        styleSrc: [`'self'`, `'unsafe-inline'`],
        imgSrc: [`'self'`, 'data:', 'https:'],
        scriptSrc: [`'self'`, `'unsafe-inline'`],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  // Daftarkan fastify multipart untuk penanganan file upload
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // Batas ukuran file 10MB
      files: 1, // Maksimal 1 file per request
    },
  });

  // === SECURITY: Global Input Validation ===
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Buang properti yang tidak terdaftar di DTO
      forbidNonWhitelisted: true, // Tolak request dengan properti asing
      transform: true, // Auto-transform payload ke tipe DTO
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // === Global Exception Filter (format error konsisten & anti information leak) ===
  app.useGlobalFilters(new AllExceptionsFilter());

  // Konfigurasi Swagger API Documentation (dapat dimatikan via env di production)
  if (process.env.SWAGGER_ENABLED !== 'false') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Genesis.id API Portal')
      .setDescription(
        'Dokumentasi API Terpadu Genesis.id untuk layanan smart-city, pelaporan spasial lingkungan, gamifikasi, dan portal integrasi data pemerintah (DaaS).',
      )
      .setVersion('1.0.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Masukkan Token JWT Supabase',
          in: 'header',
        },
        'JWT-auth',
      )
      .addApiKey(
        {
          type: 'apiKey',
          name: 'x-api-key',
          in: 'header',
          description: 'API Key B2G (hubungi admin untuk mendapatkan akses)',
        },
        'x-api-key',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  // === SECURITY: CORS berbasis whitelist origin dari environment ===
  // Contoh: ALLOWED_ORIGINS=https://genesishub.my.id,https://app.genesishub.my.id
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  if (isProduction && allowedOrigins.length === 0) {
    Logger.warn(
      'ALLOWED_ORIGINS tidak diset di production! CORS akan menerima semua origin. Segera set ALLOWED_ORIGINS di .env.',
      'Bootstrap',
    );
  }

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, Authorization, x-api-key',
    credentials: true,
  });

  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
void bootstrap();