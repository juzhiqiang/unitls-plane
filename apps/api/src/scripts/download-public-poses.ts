/**
 * 批量下载姿势图片并上传到 MinIO
 *
 * 只下载 visibility=public 的姿势，节省时间和存储空间
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

async function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        if (res.statusCode === 404) {
          console.warn(`  404: ${url}`);
          resolve(Buffer.alloc(0)); // 返回空 buffer，跳过此文件
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
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
  if (buffer.length === 0) return; // 跳过空文件

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
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: BUCKET,
        Key: key,
      })
    );
    return true;
  } catch (err: any) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

async function main() {
  console.log('[DownloadPublicPoses] Starting...');

  const listPath = path.join(
    process.cwd(),
    'pose-images-github-multiview.json'
  );
  const rawData = await fs.readFile(listPath, 'utf-8');
  const allImages: ImageItem[] = JSON.parse(rawData);

  const publicImages = allImages.filter(img => img.visibility === 'public');
  console.log(
    `[DownloadPublicPoses] Filtered ${publicImages.length} public images from ${allImages.length} total`
  );

  let successCount = 0;
  let skipCount = 0;
  let failureCount = 0;

  for (let i = 0; i < publicImages.length; i++) {
    const img = publicImages[i];
    const progress = `[${i + 1}/${publicImages.length}]`;

    try {
      // 检查是否已存在
      const origExists = await checkExists(img.minioPath);
      const thumbExists = await checkExists(img.minioThumbPath);

      if (origExists && thumbExists) {
        skipCount++;
        if (i % 50 === 0) {
          console.log(`${progress} ⊙ Skip (exists): ${img.minioPath}`);
        }
        continue;
      }

      if (!origExists) {
        const originalBuffer = await downloadFile(img.original);
        if (originalBuffer.length > 0) {
          await uploadToMinIO(img.minioPath, originalBuffer, 'image/png');
        }
      }

      if (!thumbExists) {
        const thumbnailBuffer = await downloadFile(img.thumbnail);
        if (thumbnailBuffer.length > 0) {
          await uploadToMinIO(
            img.minioThumbPath,
            thumbnailBuffer,
            'image/jpeg'
          );
        }
      }

      successCount++;
      if (i % 10 === 0 || i < 5) {
        console.log(`${progress} ✓ ${img.minioPath}`);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (err) {
      failureCount++;
      console.error(
        `${progress} ✗ ${img.minioPath}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log('[DownloadPublicPoses] Complete!');
  console.log(`  Success: ${successCount}`);
  console.log(`  Skipped (exists): ${skipCount}`);
  console.log(`  Failed: ${failureCount}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[DownloadPublicPoses] Fatal error:', err);
    process.exit(1);
  });
