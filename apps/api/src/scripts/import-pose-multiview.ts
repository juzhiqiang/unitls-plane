/**
 * 导入完整多视角姿势参考图库
 *
 * 从 ai-pose-gallery-zh 项目筛选所有适合试衣的姿势，并为每个姿势的每个视角创建独立记录。
 *
 * 关键改动：
 * 1. 不再排除非正面视角
 * 2. 每个视角生成独立的 slug 和 DB 记录
 * 3. MinIO key 包含视角标识：pose/{category}_{id}_{view}.png
 * 4. visibility 字段控制是否对前端可见
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

// 成人内容分类规则
const ADULT_CATEGORIES = ['正常位', '后入位', '骑乘位', '侧卧位'] as const;
const INTIMATE_CATEGORIES = [
  '坐位贴身',
  '立位贴身',
  '贴身',
  '贴脸系',
  '面对面坐位',
] as const;
const HIDDEN_CATEGORIES = ['挤胸・强调事业线系', '后仰・挺背'] as const;

// 视角映射
const VIEW_MAP: Record<string, string> = {
  正面: 'front',
  侧面: 'side',
  背面: 'back',
  高角度: 'high',
  低角度: 'low',
  斜侧: 'diag',
};

function classifyVisibility(
  pose: PoseData
): 'public' | 'hidden' | 'adult' | 'intimate' {
  if (
    pose.体系.includes('R18') ||
    ADULT_CATEGORIES.some(c => pose.分类.includes(c))
  ) {
    return 'adult';
  }
  if (INTIMATE_CATEGORIES.some(c => pose.分类.includes(c))) {
    return 'intimate';
  }
  if (HIDDEN_CATEGORIES.some(c => pose.分类.includes(c))) {
    return 'hidden';
  }
  return 'public';
}

function generateSlug(pose: PoseData, view: string): string {
  const base = pose.id.toLowerCase().replace(/\s+/g, '-');
  return `${base}_${view}`;
}

function generateTags(pose: PoseData, view: string): string[] {
  const tags: string[] = [];
  tags.push(view);

  if (pose.体系) tags.push(pose.体系);
  if (pose.分类) {
    pose.分类.split(/[・·、,]/).forEach(cat => {
      const trimmed = cat.trim();
      if (trimmed && !tags.includes(trimmed)) {
        tags.push(trimmed);
      }
    });
  }

  if (pose.姿势编号.startsWith('full_single')) tags.push('solo');
  else if (pose.姿势编号.startsWith('pair')) tags.push('pair');
  else if (pose.姿势编号.startsWith('full_sexy')) tags.push('sexy');
  else if (pose.姿势编号.startsWith('upper')) tags.push('upper-body');

  return tags;
}

async function main() {
  console.log('[ImportPoseMultiview] Starting multiview import...');

  const dataPath = path.join(process.cwd(), '../../public/pose-dicts.json');
  console.log(`[ImportPoseMultiview] Reading ${dataPath}`);

  const rawData = await fs.readFile(dataPath, 'utf-8');
  const poses: PoseData[] = JSON.parse(rawData);
  console.log(`[ImportPoseMultiview] Loaded ${poses.length} total poses`);

  // 按姿势编号分组
  const poseGroups = new Map<string, PoseData[]>();
  poses.forEach(pose => {
    const key = pose.姿势编号;
    if (!poseGroups.has(key)) poseGroups.set(key, []);
    poseGroups.get(key)!.push(pose);
  });

  console.log(`[ImportPoseMultiview] Found ${poseGroups.size} unique poses`);

  const records: Array<typeof aiTryOnReferences.$inferInsert> = [];

  for (const [poseId, views] of poseGroups.entries()) {
    const basePose = views[0];
    const visibility = classifyVisibility(basePose);

    for (const pose of views) {
      const view = VIEW_MAP[pose.角度];
      if (!view) {
        console.warn(
          `[ImportPoseMultiview] Unknown view: ${pose.角度} for ${poseId}, skipping`
        );
        continue;
      }

      records.push({
        slug: generateSlug(pose, view),
        kind: 'pose',
        visibility,
        titleZh: `${pose.姿势名称} (${pose.角度})`,
        titleEn: `${pose.id} (${view})`,
        descriptionZh: `${pose.体系} · ${pose.分类}`,
        descriptionEn: `${pose.体系} · ${pose.分类}`,
        tags: generateTags(pose, view),
        assetBucket: 'try-on-references',
        assetStorageKey: `pose/${pose.原图.replace('img/', '')}`,
        thumbnailBucket: 'try-on-references',
        thumbnailStorageKey: `pose/thumbnails/${pose.缩略图.replace('thumbs/', '')}`,
        sourceUrl: 'https://github.com/anhao/ai-pose-gallery-zh',
        licenseName: 'CC0-1.0',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        attribution: 'AI Pose Gallery ZH',
        isEnabled: true,
        sortOrder: records.length,
      });
    }
  }

  console.log(`[ImportPoseMultiview] Generated ${records.length} records`);
  console.log(`[ImportPoseMultiview] By visibility:`);
  const vCounts = records.reduce(
    (acc, r) => {
      acc[r.visibility] = (acc[r.visibility] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  console.log(JSON.stringify(vCounts, null, 2));

  console.log('[ImportPoseMultiview] Inserting records...');

  try {
    await db.insert(aiTryOnReferences).values(records).onConflictDoNothing();
    console.log(
      `[ImportPoseMultiview] Successfully imported ${records.length} pose references`
    );
  } catch (err: any) {
    console.error('[ImportPoseMultiview] Insert failed:', err);
    throw err;
  }

  // 导出图片清单
  const imageList = records.map(r => ({
    original: `https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/public/${r.assetStorageKey.replace('pose/', 'img/')}`,
    thumbnail: `https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/public/${r.thumbnailStorageKey.replace('pose/thumbnails/', 'thumbs/')}`,
    minioPath: r.assetStorageKey,
    minioThumbPath: r.thumbnailStorageKey,
    visibility: r.visibility,
  }));

  const listPath = path.join(
    process.cwd(),
    'pose-images-multiview-to-download.json'
  );
  await fs.writeFile(listPath, JSON.stringify(imageList, null, 2));
  console.log(`[ImportPoseMultiview] Image list saved to: ${listPath}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[ImportPoseMultiview] Failed:', err);
    process.exit(1);
  });
