/**
 * 批量下载姿势图片并上传到 MinIO（修正版）
 * 使用修正后的 URL 清单
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import https from 'https';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Buffer } from 'buffer';

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

interface ImageItem {
  original: string;
  thumbnail: string;
  minioPath: string;
  minioThumbPath: string;
  visibility: string;
}

async function downloadFile(url: string): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        if (res.statusCode === 404) {
          resolve(null);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
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

async function checkExists(key: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err: any) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

async function main() {
  console.log('[DownloadPosesFixed] Starting...');

  const listPath = path.join(
    process.cwd(),
    'pose-images-github-multiview-fixed.json'
  );
  const rawData = await fs.readFile(listPath, 'utf-8');
  const allImages: ImageItem[] = JSON.parse(rawData);

  const publicImages = allImages.filter(img => img.visibility === 'public');
  console.log(
    `[DownloadPosesFixed] Processing ${publicImages.length} public images`
  );

  let successCount = 0;
  let skipCount = 0;
  let notFoundCount = 0;
  let failureCount = 0;

  for (let i = 0; i < publicImages.length; i++) {
    const img = publicImages[i];
    const progress = `[${i + 1}/${publicImages.length}]`;

    try {
      const origExists = await checkExists(img.minioPath);
      const thumbExists = await checkExists(img.minioThumbPath);

      if (origExists && thumbExists) {
        skipCount++;
        continue;
      }

      let uploaded = false;

      if (!origExists) {
        const originalBuffer = await downloadFile(img.original);
        if (originalBuffer) {
          await uploadToMinIO(img.minioPath, originalBuffer, 'image/png');
          uploaded = true;
        } else {
          notFoundCount++;
        }
      }

      if (!thumbExists) {
        const thumbnailBuffer = await downloadFile(img.thumbnail);
        if (thumbnailBuffer) {
          await uploadToMinIO(
            img.minioThumbPath,
            thumbnailBuffer,
            'image/jpeg'
          );
          uploaded = true;
        }
      }

      if (uploaded) {
        successCount++;
        if (i % 20 === 0 || i < 5) {
          console.log(`${progress} ✓ ${img.minioPath}`);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (err) {
      failureCount++;
      console.error(
        `${progress} ✗ ${img.minioPath}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log('[DownloadPosesFixed] Complete!');
  console.log(`  Success: ${successCount}`);
  console.log(`  Skipped (exists): ${skipCount}`);
  console.log(`  Not found (404): ${notFoundCount}`);
  console.log(`  Failed: ${failureCount}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[DownloadPosesFixed] Fatal error:', err);
    process.exit(1);
  });
