import { api } from '@/lib/api-client';
import type { TaskStatusDto } from '@/hooks/api/types';

export async function waitForTask(
  taskId: string,
  options?: {
    timeoutMs?: number;
    pollingInterval?: number;
    onProgress?: (progress: number) => void;
  }
): Promise<{ outputFileId: string }> {
  const timeout = options?.timeoutMs ?? 5 * 60 * 1000;
  const interval = options?.pollingInterval ?? 1000;
  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > timeout) {
      throw new Error('Task timeout');
    }

    const { data, error } = await api.GET('/tasks/{id}/status', {
      params: { path: { id: taskId } },
    });
    if (error) throw error;

    const status = data as TaskStatusDto;
    options?.onProgress?.(status.progress);

    if (status.status === 'completed') {
      return { outputFileId: status.outputFileId ?? '' };
    }
    if (status.status === 'failed') {
      throw new Error(status.errorMessage ?? 'Task failed');
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
