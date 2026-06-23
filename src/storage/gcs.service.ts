import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';

@Injectable()
export class GcsService implements OnModuleInit {
  private readonly logger = new Logger(GcsService.name);
  private storage: Storage;
  private bucketName: string;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const projectId = this.configService.get<string>('GCS_PROJECT_ID');
    const keyFilePath = this.configService.get<string>('GCS_KEY_FILE_PATH');
    this.bucketName = this.configService.get<string>('GCS_BUCKET_NAME') || '';

    if (!projectId || !this.bucketName) {
      this.logger.warn(
        'Konfigurasi Google Cloud Storage (GCS) belum lengkap di file .env. GcsService mungkin gagal saat mengunggah.',
      );
      return;
    }

    try {
      const storageOptions: any = {};
      if (projectId) storageOptions.projectId = projectId;
      if (keyFilePath) storageOptions.keyFilename = keyFilePath;

      this.storage = new Storage(storageOptions);
      this.logger.log('Google Cloud Storage client successfully initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Google Cloud Storage: ' + error.message);
    }
  }

  async uploadFile(buffer: Buffer, fileName: string, contentType: string): Promise<string> {
    if (!this.storage) {
      throw new Error(
        'Klien GCS belum terinisialisasi. Silakan periksa konfigurasi GCS di berkas .env',
      );
    }

    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(fileName);

    await file.save(buffer, {
      metadata: { contentType },
      resumable: false,
    });

    // Mengembalikan URL publik berkas (Pastikan izin bucket diset ke Public Read-Only di GCP Console)
    return `https://storage.googleapis.com/${this.bucketName}/${fileName}`;
  }
}
