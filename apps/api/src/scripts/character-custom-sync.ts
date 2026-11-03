/**
 * 上游「自建人物参考」→ 图库记录的纯逻辑。
 *
 * 与 import-character-custom.ts 分离:这里不碰网络、S3 和 DB,方便单测。
 * 元数据来自 open-pose-costume 仓库 data/custom/character.json,共两类:
 *
 * 1. 多地区人物参考(22 条,RCF-001 ~ RCF-022):11 个地区 × 男女,
 *    id 形如 `custom_character_region_fr_female`,标题形如「法国 · 女性人像」。
 * 2. 男性风格参考(6 条,MCF-001 ~ MCF-006):只有性别,没有地区。
 *
 * 单条结构:
 *   { "id": "custom_character_region_fr_female", "kind": "character",
 *     "code": "RCF-001",
 *     "title": { "zh": "法国 · 女性人像", "en": "France · Female portrait" },
 *     "category": { "id": "portrait-face", "zh": "人脸", "en": "Face" },
 *     "series": { "zh": "多地区人物参考 · 22 张", ... },
 *     "keywords": { "zh": "...国家仅为编辑分组。", "en": "...Editorial country grouping only." },
 *     "tags": [ { "id": "female", "zh": "女性", "en": "Female" }, { "id": "photo", ... } ],
 *     "variants": [ { "id": "...", "angle": "front",
 *       "label": { "zh": "正面人像", "en": "Front portrait" },
 *       "original": "custom/character/originals/xxx.png",
 *       "image": "custom/character/images/xxx.webp",
 *       "thumbnail": "custom/character/thumbnails/xxx.webp" } ] }
 *
 * 授权边界(与 import-pose-male-custom.ts / import-costume-custom.ts 同一批自建素材、
 * 同一份授权):自建素材默认条款禁止商用与再分发,本项目已取得维护者单独授权后才导入。
 *
 * 地区特征的边界(重要):上游明确写了「国家仅为编辑分组,不推定真实国籍或代表性外貌」。
 * 所以地区只作为编辑分组标签入库,描述里必须带上这句免责声明,
 * 且不得从地区反推发型/五官/肤色等外观属性。
 */

import type { aiTryOnReferences } from '@utils-plane/db';

/** 一条待入库的图库记录。bucket 两列由可执行脚本按环境填。 */
export type CharacterRecord = Omit<
  typeof aiTryOnReferences.$inferInsert,
  'assetBucket' | 'thumbnailBucket' | 'assetStorageKey' | 'thumbnailStorageKey'
> & {
  assetStorageKey: string;
  thumbnailStorageKey: string;
};

/** 入库记录 + 下载用的仓库内相对路径。两者不同,不能互相推导后复用。 */
export interface CharacterEntry {
  record: CharacterRecord;
  originalPath: string;
  thumbnailPath: string;
}

export interface LocalizedText {
  zh?: unknown;
  en?: unknown;
}

export interface CharacterTag {
  id?: unknown;
  zh?: unknown;
  en?: unknown;
}

export interface CharacterVariant {
  id?: unknown;
  angle?: unknown;
  label?: LocalizedText;
  original?: unknown;
  image?: unknown;
  thumbnail?: unknown;
}

export interface CustomCharacter {
  id?: unknown;
  code?: unknown;
  title?: LocalizedText;
  category?: { id?: unknown; zh?: unknown; en?: unknown };
  series?: LocalizedText;
  keywords?: LocalizedText;
  tags?: CharacterTag[];
  variants?: CharacterVariant[];
}

export interface BuildCharacterOptions {
  /** sortOrder 起点。原创种子 0 起、男装 100 起、男性姿势 20000 起、自建女装 25000 起、上游服饰 30000 起。 */
  sortOrderBase: number;
}

/** 上游对地区分组与人物真实性的免责声明,原样保留进描述。 */
export const REGION_DISCLAIMER_ZH =
  'AI 虚构成成年人物 · 年龄为生成设定 · 国家/地区仅为编辑分组';
export const REGION_DISCLAIMER_EN =
  'Fictional adult · age is a generation setting · country/region is an editorial grouping only';

/** 多地区人像的 id 形态:custom_character_region_<cc>_<gender>。 */
const REGION_ID_PATTERN = /^custom_character_region_([a-z]{2})_(female|male)$/;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function localized(value: LocalizedText | undefined): {
  zh: string;
  en: string;
} {
  return { zh: asString(value?.zh) ?? '', en: asString(value?.en) ?? '' };
}

function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

/**
 * 从 id 解析地区代码与性别;非多地区条目(如男性风格参考)返回 null。
 *
 * 用 id 而不是标题首段判断:男性风格参考标题是「男性 · 清爽短发」,
 * 按分隔符切会把「男性」误当成地区。
 */
export function parseRegionAndGender(
  id: string
): { regionCode: string; gender: 'female' | 'male' } | null {
  const match = REGION_ID_PATTERN.exec(id);
  if (!match) return null;
  return {
    regionCode: match[1] as string,
    gender: match[2] as 'female' | 'male',
  };
}

/** 标题按「 · 」切出的首段即地区名(仅多地区条目适用)。 */
export function regionFromTitle(title: string): string | null {
  const [first] = title.split('·').map(part => part.trim());
  return first && first.length > 0 ? first : null;
}

/**
 * 构建入库记录。
 *
 * - 性别优先取 id 解析结果,回退 tags 里的 male/female;
 * - 地区仅多地区条目有,标签同时带地区代码与中英地区名;
 * - 描述固定带上地区/真实性免责声明——上游明确要求不得推定真实国籍或代表性外貌;
 * - storage key 走 `person/custom/` 前缀,与原创种子的 `person/` 分开(许可来源不同)。
 */
export function buildCharacterRecords(
  characters: CustomCharacter[],
  options: BuildCharacterOptions
): CharacterEntry[] {
  const entries: CharacterEntry[] = [];
  let index = 0;

  for (const character of characters) {
    const id = asString(character.id);
    if (!id) continue;

    const parsed = parseRegionAndGender(id);
    const title = localized(character.title);
    const category = character.category ?? {};
    const categoryZh = asString(category.zh) ?? '';
    const categoryEn = asString(category.en) ?? '';
    const categoryId = asString(category.id) ?? '';
    const series = localized(character.series);
    const code = asString(character.code) ?? '';

    const genderTag = character.tags?.find(
      tag => tag.id === 'male' || tag.id === 'female'
    );
    const gender =
      parsed?.gender ?? (genderTag?.id === 'male' ? 'male' : 'female');

    // 地区名取标题首段;取不到就只用代码,不硬编码一张「代码→国家」表——
    // 上游新增地区时不必改代码。
    const regionName = parsed ? regionFromTitle(title.zh) : null;
    const regionNameEn = parsed ? regionFromTitle(title.en) : null;

    for (const variant of character.variants ?? []) {
      const variantId = asString(variant.id);
      const originalPath = asString(variant.original);
      const thumbnailPath = asString(variant.thumbnail);
      // 缺原图或缩略图的变体不入库:入库后列表缩略图必然 404。
      if (!variantId || !originalPath || !thumbnailPath) continue;

      index += 1;
      const view = (asString(variant.angle) ?? '').toLowerCase();
      const label = localized(variant.label);

      const rawTags: (string | null)[] = [
        view,
        gender,
        gender === 'male' ? '男性' : '女性',
        ...(parsed
          ? [parsed.regionCode, regionName, regionNameEn, '多地区', 'regional']
          : []),
        categoryId,
        categoryZh,
        ...(character.tags ?? []).flatMap(tag => {
          const tagId = asString(tag.id);
          const tagZh = asString(tag.zh);
          return tagId && tagZh ? [tagId, tagZh] : tagId ? [tagId] : [];
        }),
      ];
      const tags = [
        ...new Set(
          rawTags.filter(
            (tag): tag is string => typeof tag === 'string' && tag.length > 0
          )
        ),
      ];

      entries.push({
        record: {
          slug: variantId.toLowerCase(),
          kind: 'person',
          visibility: 'public',
          titleZh:
            title.zh && label.zh ? `${title.zh}（${label.zh}）` : title.zh,
          titleEn:
            title.en && label.en ? `${title.en} (${label.en})` : title.en,
          descriptionZh: [code, categoryZh, series.zh, REGION_DISCLAIMER_ZH]
            .filter(Boolean)
            .join(' · '),
          descriptionEn: [code, categoryEn, series.en, REGION_DISCLAIMER_EN]
            .filter(Boolean)
            .join(' · '),
          tags,
          assetStorageKey: `person/custom/${fileName(originalPath)}`,
          thumbnailStorageKey: `person/custom/thumbnails/${fileName(thumbnailPath)}`,
          sortOrder: options.sortOrderBase + index,
        },
        originalPath,
        thumbnailPath,
      });
    }
  }

  return entries;
}
