import type {
  AiTryOnReferenceAssetDto,
  AiTryOnReferenceRole,
} from '@/hooks/api/types';

export type PoseDirection = 'front' | 'high' | 'low' | 'side' | 'diag' | 'back';
export type GenderFilterKey = 'all' | 'female' | 'male';
export type GarmentStyleKey =
  | 'all'
  | 'spring'
  | 'summer'
  | 'autumn'
  | 'winter'
  | 'party';

/**
 * 五方向固定顺序：正面 → 俯视 → 仰视 → 侧面 → 斜侧（兼容 back）
 */
const POSE_DIRECTION_ORDER: PoseDirection[] = [
  'front',
  'high',
  'low',
  'side',
  'diag',
  'back',
];

const GARMENT_STYLE_KEYWORDS: Record<
  Exclude<GarmentStyleKey, 'all'>,
  string[]
> = {
  spring: ['春日', 'spring', '春装'],
  summer: ['夏日', 'summer', '夏装', '短裤', 'shorts'],
  autumn: ['秋日', 'autumn', '秋装', '秋季'],
  winter: ['冬日', 'winter', '冬装', '冬季'],
  party: ['派对', 'party', '礼服', 'formal', '正装', 'dress'],
};

export function isGarmentReferenceRole(role: AiTryOnReferenceRole): boolean {
  return role === 'garment' || role === 'style';
}

export interface PoseVariantEntry {
  view: PoseDirection;
  item: AiTryOnReferenceAssetDto;
}

export interface PoseCardGroup {
  key: string;
  baseTitle: string;
  gender: 'female' | 'male';
  variants: PoseVariantEntry[];
}

function detectPoseDirection(item: AiTryOnReferenceAssetDto): PoseDirection {
  const thumbMatch = item.thumbnailUrl.match(
    /_(front|high|low|side|diag|back)\.[a-z0-9]+$/i
  );
  if (thumbMatch?.[1]) {
    return thumbMatch[1].toLowerCase() as PoseDirection;
  }
  for (const dir of POSE_DIRECTION_ORDER) {
    if (item.tags.includes(dir)) return dir;
  }
  return 'front';
}

function extractPoseGroupKey(item: AiTryOnReferenceAssetDto): string {
  const strippedThumb = item.thumbnailUrl.replace(
    /_(front|high|low|side|diag|back)(\.[a-z0-9]+)$/i,
    '$2'
  );
  if (strippedThumb !== item.thumbnailUrl) {
    return strippedThumb;
  }
  return item.id;
}

function stripDirectionSuffixFromTitle(title: string): string {
  return title
    .replace(/（(正面|俯视|仰视|侧面|斜侧|背面|高角度|低角度)）\s*$/, '')
    .replace(
      /\s*\((Front|High angle|Low angle|Side|Three-quarter|Back|front|high|low|side|diag|back)\)\s*$/i,
      ''
    )
    .trim();
}

export function detectAssetGender(
  item: AiTryOnReferenceAssetDto
): 'female' | 'male' | 'unisex' {
  const combined = [item.title, item.description ?? '', ...item.tags]
    .join(' ')
    .toLowerCase();
  if (
    item.tags.includes('male') ||
    item.tags.includes('男性') ||
    item.tags.includes('男装') ||
    /\b(male|man|men|boy|mens|menswear)\b/.test(combined) ||
    combined.includes('男性') ||
    combined.includes('男士') ||
    combined.includes('男装')
  ) {
    return 'male';
  }
  if (
    item.tags.includes('female') ||
    item.tags.includes('女性') ||
    item.tags.includes('女装') ||
    /\b(female|woman|women|girl|womens|womenswear)\b/.test(combined) ||
    combined.includes('女性') ||
    combined.includes('女士') ||
    combined.includes('女装') ||
    combined.includes('女孩')
  ) {
    return 'female';
  }
  return item.kind === 'pose' || item.kind === 'garment' ? 'female' : 'unisex';
}

export function detectGarmentStyle(
  item: AiTryOnReferenceAssetDto
): GarmentStyleKey {
  const combined = [item.title, item.description ?? '', ...item.tags]
    .join(' ')
    .toLowerCase();
  for (const key of [
    'spring',
    'summer',
    'autumn',
    'winter',
    'party',
  ] as const) {
    const keywords = GARMENT_STYLE_KEYWORDS[key];
    if (keywords.some(kw => combined.includes(kw.toLowerCase()))) {
      return key;
    }
  }
  return 'all';
}

export function groupPoseAssets(
  items: AiTryOnReferenceAssetDto[]
): PoseCardGroup[] {
  const map = new Map<string, PoseCardGroup>();

  for (const item of items) {
    const key = extractPoseGroupKey(item);
    const view = detectPoseDirection(item);
    let group = map.get(key);
    if (!group) {
      const g = detectAssetGender(item);
      group = {
        key,
        baseTitle: stripDirectionSuffixFromTitle(item.title),
        gender: g === 'male' ? 'male' : 'female',
        variants: [],
      };
      map.set(key, group);
    }
    if (!group.variants.some(v => v.view === view)) {
      group.variants.push({ view, item });
    }
  }

  for (const group of map.values()) {
    group.variants.sort(
      (a, b) =>
        POSE_DIRECTION_ORDER.indexOf(a.view) -
        POSE_DIRECTION_ORDER.indexOf(b.view)
    );
  }

  return Array.from(map.values());
}

export function countLibraryGenders(
  items: AiTryOnReferenceAssetDto[],
  poseGroups: PoseCardGroup[],
  role: AiTryOnReferenceRole
): Record<GenderFilterKey, number> {
  const genders =
    role === 'pose'
      ? poseGroups.map(group => group.gender)
      : items.map(detectAssetGender);
  return {
    all: genders.length,
    female: genders.filter(gender => gender === 'female').length,
    male: genders.filter(gender => gender === 'male').length,
  };
}

export function countGarmentStyles(
  items: AiTryOnReferenceAssetDto[],
  genderFilter: GenderFilterKey
): Record<GarmentStyleKey, number> {
  const counts: Record<GarmentStyleKey, number> = {
    all: 0,
    spring: 0,
    summer: 0,
    autumn: 0,
    winter: 0,
    party: 0,
  };
  for (const item of items) {
    if (genderFilter !== 'all' && detectAssetGender(item) !== genderFilter)
      continue;
    counts.all++;
    const style = detectGarmentStyle(item);
    if (style !== 'all') counts[style]++;
  }
  return counts;
}

function matchesSearch(item: AiTryOnReferenceAssetDto, query: string): boolean {
  return (
    item.title.toLowerCase().includes(query) ||
    (item.description ?? '').toLowerCase().includes(query) ||
    item.tags.some(tag => tag.toLowerCase().includes(query))
  );
}

export function filterPoseGroups(
  groups: PoseCardGroup[],
  genderFilter: GenderFilterKey,
  searchQuery: string
): PoseCardGroup[] {
  const query = searchQuery.trim().toLowerCase();
  return groups.filter(
    group =>
      (genderFilter === 'all' || group.gender === genderFilter) &&
      (!query ||
        group.baseTitle.toLowerCase().includes(query) ||
        group.variants.some(({ item }) => matchesSearch(item, query)))
  );
}

export function filterReferenceAssets(
  items: AiTryOnReferenceAssetDto[],
  role: AiTryOnReferenceRole,
  genderFilter: GenderFilterKey,
  styleFilter: GarmentStyleKey,
  searchQuery: string
): AiTryOnReferenceAssetDto[] {
  const query = searchQuery.trim().toLowerCase();
  return items.filter(
    item =>
      (genderFilter === 'all' || detectAssetGender(item) === genderFilter) &&
      (!isGarmentReferenceRole(role) ||
        styleFilter === 'all' ||
        detectGarmentStyle(item) === styleFilter) &&
      (!query || matchesSearch(item, query))
  );
}

export function getActivePoseVariant(
  group: PoseCardGroup,
  selectedId: string | null,
  rememberedView?: PoseDirection
): PoseVariantEntry {
  return (
    group.variants.find(({ item }) => item.id === selectedId) ??
    group.variants.find(({ view }) => view === rememberedView) ??
    group.variants[0]!
  );
}
