import { describe, expect, it } from 'bun:test';
import {
  REGION_DISCLAIMER_ZH,
  buildCharacterRecords,
  parseRegionAndGender,
  regionFromTitle,
  type CustomCharacter,
} from '../../src/scripts/character-custom-sync';

function regionalCharacter(
  regionCode: string,
  gender: 'female' | 'male',
  regionZh: string,
  regionEn: string
): CustomCharacter {
  const id = `custom_character_region_${regionCode}_${gender}`;
  return {
    id,
    kind: 'character',
    code: `RCF-${regionCode.toUpperCase()}-01`,
    title: {
      zh: `${regionZh} · ${gender === 'male' ? '男性' : '女性'}人像`,
      en: `${regionEn} · ${gender === 'male' ? 'Male' : 'Female'} portrait`,
    },
    category: { id: 'portrait-face', zh: '人脸', en: 'Face' },
    series: {
      zh: '多地区人物参考 · 22 张',
      en: 'Regional character references · 22 portraits',
    },
    keywords: { zh: '法国 女性 成年', en: 'France Female adult' },
    tags: [
      {
        id: gender,
        zh: gender === 'male' ? '男性' : '女性',
        en: gender === 'male' ? 'Male' : 'Female',
      },
      { id: 'photo', zh: '写实', en: 'Photographic' },
    ],
    variants: [
      {
        id,
        angle: 'front',
        label: { zh: '正面人像', en: 'Front portrait' },
        original: `custom/character/originals/${id}.png`,
        image: `custom/character/images/${id}.webp`,
        thumbnail: `custom/character/thumbnails/${id}.webp`,
      },
    ],
  };
}

function maleStyleCharacter(index: number, styleZh: string): CustomCharacter {
  const id = `custom_character_male_style_${index}`;
  return {
    id,
    kind: 'character',
    code: `MCF-00${index}`,
    title: { zh: `男性 · ${styleZh}`, en: `Men · ${styleZh}` },
    category: { id: 'portrait-face', zh: '人脸', en: 'Face' },
    series: {
      zh: '男性人物参考 · 六种风格',
      en: 'Menswear references · six styles',
    },
    keywords: { zh: '男性 短发', en: 'Men short hair' },
    tags: [
      { id: 'male', zh: '男性', en: 'Male' },
      { id: 'photo', zh: '写实', en: 'Photographic' },
    ],
    variants: [
      {
        id,
        angle: 'front',
        label: { zh: '正面人像', en: 'Front portrait' },
        original: `custom/character/originals/${id}.png`,
        image: `custom/character/images/${id}.webp`,
        thumbnail: `custom/character/thumbnails/${id}.webp`,
      },
    ],
  };
}

const options = { sortOrderBase: 50000 };

describe('parseRegionAndGender', () => {
  it('reads region and gender out of the regional id', () => {
    expect(parseRegionAndGender('custom_character_region_fr_female')).toEqual({
      regionCode: 'fr',
      gender: 'female',
    });
    expect(parseRegionAndGender('custom_character_region_kr_male')).toEqual({
      regionCode: 'kr',
      gender: 'male',
    });
  });

  it('returns null for non-regional entries so they are not given a region', () => {
    expect(parseRegionAndGender('custom_character_male_style_1')).toBeNull();
    expect(
      parseRegionAndGender('custom_character_region_usa_female')
    ).toBeNull();
  });
});

describe('regionFromTitle', () => {
  it('takes the first segment of a regional title', () => {
    expect(regionFromTitle('法国 · 女性人像')).toBe('法国');
    expect(regionFromTitle('France · Female portrait')).toBe('France');
  });

  it('returns the whole title when there is no separator', () => {
    expect(regionFromTitle('男性')).toBe('男性');
  });
});

describe('buildCharacterRecords', () => {
  it('tags a regional portrait with gender and region', () => {
    const [entry] = buildCharacterRecords(
      [regionalCharacter('fr', 'female', '法国', 'France')],
      options
    );

    expect(entry).toBeDefined();
    expect(entry?.record.slug).toBe('custom_character_region_fr_female');
    expect(entry?.record.kind).toBe('person');
    expect(entry?.record.visibility).toBe('public');
    expect(entry?.record.titleZh).toBe('法国 · 女性人像（正面人像）');
    expect(entry?.record.titleEn).toBe(
      'France · Female portrait (Front portrait)'
    );
    expect(entry?.record.tags).toContain('female');
    expect(entry?.record.tags).toContain('女性');
    expect(entry?.record.tags).toContain('fr');
    expect(entry?.record.tags).toContain('法国');
    expect(entry?.record.tags).toContain('France');
    expect(entry?.record.tags).toContain('多地区');
  });

  it('keeps the upstream region disclaimer in both descriptions', () => {
    const [entry] = buildCharacterRecords(
      [regionalCharacter('jp', 'male', '日本', 'Japan')],
      options
    );

    expect(entry?.record.descriptionZh).toContain(REGION_DISCLAIMER_ZH);
    expect(entry?.record.descriptionZh).toContain('国家/地区仅为编辑分组');
    expect(entry?.record.descriptionEn).toContain(
      'country/region is an editorial grouping only'
    );
    // 不得从地区反推外观属性:描述里不该出现发型/五官/肤色这类词。
    expect(entry?.record.descriptionZh).not.toMatch(/发型|五官|肤色/);
  });

  it('gives a male style reference gender but no region', () => {
    const [entry] = buildCharacterRecords(
      [maleStyleCharacter(1, '清爽短发')],
      options
    );

    expect(entry?.record.slug).toBe('custom_character_male_style_1');
    // 性别标签正常保留。
    expect(entry?.record.tags).toContain('male');
    expect(entry?.record.tags).toContain('男性');
    // 标题首段是「男性」,不能被误当成地区:不应出现任何地区标记。
    expect(entry?.record.tags).not.toContain('多地区');
    expect(entry?.record.tags).not.toContain('regional');
    // 也不该出现两位小写地区代码(fr/kr 这类)。注意不能用 length===2 判断:
    // 「男性」「写实」等中文两字词长度同样是 2。
    expect(entry?.record.tags?.filter(t => /^[a-z]{2}$/.test(t))).toEqual([]);
  });

  it('uses a person/custom key prefix apart from the builtin person prefix', () => {
    const [entry] = buildCharacterRecords(
      [regionalCharacter('br', 'female', '巴西', 'Brazil')],
      options
    );

    expect(entry?.record.assetStorageKey).toBe(
      'person/custom/custom_character_region_br_female.png'
    );
    expect(entry?.record.thumbnailStorageKey).toBe(
      'person/custom/thumbnails/custom_character_region_br_female.webp'
    );
    // 原创种子用 person/front.png;自建人物必须换前缀,许可来源不同。
    expect(entry?.record.assetStorageKey?.startsWith('person/custom/')).toBe(
      true
    );
  });

  it('keeps download paths separate from storage keys', () => {
    const [entry] = buildCharacterRecords(
      [regionalCharacter('in', 'male', '印度', 'India')],
      options
    );

    expect(entry?.originalPath).toBe(
      'custom/character/originals/custom_character_region_in_male.png'
    );
    expect(entry?.thumbnailPath).toBe(
      'custom/character/thumbnails/custom_character_region_in_male.webp'
    );
  });

  it('numbers sortOrder sequentially from the base', () => {
    const entries = buildCharacterRecords(
      [
        regionalCharacter('fr', 'female', '法国', 'France'),
        regionalCharacter('fr', 'male', '法国', 'France'),
        maleStyleCharacter(1, '清爽短发'),
      ],
      options
    );

    expect(entries.map(e => e.record.sortOrder)).toEqual([50001, 50002, 50003]);
  });

  it('drops variants without an original or thumbnail', () => {
    const broken = regionalCharacter('de', 'female', '德国', 'Germany');
    broken.variants = [
      {
        id: 'custom_character_region_de_female',
        angle: 'front',
        label: { zh: '正面人像', en: 'Front portrait' },
        original:
          'custom/character/originals/custom_character_region_de_female.png',
        image: 'custom/character/images/custom_character_region_de_female.webp',
      },
    ];

    expect(buildCharacterRecords([broken], options)).toEqual([]);
  });

  it('imports a mixed library of regional and style references', () => {
    const entries = buildCharacterRecords(
      [
        regionalCharacter('fr', 'female', '法国', 'France'),
        regionalCharacter('us', 'male', '美国', 'USA'),
        maleStyleCharacter(1, '硬朗寸头'),
      ],
      options
    );

    expect(entries).toHaveLength(3);
    expect(entries.filter(e => e.record.tags?.includes('多地区'))).toHaveLength(
      2
    );
    expect(entries.filter(e => e.record.tags?.includes('male'))).toHaveLength(
      2
    );
    expect(entries.filter(e => e.record.tags?.includes('female'))).toHaveLength(
      1
    );
  });
});
