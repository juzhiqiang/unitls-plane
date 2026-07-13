import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccountSummary } from '../use-account';
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
