import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aiTryOnQueryKeys,
  normalizeAiTryOnReferenceAsset,
  useAiTryOnReferences,
} from '@/hooks/api/use-ai-try-on';

const localeState = vi.hoisted(() => ({ current: 'zh' }));

vi.mock('next-intl', () => ({
  useLocale: () => localeState.current,
}));

vi.mock('@/lib/api-client', () => ({
  api: {
    GET: vi.fn(),
  },
}));

import { api } from '@/lib/api-client';

const mockGet = vi.mocked(api.GET);

function createWrapper(
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
) {
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useAiTryOnReferences', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    localeState.current = 'zh';
  });

  it('waits for demand, shares simultaneous consumers and cancels the abandoned request', async () => {
    mockGet.mockImplementation(() => new Promise(() => {}));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(client);
    const first = renderHook(
      ({ enabled }) => useAiTryOnReferences('pose', { enabled }),
      {
        wrapper,
        initialProps: { enabled: false },
      }
    );
    expect(mockGet).not.toHaveBeenCalled();
    first.rerender({ enabled: true });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    const second = renderHook(() => useAiTryOnReferences('pose'), { wrapper });
    expect(mockGet).toHaveBeenCalledTimes(1);
    const signal = mockGet.mock.calls[0]?.[1]?.signal;
    first.unmount();
    expect(signal?.aborted).toBe(false);
    second.unmount();
    expect(signal?.aborted).toBe(true);
    client.clear();
  });

  it('reuses fresh data but replaces stale data on remount', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = aiTryOnQueryKeys.references('pose', 'zh');
    client.setQueryData(key, [{ id: 'old' }]);
    mockGet.mockResolvedValue({
      data: [{ id: 'new', title: 'Updated' }],
    } as never);
    const first = renderHook(() => useAiTryOnReferences('pose'), {
      wrapper: createWrapper(client),
    });
    expect(first.result.current.data?.[0]?.id).toBe('old');
    expect(mockGet).not.toHaveBeenCalled();
    first.unmount();
    client.setQueryData(key, [{ id: 'old' }], {
      updatedAt: Date.now() - 6 * 60_000,
    });
    const second = renderHook(() => useAiTryOnReferences('pose'), {
      wrapper: createWrapper(client),
    });
    await waitFor(() =>
      expect(second.result.current.data?.[0]?.id).toBe('new')
    );
    client.clear();
  });

  it('refreshes an open library periodically without losing cached data on failure', async () => {
    vi.useFakeTimers();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = aiTryOnQueryKeys.references('pose', 'zh');
    client.setQueryData(key, [{ id: 'cached' }]);
    mockGet.mockResolvedValue({ error: new Error('offline') } as never);
    const view = renderHook(() => useAiTryOnReferences('pose'), {
      wrapper: createWrapper(client),
    });
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000 + 10));
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(view.result.current.isError).toBe(true);
    expect(view.result.current.data?.[0]?.id).toBe('cached');
    view.unmount();
    client.clear();
  });

  it('requests references by kind and current locale and strips storage bucket/key fields', async () => {
    mockGet.mockResolvedValue({
      data: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          kind: 'person',
          title: '正面棚拍女模',
          description: '自然站姿全身照',
          tags: ['studio', 'full-body'],
          thumbnailUrl: 'https://cdn.example.test/person-1.webp',
          sourceUrl: 'https://source.example.test/person-1',
          licenseName: 'CC0 1.0',
          attribution: 'Utils Plane Studio',
          bucket: 'should-not-leak',
          storageKey: 'secret/key.png',
        },
      ],
      error: undefined,
    } as never);

    const { result } = renderHook(() => useAiTryOnReferences('person'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/tasks/ai-try-on/references', {
      params: { query: { kind: 'person', lang: 'zh' } },
      signal: expect.any(AbortSignal),
    });
    expect(result.current.data).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000001',
        kind: 'person',
        title: '正面棚拍女模',
        description: '自然站姿全身照',
        tags: ['studio', 'full-body'],
        thumbnailUrl: 'https://cdn.example.test/person-1.webp',
        sourceUrl: 'https://source.example.test/person-1',
        licenseName: 'CC0 1.0',
        attribution: 'Utils Plane Studio',
      },
    ]);
    expect(result.current.data?.[0]).not.toHaveProperty('bucket');
    expect(result.current.data?.[0]).not.toHaveProperty('storageKey');
  });

  it('switches query key and lang parameter when locale is en', async () => {
    localeState.current = 'en';
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockGet.mockResolvedValue({
      data: {
        items: [
          {
            id: '00000000-0000-4000-8000-000000000002',
            kind: 'garment',
            title: 'Linen blazer',
            tags: ['outerwear'],
            thumbnailUrl: 'https://cdn.example.test/garment-1.webp',
            sourceUrl: 'https://source.example.test/garment-1',
            licenseName: 'CC BY 4.0',
            attribution: 'Studio Archive',
          },
        ],
      },
      error: undefined,
    } as never);

    const { result } = renderHook(() => useAiTryOnReferences('garment'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/tasks/ai-try-on/references', {
      params: { query: { kind: 'garment', lang: 'en' } },
      signal: expect.any(AbortSignal),
    });
    expect(
      queryClient.getQueryData(aiTryOnQueryKeys.references('garment', 'en'))
    ).toHaveLength(1);
  });

  it('surfaces API errors when the reference query fails', async () => {
    const apiError = { message: 'Service unavailable' };
    mockGet.mockResolvedValue({
      data: undefined,
      error: apiError,
    } as never);

    const { result } = renderHook(() => useAiTryOnReferences('pose'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(apiError);
  });

  it('does not replace cached selections with an empty list on a malformed response', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(aiTryOnQueryKeys.references('pose', 'zh'), [
      { id: 'cached' },
    ]);
    mockGet.mockResolvedValue({ data: { message: 'upstream error' } } as never);
    const view = renderHook(() => useAiTryOnReferences('pose'), {
      wrapper: createWrapper(client),
    });
    expect(view.result.current.isError).toBe(false);
    await act(async () => {
      await view.result.current.refetch();
    });
    await waitFor(() => expect(view.result.current.isError).toBe(true));
    expect(view.result.current.data?.[0]?.id).toBe('cached');
    view.unmount();
    client.clear();
  });

  it('normalizes fallback fields cleanly', () => {
    const normalized = normalizeAiTryOnReferenceAsset(
      {
        id: '00000000-0000-4000-8000-000000000003',
        title: 'Pose A',
        imageUrl: 'https://cdn.example.test/pose.webp',
        source: 'https://source.example.test/pose',
        license: 'CC0',
        attribution: 'In-house',
        sortOrder: 2,
      },
      'pose'
    );

    expect(normalized).toEqual({
      id: '00000000-0000-4000-8000-000000000003',
      kind: 'pose',
      title: 'Pose A',
      description: undefined,
      tags: [],
      thumbnailUrl: 'https://cdn.example.test/pose.webp',
      sourceUrl: 'https://source.example.test/pose',
      licenseName: 'CC0',
      licenseUrl: undefined,
      attribution: 'In-house',
      sortOrder: 2,
    });
  });
});
