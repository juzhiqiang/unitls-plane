/**
 * 同步 AI Pose Gallery ZH 多视角姿势元数据与许可审查时间
 *
 * 1. 基于 `pose-zh.json` 与 `pose-titles.en.json` 补全 1,439 条多视角记录的中英文标题、分类描述与标签（含性别标签 `female`/`女性` 或 `pair`/`双人`，修正视角标签）；
 * 2. 按分类规则标记 `adult` / `intimate` / `hidden` / `public`，并为 `public` 记录补齐 `license_reviewed_at`；
 * 3. 将早期单视角重复记录 `pose-*` 设为 `is_enabled = false`，避免与多视角 `_front` 重复出现。
 */

import { db, aiTryOnReferences } from '@utils-plane/db';
import { eq, like, sql } from 'drizzle-orm';

const REPO_RAW_BASE =
  'https://raw.githubusercontent.com/hongye007/open-pose-costume/main';
const POSE_ZH_URL = `${REPO_RAW_BASE}/data/source/pose-zh.json`;
const POSE_EN_URL = `${REPO_RAW_BASE}/data/pose-titles.en.json`;

interface PoseZhEntry {
  id: string;
  体系: string;
  姿势编号: string;
  分类: string;
  姿势名称: string;
  角度: string;
  缩略图: string;
  原图: string;
}

type PoseTitlesEn = Record<string, string[] | Record<string, string>>;

const VIEW_MAP: Record<string, string> = {
  正面: 'front',
  俯视: 'high',
  仰视: 'low',
  侧面: 'side',
  斜侧: 'diag',
  背面: 'back',
  高角度: 'high',
  低角度: 'low',
};

const VIEW_EN_LABEL: Record<string, string> = {
  front: 'Front',
  high: 'High angle',
  low: 'Low angle',
  side: 'Side',
  diag: 'Three-quarter',
  back: 'Back',
};

const ADULT_CATEGORIES = ['正常位', '后入位', '骑乘位', '侧卧位'] as const;
const INTIMATE_CATEGORIES = [
  '坐位贴身',
  '立位贴身',
  '贴身',
  '贴脸系',
  '面对面坐位',
] as const;
const HIDDEN_CATEGORIES = ['挤胸・强调事业线系', '后仰・挺背'] as const;

function classifyVisibility(
  entry: PoseZhEntry
): 'public' | 'hidden' | 'adult' | 'intimate' {
  const lower = entry.id.toLowerCase();
  if (
    entry.体系.includes('R18') ||
    ADULT_CATEGORIES.some(c => entry.分类.includes(c)) ||
    /full_sexy_p0(18|19|5[1-4])/.test(lower)
  ) {
    return 'adult';
  }
  if (
    INTIMATE_CATEGORIES.some(c => entry.分类.includes(c)) ||
    entry.体系 === '双人缠绵' ||
    lower.startsWith('pair60_')
  ) {
    return 'intimate';
  }
  if (
    HIDDEN_CATEGORIES.some(c => entry.分类.includes(c)) ||
    /full_sexy_p0(26|28|29|33|48|49)/.test(lower)
  ) {
    return 'hidden';
  }
  return 'public';
}

function resolveEnglishTitle(entry: PoseZhEntry, enMap: PoseTitlesEn): string {
  const match = entry.id.match(/^([a-z0-9_]+)_P(\d{3})_/i);
  if (!match) return entry.姿势名称;
  const seriesKey = (match[1] ?? '').toLowerCase();
  const numStr = match[2] ?? '001';
  const numIdx = parseInt(numStr, 10) - 1;
  const table = enMap[seriesKey];
  if (Array.isArray(table)) {
    return table[numIdx] || `${seriesKey} P${numStr}`;
  }
  if (table && typeof table === 'object') {
    return table[numStr] || `${seriesKey} P${numStr}`;
  }
  return `${seriesKey} P${numStr}`;
}

async function main() {
  console.log(
    '[SyncPoseMultiviewMetadata] Fetching pose-zh.json & pose-titles.en.json...'
  );
  const [poseZhRes, poseEnRes] = await Promise.all([
    fetch(POSE_ZH_URL),
    fetch(POSE_EN_URL),
  ]);
  const entries = (await poseZhRes.json()) as PoseZhEntry[];
  const enMap = (await poseEnRes.json()) as PoseTitlesEn;

  console.log(`[SyncPoseMultiviewMetadata] Loaded ${entries.length} entries`);
  const reviewedAt = new Date();
  let updated = 0;
  let publicCount = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const slug = entry.id.toLowerCase();
    const view = VIEW_MAP[entry.角度] || 'front';
    const visibility = classifyVisibility(entry);
    if (visibility === 'public') publicCount++;

    const enBaseTitle = resolveEnglishTitle(entry, enMap);
    const enView = VIEW_EN_LABEL[view] || view;
    const isPair = slug.startsWith('pair60_') || entry.体系 === '双人缠绵';
    const isUpper = slug.startsWith('upper');

    const tags = Array.from(
      new Set([
        view,
        ...(isPair ? ['pair', '双人'] : ['female', '女性', 'solo', '单人']),
        ...(isUpper ? ['upper-body', '上半身'] : ['full-body', '全身']),
        entry.分类,
        entry.体系,
      ])
    );

    await db
      .update(aiTryOnReferences)
      .set({
        visibility,
        titleZh: `${entry.姿势名称}（${entry.角度}）`,
        titleEn: `${enBaseTitle} (${enView})`,
        descriptionZh: `${entry.姿势编号} · ${entry.分类} · ${entry.体系}`,
        descriptionEn: `${entry.姿势编号} · ${entry.分类} · ${entry.体系}`,
        tags,
        licenseReviewedAt: visibility === 'public' ? reviewedAt : null,
        sortOrder: i,
        updatedAt: reviewedAt,
      })
      .where(eq(aiTryOnReferences.slug, slug));

    updated++;
  }

  // 禁用旧版单视角重复记录 pose-*
  await db
    .update(aiTryOnReferences)
    .set({ isEnabled: false, updatedAt: reviewedAt })
    .where(like(aiTryOnReferences.slug, 'pose-%'));

  const stats = await db.execute(sql`
    SELECT visibility, is_enabled, license_reviewed_at IS NOT NULL AS reviewed, count(*) AS cnt
    FROM ai_try_on_references
    WHERE kind = 'pose'
    GROUP BY visibility, is_enabled, license_reviewed_at IS NOT NULL
    ORDER BY visibility, is_enabled DESC
  `);
  console.log('[SyncPoseMultiviewMetadata] Done:', {
    updated,
    publicCount,
    stats: (stats as { rows?: unknown }).rows ?? stats,
  });
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[SyncPoseMultiviewMetadata] Failed:', err);
    process.exit(1);
  });
