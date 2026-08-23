import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { useTaskGroupProgress } from '../use-task-group-progress';

vi.mock('@/lib/api-client', () => ({
  api: {
    GET: vi.fn(),
  },
}));

import { api } from '@/lib/api-client';
const mockGet = vi.mocked(api.GET);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

function statusFor(id: string) {
  if (id === 'task-1') {
    return { status: 'completed', progress: 100, outputFileId: 'file-1' };
  }
  return {
    status: 'failed',
    progress: 0,
    errorCode: 'AI_IMAGE_GENERATION_FAILED',
    errorMessage: 'Image generation failed',
  };
}

describe('useTaskGroupProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not fetch for an empty id list', () => {
    renderHook(() => useTaskGroupProgress([]), { wrapper: createWrapper() });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns one item per task id, keyed in input order', async () => {
    mockGet.mockImplementation((async (_path: string, init: any) => ({
      data: statusFor(init.params.path.id),
      error: undefined,
    })) as any);

    const { result } = renderHook(
      () =>
        useTaskGroupProgress(['task-1', 'task-2'], { pollingInterval: 100 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.items).toHaveLength(2), {
      timeout: 3000,
    });
    expect(result.current.items.map(item => item.taskId)).toEqual([
      'task-1',
      'task-2',
    ]);
    expect(result.current.completedCount).toBe(1);
    expect(result.current.failedCount).toBe(1);
    expect(result.current.settled).toBe(true);
  });

  it('stops polling once every task reaches a terminal state', async () => {
    mockGet.mockImplementation((async (_path: string, init: any) => ({
      data: statusFor(init.params.path.id),
      error: undefined,
    })) as any);

    const { result } = renderHook(
      () =>
        useTaskGroupProgress(['task-1', 'task-2'], { pollingInterval: 100 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.settled).toBe(true), {
      timeout: 3000,
    });

    const callCount = mockGet.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(mockGet.mock.calls.length).toBe(callCount);
  });

  it('reports each terminal task exactly once', async () => {
    const onItemCompleted = vi.fn();
    const onItemFailed = vi.fn();
    mockGet.mockImplementation((async (_path: string, init: any) => ({
      data: statusFor(init.params.path.id),
      error: undefined,
    })) as any);

    renderHook(
      () =>
        useTaskGroupProgress(['task-1', 'task-2'], {
          pollingInterval: 100,
          onItemCompleted,
          onItemFailed,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(onItemCompleted).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    await new Promise(resolve => setTimeout(resolve, 300));

    expect(onItemCompleted).toHaveBeenCalledWith('task-1', 'file-1');
    expect(onItemFailed).toHaveBeenCalledTimes(1);
    expect(onItemFailed).toHaveBeenCalledWith('task-2', {
      code: 'AI_IMAGE_GENERATION_FAILED',
      message: 'Image generation failed',
    });
  });

  it('reports an early terminal task once while later tasks keep polling', async () => {
    const onItemCompleted = vi.fn();
    const onItemFailed = vi.fn();
    const roundsPerTask: Record<string, number> = {};

    // task-1 首轮就完成;task-2 前两轮 processing,第 3 轮才失败。
    // task-2 每轮 progress 递增,避免 react-query 结构共享让 data 引用保持不变,
    // 这样上报 effect 每轮都会重跑 —— 去重失效时 task-1 会被重复上报。
    mockGet.mockImplementation((async (_path: string, init: any) => {
      const id = init.params.path.id as string;
      roundsPerTask[id] = (roundsPerTask[id] ?? 0) + 1;
      const round = roundsPerTask[id];

      if (id === 'task-1') {
        return {
          data: { status: 'completed', progress: 100, outputFileId: 'file-1' },
          error: undefined,
        };
      }
      if (round < 3) {
        return {
          data: { status: 'processing', progress: round * 20 },
          error: undefined,
        };
      }
      return {
        data: {
          status: 'failed',
          progress: 0,
          errorCode: 'AI_IMAGE_GENERATION_FAILED',
          errorMessage: 'Image generation failed',
        },
        error: undefined,
      };
    }) as any);

    const { result } = renderHook(
      () =>
        useTaskGroupProgress(['task-1', 'task-2'], {
          pollingInterval: 50,
          onItemCompleted,
          onItemFailed,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.settled).toBe(true), {
      timeout: 3000,
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    // 确认真的经过了多轮轮询,否则这条用例失去意义。
    expect(roundsPerTask['task-2']).toBeGreaterThanOrEqual(3);
    expect(onItemCompleted).toHaveBeenCalledTimes(1);
    expect(onItemCompleted).toHaveBeenCalledWith('task-1', 'file-1');
    expect(onItemFailed).toHaveBeenCalledTimes(1);
    expect(onItemFailed).toHaveBeenCalledWith('task-2', {
      code: 'AI_IMAGE_GENERATION_FAILED',
      message: 'Image generation failed',
    });
  });
});
