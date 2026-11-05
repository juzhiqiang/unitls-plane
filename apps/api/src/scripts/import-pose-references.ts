/**
 * 导入姿势参考图片
 *
 * 从 ai-pose-gallery-zh 项目筛选适合试衣的姿势并导入到图库。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { db } from '@utils-plane/db';
import { aiTryOnReferences } from '@utils-plane/db/schema';

interface PoseData {
  id: string;
  体系: string;
  姿势编号: string;
  分类: string;
  姿势名称: string;
  角度: string;
  缩略图: string;
  原图: string;
  检索: string;
}

// 排除明显成人内容，但保留合理的泳装/内衣/性感系展示姿势
const EXCLUDED_CATEGORIES = [
  '正常位',
  '后入位',
  '骑乘位',
  '侧卧位',
  '坐位贴身',
  '立位贴身',
  '贴身',
  '贴脸系',
  '面对面坐位',
] as const;

function shouldIncludePose(pose: PoseData): boolean {
  if (pose.角度 !== '正面') return false;
  if (EXCLUDED_CATEGORIES.some(ex => pose.分类.includes(ex))) return false;
  if (pose.体系.includes('R18') || pose.体系.includes('成人')) return false;

  const validCategories = [
    '站姿',
    '行走',
    '坐姿',
    '跪立',
    '跪立・四肢着地',
    '躺卧',
    '趴卧',
    '蹲姿',
    '侧坐・女孩坐',
    '背向坐位',
    '性感・大胆系',
    '可爱系',
    '挤胸・强调事业线系',
    '前倾',
    '后仰・挺背',
    '扭身',
    '立位',
  ];

  return validCategories.includes(pose.分类);
}

function generateSlug(pose: PoseData): string {
  const categorySlug = pose.分类.replace(/[・／]/g, '-');
  const code = pose.姿势编号.toLowerCase();
  return `pose-${categorySlug}-${code}`.toLowerCase();
}

function generateTags(pose: PoseData): string[] {
  const tags: string[] = [pose.分类];
  if (pose.体系.includes('全身')) tags.push('full-body');
  if (pose.体系.includes('单人')) tags.push('solo');
  tags.push('front');
  if (pose.姿势名称.includes('自然')) tags.push('natural');
  if (pose.姿势名称.includes('展示')) tags.push('display');
  if (pose.姿势名称.includes('优雅')) tags.push('elegant');
  return tags;
}

async function main() {
  console.log('[ImportPoseReferences] Starting import...');

  const dataPath = process.argv[2] || path.join(process.cwd(), 'pose-zh.json');
  const rawData = await fs.readFile(dataPath, 'utf-8');
  const poses: PoseData[] = JSON.parse(rawData);
  console.log(`[ImportPoseReferences] Loaded ${poses.length} poses`);

  const suitable = poses.filter(shouldIncludePose);
  console.log(`[ImportPoseReferences] Found ${suitable.length} suitable poses`);

  const byCategory = new Map<string, PoseData[]>();
  suitable.forEach(pose => {
    const cat = pose.分类;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(pose);
  });

  const selected: PoseData[] = [];
  const maxPerCategory = Math.ceil(60 / byCategory.size);

  for (const [category, poses] of byCategory.entries()) {
    selected.push(...poses.slice(0, maxPerCategory));
  }
  console.log(
    `[ImportPoseReferences] Selected ${selected.length} poses for import`
  );

  // 使用camelCase字段名
  const records = selected.map((pose, index) => ({
    slug: generateSlug(pose),
    kind: 'pose' as const,
    titleZh: pose.姿势名称,
    titleEn: pose.id.replace(/_/g, ' '),
    descriptionZh: `${pose.体系} · ${pose.分类} · ${pose.角度}`,
    descriptionEn: `${pose.体系} · ${pose.分类}`,
    tags: generateTags(pose),
    assetBucket: 'try-on-references',
    assetStorageKey: `pose/${pose.原图.replace('img/', '')}`,
    thumbnailBucket: 'try-on-references',
    thumbnailStorageKey: `pose/thumbnails/${pose.缩略图.replace('thumbs/', '')}`,
    sourceUrl: 'https://github.com/anhao/ai-pose-gallery-zh',
    licenseName: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'AI Pose Gallery ZH',
    isEnabled: true,
    sortOrder: index,
  }));

  console.log('[ImportPoseReferences] Inserting records...');

  try {
    await db.insert(aiTryOnReferences).values(records).onConflictDoNothing();
    console.log(
      `[ImportPoseReferences] Successfully imported ${records.length} pose references`
    );
  } catch (err: any) {
    console.error('[ImportPoseReferences] Insert failed:', err);
    throw err;
  }

  // 导出图片清单
  const imageList = records.map(r => ({
    original: `https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/public/${r.assetStorageKey.replace('pose/', 'img/')}`,
    thumbnail: `https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/public/${r.thumbnailStorageKey.replace('pose/thumbnails/', 'thumbs/')}`,
    minioPath: r.assetStorageKey,
    minioThumbPath: r.thumbnailStorageKey,
  }));

  const listPath = path.join(process.cwd(), 'pose-images-to-download.json');
  await fs.writeFile(listPath, JSON.stringify(imageList, null, 2));
  console.log(`[ImportPoseReferences] Image list saved to: ${listPath}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[ImportPoseReferences] Failed:', err);
    process.exit(1);
  });
