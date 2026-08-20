'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { TaskStatusDto } from './types';

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
      const { data, error } = await api.GET('/tasks/{id}/status', {
        params: { path: { id: taskId! } },
      });
      if (error) throw error;
      return data as TaskStatusDto;
    },
    enabled: !!taskId,
    refetchInterval: q => {
      const status = q.state.data?.status;
      if (status === 'completed' || status === 'failed') return false;
      return interval;
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
