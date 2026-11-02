/**
 * 上游服饰元数据 → 图库候选项的纯逻辑。
 *
 * 与 seed-ai-try-on-costumes.ts 分离:这里不碰网络、S3 和 DB,方便单测。
 * 元数据格式见 data/source/costume.json(open-pose-costume 仓库):
 *
 *   { "id": "SPR-0001", "カテゴリ": "春", "キーワード": "ivory frill knit ...",
 *     "サムネ": "thumbs/SPR-0001.webp", "画像": "img/SPR-0001.webp",
 *     "原寸": "png/SPR-0001.png" }
 *
 * 两个已知坑:
 * 1. 上游文件里 ID 会中途重头编号(默认区块 + 扩展区块),同一 id 出现多次。
 *    slug 用「出现次序」消歧,重名时追加 -2/-3 并打日志;次序依赖上游顺序,
 *    上游若重排可能产生新 slug(旧行不会被删,由人工清理)。
 * 2. 分类是日文,译名表在 data/vocabulary.json 的 categories;关键词是英文,
 *    中文译名在同文件 costume 下。取不到译名表时用内置兜底分类。
 */

/** 上游单条服饰元数据。字段名保持日文原样,避免转换出错。 */
export interface CostumeMetadataEntry {
  id?: unknown;
  カテゴリ?: unknown;
  キーワード?: unknown;
  サムネ?: unknown;
  原寸?: unknown;
}

/** 图库可见性,与 DB 枚举 ai_try_on_reference_visibility 一致。 */
export type AiTryOnReferenceVisibility =
  | 'public'
  | 'hidden'
  | 'adult'
  | 'intimate';

/** 译名表(来自上游 data/vocabulary.json)。 */
export interface CostumeVocabulary {
  categories: Record<string, { id?: unknown; zh?: unknown; en?: unknown }>;
  costume: Record<string, unknown>;
}

/** 一条待入库的图库候选。 */
export interface CostumeSyncCandidate {
  slug: string;
  upstreamId: string;
  categoryJa: string;
  titleZh: string;
  titleEn: string;
  descriptionZh: string | null;
  descriptionEn: string | null;
  tags: string[];
  thumbnailSourceUrl: string;
  imageSourceUrl: string;
  thumbnailKey: string;
  assetKey: string;
  visibility: AiTryOnReferenceVisibility;
}

/**
 * 分类 → 可见性。
 *
 * 策略见 docs/ai-try-on/AI_TRYON_ADULT_CONTENT_MANAGEMENT.md:API 只返
 * visibility='public',其余保留在 MinIO 但不进列表、也不能被生成任务解析。
 * 内衣/泳装不适配电商试衣但非成人 → hidden;性感向 → adult;其余公开。
 */
export const COSTUME_VISIBILITY_MAP: Record<
  string,
  AiTryOnReferenceVisibility
> = {
  ランジェリー: 'hidden',
  水着: 'hidden',
  セクシー: 'adult',
};

export const DEFAULT_COSTUME_VISIBILITY: AiTryOnReferenceVisibility = 'public';

export interface BuildCandidatesOptions {
  /** 图片 base URL,如 https://ai-costume-gallery.pages.dev */
  baseUrl: string;
  vocabulary: CostumeVocabulary;
  /** 只保留这些日文分类;空数组 = 全要。 */
  categories?: string[];
  /** 最多多少条;0 或负数 = 不限。 */
  limit?: number;
  /** 覆盖内置的 分类→可见性 映射。 */
  visibilityMap?: Record<string, AiTryOnReferenceVisibility>;
}

/** 译名表拉取失败时的兜底:至少八个服饰分类能显示中文名。 */
export const FALLBACK_VOCABULARY: CostumeVocabulary = {
  categories: {
    春: { id: 'spring', zh: '春日穿搭', en: 'Spring' },
    夏: { id: 'summer', zh: '夏日穿搭', en: 'Summer' },
    秋: { id: 'autumn', zh: '秋日穿搭', en: 'Autumn' },
    冬: { id: 'winter', zh: '冬日穿搭', en: 'Winter' },
    ランジェリー: { id: 'lingerie', zh: '内衣', en: 'Lingerie' },
    パーティ: { id: 'party', zh: '派对礼服', en: 'Party' },
    水着: { id: 'swimwear', zh: '泳装', en: 'Swimwear' },
    セクシー: {
      id: 'expressive-outfits',
      zh: '魅力穿搭',
      en: 'Statement outfits',
    },
  },
  costume: {},
};

/** 拼绝对 URL:base 去掉末尾斜杠,path 去掉开头斜杠。 */
export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * 关键词译中文(取不到译名保留英文)。
 *
 * 产品以中文为主,标签直接存中文;英文原文进 description,前端要英文标签时
 * 可以用同一张译名表反查。
 */
export function translateKeywords(
  keywords: string[],
  vocabulary: CostumeVocabulary
): string[] {
  const translated = keywords.map(word => {
    const zh = vocabulary.costume[word];
    return typeof zh === 'string' && zh.trim().length > 0 ? zh.trim() : word;
  });
  return [...new Set(translated)];
}

function categoryLabel(
  categoryJa: string,
  vocabulary: CostumeVocabulary
): { zh: string; en: string } {
  const entry = vocabulary.categories[categoryJa];
  const zh = entry && asString(entry.zh);
  const en = entry && asString(entry.en);
  return {
    zh: zh ?? categoryJa,
    en: en ?? categoryJa,
  };
}

/**
 * 把上游元数据转成入库候选。
 *
 * 过滤规则:缺原图或缺缩略图的条目直接跳过(入库后必然 404);
 * 分类过滤与 limit 在去重之后应用,保证条数符合预期。
 */
export function buildCostumeCandidates(
  entries: CostumeMetadataEntry[],
  options: BuildCandidatesOptions
): CostumeSyncCandidate[] {
  const { baseUrl, vocabulary } = options;
  const categoryFilter = options.categories ?? [];
  const limit = options.limit ?? 0;
  const visibilityMap = options.visibilityMap ?? COSTUME_VISIBILITY_MAP;

  // id -> 已出现次数,用于重名消歧。
  const occurrences = new Map<string, number>();
  const candidates: CostumeSyncCandidate[] = [];

  for (const entry of entries) {
    const id = asString(entry.id);
    const imagePath = asString(entry.原寸);
    const thumbnailPath = asString(entry.サムネ);
    if (!id || !imagePath || !thumbnailPath) continue;

    const categoryJa = asString(entry.カテゴリ) ?? '';

    // 先按 id 计数再过滤:分类过滤不会影响重名编号,slug 在多种跑法下保持稳定。
    const seen = (occurrences.get(id) ?? 0) + 1;
    occurrences.set(id, seen);
    const slug = seen === 1 ? `costume-${id}` : `costume-${id}-${seen}`;
    // 重名 ID 的存储 key 也必须带序号:上游默认区块与扩展区块共用同一套编号,
    // 不带序号会让后一份覆盖前一份,前一行图就错了。
    const keySuffix = seen === 1 ? '' : `-${seen}`;

    if (categoryFilter.length > 0 && !categoryFilter.includes(categoryJa)) {
      continue;
    }

    const label = categoryLabel(categoryJa, vocabulary);
    const keywords = (asString(entry.キーワード) ?? '')
      .split(/\s+/)
      .filter(Boolean);
    const tags = translateKeywords(keywords, vocabulary);

    candidates.push({
      slug,
      upstreamId: id,
      categoryJa,
      titleZh: `${label.zh} ${id}`,
      titleEn: `${label.en} ${id}`,
      descriptionZh: tags.length > 0 ? tags.join('、') : null,
      descriptionEn: keywords.length > 0 ? keywords.join(', ') : null,
      tags,
      thumbnailSourceUrl: joinUrl(baseUrl, thumbnailPath),
      imageSourceUrl: joinUrl(baseUrl, imagePath),
      thumbnailKey: `costume/thumbs/${id}${keySuffix}.webp`,
      assetKey: `costume/${id}${keySuffix}.png`,
      visibility: visibilityMap[categoryJa] ?? DEFAULT_COSTUME_VISIBILITY,
    });

    if (limit > 0 && candidates.length >= limit) break;
  }

  return candidates;
}
