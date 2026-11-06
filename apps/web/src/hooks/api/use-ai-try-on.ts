import { useQuery } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { api } from '@/lib/api-client';
import type { AiTryOnReferenceAssetDto, AiTryOnReferenceKind } from './types';
import { catalogQueryOptions } from './catalog-query-options';

export const aiTryOnQueryKeys = {
  all: ['catalog', 'ai-try-on'] as const,
  references: (kind: AiTryOnReferenceKind, lang?: string) =>
    [...aiTryOnQueryKeys.all, 'references', kind, lang] as const,
};

function extractReferenceRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload as Record<string, unknown>[];
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.items)) {
      return record.items as Record<string, unknown>[];
    }
    if (Array.isArray(record.references)) {
      return record.references as Record<string, unknown>[];
    }
  }
  // 格式错误不能冒充成功的空图库，否则刷新会清除用户的选择。
  throw new Error('Invalid reference catalog response');
}

export function normalizeAiTryOnReferenceAsset(
  raw: Record<string, unknown>,
  fallbackKind: AiTryOnReferenceKind
): AiTryOnReferenceAssetDto {
  const kind =
    raw.kind === 'person' || raw.kind === 'pose' || raw.kind === 'garment'
      ? raw.kind
      : fallbackKind;

  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    kind,
    title: typeof raw.title === 'string' ? raw.title : '',
    description:
      typeof raw.description === 'string' ? raw.description : undefined,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    thumbnailUrl:
      typeof raw.thumbnailUrl === 'string'
        ? raw.thumbnailUrl
        : typeof raw.imageUrl === 'string'
          ? raw.imageUrl
          : '',
    sourceUrl:
      typeof raw.sourceUrl === 'string'
        ? raw.sourceUrl
        : typeof raw.source === 'string'
          ? raw.source
          : '',
    licenseName:
      typeof raw.licenseName === 'string'
        ? raw.licenseName
        : typeof raw.license === 'string'
          ? raw.license
          : '',
    licenseUrl: typeof raw.licenseUrl === 'string' ? raw.licenseUrl : undefined,
    attribution: typeof raw.attribution === 'string' ? raw.attribution : '',
    ...(typeof raw.sortOrder === 'number' ? { sortOrder: raw.sortOrder } : {}),
  };
}

export function useAiTryOnReferences(
  kind: AiTryOnReferenceKind,
  options?: { enabled?: boolean }
) {
  const locale = useLocale();
  const lang = locale === 'en' ? 'en' : 'zh';

  return useQuery({
    queryKey: aiTryOnQueryKeys.references(kind, lang),
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/tasks/ai-try-on/references', {
        params: { query: { kind, lang } },
        signal,
      });
      if (error) throw error;
      return extractReferenceRows(data).map(item =>
        normalizeAiTryOnReferenceAsset(item, kind)
      );
    },
    enabled: options?.enabled ?? true,
    ...catalogQueryOptions,
  });
}
