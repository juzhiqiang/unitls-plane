import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { db, aiTryOnReferences } from '@utils-plane/db';
import { eq } from 'drizzle-orm';
import https from 'https';
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
const BASE_URL = 'https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main';

// 需要恢复的姿势分类
const posesToRestore = {
  adult: [
    { slug: 'full_sexy_P018_front', title_zh: 'M字开腿1', title_en: 'M-Pose 1', tags: ['性感・大胆系', 'R18', 'front'], key: 'full_sexy_P018_front.png' },
    { slug: 'full_sexy_P019_front', title_zh: 'M字开腿2', title_en: 'M-Pose 2', tags: ['性感・大胆系', 'R18', 'front'], key: 'full_sexy_P019_front.png' },
    { slug: 'full_sexy_P051_front', title_zh: '性感大胆1', title_en: 'Sexy Bold 1', tags: ['性感・大胆系', 'R18', 'front'], key: 'full_sexy_P051_front.png' },
    { slug: 'full_sexy_P052_front', title_zh: '性感大胆2', title_en: 'Sexy Bold 2', tags: ['性感・大胆系', 'R18', 'front'], key: 'full_sexy_P052_front.png' },
    { slug: 'full_sexy_P053_front', title_zh: '性感大胆3', title_en: 'Sexy Bold 3', tags: ['性感・大胆系', 'R18', 'front'], key: 'full_sexy_P053_front.png' },
    { slug: 'full_sexy_P054_front', title_zh: '性感大胆4', title_en: 'Sexy Bold 4', tags: ['性感・大胆系', 'R18', 'front'], key: 'full_sexy_P054_front.png' },
  ],
  intimate: [
    { slug: 'pair60_P001_front', title_zh: '立位贴身1', title_en: 'Standing Close 1', tags: ['立位', '贴身', 'front', 'pair'], key: 'pair60_P001_front.png' },
    { slug: 'pair60_P030_front', title_zh: '立位贴身2', title_en: 'Standing Close 2', tags: ['立位', '贴身', 'front', 'pair'], key: 'pair60_P030_front.png' },
    { slug: 'pair60_P052_front', title_zh: '立位贴身3', title_en: 'Standing Close 3', tags: ['立位', '贴身', 'front', 'pair'], key: 'pair60_P052_front.png' },
    { slug: 'pair60_P053_front', title_zh: '立位贴身4', title_en: 'Standing Close 4', tags: ['立位', '贴身', 'front', 'pair'], key: 'pair60_P053_front.png' },
    { slug: 'pair60_P009_front', title_zh: '背向坐位1', title_en: 'Back Sitting 1', tags: ['坐姿', '背向坐位', '贴身', 'front', 'pair'], key: 'pair60_P009_front.png' },
    { slug: 'pair60_P010_front', title_zh: '背向坐位2', title_en: 'Back Sitting 2', tags: ['坐姿', '背向坐位', '贴身', 'front', 'pair'], key: 'pair60_P010_front.png' },
    { slug: 'pair60_P016_front', title_zh: '背向坐位3', title_en: 'Back Sitting 3', tags: ['坐姿', '背向坐位', '贴身', 'front', 'pair'], key: 'pair60_P016_front.png' },
    { slug: 'pair60_P019_front', title_zh: '背向坐位4', title_en: 'Back Sitting 4', tags: ['坐姿', '背向坐位', '贴身', 'front', 'pair'], key: 'pair60_P019_front.png' },
  ],
  hidden: [
    { slug: 'pose-a-standing', title_zh: 'A-pose站姿', title_en: 'A-Pose Standing', tags: ['a-pose', '站姿', 'front', 'full-body', 'solo', 'standing'], key: 'a.png' },
    { slug: 'pose-t-standing', title_zh: 'T-pose站姿', title_en: 'T-Pose Standing', tags: ['t-pose', '站姿', 'front', 'full-body', 'solo', 'standing'], key: 't.png' },
    { slug: 'pose-walking', title_zh: '行走姿势', title_en: 'Walking Pose', tags: ['motion', 'walking', 'front', 'full-body', 'solo'], key: 'walk.png' },
    { slug: 'full_sexy_P026_front', title_zh: '挤胸姿势1', title_en: 'Chest Pose 1', tags: ['挤胸・强调事业线系', '性感・大胆系', 'front'], key: 'full_sexy_P026_front.png' },
    { slug: 'full_sexy_P028_front', title_zh: '挤胸姿势2', title_en: 'Chest Pose 2', tags: ['挤胸・强调事业线系', '性感・大胆系', 'front'], key: 'full_sexy_P028_front.png' },
    { slug: 'full_sexy_P029_front', title_zh: '挤胸姿势3', title_en: 'Chest Pose 3', tags: ['挤胸・强调事业线系', '性感・大胆系', 'front'], key: 'full_sexy_P029_front.png' },
    { slug: 'full_sexy_P033_front', title_zh: '过度后仰1', title_en: 'Arch Back 1', tags: ['后仰・挺背', '性感・大胆系', 'front'], key: 'full_sexy_P033_front.png' },
    { slug: 'full_sexy_P048_front', title_zh: '过度后仰2', title_en: 'Arch Back 2', tags: ['后仰・挺背', '性感・大胆系', 'front'], key: 'full_sexy_P048_front.png' },
    { slug: 'full_sexy_P049_front', title_zh: '过度后仰3', title_en: 'Arch Back 3', tags: ['后仰・挺背', '性感・大胆系', 'front'], key: 'full_sexy_P049_front.png' },
  ],
};

function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function uploadToMinio(key: string, buffer: Buffer): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: key.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
    })
  );
}

async function checkMinioFileExists(key: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function restorePoses() {
  console.log('开始恢复被删除的姿势...\n');
  
  let downloaded = 0;
  let uploaded = 0;
  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const [visibility, poses] of Object.entries(posesToRestore)) {
    console.log(`\n处理 ${visibility} 分类 (${poses.length}个)...`);
    
    for (const pose of poses) {
      try {
        // 检查数据库是否已存在
        const existing = await db.select().from(aiTryOnReferences).where(eq(aiTryOnReferences.slug, pose.slug)).limit(1);
        if (existing.length > 0) {
          console.log(`  → ${pose.slug}: 数据库记录已存在,跳过`);
          skipped++;
          continue;
        }
        
        // 检查MinIO文件
        const imageKey = `pose/${pose.key}`;
        const thumbKey = `pose/thumbnails/${pose.key.replace('.png', '.jpg')}`;
        
        let imageExists = await checkMinioFileExists(imageKey);
        let thumbExists = await checkMinioFileExists(thumbKey);
        
        // 下载并上传原图
        if (!imageExists) {
          const imageUrl = `${BASE_URL}/img/${pose.key}`;
          console.log(`  ↓ 下载: ${pose.key}...`);
          const imageBuffer = await downloadFile(imageUrl);
          downloaded++;
          
          console.log(`  ↑ 上传到MinIO: ${imageKey}`);
          await uploadToMinio(imageKey, imageBuffer);
          uploaded++;
          imageExists = true;
        }
        
        // 下载并上传缩略图
        if (!thumbExists) {
          const thumbFilename = pose.key.replace('.png', '.jpg');
          const thumbUrl = `${BASE_URL}/thumbs/${thumbFilename}`;
          console.log(`  ↓ 下载缩略图: ${thumbFilename}...`);
          const thumbBuffer = await downloadFile(thumbUrl);
          downloaded++;
          
          console.log(`  ↑ 上传到MinIO: ${thumbKey}`);
          await uploadToMinio(thumbKey, thumbBuffer);
          uploaded++;
          thumbExists = true;
        }
        
        // 插入数据库记录
        await db.insert(aiTryOnReferences).values({
          slug: pose.slug,
          kind: 'pose',
          visibility: visibility as any,
          titleZh: pose.title_zh,
          titleEn: pose.title_en,
          descriptionZh: null,
          descriptionEn: null,
          tags: pose.tags,
          assetBucket: BUCKET,
          assetStorageKey: imageKey,
          thumbnailBucket: BUCKET,
          thumbnailStorageKey: thumbKey,
          sourceUrl: 'https://github.com/anhao/ai-pose-gallery-zh',
          licenseName: 'CC0-1.0',
          licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
          attribution: 'AI Pose Gallery ZH',
          licenseReviewedAt: new Date(),
          isEnabled: true,
          sortOrder: 9000 + inserted,
        });
        
        console.log(`  ✓ ${pose.slug}: 恢复完成 (visibility=${visibility})`);
        inserted++;
        
      } catch (error) {
        console.error(`  ✗ ${pose.slug}: 失败 -`, error.message);
        failed++;
      }
    }
  }
  
  console.log(`\n恢复统计:`);
  console.log(`  下载文件: ${downloaded}`);
  console.log(`  上传MinIO: ${uploaded}`);
  console.log(`  插入记录: ${inserted}`);
  console.log(`  跳过: ${skipped}`);
  console.log(`  失败: ${failed}`);
}

restorePoses()
  .then(() => {
    console.log('\n✅ 所有操作完成');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ 执行失败:', error);
    process.exit(1);
  });
