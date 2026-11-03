/**
 * 导入 Open Pose & Costume 自建人物参考到试衣参考图库
 *
 * 来源：https://github.com/hongye007/open-pose-costume 的 `data/custom/character.json`
 * 两类条目：
 *   - 多地区人物参考 22 条（RCF-001 ~ RCF-022，11 个地区 × 男女），带性别与地区标签；
 *   - 男性风格参考 6 条（MCF-001 ~ MCF-006），只有性别、没有地区。
 *
 * 授权说明：
 * - 这批素材属于该仓库的「自建素材」，默认条款禁止商用与再分发；
 * - 本项目已取得维护者单独授权后才导入，`license_name` 标注为单独授权，
 *   `license_reviewed_at` 记录导入时的审查时间，满足图库「许可四项齐全」的放行要求。
 * - 与 import-pose-male-custom.ts / import-costume-custom.ts 是同一批素材、同一份授权，
 *   许可字段保持一致。
 *
 * 地区特征的边界：上游明确「国家仅为编辑分组，不推定真实国籍或代表性外貌」。
 * 因此地区只作编辑分组标签，描述里固定带上该免责声明，且不从地区反推外观属性。
 *
 * 处理流程：
 * 1. 拉取 `data/custom/character.json`；
 * 2. 下载每个变体的 PNG 原图与 WebP 缩略图，上传到 MinIO（已存在的对象跳过）；
 * 3. 以 slug 为键 upsert 数据库记录（重复执行只刷新元数据，不改 is_enabled）。
 *
 * storage key 走 `person/custom/` 前缀，与原创种子的 `person/` 分开——许可来源不同。
 *
 * 运行：
 *   cd apps/api
 *   bun --env-file=../../.env.local run src/scripts/import-character-custom.ts
 *
 * 可选环境变量（镜像/离线场景）：
 *   CHARACTER_MALE_RAW_BASE      图片下载 base，默认上游 raw 域名
 *   CHARACTER_METADATA_URL       元数据地址，默认上游 data/custom/character.json
 */

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { db, aiTryOnReferences } from '@utils-plane/db';
import { sql } from 'drizzle-orm';
import {
  buildCharacterRecords,
  type CustomCharacter,
} from './character-custom-sync';

const REPO_RAW_BASE =
  process.env.CHARACTER_RAW_BASE ??
  'https://raw.githubusercontent.com/hongye007/open-pose-costume/main';
const CHARACTER_JSON_URL =
  process.env.CHARACTER_METADATA_URL ??
  `${REPO_RAW_BASE}/data/custom/character.json`;
const SOURCE_URL = 'https://github.com/hongye007/open-pose-costume';
const LICENSE_NAME = 'Open Pose & Costume 自建素材（已获维护者单独授权）';
const LICENSE_URL = `${SOURCE_URL}/blob/main/public/custom/LICENSE.txt`;
const ATTRIBUTION = 'Open Pose & Costume (hongye007)';

const BUCKET = process.env.S3_TRY_ON_REFERENCES_BUCKET || 'try-on-references';
/** 男装 100 起、男性姿势 20000 起、自建女装 25000 起、上游服饰 30000 起，这里取 50000。 */
const SORT_ORDER_BASE = 50000;

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
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );
  return 'uploaded';
}

async function main() {
  console.log(`[ImportCharacterCustom] Fetching ${CHARACTER_JSON_URL}`);
  const characters = (await (
    await fetch(CHARACTER_JSON_URL)
  ).json()) as CustomCharacter[];
  const records = buildCharacterRecords(characters, {
    sortOrderBase: SORT_ORDER_BASE,
  });

  if (records.length === 0) {
    console.warn(
      '[ImportCharacterCustom] No usable character variants found — nothing to import'
    );
    return;
  }

  const withRegion = records.filter(r => r.record.tags?.includes('多地区'));
  const male = records.filter(r => r.record.tags?.includes('male'));
  const female = records.filter(r => r.record.tags?.includes('female'));
  console.log(
    `[ImportCharacterCustom] ${records.length} character views ` +
      `(regional: ${withRegion.length}, male: ${male.length}, female: ${female.length})`
  );

  const reviewedAt = new Date();
  let uploaded = 0;
  let skipped = 0;
  let index = 0;

  for (const entry of records) {
    index += 1;
    // 下载用仓库内相对路径,落库用 person/custom/ 前缀的 storage key,两者不同。
    const results = await Promise.all([
      ensureUploaded(
        entry.record.assetStorageKey,
        entry.originalPath,
        'image/png'
      ),
      ensureUploaded(
        entry.record.thumbnailStorageKey,
        entry.thumbnailPath,
        'image/webp'
      ),
    ]);
    for (const r of results) {
      if (r === 'uploaded') uploaded++;
      else skipped++;
    }
    console.log(
      `  [${index}/${records.length}] ${entry.record.slug} ${results.join('/')}`
    );
  }

  console.log(`[ImportCharacterCustom] Upserting ${records.length} records...`);
  await db
    .insert(aiTryOnReferences)
    .values(
      records.map(entry => ({
        ...entry.record,
        assetBucket: BUCKET,
        thumbnailBucket: BUCKET,
        sourceUrl: SOURCE_URL,
        licenseName: LICENSE_NAME,
        licenseUrl: LICENSE_URL,
        attribution: ATTRIBUTION,
        licenseReviewedAt: reviewedAt,
        isEnabled: true,
      }))
    )
    .onConflictDoUpdate({
      target: aiTryOnReferences.slug,
      set: {
        visibility: sql`excluded.visibility`,
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

  console.log('[ImportCharacterCustom] Done');
  console.log(`  records: ${records.length}`);
  console.log(`  objects uploaded: ${uploaded}, already present: ${skipped}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[ImportCharacterCustom] Failed:', err);
    process.exit(1);
  });
