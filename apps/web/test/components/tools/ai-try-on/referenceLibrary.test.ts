import { describe, expect, it } from 'vitest';
import type { AiTryOnReferenceAssetDto } from '@/hooks/api/types';
import {
  countGarmentStyles,
  countLibraryGenders,
  filterReferenceAssets,
  getActivePoseVariant,
  groupPoseAssets,
} from '@/components/tools/ai-try-on/referenceLibrary';

function reference(
  id: string,
  overrides: Partial<AiTryOnReferenceAssetDto> = {}
): AiTryOnReferenceAssetDto {
  return {
    id,
    kind: 'pose',
    title: id,
    tags: [],
    thumbnailUrl: `https://cdn.example.test/${id}.webp`,
    sourceUrl: `https://source.example.test/${id}`,
    licenseName: 'CC0',
    attribution: 'Studio',
    ...overrides,
  };
}

describe('reference library domain behavior', () => {
  it('orders all supported views independently of input and keeps filename direction ahead of tags', () => {
    const items = [
      reference('back', {
        title: 'Walking (Back)',
        thumbnailUrl: '/walk_back.PNG',
      }),
      reference('low', { thumbnailUrl: '/walk_low.PNG' }),
      reference('diag', { thumbnailUrl: '/walk_diag.PNG' }),
      reference('side', { thumbnailUrl: '/walk_side.PNG' }),
      reference('front', { thumbnailUrl: '/walk_front.PNG', tags: ['back'] }),
      reference('high', { thumbnailUrl: '/walk_high.PNG' }),
    ];

    const groups = groupPoseAssets(items);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.baseTitle).toBe('Walking');
    expect(groups[0]!.variants.map(({ item }) => item.id)).toEqual([
      'front',
      'high',
      'low',
      'side',
      'diag',
      'back',
    ]);
    expect(items.map(item => item.id)).toEqual([
      'back',
      'low',
      'diag',
      'side',
      'front',
      'high',
    ]);
  });

  it('keeps assets without a shared filename separate and uses tag directions as fallback', () => {
    const groups = groupPoseAssets([
      reference('one', { tags: ['side'] }),
      reference('two', { title: 'Same title', tags: ['high'] }),
      reference('three', { title: 'Same title' }),
    ]);

    expect(
      groups.map(group => ({ key: group.key, view: group.variants[0]!.view }))
    ).toEqual([
      { key: 'one', view: 'side' },
      { key: 'two', view: 'high' },
      { key: 'three', view: 'front' },
    ]);
  });

  it('counts unknown persons as unisex while preserving the existing female garment default', () => {
    const items = [
      reference('unknown-person', { kind: 'person' }),
      reference('unknown-garment', { kind: 'garment' }),
      reference('female-person', { kind: 'person', title: 'Woman portrait' }),
      reference('male-person', {
        kind: 'person',
        description: 'Menswear model',
      }),
    ];

    expect(countLibraryGenders(items, [], 'person')).toEqual({
      all: 4,
      female: 2,
      male: 1,
    });
    expect(
      filterReferenceAssets(items, 'person', 'female', 'all', '').map(
        item => item.id
      )
    ).toEqual(['unknown-garment', 'female-person']);
  });

  it('applies garment style precedence to counts and combines gender, style and case-insensitive search', () => {
    const items = [
      reference('spring-dress', {
        kind: 'garment',
        title: 'Spring Dress',
        tags: ['female', 'linen'],
      }),
      reference('party-dress', {
        kind: 'garment',
        title: 'Formal dress',
        tags: ['female', 'velvet'],
      }),
      reference('mens-shorts', {
        kind: 'garment',
        title: 'Shorts',
        tags: ['male', 'linen'],
      }),
    ];

    expect(countGarmentStyles(items, 'female')).toEqual({
      all: 2,
      spring: 1,
      summer: 0,
      autumn: 0,
      winter: 0,
      party: 1,
    });
    expect(
      filterReferenceAssets(
        items,
        'style',
        'female',
        'spring',
        '  LINEN  '
      ).map(item => item.id)
    ).toEqual(['spring-dress']);
    expect(
      filterReferenceAssets(items, 'garment', 'male', 'party', '')
    ).toEqual([]);
    expect(
      filterReferenceAssets(items, 'person', 'female', 'party', 'linen').map(
        item => item.id
      )
    ).toEqual(['spring-dress']);
  });

  it('prioritizes the selected view, then remembered direction, then the first available view', () => {
    const [group] = groupPoseAssets([
      reference('side', { thumbnailUrl: '/stand_side.webp' }),
      reference('front', { thumbnailUrl: '/stand_front.webp' }),
    ]);

    expect(getActivePoseVariant(group!, 'front', 'side').item.id).toBe('front');
    expect(getActivePoseVariant(group!, null, 'side').item.id).toBe('side');
    expect(getActivePoseVariant(group!, 'missing', 'back').item.id).toBe(
      'front'
    );
  });
});
