import { api } from '@/lib/api-client';
import type { TaskStatusDto } from '@/hooks/api/types';
import { TASK_WAIT_TIMEOUT_MESSAGE } from './tasks/recovery-errors';

export class TaskWaitTimeoutError extends Error {
  constructor(readonly taskId: string) {
    super(TASK_WAIT_TIMEOUT_MESSAGE);
    this.name = 'TaskWaitTimeoutError';
  }
}

export class TaskFailedError extends Error {
  constructor(
    readonly taskId: string,
    message: string
  ) {
    super(message);
    this.name = 'TaskFailedError';
  }
}

export class TaskUnavailableError extends Error {
  constructor(readonly taskId: string) {
    super('Task is no longer available');
    this.name = 'TaskUnavailableError';
  }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function waitForTask(
  taskId: string,
  options?: {
    timeoutMs?: number;
    pollingInterval?: number;
    onProgress?: (progress: number) => void;
    signal?: AbortSignal;
  }
): Promise<{ outputFileId: string }> {
  const timeout = options?.timeoutMs ?? 5 * 60 * 1000;
  const interval = options?.pollingInterval ?? 1000;
  const controller = new AbortController();
  const abort = () =>
    controller.abort(
      options?.signal?.reason ??
        new DOMException('Stopped waiting', 'AbortError')
    );
  options?.signal?.addEventListener('abort', abort, { once: true });
  if (options?.signal?.aborted) abort();
  const timer = setTimeout(
    () => controller.abort(new TaskWaitTimeoutError(taskId)),
    timeout
  );
  let attempts = 0;
  try {
    while (true) {
      controller.signal.throwIfAborted();
      let result: {
        data?: TaskStatusDto;
        error?: unknown;
        response?: Response;
      };
      try {
        result = (await api.GET('/tasks/{id}/status', {
          params: { path: { id: taskId } },
          signal: controller.signal,
        })) as unknown as {
          data?: TaskStatusDto;
          error?: unknown;
          response?: Response;
        };
      } catch {
        controller.signal.throwIfAborted();
        await pause(
          Math.min(interval * 2 ** Math.min(attempts++, 3), 5000),
          controller.signal
        );
        continue;
      }
      if (result.error) {
        const code = result.response?.status ?? 500;
        if (code === 404 || code === 410)
          throw new TaskUnavailableError(taskId);
        if (code >= 400 && code < 500 && code !== 408 && code !== 429)
          throw result.error;
      } else if (result.data) {
        attempts = 0;
        const status = result.data as TaskStatusDto;
        options?.onProgress?.(status.progress);
        if (status.status === 'completed' && status.outputFileId)
          return { outputFileId: status.outputFileId };
        if (status.status === 'failed')
          throw new TaskFailedError(
            taskId,
            status.errorMessage ?? 'Task failed'
          );
      }
      await pause(
        Math.min(interval * 2 ** Math.min(attempts++, 3), 5000),
        controller.signal
      );
    }
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener('abort', abort);
  }
}
