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
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import sharp from 'sharp';
import { aiTryOnReferences, aiTryOnReferenceKindEnum } from '@utils-plane/db';

/** 图库素材类别，与 DB 枚举 ai_try_on_reference_kind 一致。 */
type AiTryOnReferenceKind =
  (typeof aiTryOnReferenceKindEnum.enumValues)[number];

const logger = new Logger('SeedAiTryOnReferences');

/**
 * 把内置试衣参考图库 seed 到 DB（ai_try_on_references 表）+ MinIO 匿名只读桶。
 *
 * 与 seed-image-generate-presets.ts 同模式：DB seed 与 S3 上传分离、失败不阻塞启动。
 *
 * 许可边界（重要）：
 * - 内置素材全部由本脚本用 sharp 程序绘制（扁平剪影/平面图），是 100% 原创作品，
 *   以 CC0-1.0 发布，source/attribution 指向本项目；licenseReviewedAt 取下方常量。
 * - 不得把未核实可商用/再分发许可的第三方图片（例如开源仓库里的图库图片）加进
 *   BUILTIN_REFERENCES；没有可确认素材时把 BUILTIN_REFERENCES 留空即可，空图库
 *   不阻塞真实商品试穿流程（用户可上传人像和商品图）。
 * - 新增第三方授权素材时，必须补全 sourceUrl / licenseName / licenseUrl /
 *   attribution 并更新许可审查日期后再进 BUILTIN_REFERENCES。
 *
 * 脚本职责：
 *   1. 连 DB（postgres({max:1}) + drizzle，finally client.end()）。
 *   2. 连 S3，确保 try-on-references 桶存在 + 匿名 GetObject policy + CORS。
 *   3. 用 sharp 把内置 SVG 渲染成 PNG 原图 + 384px 宽缩略图，PutObject 到桶。
 *   4. 按 slug upsert：ON CONFLICT (slug) DO UPDATE 刷新文案/存储 key/排序/许可字段，
 *      **不动 is_enabled**（后续后台禁用的内置素材 re-seed 后仍保持禁用）。
 *
 * 环境变量：
 *   DATABASE_URL
 *   S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_REGION / S3_FORCE_PATH_STYLE
 *   S3_TRY_ON_REFERENCES_BUCKET（默认 try-on-references）
 */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const THUMBNAIL_WIDTH = 384;

/** 内置素材的许可审查日期：原创素材随本脚本发布即完成审查。 */
const LICENSE_REVIEWED_AT = new Date('2026-11-02T00:00:00.000Z');
const SOURCE_URL = 'https://github.com/juzhiqiang/unitls-plane';
const LICENSE_NAME = 'CC0-1.0';
const LICENSE_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';
const ATTRIBUTION = 'Utils-Plane';

// ---------------------------------------------------------------------------
// 原创素材绘制（SVG → sharp 渲染 PNG）。风格：扁平剪影 + 中性色，无真实人物肖像，
// 避免任何肖像权争议；人像/姿势为无面中性剪影，服饰为平面示意图。
// ---------------------------------------------------------------------------

const BG = '#fafaf9';
const INK = '#292524';
const ACCENT_FILL = '#e0e7ff';
const ACCENT_LINE = '#4338ca';

function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${BG}"/>${body}</svg>`;
}

function capsule(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  color = INK
): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
}

/** 正面站立（A-pose）：人像与 A 字姿势共用。 */
function standingFront(): string {
  const W = 768;
  const H = 1152;
  const cx = 384;
  const parts: string[] = [
    `<circle cx="${cx}" cy="185" r="88" fill="${INK}"/>`,
    capsule(cx, 250, cx, 310, 44),
    // 躯干：肩→腰→胯
    `<path d="M ${cx - 102} 300 C ${cx - 118} 380 ${cx - 96} 470 ${cx - 78} 545 L ${cx - 92} 660 L ${cx + 92} 660 L ${cx + 78} 545 C ${cx + 96} 470 ${cx + 118} 380 ${cx + 102} 300 Z" fill="${INK}"/>`,
    // 手臂（A-pose，略微离体）
    capsule(cx - 108, 320, cx - 152, 480, 52),
    capsule(cx - 152, 480, cx - 172, 636, 48),
    capsule(cx + 108, 320, cx + 152, 480, 52),
    capsule(cx + 152, 480, cx + 172, 636, 48),
    // 腿
    capsule(cx - 44, 655, cx - 50, 860, 62),
    capsule(cx - 50, 860, cx - 54, 1060, 54),
    capsule(cx + 44, 655, cx + 50, 860, 62),
    capsule(cx + 50, 860, cx + 54, 1060, 54),
  ];
  return svg(W, H, parts.join(''));
}

/** 侧面站立：侧脸 + 体前下垂手臂 + 前后分立的腿。 */
function standingSide(): string {
  const W = 768;
  const H = 1152;
  const cx = 384;
  const parts: string[] = [
    // 侧脸（圆 + 鼻凸）
    `<circle cx="${cx - 8}" cy="185" r="88" fill="${INK}"/>`,
    `<path d="M ${cx + 70} 166 l 36 21 l -36 17 Z" fill="${INK}"/>`,
    capsule(cx - 8, 250, cx - 8, 312, 44),
    // 躯干侧面
    `<path d="M ${cx - 74} 300 C ${cx - 96} 380 ${cx - 88} 470 ${cx - 74} 545 L ${cx - 80} 660 L ${cx + 66} 660 L ${cx + 72} 545 C ${cx + 92} 470 ${cx + 100} 380 ${cx + 82} 300 Z" fill="${INK}"/>`,
    // 手臂自然下垂（体前）
    capsule(cx + 40, 322, cx + 66, 480, 50),
    capsule(cx + 66, 480, cx + 58, 634, 46),
    // 前后腿
    capsule(cx - 34, 655, cx - 30, 860, 60),
    capsule(cx - 30, 860, cx - 22, 1058, 52),
    capsule(cx + 40, 655, cx + 52, 860, 60),
    capsule(cx + 52, 860, cx + 66, 1058, 52),
  ];
  return svg(W, H, parts.join(''));
}

/** T 字姿势：手臂水平展开。 */
function poseT(): string {
  const W = 768;
  const H = 1152;
  const cx = 384;
  const parts: string[] = [
    `<circle cx="${cx}" cy="185" r="88" fill="${INK}"/>`,
    capsule(cx, 250, cx, 310, 44),
    `<path d="M ${cx - 96} 300 C ${cx - 112} 380 ${cx - 92} 470 ${cx - 76} 545 L ${cx - 88} 660 L ${cx + 88} 660 L ${cx + 76} 545 C ${cx + 92} 470 ${cx + 112} 380 ${cx + 96} 300 Z" fill="${INK}"/>`,
    capsule(cx - 96, 318, cx - 236, 318, 50),
    capsule(cx + 96, 318, cx + 236, 318, 50),
    capsule(cx - 42, 655, cx - 48, 860, 62),
    capsule(cx - 48, 860, cx - 52, 1060, 54),
    capsule(cx + 42, 655, cx + 48, 860, 62),
    capsule(cx + 48, 860, cx + 52, 1060, 54),
  ];
  return svg(W, H, parts.join(''));
}

/** 行走姿势：前后迈步 + 摆臂。 */
function poseWalk(): string {
  const W = 768;
  const H = 1152;
  const cx = 384;
  const parts: string[] = [
    `<circle cx="${cx}" cy="185" r="88" fill="${INK}"/>`,
    capsule(cx, 250, cx, 310, 44),
    `<path d="M ${cx - 98} 300 C ${cx - 114} 380 ${cx - 94} 470 ${cx - 78} 545 L ${cx - 90} 660 L ${cx + 90} 660 L ${cx + 78} 545 C ${cx + 94} 470 ${cx + 114} 380 ${cx + 98} 300 Z" fill="${INK}"/>`,
    capsule(cx - 100, 322, cx - 148, 470, 50),
    capsule(cx - 148, 470, cx - 96, 610, 46),
    capsule(cx + 100, 322, cx + 152, 470, 50),
    capsule(cx + 152, 470, cx + 190, 606, 46),
    capsule(cx - 40, 655, cx - 96, 850, 62),
    capsule(cx - 96, 850, cx - 128, 1050, 54),
    capsule(cx + 44, 655, cx + 92, 850, 62),
    capsule(cx + 92, 850, cx + 118, 1050, 54),
  ];
  return svg(W, H, parts.join(''));
}

/** T 恤平面图。 */
function garmentTshirt(): string {
  const W = 768;
  const H = 768;
  const cx = 384;
  const d = `M ${cx} 196
    C ${cx - 26} 166 ${cx - 46} 156 ${cx - 66} 154
    L ${cx - 140} 176
    L ${cx - 196} 272
    L ${cx - 122} 306
    L ${cx - 158} 240
    L ${cx - 152} 646
    L ${cx + 152} 646
    L ${cx + 158} 240
    L ${cx + 122} 306
    L ${cx + 196} 272
    L ${cx + 140} 176
    L ${cx + 66} 154
    C ${cx + 46} 156 ${cx + 26} 166 ${cx} 196 Z`;
  return svg(
    W,
    H,
    `<path d="${d}" fill="${ACCENT_FILL}" stroke="${ACCENT_LINE}" stroke-width="8" stroke-linejoin="round"/>
     <path d="M ${cx - 66} 154 C ${cx - 26} 166 ${cx - 26} 166 ${cx} 196 C ${cx + 26} 166 ${cx + 46} 166 ${cx + 66} 154" fill="none" stroke="${ACCENT_LINE}" stroke-width="8" stroke-linecap="round"/>`
  );
}

/** 连衣裙平面图（A 字裙型）。 */
function garmentDress(): string {
  const W = 768;
  const H = 768;
  const cx = 384;
  const d = `M ${cx} 210
    C ${cx - 24} 182 ${cx - 44} 172 ${cx - 64} 170
    L ${cx - 128} 190
    L ${cx - 150} 262
    L ${cx - 108} 286
    L ${cx - 128} 236
    L ${cx - 120} 430
    L ${cx - 250} 680
    L ${cx + 250} 680
    L ${cx + 120} 430
    L ${cx + 128} 236
    L ${cx + 108} 286
    L ${cx + 150} 262
    L ${cx + 128} 190
    L ${cx + 64} 170
    C ${cx + 44} 172 ${cx + 24} 182 ${cx} 210 Z`;
  return svg(
    W,
    H,
    `<path d="${d}" fill="${ACCENT_FILL}" stroke="${ACCENT_LINE}" stroke-width="8" stroke-linejoin="round"/>
     <line x1="${cx - 120}" y1="430" x2="${cx + 120}" y2="430" stroke="${ACCENT_LINE}" stroke-width="6"/>`
  );
}

/** 长裤平面图。 */
function garmentTrousers(): string {
  const W = 768;
  const H = 768;
  const cx = 384;
  const d = `M ${cx - 104} 150
    L ${cx + 104} 150
    L ${cx + 112} 214
    L ${cx + 92} 640
    L ${cx + 22} 640
    L ${cx + 10} 330
    L ${cx - 10} 330
    L ${cx - 22} 640
    L ${cx - 92} 640
    L ${cx - 112} 214 Z`;
  return svg(
    W,
    H,
    `<path d="${d}" fill="${ACCENT_FILL}" stroke="${ACCENT_LINE}" stroke-width="8" stroke-linejoin="round"/>
     <line x1="${cx - 112}" y1="214" x2="${cx + 112}" y2="214" stroke="${ACCENT_LINE}" stroke-width="6"/>
     <line x1="${cx}" y1="214" x2="${cx}" y2="330" stroke="${ACCENT_LINE}" stroke-width="6"/>`
  );
}

/** 外套平面图（翻领 + 前中开襟）。 */
function garmentJacket(): string {
  const W = 768;
  const H = 768;
  const cx = 384;
  const d = `M ${cx} 200
    C ${cx - 26} 170 ${cx - 46} 160 ${cx - 66} 158
    L ${cx - 140} 180
    L ${cx - 196} 276
    L ${cx - 122} 310
    L ${cx - 158} 244
    L ${cx - 152} 650
    L ${cx - 8} 650
    L ${cx - 8} 330
    L ${cx + 8} 330
    L ${cx + 8} 650
    L ${cx + 152} 650
    L ${cx + 158} 244
    L ${cx + 122} 310
    L ${cx + 196} 276
    L ${cx + 140} 180
    L ${cx + 66} 158
    C ${cx + 46} 160 ${cx + 26} 170 ${cx} 200 Z`;
  return svg(
    W,
    H,
    `<path d="${d}" fill="${ACCENT_FILL}" stroke="${ACCENT_LINE}" stroke-width="8" stroke-linejoin="round"/>
     <path d="M ${cx - 66} 158 L ${cx - 8} 330 L ${cx} 200 L ${cx + 8} 330 L ${cx + 66} 158" fill="none" stroke="${ACCENT_LINE}" stroke-width="8" stroke-linejoin="round"/>`
  );
}

// ---------------------------------------------------------------------------
// 内置素材清单。全部原创（脚本绘制）+ CC0；source/attribution 指向本项目。
// 新增第三方素材前必须先完成许可审查并补全下列字段。
// ---------------------------------------------------------------------------

interface BuiltinReference {
  slug: string;
  kind: AiTryOnReferenceKind;
  titleZh: string;
  titleEn: string;
  descriptionZh: string;
  descriptionEn: string;
  tags: string[];
  assetKey: string;
  svg: string;
  sortOrder: number;
}

const BUILTIN_REFERENCES: BuiltinReference[] = [
  {
    slug: 'person-front-standing',
    kind: 'person',
    titleZh: '正面站姿人像',
    titleEn: 'Front-standing model',
    descriptionZh: '中性无面剪影，正面自然站姿，适合作为试衣人像基准。',
    descriptionEn:
      'Faceless neutral silhouette, front standing pose, ideal as the try-on person baseline.',
    tags: ['frontal', 'standing', 'full-body'],
    assetKey: 'person/front.png',
    svg: standingFront(),
    sortOrder: 0,
  },
  {
    slug: 'person-side-standing',
    kind: 'person',
    titleZh: '侧面站姿人像',
    titleEn: 'Side-standing model',
    descriptionZh: '侧面视角剪影，用于观察服装侧面轮廓与版型。',
    descriptionEn:
      'Side-view silhouette for checking garment side profile and fit.',
    tags: ['side', 'standing', 'full-body'],
    assetKey: 'person/side.png',
    svg: standingSide(),
    sortOrder: 1,
  },
  {
    slug: 'pose-a-standing',
    kind: 'pose',
    titleZh: 'A 字站姿',
    titleEn: 'A-pose standing',
    descriptionZh: '双臂微张的 A 字站姿，电商展示最常用的稳定姿势。',
    descriptionEn:
      'A-pose with slightly open arms, the most common stable e-commerce stance.',
    tags: ['a-pose', 'standing'],
    assetKey: 'pose/a.png',
    svg: standingFront(),
    sortOrder: 0,
  },
  {
    slug: 'pose-t-standing',
    kind: 'pose',
    titleZh: 'T 字站姿',
    titleEn: 'T-pose standing',
    descriptionZh: '双臂水平展开的 T 字姿势，适合完整展示服装上身效果。',
    descriptionEn:
      'T-pose with horizontal arms, best for showing the full upper garment.',
    tags: ['t-pose', 'standing'],
    assetKey: 'pose/t.png',
    svg: poseT(),
    sortOrder: 1,
  },
  {
    slug: 'pose-walking',
    kind: 'pose',
    titleZh: '行走姿势',
    titleEn: 'Walking pose',
    descriptionZh: '自然行走动态，适合场景化展示与街拍风格生成。',
    descriptionEn:
      'Natural walking motion for lifestyle and street-style looks.',
    tags: ['walking', 'motion'],
    assetKey: 'pose/walk.png',
    svg: poseWalk(),
    sortOrder: 2,
  },
  {
    slug: 'garment-tshirt-flat',
    kind: 'garment',
    titleZh: 'T 恤平面图',
    titleEn: 'T-shirt flat',
    descriptionZh: '基础款 T 恤平面示意图，灵感模式目标服饰。',
    descriptionEn:
      'Basic T-shirt flat sketch, an inspiration-mode target garment.',
    tags: ['t-shirt', 'top', 'casual'],
    assetKey: 'garment/tshirt.png',
    svg: garmentTshirt(),
    sortOrder: 0,
  },
  {
    slug: 'garment-dress-flat',
    kind: 'garment',
    titleZh: '连衣裙平面图',
    titleEn: 'Dress flat',
    descriptionZh: 'A 字连衣裙平面示意图，灵感模式目标服饰。',
    descriptionEn:
      'A-line dress flat sketch, an inspiration-mode target garment.',
    tags: ['dress', 'one-piece'],
    assetKey: 'garment/dress.png',
    svg: garmentDress(),
    sortOrder: 1,
  },
  {
    slug: 'garment-trousers-flat',
    kind: 'garment',
    titleZh: '长裤平面图',
    titleEn: 'Trousers flat',
    descriptionZh: '直筒长裤平面示意图，灵感模式目标服饰。',
    descriptionEn:
      'Straight-leg trousers flat sketch, an inspiration-mode target garment.',
    tags: ['trousers', 'bottom'],
    assetKey: 'garment/trousers.png',
    svg: garmentTrousers(),
    sortOrder: 2,
  },
  {
    slug: 'garment-jacket-flat',
    kind: 'garment',
    titleZh: '外套平面图',
    titleEn: 'Jacket flat',
    descriptionZh: '翻领外套平面示意图，灵感模式目标服饰。',
    descriptionEn:
      'Lapel jacket flat sketch, an inspiration-mode target garment.',
    tags: ['jacket', 'outerwear'],
    assetKey: 'garment/jacket.png',
    svg: garmentJacket(),
    sortOrder: 3,
  },
];

function thumbnailKeyFor(assetKey: string): string {
  return `thumbnails/${assetKey}`;
}

// ---------------------------------------------------------------------------
// S3：建桶 + 匿名只读 policy + CORS（与 presets 桶一致）。
// ---------------------------------------------------------------------------

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    logger.log(`Bucket ${bucket} already exists`);
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    logger.log(`Created bucket ${bucket}`);
  }

  // 匿名只读策略(允许前端公开拉取图库缩略图)
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
    // 非 MinIO 后端可能不支持匿名策略,不阻塞
    logger.warn(`Bucket policy set skipped: ${(err as Error).message}`);
  }

  // CORS 配置(浏览器跨域拉取缩略图必须)
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

/** 渲染原图 + 缩略图并上传。渲染失败（如运行时不支持 SVG）跳过该素材。 */
async function uploadAsset(
  client: S3Client,
  bucket: string,
  reference: BuiltinReference
): Promise<boolean> {
  let asset: Buffer;
  let thumbnail: Buffer;
  try {
    asset = await sharp(Buffer.from(reference.svg)).png().toBuffer();
    thumbnail = await sharp(Buffer.from(reference.svg))
      .resize(THUMBNAIL_WIDTH)
      .png()
      .toBuffer();
  } catch (err) {
    logger.warn(
      `Render failed for ${reference.slug} (SVG unsupported?): ${(err as Error).message} — skipping`
    );
    return false;
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: reference.assetKey,
      Body: asset,
      ContentType: 'image/png',
      CacheControl: CACHE_CONTROL,
    })
  );
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: thumbnailKeyFor(reference.assetKey),
      Body: thumbnail,
      ContentType: 'image/png',
      CacheControl: CACHE_CONTROL,
    })
  );
  logger.log(`Synced ${reference.assetKey} (+ thumbnail) to ${bucket}`);
  return true;
}

async function upsertReferences(
  databaseUrl: string,
  bucket: string,
  references: BuiltinReference[]
): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    for (const reference of references) {
      await db
        .insert(aiTryOnReferences)
        .values({
          slug: reference.slug,
          kind: reference.kind,
          titleZh: reference.titleZh,
          titleEn: reference.titleEn,
          descriptionZh: reference.descriptionZh,
          descriptionEn: reference.descriptionEn,
          tags: reference.tags,
          assetBucket: bucket,
          assetStorageKey: reference.assetKey,
          thumbnailBucket: bucket,
          thumbnailStorageKey: thumbnailKeyFor(reference.assetKey),
          sourceUrl: SOURCE_URL,
          licenseName: LICENSE_NAME,
          licenseUrl: LICENSE_URL,
          attribution: ATTRIBUTION,
          licenseReviewedAt: LICENSE_REVIEWED_AT,
          sortOrder: reference.sortOrder,
        })
        .onConflictDoUpdate({
          target: aiTryOnReferences.slug,
          set: {
            titleZh: reference.titleZh,
            titleEn: reference.titleEn,
            descriptionZh: reference.descriptionZh,
            descriptionEn: reference.descriptionEn,
            tags: reference.tags,
            assetBucket: bucket,
            assetStorageKey: reference.assetKey,
            thumbnailBucket: bucket,
            thumbnailStorageKey: thumbnailKeyFor(reference.assetKey),
            sourceUrl: SOURCE_URL,
            licenseName: LICENSE_NAME,
            licenseUrl: LICENSE_URL,
            attribution: ATTRIBUTION,
            licenseReviewedAt: LICENSE_REVIEWED_AT,
            sortOrder: reference.sortOrder,
            updatedAt: sql`now()`,
            // 注意:刻意不刷新 is_enabled —— 后台将来禁用的内置素材 re-seed 后仍保持禁用。
          },
        });
      logger.log(`Upserted reference ${reference.slug}`);
    }
  } finally {
    await client.end();
  }
}

async function main(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  const endpoint = process.env.S3_ENDPOINT;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  const region = process.env.S3_REGION ?? 'us-east-1';
  const bucket = process.env.S3_TRY_ON_REFERENCES_BUCKET ?? 'try-on-references';

  if (!databaseUrl) {
    logger.warn('DATABASE_URL not set, skipping seed');
    return 0;
  }
  if (!endpoint) {
    logger.warn('S3_ENDPOINT not set, skipping seed');
    return 0;
  }

  const client = new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId: accessKey || 'minioadmin',
      secretAccessKey: secretKey || 'minioadmin',
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });

  try {
    await ensureBucket(client, bucket);

    // 空清单是合法状态:没有可确认许可的素材时允许空图库,
    // 真实商品试穿不依赖图库(用户上传人像 + 商品图)。
    const uploaded: BuiltinReference[] = [];
    for (const reference of BUILTIN_REFERENCES) {
      try {
        const ok = await uploadAsset(client, bucket, reference);
        if (ok) uploaded.push(reference);
      } catch (err) {
        // 单个素材上传失败不阻塞其余素材;下次重启重试。
        logger.warn(
          `Upload failed for ${reference.slug}: ${(err as Error).message}`
        );
      }
    }

    // 只 upsert 上传成功的素材:DB 行与存储对象保持一致,
    // 避免列表出现缩略图 404、生成时原图缺失。
    await upsertReferences(databaseUrl, bucket, uploaded);
    logger.log(
      `Seed complete: ${uploaded.length}/${BUILTIN_REFERENCES.length} builtin references present`
    );
    return 0;
  } catch (err) {
    logger.error(`Seed failed: ${(err as Error).message}`);
    return 0; // 不阻塞启动
  }
}

main()
  .then(code => process.exit(code))
  .catch(() => process.exit(0));
