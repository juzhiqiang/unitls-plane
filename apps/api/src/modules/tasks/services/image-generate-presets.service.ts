import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { db, imageGeneratePresets } from '@utils-plane/db';

/** API 下发的语言。DB 存双语言列，按这个值取对应列拼成单语言扁平对象。 */
export type PresetLang = 'zh' | 'en';

/** 下发给前端的模板。故意不含 slug / is_builtin / 另一语言列：前端零字段切换。 */
export interface ImageGeneratePresetDescriptor {
  id: string;
  title: string;
  prompt: string;
  imageStorageKey?: string;
  sortOrder: number;
}

/**
 * AI 生图提示词模板读取服务。
 *
 * 模板存 image_generate_presets 表（见 packages/db/src/schema/image-generate-presets.ts），
 * 内置 12 条由 apps/api/src/scripts/seed-image-generate-presets.ts seed，
 * 示例图存 MinIO presets 匿名只读桶，本服务只下发对象 key，前端自行拼公网 URL。
 *
 * 只读、无鉴权：模板内容仅为展示用提示词 + 示例图引用，端点是 @Public()。
 * 后台 CRUD 留到后续，本服务先只提供 list。
 */
@Injectable()
export class ImageGeneratePresetsService {
  /** 只返回启用中的模板，按 sortOrder 升序、id 兜底稳定排序。 */
  async list(lang: PresetLang): Promise<ImageGeneratePresetDescriptor[]> {
    const rows = await db
      .select()
      .from(imageGeneratePresets)
      .where(eq(imageGeneratePresets.isEnabled, true))
      .orderBy(
        asc(imageGeneratePresets.sortOrder),
        asc(imageGeneratePresets.id)
      );

    return rows.map(row => ({
      id: row.id,
      title: lang === 'en' ? row.titleEn : row.titleZh,
      prompt: lang === 'en' ? row.promptEn : row.promptZh,
      imageStorageKey: row.imageStorageKey ?? undefined,
      sortOrder: row.sortOrder,
    }));
  }
}
