import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadAccountExport,
  getAccountExportUrl,
  useAccountSummary,
  useDeleteAccount,
} from '../use-account';
import { accountQueryKeys } from '../query-keys';

const sessionState = vi.hoisted(() => ({
  current: {
    data: { user: { id: 'user-1' } },
    isPending: false,
  } as { data: { user: { id: string } } | null; isPending: boolean },
}));

vi.mock('@/lib/auth-client', () => ({
  useSession: () => sessionState.current,
}));

vi.mock('@/lib/api-client', () => ({
  api: {
    GET: vi.fn(),
    DELETE: vi.fn(),
  },
}));

import { api } from '@/lib/api-client';

const mockGet = vi.mocked(api.GET);
const mockDelete = vi.mocked(api.DELETE);

function createWrapper(
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
) {
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useAccountSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionState.current = {
      data: { user: { id: 'user-1' } },
      isPending: false,
    };
  });

  it('loads the authenticated account summary', async () => {
    const summary = {
      activeTaskCount: 7,
      failedTaskCount: 4,
      activeFileCount: 23,
      activeFileBytes: 123456,
      recentTasks: [],
      recentFiles: [],
    };
    mockGet.mockResolvedValue({ data: summary, error: undefined } as never);

    const { result } = renderHook(() => useAccountSummary(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/account/summary');
    expect(result.current.data).toEqual(summary);
  });

  it('does not request an account summary without a session', async () => {
    sessionState.current = { data: null, isPending: false };
    mockGet.mockResolvedValue({
      data: {
        activeTaskCount: 0,
        failedTaskCount: 0,
        activeFileCount: 0,
        activeFileBytes: 0,
        recentTasks: [],
        recentFiles: [],
      },
      error: undefined,
    } as never);

    const { result } = renderHook(() => useAccountSummary(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('does not reuse the previous account data after the session changes', async () => {
    const firstSummary = {
      activeTaskCount: 7,
      failedTaskCount: 4,
      activeFileCount: 23,
      activeFileBytes: 123456,
      recentTasks: [],
      recentFiles: [],
    };
    const secondSummary = {
      activeTaskCount: 1,
      failedTaskCount: 0,
      activeFileCount: 2,
      activeFileBytes: 2048,
      recentTasks: [],
      recentFiles: [],
    };
    let resolveSecondRequest!: (value: unknown) => void;
    mockGet
      .mockResolvedValueOnce({ data: firstSummary, error: undefined } as never)
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveSecondRequest = resolve;
          }) as never
      );

    const { result, rerender } = renderHook(() => useAccountSummary(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual(firstSummary));

    sessionState.current = {
      data: { user: { id: 'user-2' } },
      isPending: false,
    };
    rerender();

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBeUndefined();

    resolveSecondRequest({ data: secondSummary, error: undefined });
    await waitFor(() => expect(result.current.data).toEqual(secondSummary));
  });

  it('polls every five seconds while account tasks are active', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockGet.mockResolvedValue({
      data: {
        activeTaskCount: 1,
        failedTaskCount: 0,
        activeFileCount: 0,
        activeFileBytes: 0,
        recentTasks: [],
        recentFiles: [],
      },
      error: undefined,
    } as never);

    const { result } = renderHook(() => useAccountSummary(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = queryClient.getQueryCache().find({
      queryKey: accountQueryKeys.summary('user-1'),
    });
    expect(query?.options.refetchInterval).toBeTypeOf('function');
    expect(
      (
        query?.options.refetchInterval as (currentQuery: typeof query) => number
      )(query)
    ).toBe(5000);
  });

  it('polls every thirty seconds when account tasks are idle', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockGet.mockResolvedValue({
      data: {
        activeTaskCount: 0,
        failedTaskCount: 0,
        activeFileCount: 0,
        activeFileBytes: 0,
        recentTasks: [],
        recentFiles: [],
      },
      error: undefined,
    } as never);

    const { result } = renderHook(() => useAccountSummary(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = queryClient.getQueryCache().find({
      queryKey: accountQueryKeys.summary('user-1'),
    });
    expect(query?.options.refetchInterval).toBeTypeOf('function');
    expect(
      (
        query?.options.refetchInterval as (currentQuery: typeof query) => number
      )(query)
    ).toBe(30000);
  });
});

describe('account export and deletion', () => {
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
  const mockFetch = vi.fn();
  const createObjectURL = vi.fn(() => 'blob:account-export');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_API_URL;
    vi.stubGlobal('fetch', mockFetch);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
  });

  afterEach(() => {
    if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  });

  it('builds the export URL from the configured API URL with a fallback', () => {
    expect(getAccountExportUrl()).toBe('http://localhost:3001/account/export');

    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/';
    expect(getAccountExportUrl()).toBe(
      'https://api.example.com/account/export'
    );
  });

  it('downloads a successful export with a safe filename and revokes its object URL', async () => {
    const blob = new Blob(['zip-body'], { type: 'application/zip' });
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({
        'content-disposition': 'attachment; filename="../../account.zip"',
      }),
      blob: vi.fn().mockResolvedValue(blob),
    });
    const clickedDownloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clickedDownloads.push(this.download);
    });

    await downloadAccountExport();

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/account/export',
      { credentials: 'include' }
    );
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickedDownloads).toEqual(['account.zip']);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:account-export');
  });

  it.each([401, 500])(
    'rejects an account export HTTP %s response without creating a download',
    async status => {
      mockFetch.mockResolvedValue({
        ok: false,
        status,
        headers: new Headers(),
      });

      await expect(downloadAccountExport()).rejects.toThrow(
        'Account export request failed'
      );
      expect(createObjectURL).not.toHaveBeenCalled();
    }
  );

  it('sends the confirmation email when deleting an account', async () => {
    mockDelete.mockResolvedValue({
      data: undefined,
      error: undefined,
    } as never);
    const { result } = renderHook(() => useDeleteAccount(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync('owner@example.com');
    });

    expect(mockDelete).toHaveBeenCalledWith('/account', {
      body: { confirmationEmail: 'owner@example.com' },
    });
  });

  it('clears the query cache after account deletion succeeds', async () => {
    const queryClient = new QueryClient();
    const clear = vi.spyOn(queryClient, 'clear');
    mockDelete.mockResolvedValue({
      data: undefined,
      error: undefined,
    } as never);
    const { result } = renderHook(() => useDeleteAccount(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync('owner@example.com');
    });

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('preserves the query cache when account deletion fails', async () => {
    const queryClient = new QueryClient();
    const clear = vi.spyOn(queryClient, 'clear');
    const error = { message: 'Account deletion is incomplete' };
    mockDelete.mockResolvedValue({ data: undefined, error } as never);
    const { result } = renderHook(() => useDeleteAccount(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      act(async () => result.current.mutateAsync('owner@example.com'))
    ).rejects.toBe(error);
    expect(clear).not.toHaveBeenCalled();
  });
});
