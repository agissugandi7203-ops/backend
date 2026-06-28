import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import multipart from '@fastify/multipart';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  // Daftarkan fastify multipart untuk penanganan file upload
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // Batas ukuran file 10MB
    },
  });

  // Konfigurasi Swagger API Documentation
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
        description: 'Trial API Key B2G (e.g. genesis_trial_key_2026)',
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

  // Aktifkan CORS agar Flutter Web/Mobile local dan Next.js dapat terhubung
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, Authorization, x-api-key',
    credentials: true,
  });

  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
bootstrap();
