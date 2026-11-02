// 必须是第一个 import:加载仓库根目录 .env.local(详见 env-loader 注释)。
import '../env-loader';

import { Logger } from '@nestjs/common';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { sql } from 'drizzle-orm';
import { aiTryOnReferences, db } from '@utils-plane/db';
import {
  COSTUME_VISIBILITY_MAP,
  FALLBACK_VOCABULARY,
  buildCostumeCandidates,
  type AiTryOnReferenceVisibility,
  type CostumeMetadataEntry,
  type CostumeSyncCandidate,
  type CostumeVocabulary,
} from './costume-sync';

const logger = new Logger('SeedAiTryOnCostumes');

/**
 * 把上游「写实服饰」参考图同步进图库(ai_try_on_references 表 + MinIO 匿名只读桶)。
 *
 * 与 seed-ai-try-on-references.ts 的分工:那个脚本放项目自绘的原创素材(CC0),
 * 本脚本放经授权的第三方素材。两者写同一张表、同一个桶,但 storage key 前缀不同
 * (原创用 garment/、上游用 costume/),互不覆盖。
 *
 * 素材来源与许可(如实记录,详见上游 SOURCES.md):
 *   - 元数据:open-pose-costume 仓库 data/source/costume.json
 *   - 图片:ai-costume-gallery.pages.dev(作者 ギア / @giaaibusi)
 *   - 原站条款:作品制作可无偿利用(含商用/编辑/参考),禁止图片数据本身再分发/转载/转售
 *   - 仓库维护者 2026-10-30 确认取得原作者对其仓库公开再分发的额外授权;
 *     该授权不自动覆盖下游,本项目依据自身取得的授权使用,许可字段按来源记录填写,
 *     拿到正式授权凭证后应更新 license_name / license_url。
 *
 * 幂等:按 slug upsert;已在库(启用中)的 slug 直接跳过,不重复下载——
 * 全量约 1400 套、1GB 上下,中断后重跑只补差额。
 *
 * 失败不阻塞启动(与其它 seed 一致):单套下载/上传失败只跳过该套,下次重跑补。
 *
 * 环境变量:
 *   DATABASE_URL
 *   S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_REGION / S3_FORCE_PATH_STYLE
 *   S3_TRY_ON_REFERENCES_BUCKET(默认 try-on-references)
 *   COSTUME_METADATA_URL(默认上游 costume.json)
 *   COSTUME_VOCABULARY_URL(默认上游 vocabulary.json)
 *   COSTUME_IMAGE_BASE_URL(默认 https://ai-costume-gallery.pages.dev)
 *   COSTUME_SYNC_CATEGORIES(日文分类,逗号分隔;空 = 全部)
 *   COSTUME_SYNC_LIMIT(最多多少套,0 = 不限)
 *   COSTUME_SYNC_CONCURRENCY(默认 4)
 *   COSTUME_SYNC_MAX_BYTES(单图字节上限,默认 12MB)
 *   COSTUME_SYNC_VISIBILITY_OVERRIDES(覆盖分类可见性,如 "ランジェリー=public")
 *   COSTUME_SOURCE_URL(许可记录里的来源页,默认上游站根)
 *
 * 可见性:默认 春夏秋冬/派对 → public,内衣/泳装 → hidden,性感 → adult
 * (策略见 docs/ai-try-on/AI_TRYON_ADULT_CONTENT_MANAGEMENT.md);API 只返
 * public,其余保留在 MinIO 但不进列表、也不能被生成任务解析。
 */

const DEFAULT_METADATA_URL =
  'https://raw.githubusercontent.com/hongye007/open-pose-costume/main/data/source/costume.json';
const DEFAULT_VOCABULARY_URL =
  'https://raw.githubusercontent.com/hongye007/open-pose-costume/main/data/vocabulary.json';
const DEFAULT_IMAGE_BASE_URL = 'https://ai-costume-gallery.pages.dev';
const DEFAULT_SOURCE_URL = 'https://ai-costume-gallery.pages.dev/';
const LICENSE_RECORD_URL =
  'https://raw.githubusercontent.com/hongye007/open-pose-costume/main/SOURCES.md';
const ATTRIBUTION = 'ギア (@giaaibusi)';
const LICENSE_NAME =
  '原作者授权再分发(授权记录见 open-pose-costume SOURCES.md)';
const UPSERT_CHUNK = 50;
/** 排在原创种子(0 起)与男性姿势(20000 起)之后,互不打乱。 */
const SORT_ORDER_BASE = 30000;

const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const FETCH_TIMEOUT_MS = 30_000;
const DOWNLOAD_ATTEMPTS = 3;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

/**
 * 解析 COSTUME_SYNC_VISIBILITY_OVERRIDES:"ランジェリー=public,水着=public"。
 * 非法值忽略并告警,不静默改成 public。
 */
function parseVisibilityOverrides(
  raw: string | undefined
): Record<string, AiTryOnReferenceVisibility> {
  const overrides: Record<string, AiTryOnReferenceVisibility> = {};
  if (!raw) return overrides;
  for (const pair of raw.split(',')) {
    const [category, value] = pair.split('=').map(part => part?.trim());
    if (!category || !value) continue;
    if (
      value === 'public' ||
      value === 'hidden' ||
      value === 'adult' ||
      value === 'intimate'
    ) {
      overrides[category] = value;
    } else {
      logger.warn(
        `Ignoring invalid visibility "${value}" for category ${category}`
      );
    }
  }
  return overrides;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: globalThis.AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status}`);
  }
  return (await response.json()) as T;
}

async function fetchBuffer(url: string, maxBytes: number): Promise<Buffer> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: globalThis.AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (declared > maxBytes) {
        throw new Error(`declared ${declared} bytes exceeds ${maxBytes}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) {
        throw new Error(
          `downloaded ${buffer.length} bytes exceeds ${maxBytes}`
        );
      }
      return buffer;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < DOWNLOAD_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  throw lastError ?? new Error(`download failed: ${url}`);
}

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    logger.log(`Bucket ${bucket} already exists`);
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    logger.log(`Created bucket ${bucket}`);
  }

  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: '*',
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  };
  try {
    await client.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify(policy),
      })
    );
    logger.log(`Anonymous read policy set on ${bucket}`);
  } catch (err) {
    logger.warn(`Bucket policy set skipped: ${(err as Error).message}`);
  }

  const corsRules = {
    CORSRules: [
      {
        AllowedOrigins: ['*'],
        AllowedMethods: ['GET', 'HEAD'],
        AllowedHeaders: ['*'],
        ExposeHeaders: [
          'Content-Length',
          'Content-Type',
          'ETag',
          'Cache-Control',
        ],
        MaxAgeSeconds: 86400,
      },
    ],
  };
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: corsRules,
      })
    );
    logger.log(`CORS rules set on ${bucket}`);
  } catch (err) {
    logger.warn(`CORS config set skipped: ${(err as Error).message}`);
  }
}

/** 简易并发池:失败不中断其它任务。 */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index] as T);
      }
    }
  );
  await Promise.all(runners);
}

async function main(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  const endpoint = process.env.S3_ENDPOINT;
  if (!databaseUrl) {
    logger.warn('DATABASE_URL not set, skipping costume sync');
    return 0;
  }
  if (!endpoint) {
    logger.warn('S3_ENDPOINT not set, skipping costume sync');
    return 0;
  }

  const bucket = process.env.S3_TRY_ON_REFERENCES_BUCKET ?? 'try-on-references';
  const metadataUrl = process.env.COSTUME_METADATA_URL ?? DEFAULT_METADATA_URL;
  const vocabularyUrl =
    process.env.COSTUME_VOCABULARY_URL ?? DEFAULT_VOCABULARY_URL;
  const imageBaseUrl =
    process.env.COSTUME_IMAGE_BASE_URL ?? DEFAULT_IMAGE_BASE_URL;
  const sourceUrl = process.env.COSTUME_SOURCE_URL ?? DEFAULT_SOURCE_URL;
  const categories = envList('COSTUME_SYNC_CATEGORIES');
  const limit = envInt('COSTUME_SYNC_LIMIT', 0);
  const concurrency = envInt('COSTUME_SYNC_CONCURRENCY', 4);
  const maxBytes = envInt('COSTUME_SYNC_MAX_BYTES', 12 * 1024 * 1024);

  const client = new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });

  try {
    // 元数据与译名表:译名表拉取失败用内置兜底,不中断。
    const entries = await fetchJson<CostumeMetadataEntry[]>(metadataUrl);
    if (!Array.isArray(entries)) {
      logger.warn(`Metadata at ${metadataUrl} is not an array, skipping`);
      return 0;
    }
    let vocabulary: CostumeVocabulary = FALLBACK_VOCABULARY;
    try {
      vocabulary = await fetchJson<CostumeVocabulary>(vocabularyUrl);
    } catch (err) {
      logger.warn(
        `Vocabulary fetch failed (${(err as Error).message}), using fallback labels`
      );
    }

    const candidates = buildCostumeCandidates(entries, {
      baseUrl: imageBaseUrl,
      vocabulary,
      categories,
      limit,
      visibilityMap: {
        ...COSTUME_VISIBILITY_MAP,
        ...parseVisibilityOverrides(
          process.env.COSTUME_SYNC_VISIBILITY_OVERRIDES
        ),
      },
    });
    logger.log(
      `Candidates: ${candidates.length} (metadata entries: ${entries.length}, categories: ${categories.length > 0 ? categories.join('/') : 'all'}, limit: ${limit || 'none'})`
    );
    if (candidates.length === 0) return 0;

    await ensureBucket(client, bucket);

    // 已在库的启用中素材直接跳过:全量 1GB 上下,重跑只补差额。
    const rows = await db
      .select({ slug: aiTryOnReferences.slug })
      .from(aiTryOnReferences)
      .where(sql`${aiTryOnReferences.isEnabled} = true`);
    const existing = new Set(rows.map(row => row.slug));
    logger.log(`Already present (enabled): ${existing.size}`);

    const pending = candidates.filter(
      candidate => !existing.has(candidate.slug)
    );
    logger.log(`To sync: ${pending.length}`);

    const synced: CostumeSyncCandidate[] = [];
    let failed = 0;
    await runPool(pending, concurrency, async candidate => {
      try {
        const [thumbnail, image] = await Promise.all([
          fetchBuffer(candidate.thumbnailSourceUrl, maxBytes),
          fetchBuffer(candidate.imageSourceUrl, maxBytes),
        ]);
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: candidate.thumbnailKey,
            Body: thumbnail,
            ContentType: 'image/webp',
            CacheControl: CACHE_CONTROL,
          })
        );
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: candidate.assetKey,
            Body: image,
            ContentType: 'image/png',
            CacheControl: CACHE_CONTROL,
          })
        );
        synced.push(candidate);
      } catch (error) {
        failed += 1;
        // 不打印完整 URL 之外的细节;失败套次跳过,下次重跑补。
        logger.warn(
          `Sync failed for ${candidate.slug}: ${error instanceof Error ? error.message : 'unknown'}`
        );
      }
    });

    logger.log(`Uploaded: ${synced.length}, failed: ${failed}`);

    // 只 upsert 上传成功的:DB 行与存储对象保持一致。
    // sortOrder 从 30000 起:原创种子占 0 起,男性姿势占 20000 起,互不打乱。
    const licenseReviewedAt = new Date();
    for (let start = 0; start < synced.length; start += UPSERT_CHUNK) {
      const chunk = synced.slice(start, start + UPSERT_CHUNK);
      await db
        .insert(aiTryOnReferences)
        .values(
          chunk.map((candidate, offset) => ({
            slug: candidate.slug,
            kind: 'garment' as const,
            visibility: candidate.visibility,
            titleZh: candidate.titleZh,
            titleEn: candidate.titleEn,
            descriptionZh: candidate.descriptionZh,
            descriptionEn: candidate.descriptionEn,
            tags: candidate.tags,
            assetBucket: bucket,
            assetStorageKey: candidate.assetKey,
            thumbnailBucket: bucket,
            thumbnailStorageKey: candidate.thumbnailKey,
            sourceUrl,
            licenseName: LICENSE_NAME,
            licenseUrl: LICENSE_RECORD_URL,
            attribution: ATTRIBUTION,
            licenseReviewedAt,
            sortOrder: SORT_ORDER_BASE + start + offset,
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
            assetBucket: sql`excluded.asset_bucket`,
            assetStorageKey: sql`excluded.asset_storage_key`,
            thumbnailBucket: sql`excluded.thumbnail_bucket`,
            thumbnailStorageKey: sql`excluded.thumbnail_storage_key`,
            sourceUrl: sql`excluded.source_url`,
            licenseName: sql`excluded.license_name`,
            licenseUrl: sql`excluded.license_url`,
            attribution: sql`excluded.attribution`,
            licenseReviewedAt: sql`excluded.license_reviewed_at`,
            sortOrder: sql`excluded.sort_order`,
            updatedAt: sql`now()`,
            // 注意:刻意不刷新 is_enabled —— 后台将来禁用的素材重跑后仍保持禁用。
          },
        });
    }

    logger.log(
      `Costume sync complete: ${synced.length} rows upserted, ${failed} skipped`
    );
    return 0;
  } catch (err) {
    logger.error(`Costume sync failed: ${(err as Error).message}`);
    return 0; // 不阻塞启动
  }
}

main()
  .then(code => process.exit(code))
  .catch(() => process.exit(0));
