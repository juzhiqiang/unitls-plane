import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useBatchPermanentDeleteFiles,
  useBatchRestoreFiles,
  useEmptyTrash,
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
});
