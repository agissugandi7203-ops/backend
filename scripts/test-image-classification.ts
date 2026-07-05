import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ReportsService } from '../src/reports/reports.service';

async function testImage() {
  console.log('Initializing NestJS app context...');
  const app = await NestFactory.createApplicationContext(AppModule);
  const reportsService = app.get(ReportsService);

  console.log('Creating dummy 1x1 pixel PNG buffer...');
  const dummyBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const buffer = Buffer.from(dummyBase64, 'base64');
  const mimeType = 'image/png';

  console.log('Calling reportsService.analyzeImage()...');
  try {
    const result = await reportsService.analyzeImage(buffer, mimeType);
    console.log('SUCCESS! Analysis Result:', result);
  } catch (err: any) {
    console.error('FAILED to analyze image:', err.message);
    if (err.stack) {
      console.error(err.stack);
    }
  }

  await app.close();
  console.log('Done.');
}

testImage();
