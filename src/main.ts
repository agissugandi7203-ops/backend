import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import multipart from '@fastify/multipart';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true })
  );

  // Daftarkan fastify multipart untuk penanganan file upload
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // Batas ukuran file 10MB
    },
  });

  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
bootstrap();

