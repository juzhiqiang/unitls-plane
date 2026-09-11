import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useBatchPermanentDeleteFiles,
  useBatchRestoreFiles,
  useEmptyTrash,
  useFile,
  useFiles,
  useTrashedFiles,
} from '../use-files';
import { accountQueryKeys } from '../query-keys';

vi.mock('@/lib/api-client', () => ({
  api: {
    DELETE: vi.fn(),
    POST: vi.fn(),
    GET: vi.fn(),
  },
}));

import { api } from '@/lib/api-client';

const mockDelete = vi.mocked(api.DELETE);
const mockPost = vi.mocked(api.POST);
const mockGet = vi.mocked(api.GET);

function createWrapper(queryClient = new QueryClient()) {
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('file trash mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDelete.mockResolvedValue({
      data: { success: true },
      error: undefined,
    } as never);
    mockPost.mockResolvedValue({
      data: { success: true },
      error: undefined,
    } as never);
  });

  it('batch restores trashed files and refreshes file queries', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useBatchRestoreFiles(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(['file-1', 'file-2']);
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/files/batch-restore' as never,
      {
        body: { ids: ['file-1', 'file-2'] },
      } as never
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['files'] })
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: accountQueryKeys.summaries(),
    });
  });

  it('batch permanently deletes trashed files and refreshes file queries', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useBatchPermanentDeleteFiles(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(['file-1', 'file-2']);
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/files/batch-permanent-delete' as never,
      {
        body: { ids: ['file-1', 'file-2'] },
      } as never
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['files'] })
    );
  });

  it('empties trash and refreshes file queries', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useEmptyTrash(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(mockDelete).toHaveBeenCalledWith('/files/trash/empty' as never, {});
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['files'] })
    );
  });
});

describe('file list cursor queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({
      data: { files: [], total: null, nextCursor: null },
      error: undefined,
    } as never);
  });

  it('uses cursor-only totals for active file pagination', async () => {
    const { result } = renderHook(
      () => useFiles({ cursor: 'cursor-1', limit: 20 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/files', {
      params: {
        query: {
          page: '1',
          limit: '20',
          cursor: 'cursor-1',
          includeTotal: 'false',
        },
      },
    });
  });

  it('uses cursor-only totals for trash pagination', async () => {
    const { result } = renderHook(
      () => useTrashedFiles({ cursor: 'cursor-1', limit: 20 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/files/trash', {
      params: {
        query: {
          page: '1',
          limit: '20',
          cursor: 'cursor-1',
          includeTotal: 'false',
        },
      },
    });
  });

  it('isolates active file list cache entries by userId without forwarding it to the API', async () => {
    const queryClient = new QueryClient();
    const query = { cursor: 'cursor-1', limit: 20 };

    renderHook(() => useFiles(query, 'user-1'), {
      wrapper: createWrapper(queryClient),
    });
    renderHook(() => useFiles(query, 'user-2'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryCache().findAll({ queryKey: ['files'] })
      ).toHaveLength(2)
    );
    expect(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: ['files'] })
        .map(entry => entry.queryKey)
    ).toEqual(
      expect.arrayContaining([
        ['files', 'user-1', query],
        ['files', 'user-2', query],
      ])
    );
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet).toHaveBeenNthCalledWith(1, '/files', {
      params: {
        query: {
          page: '1',
          limit: '20',
          cursor: 'cursor-1',
          includeTotal: 'false',
        },
      },
    });
  });

  it('isolates trash file list cache entries by userId without forwarding it to the API', async () => {
    const queryClient = new QueryClient();
    const query = { cursor: 'cursor-1', limit: 20 };

    renderHook(() => useTrashedFiles(query, 'user-1'), {
      wrapper: createWrapper(queryClient),
    });
    renderHook(() => useTrashedFiles(query, 'user-2'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryCache().findAll({ queryKey: ['files', 'trash'] })
      ).toHaveLength(2)
    );
    expect(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: ['files', 'trash'] })
        .map(entry => entry.queryKey)
    ).toEqual(
      expect.arrayContaining([
        ['files', 'trash', 'user-1', query],
        ['files', 'trash', 'user-2', query],
      ])
    );
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet).toHaveBeenNthCalledWith(1, '/files/trash', {
      params: {
        query: {
          page: '1',
          limit: '20',
          cursor: 'cursor-1',
          includeTotal: 'false',
        },
      },
    });
  });

  it('isolates file detail cache entries by userId without forwarding it to the API', async () => {
    const queryClient = new QueryClient();
    mockGet.mockResolvedValue({
      data: { id: 'file-1', userId: 'user-1' },
      error: undefined,
    } as never);

    renderHook(() => useFile('file-1', 'user-1'), {
      wrapper: createWrapper(queryClient),
    });
    renderHook(() => useFile('file-1', 'user-2'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryCache().findAll({ queryKey: ['files'] })
      ).toHaveLength(2)
    );
    expect(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: ['files'] })
        .map(entry => entry.queryKey)
    ).toEqual(
      expect.arrayContaining([
        ['files', 'user-1', 'file-1'],
        ['files', 'user-2', 'file-1'],
      ])
    );
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet).toHaveBeenNthCalledWith(1, '/files/{id}', {
      params: { path: { id: 'file-1' } },
    });
  });
});
