import { describe, expect, it } from 'bun:test';
import {
  FALLBACK_VOCABULARY,
  buildCostumeCandidates,
  joinUrl,
  translateKeywords,
  type CostumeMetadataEntry,
  type CostumeVocabulary,
} from '../../src/scripts/costume-sync';

const vocabulary: CostumeVocabulary = {
  categories: {
    春: { id: 'spring', zh: '春日穿搭', en: 'Spring' },
    ランジェリー: { id: 'lingerie', zh: '内衣', en: 'Lingerie' },
  },
  costume: {
    ivory: '象牙白',
    knit: '针织',
    denim: '牛仔布',
    skirt: '半身裙',
  },
};

function entry(
  id: string,
  overrides: Partial<CostumeMetadataEntry> = {}
): CostumeMetadataEntry {
  return {
    id,
    カテゴリ: '春',
    キーワード: 'ivory frill knit denim mini skirt',
    サムネ: `thumbs/${id}.webp`,
    原寸: `png/${id}.png`,
    ...overrides,
  };
}

describe('joinUrl', () => {
  it('normalises slashes on both sides', () => {
    expect(joinUrl('https://a.dev/', '/png/x.png')).toBe(
      'https://a.dev/png/x.png'
    );
    expect(joinUrl('https://a.dev///', 'png/x.png')).toBe(
      'https://a.dev/png/x.png'
    );
  });
});

describe('translateKeywords', () => {
  it('translates known words and keeps unknown ones in English', () => {
    expect(
      translateKeywords(['ivory', 'knit', 'mysteryword'], vocabulary)
    ).toEqual(['象牙白', '针织', 'mysteryword']);
  });

  it('deduplicates after translation', () => {
    expect(translateKeywords(['ivory', 'ivory'], vocabulary)).toEqual([
      '象牙白',
    ]);
  });
});

describe('buildCostumeCandidates', () => {
  const options = {
    baseUrl: 'https://ai-costume-gallery.pages.dev',
    vocabulary,
  };

  it('maps metadata into library rows with source URLs and storage keys', () => {
    const [candidate] = buildCostumeCandidates([entry('SPR-0001')], options);

    expect(candidate).toBeDefined();
    expect(candidate?.slug).toBe('costume-SPR-0001');
    expect(candidate?.upstreamId).toBe('SPR-0001');
    expect(candidate?.titleZh).toBe('春日穿搭 SPR-0001');
    expect(candidate?.titleEn).toBe('Spring SPR-0001');
    expect(candidate?.tags).toEqual([
      '象牙白',
      'frill',
      '针织',
      '牛仔布',
      'mini',
      '半身裙',
    ]);
    expect(candidate?.descriptionEn).toBe(
      'ivory, frill, knit, denim, mini, skirt'
    );
    expect(candidate?.descriptionZh).toBe(
      '象牙白、frill、针织、牛仔布、mini、半身裙'
    );
    expect(candidate?.thumbnailSourceUrl).toBe(
      'https://ai-costume-gallery.pages.dev/thumbs/SPR-0001.webp'
    );
    expect(candidate?.imageSourceUrl).toBe(
      'https://ai-costume-gallery.pages.dev/png/SPR-0001.png'
    );
    expect(candidate?.thumbnailKey).toBe('costume/thumbs/SPR-0001.webp');
    expect(candidate?.assetKey).toBe('costume/SPR-0001.png');
  });

  it('gives repeated upstream ids their own storage keys', () => {
    const candidates = buildCostumeCandidates(
      [
        entry('L-0001', { カテゴリ: 'ランジェリー' }),
        entry('L-0001', { カテゴリ: 'ランジェリー' }),
      ],
      {
        ...options,
        vocabulary: {
          ...vocabulary,
          categories: {
            ...vocabulary.categories,
            ランジェリー: { zh: '内衣', en: 'Lingerie' },
          },
        },
      }
    );

    // 同一上游 id 的第二份必须换 key,否则后上传的会覆盖前一张。
    expect(candidates.map(candidate => candidate.assetKey)).toEqual([
      'costume/L-0001.png',
      'costume/L-0001-2.png',
    ]);
    expect(candidates.map(candidate => candidate.thumbnailKey)).toEqual([
      'costume/thumbs/L-0001.webp',
      'costume/thumbs/L-0001-2.webp',
    ]);
  });

  it('skips entries without a full-size image or thumbnail', () => {
    const candidates = buildCostumeCandidates(
      [
        entry('A-1'),
        entry('A-2', { 原寸: undefined }),
        entry('A-3', { サムネ: undefined }),
        entry('A-4', { id: undefined }),
      ],
      options
    );

    expect(candidates.map(candidate => candidate.upstreamId)).toEqual(['A-1']);
  });

  it('keeps unknown categories visible instead of dropping them', () => {
    const [candidate] = buildCostumeCandidates(
      [entry('X-1', { カテゴリ: '未知分类' })],
      options
    );

    expect(candidate?.titleZh).toBe('未知分类 X-1');
    expect(candidate?.titleEn).toBe('未知分类 X-1');
  });

  it('filters by Japanese category', () => {
    const candidates = buildCostumeCandidates(
      [entry('S-1'), entry('L-1', { カテゴリ: 'ランジェリー' })],
      { ...options, categories: ['ランジェリー'] }
    );

    expect(candidates.map(candidate => candidate.upstreamId)).toEqual(['L-1']);
  });

  it('applies the limit after filtering', () => {
    const candidates = buildCostumeCandidates(
      [entry('S-1'), entry('S-2'), entry('L-1', { カテゴリ: 'ランジェリー' })],
      { ...options, limit: 2 }
    );

    expect(candidates.map(candidate => candidate.upstreamId)).toEqual([
      'S-1',
      'S-2',
    ]);
  });

  it('disambiguates repeated upstream ids without letting the filter shift the numbering', () => {
    const entries = [
      entry('L-0001', { カテゴリ: 'ランジェリー' }),
      entry('S-0001'),
      entry('L-0001', { カテゴリ: 'ランジェリー' }),
    ];

    const all = buildCostumeCandidates(entries, options);
    expect(all.map(candidate => candidate.slug)).toEqual([
      'costume-L-0001',
      'costume-S-0001',
      'costume-L-0001-2',
    ]);

    // 分类过滤不该让第二个 L-0001 变成 -2 之外的名字,也不该抢走 -1。
    const filtered = buildCostumeCandidates(entries, {
      ...options,
      categories: ['ランジェリー'],
    });
    expect(filtered.map(candidate => candidate.slug)).toEqual([
      'costume-L-0001',
      'costume-L-0001-2',
    ]);
  });

  it('maps lingerie, swimwear and statement categories away from public', () => {
    const vocabularyWithAll: CostumeVocabulary = {
      categories: {
        ...vocabulary.categories,
        ランジェリー: { zh: '内衣', en: 'Lingerie' },
        水着: { zh: '泳装', en: 'Swimwear' },
        セクシー: { zh: '魅力穿搭', en: 'Statement outfits' },
        パーティ: { zh: '派对礼服', en: 'Party' },
      },
      costume: vocabulary.costume,
    };

    const candidates = buildCostumeCandidates(
      [
        entry('S-1'),
        entry('L-1', { カテゴリ: 'ランジェリー' }),
        entry('W-1', { カテゴリ: '水着' }),
        entry('X-1', { カテゴリ: 'セクシー' }),
        entry('P-1', { カテゴリ: 'パーティ' }),
      ],
      { ...options, vocabulary: vocabularyWithAll }
    );

    expect(
      candidates.map(candidate => [candidate.categoryJa, candidate.visibility])
    ).toEqual([
      ['春', 'public'],
      ['ランジェリー', 'hidden'],
      ['水着', 'hidden'],
      ['セクシー', 'adult'],
      ['パーティ', 'public'],
    ]);
  });

  it('honours a visibility map override', () => {
    const [candidate] = buildCostumeCandidates(
      [entry('L-1', { カテゴリ: 'ランジェリー' })],
      {
        ...options,
        vocabulary: {
          ...vocabulary,
          categories: {
            ...vocabulary.categories,
            ランジェリー: { zh: '内衣', en: 'Lingerie' },
          },
        },
        visibilityMap: { ランジェリー: 'public' },
      }
    );

    expect(candidate?.visibility).toBe('public');
  });

  it('handles missing keywords with null descriptions and empty tags', () => {
    const [candidate] = buildCostumeCandidates(
      [entry('N-1', { キーワード: undefined })],
      options
    );

    expect(candidate?.tags).toEqual([]);
    expect(candidate?.descriptionZh).toBeNull();
    expect(candidate?.descriptionEn).toBeNull();
  });
});

describe('FALLBACK_VOCABULARY', () => {
  it('covers every costume category with Chinese and English labels', () => {
    for (const category of [
      '春',
      '夏',
      '秋',
      '冬',
      'ランジェリー',
      'パーティ',
      '水着',
      'セクシー',
    ]) {
      const label = FALLBACK_VOCABULARY.categories[category];
      expect(typeof label?.zh).toBe('string');
      expect(typeof label?.en).toBe('string');
    }
  });
});
