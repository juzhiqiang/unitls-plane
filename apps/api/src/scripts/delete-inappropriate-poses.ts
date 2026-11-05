/**
 * 删除MinIO中不适合的姿势图片
 */

import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

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

// 需要删除的文件列表
const filesToDelete = [
  // 默认种子姿势
  'pose/a.png',
  'pose/thumbnails/a.png',
  'pose/t.png',
  'pose/thumbnails/t.png',
  'pose/walk.png',
  'pose/thumbnails/walk.png',

  // M字开腿系列
  'pose/full_sexy_P018_front.png',
  'pose/thumbnails/full_sexy_P018_front.jpg',
  'pose/full_sexy_P019_front.png',
  'pose/thumbnails/full_sexy_P019_front.jpg',

  // 性感大胆系
  'pose/full_sexy_P051_front.png',
  'pose/thumbnails/full_sexy_P051_front.jpg',
  'pose/full_sexy_P052_front.png',
  'pose/thumbnails/full_sexy_P052_front.jpg',
  'pose/full_sexy_P053_front.png',
  'pose/thumbnails/full_sexy_P053_front.jpg',
  'pose/full_sexy_P054_front.png',
  'pose/thumbnails/full_sexy_P054_front.jpg',

  // 双人立位
  'pose/pair60_P001_front.png',
  'pose/thumbnails/pair60_P001_front.jpg',
  'pose/pair60_P030_front.png',
  'pose/thumbnails/pair60_P030_front.jpg',
  'pose/pair60_P052_front.png',
  'pose/thumbnails/pair60_P052_front.jpg',
  'pose/pair60_P053_front.png',
  'pose/thumbnails/pair60_P053_front.jpg',

  // 背向坐位
  'pose/pair60_P009_front.png',
  'pose/thumbnails/pair60_P009_front.jpg',
  'pose/pair60_P010_front.png',
  'pose/thumbnails/pair60_P010_front.jpg',
  'pose/pair60_P016_front.png',
  'pose/thumbnails/pair60_P016_front.jpg',
  'pose/pair60_P019_front.png',
  'pose/thumbnails/pair60_P019_front.jpg',

  // 挤胸系列
  'pose/full_sexy_P026_front.png',
  'pose/thumbnails/full_sexy_P026_front.jpg',
  'pose/full_sexy_P028_front.png',
  'pose/thumbnails/full_sexy_P028_front.jpg',
  'pose/full_sexy_P029_front.png',
  'pose/thumbnails/full_sexy_P029_front.jpg',

  // 过度后仰
  'pose/full_sexy_P033_front.png',
  'pose/thumbnails/full_sexy_P033_front.jpg',
  'pose/full_sexy_P048_front.png',
  'pose/thumbnails/full_sexy_P048_front.jpg',
  'pose/full_sexy_P049_front.png',
  'pose/thumbnails/full_sexy_P049_front.jpg',
];

async function main() {
  console.log(
    `[DeleteInappropriatePoses] Deleting ${filesToDelete.length} files from MinIO...`
  );

  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < filesToDelete.length; i++) {
    const key = filesToDelete[i];
    const progress = `[${i + 1}/${filesToDelete.length}]`;

    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: BUCKET,
          Key: key,
        })
      );

      successCount++;
      console.log(`${progress} ✓ Deleted: ${key}`);
    } catch (err) {
      failureCount++;
      console.error(`${progress} ✗ Failed to delete ${key}:`, err);
    }
  }

  console.log('[DeleteInappropriatePoses] Complete!');
  console.log(`  Success: ${successCount}`);
  console.log(`  Failed: ${failureCount}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[DeleteInappropriatePoses] Fatal error:', err);
    process.exit(1);
  });
