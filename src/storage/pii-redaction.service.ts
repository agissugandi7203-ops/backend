import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as vision from '@google-cloud/vision';
import sharp from 'sharp';

@Injectable()
export class PiiRedactionService implements OnModuleInit {
  private readonly logger = new Logger(PiiRedactionService.name);
  private visionClient: vision.ImageAnnotatorClient;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const projectId = this.configService.get<string>('GCS_PROJECT_ID');
    const keyFilePath = this.configService.get<string>('GCS_KEY_FILE_PATH');

    if (!projectId || !keyFilePath) {
      this.logger.warn(
        'Konfigurasi Google Cloud Vision API belum lengkap di file .env. PiiRedactionService mungkin gagal mendeteksi.',
      );
      return;
    }

    try {
      this.visionClient = new vision.ImageAnnotatorClient({
        projectId,
        keyFilename: keyFilePath,
      });
      this.logger.log('Google Cloud Vision API client successfully initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Google Cloud Vision client: ' + error.message);
    }
  }

  async redactSensitiveInfo(imageBuffer: Buffer): Promise<Buffer> {
    if (!this.visionClient) {
      this.logger.warn(
        'Klien GCP Vision belum terinisialisasi. Melewati pemrosesan sensor PII.',
      );
      return imageBuffer;
    }

    try {
      // 1. Jalankan deteksi wajah dan deteksi teks (plat nomor)
      const [faceResults] = await this.visionClient.faceDetection(imageBuffer);
      const [textResults] = await this.visionClient.textDetection(imageBuffer);

      const faces = faceResults.faceAnnotations || [];
      const textAnnotations = textResults.textAnnotations || [];

      // Jika tidak ada wajah atau teks terdeteksi, langsung kembalikan gambar asli
      if (faces.length === 0 && textAnnotations.length === 0) {
        return imageBuffer;
      }

      // Mulai memproses gambar menggunakan Sharp
      let processedImage = sharp(imageBuffer);
      const metadata = await processedImage.metadata();
      const imgWidth = metadata.width || 0;
      const imgHeight = metadata.height || 0;

      const compositeOperations: any[] = [];

      // 2. Kumpulkan area wajah untuk disensor
      for (const face of faces) {
        const poly = face.boundingPoly;
        if (poly && poly.vertices) {
          const vertices = poly.vertices;
          // Cari batas kotak (bounding box) wajah
          const xCoords = vertices.map((v) => v.x || 0);
          const yCoords = vertices.map((v) => v.y || 0);
          const minX = Math.max(0, Math.min(...xCoords));
          const maxX = Math.min(imgWidth, Math.max(...xCoords));
          const minY = Math.max(0, Math.min(...yCoords));
          const maxY = Math.min(imgHeight, Math.max(...yCoords));

          const width = maxX - minX;
          const height = maxY - minY;

          if (width > 0 && height > 0) {
            // Ekstrak area wajah, blur, lalu jadikan buffer untuk composite overlay
            const blurredFace = await sharp(imageBuffer)
              .extract({ left: minX, top: minY, width, height })
              .blur(20) // Tingkat keburaman Gaussian blur
              .toBuffer();

            compositeOperations.push({
              input: blurredFace,
              left: minX,
              top: minY,
            });
          }
        }
      }

      // 3. Kumpulkan area teks (untuk sensor plat nomor)
      // Indeks 0 biasanya adalah gabungan seluruh teks, kita ambil kata demi kata di indeks 1+
      for (let i = 1; i < textAnnotations.length; i++) {
        const annotation = textAnnotations[i];
        const poly = annotation.boundingPoly;
        if (poly && poly.vertices) {
          const vertices = poly.vertices;
          const xCoords = vertices.map((v) => v.x || 0);
          const yCoords = vertices.map((v) => v.y || 0);
          const minX = Math.max(0, Math.min(...xCoords));
          const maxX = Math.min(imgWidth, Math.max(...xCoords));
          const minY = Math.max(0, Math.min(...yCoords));
          const maxY = Math.min(imgHeight, Math.max(...yCoords));

          const width = maxX - minX;
          const height = maxY - minY;

          if (width > 0 && height > 0) {
            const blurredText = await sharp(imageBuffer)
              .extract({ left: minX, top: minY, width, height })
              .blur(25)
              .toBuffer();

            compositeOperations.push({
              input: blurredText,
              left: minX,
              top: minY,
            });
          }
        }
      }

      // 4. Gabungkan seluruh filter sensor di atas gambar asli
      if (compositeOperations.length > 0) {
        processedImage = processedImage.composite(compositeOperations);
      }

      return await processedImage.toBuffer();
    } catch (error) {
      this.logger.error('Error during PII redaction processing: ' + error.message);
      // Jika terjadi kegagalan proses AI, kembalikan gambar asli agar sistem tidak crash
      return imageBuffer;
    }
  }
}
