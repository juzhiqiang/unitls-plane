'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { TaskStatusDto } from './types';

const POLLING_BACKOFF_SECONDS = [1, 2, 3, 5] as const;
const MAX_POLLING_INTERVAL = 5000;

function getPollingInterval(baseInterval: number, dataUpdateCount: number) {
  const backoffIndex = Math.min(
    Math.max(0, dataUpdateCount - 1),
    POLLING_BACKOFF_SECONDS.length - 1
  );
  const multiplier = POLLING_BACKOFF_SECONDS[backoffIndex] ?? 5;
  return Math.min(baseInterval * multiplier, MAX_POLLING_INTERVAL);
}

export function useTaskProgress(
  taskId: string | null,
  options?: {
    pollingInterval?: number;
    onCompleted?: (outputFileId: string) => void;
    onFailed?: (error: { code: string; message: string }) => void;
  }
) {
  const interval = options?.pollingInterval ?? 1000;
  const onCompleted = options?.onCompleted;
  const onFailed = options?.onFailed;
  const calledRef = useRef<string | null>(null);

  const query = useQuery({
    queryKey: ['task-progress', taskId],
    queryFn: async () => {
      const { data, error } = await api.GET('/tasks/status', {
        params: { query: { ids: taskId! } },
      });
      if (error) throw error;

      const row = data?.find(item => item.taskId === taskId);
      if (!row || row.status === 'not_found') {
        throw new Error('Task not found');
      }

      const { taskId: _taskId, ...status } = row;
      return status as TaskStatusDto;
    },
    enabled: !!taskId,
    refetchInterval: q => {
      const status = q.state.data?.status;
      if (status === 'completed' || status === 'failed') return false;
      return getPollingInterval(interval, q.state.dataUpdateCount);
    },
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    const data = query.data;

    if (!data || calledRef.current === taskId) return;

    if (data.status === 'completed') {
      calledRef.current = taskId;
      onCompleted?.(data.outputFileId ?? '');
    } else if (data.status === 'failed') {
      calledRef.current = taskId;
      onFailed?.({
        code: data.errorCode ?? 'UNKNOWN',
        message: data.errorMessage ?? 'Task failed',
      });
    }
  }, [onCompleted, onFailed, query.data, taskId]);

  // Reset when taskId changes
  useEffect(() => {
    calledRef.current = null;
  }, [taskId]);

  return query;
}
