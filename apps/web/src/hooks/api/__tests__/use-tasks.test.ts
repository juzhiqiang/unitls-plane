import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accountQueryKeys } from '../query-keys';
import { useCreateTask, useRetryTask } from '../use-tasks';

vi.mock('@/lib/api-client', () => ({
  api: {
    POST: vi.fn(),
  },
}));

import { api } from '@/lib/api-client';

const mockPost = vi.mocked(api.POST);
const task = {
  id: 'task-1',
  userId: 'user-1',
  type: 'pdf_merge',
  status: 'pending',
  inputFileIds: ['file-1'],
  progress: 0,
  createdAt: '2026-07-14T00:00:00.000Z',
} as const;

function createWrapper(queryClient: QueryClient) {
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('task mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({ data: task, error: undefined } as never);
  });

  it('refreshes task and account summary queries after creating a task', async () => {
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
  });

  it('refreshes task and account summary queries after retrying a task', async () => {
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
  });
});
