import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * 试衣参考图库素材类别。
 *
 * - `person`：人像参考（系统模特或用户上传人像的图库对应物）。
 * - `pose`：姿势参考。
 * - `garment`：服饰参考（灵感模式的目标服装，或 product 模式的弱优先级辅助 style）。
 */
export const aiTryOnReferenceKindEnum = pgEnum('ai_try_on_reference_kind', [
  'person',
  'pose',
  'garment',
]);

/**
 * 试衣参考图库素材可见性。
 *
 * - `public`：公开可用，前端图库可见。
 * - `hidden`：隐藏但保留，MinIO中保留文件，数据库有记录但API不返回。
 * - `adult`：成人内容，MinIO中保留并单独分类，数据库有记录但API不返回。
 * - `intimate`：亲密接触姿势，MinIO中保留并单独分类，数据库有记录但API不返回。
 */
export const aiTryOnReferenceVisibilityEnum = pgEnum('ai_try_on_reference_visibility', [
  'public',
  'hidden',
  'adult',
  'intimate',
]);

/**
 * AI 电商试衣参考图库。
 *
 * 与 image_generate_presets 同思路：DB 存元数据、MinIO 匿名只读桶存图片、
 * GET /tasks/ai-try-on/references 只读下发；后台 CRUD 留到后续。
 *
 * 关键约束：
 * - 许可字段（source_url / license_name / attribution / license_reviewed_at）可空，
 *   但列表与任务解析都要求四项齐全才放行——缺任何一项都视为「未审查」，fail closed。
 *   未核实可商用/再分发许可的素材不得进入本表，也不能用未授权开源仓库图片填充。
 * - 素材走 bucket/key 两列而非硬编码桶：图库桶与上传桶分离，换桶不改代码。
 * - 双语列：API 按 lang 查询参数取对应列拼成单语言扁平对象，前端零字段切换。
 * - visibility 控制前端可见性：只有 public 可见，其他分类保留在 MinIO 但 API 不返回。
 *
 * slug 是 upsert 键：re-seed 只刷新内置素材的文案/存储 key/排序，不动 is_enabled
 * （后续后台禁用的内置素材 re-seed 后仍保持禁用），也不允许外部行占用同一 slug。
 *
 * 排序：sort_order 升序、id 兜底稳定排序，与 presets 一致。
 */
export const aiTryOnReferences = pgTable(
  'ai_try_on_references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    kind: aiTryOnReferenceKindEnum('kind').notNull(),
    visibility: aiTryOnReferenceVisibilityEnum('visibility').notNull().default('public'),
    titleZh: text('title_zh').notNull(),
    titleEn: text('title_en').notNull(),
    descriptionZh: text('description_zh'),
    descriptionEn: text('description_en'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    assetBucket: text('asset_bucket').notNull(),
    assetStorageKey: text('asset_storage_key').notNull(),
    thumbnailBucket: text('thumbnail_bucket').notNull(),
    thumbnailStorageKey: text('thumbnail_storage_key').notNull(),
    sourceUrl: text('source_url'),
    licenseName: text('license_name'),
    licenseUrl: text('license_url'),
    attribution: text('attribution'),
    licenseReviewedAt: timestamp('license_reviewed_at'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  t => ({
    // 覆盖列表查询的 kind 过滤 + sort_order 排序。
    kindSortIdx: index('ai_try_on_references_kind_sort_idx').on(
      t.kind,
      t.sortOrder
    ),
  })
);

export type AiTryOnReference = typeof aiTryOnReferences.$inferSelect;
export type NewAiTryOnReference = typeof aiTryOnReferences.$inferInsert;
