import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accountQueryKeys, taskQueryKeys } from '../query-keys';
import { useCreateTask, useImageGenerateQuota, useRetryTask } from '../use-tasks';

// useImageGenerateQuota 依赖 useSession 决定是否启用查询,用 hoisted 状态在用例间切换登录态。
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
    POST: vi.fn(),
    GET: vi.fn(),
  },
}));

import { api } from '@/lib/api-client';

const mockPost = vi.mocked(api.POST);
const mockGet = vi.mocked(api.GET);
const task = {
  id: 'task-1',
  userId: 'user-1',
  type: 'pdf_merge',
  status: 'pending',
  inputFileIds: ['file-1'],
  progress: 0,
  createdAt: '2026-07-14T00:00:00.000Z',
} as const;

function createWrapper(
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
) {
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('task mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({ data: task, error: undefined } as never);
    sessionState.current = {
      data: { user: { id: 'user-1' } },
      isPending: false,
    };
  });

  it('refreshes task, account summary, and image-generate quota queries after creating a task', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateTask(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        type: 'pdf_merge',
        inputFileIds: ['file-1'],
      });
    });

    expect(mockPost).toHaveBeenCalledWith('/tasks', {
      body: { type: 'pdf_merge', inputFileIds: ['file-1'] },
    });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks'] })
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: accountQueryKeys.summaries(),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: taskQueryKeys.imageGenerateQuota(),
    });
  });

  it('refreshes task, account summary, and image-generate quota queries after retrying a task', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRetryTask(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync('task-1');
    });

    expect(mockPost).toHaveBeenCalledWith('/tasks/{id}/retry', {
      params: { path: { id: 'task-1' } },
    });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks'] })
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: accountQueryKeys.summaries(),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: taskQueryKeys.imageGenerateQuota(),
    });
  });
});

describe('useImageGenerateQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionState.current = {
      data: { user: { id: 'user-1' } },
      isPending: false,
    };
  });

  it('fetches the daily quota snapshot for an authenticated user', async () => {
    const quota = { limit: 10, used: 3, remaining: 7 };
    mockGet.mockResolvedValue({ data: quota, error: undefined } as never);

    const { result } = renderHook(() => useImageGenerateQuota(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/tasks/image-generate/quota');
    expect(result.current.data).toEqual(quota);
  });

  it('stays idle and does not call the API without a session', async () => {
    sessionState.current = { data: null, isPending: false };
    mockGet.mockResolvedValue({
      data: { limit: 0, used: 0, remaining: 0 },
      error: undefined,
    } as never);

    const { result } = renderHook(() => useImageGenerateQuota(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('stays idle while the session is still loading', async () => {
    sessionState.current = { data: null, isPending: true };
    mockGet.mockResolvedValue({
      data: { limit: 0, used: 0, remaining: 0 },
      error: undefined,
    } as never);

    const { result } = renderHook(() => useImageGenerateQuota(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('throws when the API returns an error', async () => {
    const error = { message: 'Unauthorized' };
    mockGet.mockResolvedValue({ data: undefined, error } as never);

    const { result } = renderHook(() => useImageGenerateQuota(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(error);
  });
});
