/**
 * 导入 Open Pose & Costume 自建服饰（含男士服饰 MC-001 ~ MC-004 及自建女士服饰）到试衣参考图库，
 * 并为存量上游女装（costume-*）补齐女性标签。
 *
 * 来源：https://github.com/hongye007/open-pose-costume 的 `data/custom/costume.json`
 *
 * 运行：
 *   cd apps/api
 *   bun --env-file=../../.env.local run src/scripts/import-costume-custom.ts
 */

import '../env-loader';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { aiTryOnReferences, db } from '@utils-plane/db';
import { sql } from 'drizzle-orm';

const REPO_RAW_BASE =
  'https://raw.githubusercontent.com/hongye007/open-pose-costume/main';
const COSTUME_CUSTOM_JSON_URL = `${REPO_RAW_BASE}/data/custom/costume.json`;
const SOURCE_URL = 'https://github.com/hongye007/open-pose-costume';
const LICENSE_NAME = 'Open Pose & Costume 自建素材（已获维护者单独授权）';
const LICENSE_URL = `${SOURCE_URL}/blob/main/public/custom/LICENSE.txt`;
const ATTRIBUTION = 'Open Pose & Costume (hongye007)';

const BUCKET = process.env.S3_TRY_ON_REFERENCES_BUCKET || 'try-on-references';
/** 男装排在前面方便在男性分类或默认列表里快速看到，自建女装排在 25000 起 */
const MALE_SORT_ORDER_BASE = 100;
const FEMALE_CUSTOM_SORT_ORDER_BASE = 25000;

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

interface CustomCostumeVariant {
  id: string;
  angle: string;
  label: LocalizedText;
  original: string;
  image: string;
  thumbnail: string;
}

interface CustomCostumeEntry {
  id: string;
  code: string;
  title: LocalizedText;
  category: { id: string; zh: string; en: string };
  series: LocalizedText;
  keywords: LocalizedText;
  tags: Array<{ id: string; zh: string; en: string }>;
  variants: CustomCostumeVariant[];
}

function resolveVisibility(
  categoryId: string
): 'public' | 'hidden' | 'adult' | 'intimate' {
  if (categoryId === 'lingerie' || categoryId === 'swimwear') {
    return 'hidden';
  }
  if (categoryId === 'expressive-outfits') {
    return 'adult';
  }
  return 'public';
}

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

function fileName(path: string): string {
  return path.split('/').pop()!;
}

async function main() {
  console.log(`[ImportCostumeCustom] Fetching ${COSTUME_CUSTOM_JSON_URL}`);
  const entries = (await (
    await fetch(COSTUME_CUSTOM_JSON_URL)
  ).json()) as CustomCostumeEntry[];
  console.log(`[ImportCostumeCustom] Found ${entries.length} custom costumes`);

  const reviewedAt = new Date();
  const records: Array<typeof aiTryOnReferences.$inferInsert> = [];
  let uploaded = 0;
  let skipped = 0;
  let maleIndex = 0;
  let femaleIndex = 0;

  for (const item of entries) {
    const variant = item.variants[0];
    if (!variant) continue;

    const isMale = item.tags.some(t => t.id === 'male');
    const assetKey = `costume/${fileName(variant.original)}`;
    const thumbKey = `costume/thumbs/${fileName(variant.thumbnail)}`;

    const results = await Promise.all([
      ensureUploaded(assetKey, variant.original, 'image/png'),
      ensureUploaded(thumbKey, variant.thumbnail, 'image/webp'),
    ]);
    for (const r of results) {
      if (r === 'uploaded') uploaded++;
      else skipped++;
    }

    const keywordTagsZh = item.keywords.zh
      .split(/\s+/)
      .map(s => s.trim())
      .filter(Boolean);

    const tagList = Array.from(
      new Set([
        isMale ? 'male' : 'female',
        isMale ? '男性' : '女性',
        item.category.id,
        item.category.zh,
        ...item.tags.flatMap(t => [t.id, t.zh]),
        ...keywordTagsZh,
      ])
    );

    const sortOrder = isMale
      ? MALE_SORT_ORDER_BASE + ++maleIndex
      : FEMALE_CUSTOM_SORT_ORDER_BASE + ++femaleIndex;

    records.push({
      slug: `costume-${item.id.toLowerCase()}`,
      kind: 'garment',
      visibility: resolveVisibility(item.category.id),
      titleZh: `${item.title.zh} (${item.code})`,
      titleEn: `${item.title.en} (${item.code})`,
      descriptionZh: `${item.category.zh} · ${item.keywords.zh}`,
      descriptionEn: `${item.category.en} · ${item.keywords.en}`,
      tags: tagList,
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
      sortOrder,
    });
  }

  console.log(
    `[ImportCostumeCustom] Upserting ${records.length} custom costume records (male: ${maleIndex}, female: ${femaleIndex})...`
  );
  await db
    .insert(aiTryOnReferences)
    .values(records)
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

  // 为存量上游女装（slug 以 costume- 开头且不含 male 标签）补齐 'female' 和 '女性' 标签
  console.log(
    '[ImportCostumeCustom] Backfilling female tags on existing upstream garments...'
  );
  await db.execute(sql`
    UPDATE ai_try_on_references
    SET tags = array_cat(ARRAY['female', '女性']::text[], tags),
        updated_at = now()
    WHERE kind = 'garment'
      AND NOT ('male' = ANY(tags))
      AND NOT ('female' = ANY(tags))
  `);

  console.log('[ImportCostumeCustom] Done');
  console.log(`  records upserted: ${records.length}`);
  console.log(`  objects uploaded: ${uploaded}, already present: ${skipped}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[ImportCostumeCustom] Failed:', err);
    process.exit(1);
  });
