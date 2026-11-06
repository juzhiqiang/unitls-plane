import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForTask } from '@/lib/wait-for-task';
import { api } from '@/lib/api-client';
vi.mock('@/lib/api-client', () => ({ api: { GET: vi.fn() } }));
const get = vi.mocked(api.GET);
afterEach(() => vi.resetAllMocks());

describe('waitForTask', () => {
  it('survives a temporary network error without creating another task', async () => {
    get.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue({
      data: { status: 'completed', outputFileId: 'out' },
    } as never);
    await expect(waitForTask('task', { pollingInterval: 1 })).resolves.toEqual({
      outputFileId: 'out',
    });
  });
  it('reports local wait timeout with a recoverable task ID', async () => {
    get.mockResolvedValue({
      data: { status: 'processing', progress: 20 },
    } as never);
    await expect(
      waitForTask('task', { timeoutMs: 10, pollingInterval: 1 })
    ).rejects.toMatchObject({ name: 'TaskWaitTimeoutError', taskId: 'task' });
  });
  it('does not poll when the caller already stopped waiting', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      waitForTask('task', { signal: controller.signal } as never)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(get).not.toHaveBeenCalled();
  });
  it('aborts an outstanding request when the overall deadline expires', async () => {
    get.mockImplementation(
      (_path, options) =>
        new Promise((_resolve, reject) => {
          const signal = (options as { signal?: AbortSignal } | undefined)
            ?.signal;
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        })
    );
    await expect(waitForTask('task', { timeoutMs: 10 })).rejects.toMatchObject({
      name: 'TaskWaitTimeoutError',
      taskId: 'task',
    });
  });
  it('distinguishes a confirmed server failure from a failed status request', async () => {
    get.mockResolvedValue({
      data: { status: 'failed', errorMessage: 'invalid image' },
    } as never);
    await expect(waitForTask('task')).rejects.toMatchObject({
      name: 'TaskFailedError',
      message: 'invalid image',
    });
  });
});
