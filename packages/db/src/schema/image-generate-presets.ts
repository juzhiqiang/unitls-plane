import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * AI 生图提示词模板。
 *
 * 模板内容走「分类」思路：每条都是一个相对完整的创作框架（导览式科普绘本、拟人化 IP 海报、
 * 信息图长图等），用户选了之后替换【主题】等占位即可。
 *
 * 走 DB + MinIO presets 桶 + GET /tasks/image-generate/presets 下发，方便后续后台动态运营增删改；
 * 本轮只 seed 12 条内置模板，后台 CRUD 留到后续。
 *
 * 双语列：后台编辑时直接改对应语言列即可，无需额外的翻译表结构；API 按 lang 查询参数拼成
 * 单语言扁平对象返回，前端零字段切换。
 *
 * slug 是 upsert 键：re-seed 只刷新内置模板（is_builtin=true）的标题/提示词/图 key/排序，
 * 不动 is_enabled（后台将来禁用的内置模板在 re-seed 后仍保持禁用），也不触碰 is_builtin=false 的后台新增行。
 */
export const imageGeneratePresets = pgTable(
  'image_generate_presets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    titleZh: text('title_zh').notNull(),
    titleEn: text('title_en').notNull(),
    promptZh: text('prompt_zh').notNull(),
    promptEn: text('prompt_en').notNull(),
    imageStorageKey: text('image_storage_key'),
    sortOrder: integer('sort_order').notNull().default(0),
    isEnabled: boolean('is_enabled').notNull().default(true),
    isBuiltin: boolean('is_builtin').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  t => ({
    sortIdx: index('image_generate_presets_sort_idx').on(t.sortOrder),
  })
);

export type ImageGeneratePreset = typeof imageGeneratePresets.$inferSelect;
export type NewImageGeneratePreset = typeof imageGeneratePresets.$inferInsert;
