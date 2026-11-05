/**
 * 下载姿势参考图片并上传到MinIO
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

interface ImageItem {
  original: string;
  thumbnail: string;
  minioPath: string;
  minioThumbPath: string;
}

const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  region: process.env.S3_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'minioadmin',
  },
  forcePathStyle: true,
});

const BUCKET = 'try-on-references';

async function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${res.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
  });
}

async function uploadToMinIO(key: string, buffer: Buffer, contentType: string) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
}

async function main() {
  console.log('[DownloadPoseImages] Starting download and upload...');

  const listPath =
    process.argv[2] || path.join(process.cwd(), 'pose-images-to-download.json');
  const rawData = await fs.readFile(listPath, 'utf-8');
  const images: ImageItem[] = JSON.parse(rawData);

  console.log(`[DownloadPoseImages] Processing ${images.length} images...`);

  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const progress = `[${i + 1}/${images.length}]`;

    try {
      // Download original image
      console.log(`${progress} Downloading original: ${img.original}`);
      const originalBuffer = await downloadFile(img.original);

      // Upload to MinIO
      console.log(`${progress} Uploading to MinIO: ${img.minioPath}`);
      await uploadToMinIO(img.minioPath, originalBuffer, 'image/png');

      // Download thumbnail
      console.log(`${progress} Downloading thumbnail: ${img.thumbnail}`);
      const thumbnailBuffer = await downloadFile(img.thumbnail);

      // Upload thumbnail to MinIO
      console.log(
        `${progress} Uploading thumbnail to MinIO: ${img.minioThumbPath}`
      );
      await uploadToMinIO(img.minioThumbPath, thumbnailBuffer, 'image/jpeg');

      successCount++;
      console.log(`${progress} ✓ Success`);

      // Rate limiting: 避免GitHub限流
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      failureCount++;
      console.error(`${progress} ✗ Failed:`, err);
    }
  }

  console.log('[DownloadPoseImages] Complete!');
  console.log(`  Success: ${successCount}`);
  console.log(`  Failed: ${failureCount}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[DownloadPoseImages] Fatal error:', err);
    process.exit(1);
  });
