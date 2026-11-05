/**
 * 恢复之前删除的成人内容姿势到数据库,标记为不可见但保留在MinIO中
 */

import { db, aiTryOnReferences } from '@utils-plane/db';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

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

// 需要恢复的姿势,按visibility分类
const posesToRestore = {
  // 成人内容 - R18标记
  adult: [
    {
      slug: 'full_sexy_P018_front',
      title: 'M字开腿1',
      tags: ['性感・大胆系', 'R18'],
      key: 'full_sexy_P018_front.png',
    },
    {
      slug: 'full_sexy_P019_front',
      title: 'M字开腿2',
      tags: ['性感・大胆系', 'R18'],
      key: 'full_sexy_P019_front.png',
    },
    {
      slug: 'full_sexy_P051_front',
      title: '性感大胆1',
      tags: ['性感・大胆系', 'R18'],
      key: 'full_sexy_P051_front.png',
    },
    {
      slug: 'full_sexy_P052_front',
      title: '性感大胆2',
      tags: ['性感・大胆系', 'R18'],
      key: 'full_sexy_P052_front.png',
    },
    {
      slug: 'full_sexy_P053_front',
      title: '性感大胆3',
      tags: ['性感・大胆系', 'R18'],
      key: 'full_sexy_P053_front.png',
    },
    {
      slug: 'full_sexy_P054_front',
      title: '性感大胆4',
      tags: ['性感・大胆系', 'R18'],
      key: 'full_sexy_P054_front.png',
    },
  ],
  // 亲密接触姿势
  intimate: [
    {
      slug: 'pair60_P001_front',
      title: '立位贴身1',
      tags: ['立位', '贴身'],
      key: 'pair60_P001_front.png',
    },
    {
      slug: 'pair60_P030_front',
      title: '立位贴身2',
      tags: ['立位', '贴身'],
      key: 'pair60_P030_front.png',
    },
    {
      slug: 'pair60_P052_front',
      title: '立位贴身3',
      tags: ['立位', '贴身'],
      key: 'pair60_P052_front.png',
    },
    {
      slug: 'pair60_P053_front',
      title: '立位贴身4',
      tags: ['立位', '贴身'],
      key: 'pair60_P053_front.png',
    },
    {
      slug: 'pair60_P009_front',
      title: '背向坐位1',
      tags: ['坐姿', '背向坐位', '贴身'],
      key: 'pair60_P009_front.png',
    },
    {
      slug: 'pair60_P010_front',
      title: '背向坐位2',
      tags: ['坐姿', '背向坐位', '贴身'],
      key: 'pair60_P010_front.png',
    },
    {
      slug: 'pair60_P016_front',
      title: '背向坐位3',
      tags: ['坐姿', '背向坐位', '贴身'],
      key: 'pair60_P016_front.png',
    },
    {
      slug: 'pair60_P019_front',
      title: '背向坐位4',
      tags: ['坐姿', '背向坐位', '贴身'],
      key: 'pair60_P019_front.png',
    },
  ],
  // 隐藏内容 - 不适合电商但非成人
  hidden: [
    {
      slug: 'pose-a-standing',
      title: 'A-pose站姿',
      tags: ['a-pose', '站姿', 'front', 'full-body', 'solo', 'standing'],
      key: 'a.png',
    },
    {
      slug: 'pose-t-standing',
      title: 'T-pose站姿',
      tags: ['t-pose', '站姿', 'front', 'full-body', 'solo', 'standing'],
      key: 't.png',
    },
    {
      slug: 'pose-walking',
      title: '行走姿势',
      tags: ['motion', 'walking', 'front', 'full-body', 'solo'],
      key: 'walk.png',
    },
    {
      slug: 'full_sexy_P026_front',
      title: '挤胸姿势1',
      tags: ['挤胸・强调事业线系', '性感・大胆系'],
      key: 'full_sexy_P026_front.png',
    },
    {
      slug: 'full_sexy_P028_front',
      title: '挤胸姿势2',
      tags: ['挤胸・强调事业线系', '性感・大胆系'],
      key: 'full_sexy_P028_front.png',
    },
    {
      slug: 'full_sexy_P029_front',
      title: '挤胸姿势3',
      tags: ['挤胸・强调事业线系', '性感・大胆系'],
      key: 'full_sexy_P029_front.png',
    },
    {
      slug: 'full_sexy_P033_front',
      title: '过度后仰1',
      tags: ['后仰・挺背', '性感・大胆系'],
      key: 'full_sexy_P033_front.png',
    },
    {
      slug: 'full_sexy_P048_front',
      title: '过度后仰2',
      tags: ['后仰・挺背', '性感・大胆系'],
      key: 'full_sexy_P048_front.png',
    },
    {
      slug: 'full_sexy_P049_front',
      title: '过度后仰3',
      tags: ['后仰・挺背', '性感・大胆系'],
      key: 'full_sexy_P049_front.png',
    },
  ],
};

async function checkFileExists(key: string): Promise<boolean> {
  try {
    await s3Client.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: `pose/${key}` })
    );
    return true;
  } catch {
    return false;
  }
}

async function restorePoses() {
  console.log('开始恢复已删除的姿势记录...\n');

  let restoredCount = 0;
  let skippedCount = 0;
  let totalCount = 0;

  for (const [visibility, poses] of Object.entries(posesToRestore)) {
    console.log(`\n处理 ${visibility} 分类...`);

    for (const pose of poses) {
      totalCount++;

      // 检查MinIO文件是否存在
      const fileExists = await checkFileExists(pose.key);
      if (!fileExists) {
        console.log(`  ⚠ ${pose.slug}: MinIO文件不存在,跳过`);
        skippedCount++;
        continue;
      }

      // 检查缩略图文件
      const thumbKey = pose.key.replace('.png', '.jpg');
      const thumbExists = await checkFileExists(thumbKey);

      try {
        await db.insert(aiTryOnReferences).values({
          slug: pose.slug,
          kind: 'pose',
          visibility: visibility as any,
          titleZh: pose.title,
          titleEn: pose.title,
          descriptionZh: null,
          descriptionEn: null,
          tags: pose.tags,
          assetBucket: BUCKET,
          assetStorageKey: `pose/${pose.key}`,
          thumbnailBucket: BUCKET,
          thumbnailStorageKey: `pose/thumbnails/${thumbExists ? thumbKey : pose.key}`,
          sourceUrl: 'https://github.com/anhao/ai-pose-gallery-zh',
          licenseName: 'CC0-1.0',
          licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
          attribution: 'AI Pose Gallery ZH',
          licenseReviewedAt: new Date(),
          isEnabled: true,
          sortOrder: 9000 + totalCount, // 排序靠后
        });

        console.log(`  ✓ ${pose.slug}: 已恢复 (visibility=${visibility})`);
        restoredCount++;
      } catch (error) {
        if ((error as any).code === '23505') {
          console.log(`  → ${pose.slug}: 记录已存在,跳过`);
        } else {
          console.error(`  ✗ ${pose.slug}: 恢复失败`, error);
        }
        skippedCount++;
      }
    }
  }

  console.log(`\n恢复完成:`);
  console.log(`  总计: ${totalCount}`);
  console.log(`  成功: ${restoredCount}`);
  console.log(`  跳过: ${skippedCount}`);
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
