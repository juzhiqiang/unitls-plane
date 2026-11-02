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

// 排除不适合试衣的体系
const EXCLUDED_SYSTEMS = [
  '性感系',
  '泳装',
  '内衣',
  '躺卧',
  '双人',
] as const;

// 图片基础 URL（需要根据实际部署调整）
const IMAGE_BASE_URL = 'https://ai-pose-gallery.pages.dev';

function shouldIncludePose(pose: PoseData): boolean {
  // 只选择正面角度（试衣主要展示正面）
  if (pose.角度 !== '正面') return false;
  
  // 检查分类
  if (!SUITABLE_CATEGORIES.includes(pose.分类 as any)) return false;
  
  // 排除不适合的体系
  if (EXCLUDED_SYSTEMS.some(ex => pose.体系.includes(ex))) return false;
  
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
  
  // 3. 限制数量（前 25 个，避免过多）
  const selected = suitable.slice(0, 25);
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
