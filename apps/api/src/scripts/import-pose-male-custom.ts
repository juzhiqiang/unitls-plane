/**
 * 导入 Open Pose & Costume 自建男性姿势到试衣参考图库
 *
 * 来源：https://github.com/hongye007/open-pose-costume 的 `data/custom/pose.json`
 * 中带 `male` 标签的自建姿势（MP-001 ~ MP-013，每个姿势 5 个视角）。
 *
 * 授权说明：
 * - 这批素材属于该仓库的「自建素材」，默认条款禁止商用与再分发；
 * - 本项目已取得维护者单独授权后才导入，`license_name` 标注为单独授权，
 *   `license_reviewed_at` 记录导入时的审查时间，满足图库「许可四项齐全」的放行要求。
 *
 * 处理流程：
 * 1. 拉取 `data/custom/pose.json`，筛选 `male` 标签条目；
 * 2. 下载每个视角的 PNG 原图与 WebP 缩略图（跳过 depth 深度图），上传到 MinIO；
 * 3. 以 slug 为键 upsert 数据库记录（重复执行只刷新元数据，不改 is_enabled）。
 *
 * 运行：
 *   cd apps/api
 *   bun --env-file=../../.env.local run src/scripts/import-pose-male-custom.ts
 */

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { db, aiTryOnReferences } from '@utils-plane/db';
import { sql } from 'drizzle-orm';

const REPO_RAW_BASE =
  'https://raw.githubusercontent.com/hongye007/open-pose-costume/main';
const POSE_JSON_URL = `${REPO_RAW_BASE}/data/custom/pose.json`;
const SOURCE_URL = 'https://github.com/hongye007/open-pose-costume';
const LICENSE_NAME = 'Open Pose & Costume 自建素材（已获维护者单独授权）';
const LICENSE_URL = `${SOURCE_URL}/blob/main/public/custom/LICENSE.txt`;
const ATTRIBUTION = 'Open Pose & Costume (hongye007)';

const BUCKET = 'try-on-references';
/** 排在现有姿势之后，避免打乱已有排序。 */
const SORT_ORDER_BASE = 20000;

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  region: process.env.S3_REGION || 'us-east-1',
  credentials: {
    accessKeyId:
      process.env.S3_ACCESS_KEY || process.env.S3_ACCESS_KEY_ID || 'minioadmin',
    secretAccessKey:
      process.env.S3_SECRET_KEY ||
      process.env.S3_SECRET_ACCESS_KEY ||
      'minioadmin',
  },
  forcePathStyle: true,
});

interface LocalizedText {
  zh: string;
  en: string;
}

interface CustomPoseVariant {
  id: string;
  angle: string;
  label: LocalizedText;
  original: string;
  image: string;
  thumbnail: string;
}

interface CustomPose {
  id: string;
  code: string;
  title: LocalizedText;
  category: { id: string; zh: string; en: string };
  series: LocalizedText;
  tags: Array<{ id: string; zh: string; en: string }>;
  variants: CustomPoseVariant[];
}

const KNOWN_VIEWS = new Set(['front', 'side', 'back', 'high', 'low', 'diag']);

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': 'utils-plane' } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    const e = err as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    if (e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

async function ensureUploaded(
  key: string,
  sourcePath: string,
  contentType: string
): Promise<'uploaded' | 'skipped'> {
  if (await objectExists(key)) return 'skipped';
  const body = await fetchBuffer(`${REPO_RAW_BASE}/public/${sourcePath}`);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return 'uploaded';
}

function fileName(path: string): string {
  return path.split('/').pop()!;
}

async function main() {
  console.log(`[ImportPoseMaleCustom] Fetching ${POSE_JSON_URL}`);
  const poses = (await (await fetch(POSE_JSON_URL)).json()) as CustomPose[];
  const malePoses = poses.filter(p => p.tags?.some(t => t.id === 'male'));
  const variantTotal = malePoses.reduce((s, p) => s + p.variants.length, 0);
  console.log(
    `[ImportPoseMaleCustom] ${malePoses.length} male poses, ${variantTotal} views`
  );

  const reviewedAt = new Date();
  const records: Array<typeof aiTryOnReferences.$inferInsert> = [];
  let uploaded = 0;
  let skipped = 0;
  let index = 0;

  for (const pose of malePoses) {
    for (const variant of pose.variants) {
      index += 1;
      const view = variant.angle.toLowerCase();
      if (!KNOWN_VIEWS.has(view)) {
        console.warn(`  skip unknown view ${variant.angle} for ${variant.id}`);
        continue;
      }

      const assetKey = `pose/${fileName(variant.original)}`;
      const thumbKey = `pose/thumbnails/${fileName(variant.thumbnail)}`;

      const results = await Promise.all([
        ensureUploaded(assetKey, variant.original, 'image/png'),
        ensureUploaded(thumbKey, variant.thumbnail, 'image/webp'),
      ]);
      for (const r of results) {
        if (r === 'uploaded') uploaded++;
        else skipped++;
      }
      console.log(
        `  [${index}/${variantTotal}] ${variant.id} ${results.join('/')}`
      );

      const extraTags = pose.tags
        .filter(t => t.id !== 'male')
        .flatMap(t => [t.id, t.zh]);

      records.push({
        slug: variant.id.toLowerCase(),
        kind: 'pose',
        visibility: 'public',
        titleZh: `${pose.title.zh}（${variant.label.zh}）`,
        titleEn: `${pose.title.en} (${variant.label.en})`,
        descriptionZh: `${pose.code} · ${pose.category.zh} · ${pose.series.zh}`,
        descriptionEn: `${pose.code} · ${pose.category.en} · ${pose.series.en}`,
        tags: Array.from(
          new Set([
            view,
            'male',
            '男性',
            'solo',
            'full-body',
            '全身',
            pose.category.id,
            pose.category.zh,
            ...extraTags,
          ])
        ),
        assetBucket: BUCKET,
        assetStorageKey: assetKey,
        thumbnailBucket: BUCKET,
        thumbnailStorageKey: thumbKey,
        sourceUrl: SOURCE_URL,
        licenseName: LICENSE_NAME,
        licenseUrl: LICENSE_URL,
        attribution: ATTRIBUTION,
        licenseReviewedAt: reviewedAt,
        isEnabled: true,
        sortOrder: SORT_ORDER_BASE + index,
      });
    }
  }

  console.log(`[ImportPoseMaleCustom] Upserting ${records.length} records...`);
  await db
    .insert(aiTryOnReferences)
    .values(records)
    .onConflictDoUpdate({
      target: aiTryOnReferences.slug,
      set: {
        titleZh: sql`excluded.title_zh`,
        titleEn: sql`excluded.title_en`,
        descriptionZh: sql`excluded.description_zh`,
        descriptionEn: sql`excluded.description_en`,
        tags: sql`excluded.tags`,
        assetStorageKey: sql`excluded.asset_storage_key`,
        thumbnailStorageKey: sql`excluded.thumbnail_storage_key`,
        sourceUrl: sql`excluded.source_url`,
        licenseName: sql`excluded.license_name`,
        licenseUrl: sql`excluded.license_url`,
        attribution: sql`excluded.attribution`,
        licenseReviewedAt: sql`excluded.license_reviewed_at`,
        sortOrder: sql`excluded.sort_order`,
        updatedAt: sql`now()`,
      },
    });

  console.log('[ImportPoseMaleCustom] Done');
  console.log(`  records: ${records.length}`);
  console.log(`  objects uploaded: ${uploaded}, already present: ${skipped}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[ImportPoseMaleCustom] Failed:', err);
    process.exit(1);
  });
