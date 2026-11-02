/**
 * 导入姿势参考图片
 * 
 * 从 ai-pose-gallery-zh 项目筛选适合试衣的姿势并导入到图库。
 * 
 * 数据来源：
 * - https://github.com/anhao/ai-pose-gallery-zh （CC0/开源）
 * - https://hongye007.github.io/open-pose-costume/ （参考项目）
 * 
 * 用法：
 *   1. 下载姿势数据：curl -o pose-zh.json https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/data/pose-zh.json
 *   2. 运行脚本：bun run src/scripts/import-pose-references.ts
 *   3. 脚本会筛选试衣姿势、下载图片并插入数据库
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

// 适合试衣的姿势分类（按优先级）
const SUITABLE_CATEGORIES = [
  '站姿',
  '行走',
  '坐姿',
  '跪姿',
] as const;

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

// 图片基础 URL（需要根据实际部署调整）
const IMAGE_BASE_URL = 'https://ai-pose-gallery.pages.dev';

function shouldIncludePose(pose: PoseData): boolean {
  // 只选择正面角度（试衣主要展示正面）
  if (pose.角度 !== '正面') return false;
  
  // 排除成人内容分类
  if (EXCLUDED_CATEGORIES.some(ex => pose.分类.includes(ex))) return false;
  
  // 排除明显的成人内容体系
  if (pose.体系.includes('R18') || pose.体系.includes('成人')) return false;
  
  // 允许的分类：站姿、坐姿、跪姿、躺卧、蹲姿等合理展示姿势
  const validCategories = [
    '站姿', '行走', '坐姿', '跪立', '跪立・四肢着地',
    '躺卧', '趴卧', '蹲姿', '侧坐・女孩坐', '背向坐位',
    '性感・大胆系', '可爱系', '挤胸・强调事业线系',
    '前倾', '后仰・挺背', '扭身', '立位'
  ];
  
  if (!validCategories.includes(pose.分类)) return false;
  
  return true;
}

function generateSlug(pose: PoseData): string {
  const categorySlug = pose.分类.toLowerCase();
  const code = pose.姿势编号.toLowerCase();
  return `pose-${categorySlug}-${code}`;
}

function generateTags(pose: PoseData): string[] {
  const tags: string[] = [];
  
  // 分类标签
  tags.push(pose.分类);
  
  // 体系标签
  if (pose.体系.includes('全身')) tags.push('full-body');
  if (pose.体系.includes('单人')) tags.push('solo');
  
  // 角度标签
  tags.push('front');
  
  // 姿势特征标签
  if (pose.姿势名称.includes('自然')) tags.push('natural');
  if (pose.姿势名称.includes('展示')) tags.push('display');
  if (pose.姿势名称.includes('优雅')) tags.push('elegant');
  
  return tags;
}

async function main() {
  console.log('[ImportPoseReferences] Starting import...');
  
  // 1. 读取姿势数据
  const dataPath = process.argv[2] || path.join(process.cwd(), 'pose-zh.json');
  const rawData = await fs.readFile(dataPath, 'utf-8');
  const poses: PoseData[] = JSON.parse(rawData);
  console.log(`[ImportPoseReferences] Loaded ${poses.length} poses`);
  
  // 2. 筛选适合试衣的姿势
  const suitable = poses.filter(shouldIncludePose);
  console.log(`[ImportPoseReferences] Found ${suitable.length} suitable poses`);
  
  // 3. 按分类平衡选择姿势（每个分类最多取一定数量，确保多样性）
  const byCategory = new Map<string, PoseData[]>();
  suitable.forEach(pose => {
    const cat = pose.分类;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(pose);
  });
  
  const selected: PoseData[] = [];
  const maxPerCategory = Math.ceil(50 / byCategory.size); // 目标50个姿势，平均分配
  
  for (const [category, poses] of byCategory.entries()) {
    selected.push(...poses.slice(0, maxPerCategory));
  }
  console.log(`[ImportPoseReferences] Selected ${selected.length} poses for import`);
  
  // 4. 生成插入数据
  const records = selected.map((pose, index) => ({
    slug: generateSlug(pose),
    kind: 'pose' as const,
    title_zh: pose.姿势名称,
    title_en: pose.id.replace(/_/g, ' '),
    description_zh: `${pose.体系} · ${pose.分类} · ${pose.角度}`,
    description_en: `${pose.体系} · ${pose.分类}`,
    tags: generateTags(pose),
    asset_bucket: 'try-on-references',
    asset_storage_key: `pose/${pose.原图.replace('img/', '')}`,
    thumbnail_bucket: 'try-on-references',
    thumbnail_storage_key: `pose/thumbnails/${pose.缩略图.replace('thumbs/', '')}`,
    source_url: 'https://github.com/anhao/ai-pose-gallery-zh',
    license_name: 'CC0-1.0',
    license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'AI Pose Gallery ZH',
    is_enabled: true,
    sort_order: index,
  }));
  
  // 5. 批量插入数据库
  console.log('[ImportPoseReferences] Inserting records...');
  await db.insert(aiTryOnReferences).values(records).onConflictDoUpdate({
    target: [aiTryOnReferences.slug],
    set: {
      title_zh: records[0].title_zh,
      title_en: records[0].title_en,
      description_zh: records[0].description_zh,
      description_en: records[0].description_en,
      tags: records[0].tags,
    },
  });
  
  console.log(`[ImportPoseReferences] Successfully imported ${records.length} pose references`);
  console.log('[ImportPoseReferences] Next steps:');
  console.log('  1. Download images from source repository');
  console.log('  2. Upload to MinIO: try-on-references/pose/');
  console.log('  3. Run seed script to verify');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[ImportPoseReferences] Failed:', err);
    process.exit(1);
  });


