import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { useTaskProgress } from '../use-task-progress';

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

describe('useTaskProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not fetch when taskId is null', () => {
    renderHook(() => useTaskProgress(null), { wrapper: createWrapper() });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('polls and stops on completed status', async () => {
    mockGet
      .mockResolvedValueOnce({
        data: { status: 'processing', progress: 50 },
        error: undefined,
      } as any)
      .mockResolvedValue({
        data: { status: 'completed', progress: 100, outputFileId: 'file-1' },
        error: undefined,
      } as any);

    const { result } = renderHook(
      () => useTaskProgress('task-1', { pollingInterval: 100 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data?.status).toBe('completed'), {
      timeout: 3000,
    });

    const callCount = mockGet.mock.calls.length;
    // Wait to confirm no more polling
    await new Promise(r => setTimeout(r, 300));
    expect(mockGet.mock.calls.length).toBe(callCount);
  });

  it('calls onCompleted when task completes', async () => {
    const onCompleted = vi.fn();
    mockGet.mockResolvedValue({
      data: { status: 'completed', progress: 100, outputFileId: 'file-1' },
      error: undefined,
    } as any);

    renderHook(
      () => useTaskProgress('task-1', { pollingInterval: 100, onCompleted }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith('file-1'), {
      timeout: 3000,
    });
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it('calls onFailed when task fails', async () => {
    const onFailed = vi.fn();
    mockGet.mockResolvedValue({
      data: {
        status: 'failed',
        progress: 0,
        errorCode: 'ERR_01',
        errorMessage: 'Out of memory',
      },
      error: undefined,
    } as any);

    renderHook(
      () => useTaskProgress('task-1', { pollingInterval: 100, onFailed }),
      { wrapper: createWrapper() }
    );

    await waitFor(
      () =>
        expect(onFailed).toHaveBeenCalledWith({
          code: 'ERR_01',
          message: 'Out of memory',
        }),
      { timeout: 3000 }
    );
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('stops polling on failed status', async () => {
    mockGet.mockResolvedValue({
      data: { status: 'failed', progress: 0, errorMessage: 'error' },
      error: undefined,
    } as any);

    const { result } = renderHook(
      () => useTaskProgress('task-1', { pollingInterval: 100 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data?.status).toBe('failed'), {
      timeout: 3000,
    });

    const callCount = mockGet.mock.calls.length;
    await new Promise(r => setTimeout(r, 300));
    expect(mockGet.mock.calls.length).toBe(callCount);
  });
});
