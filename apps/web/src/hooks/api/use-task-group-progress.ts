'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { TaskStatusDto } from './types';

export interface TaskGroupProgressItem extends TaskStatusDto {
  taskId: string;
}

export interface UseTaskGroupProgressOptions {
  pollingInterval?: number;
  onItemCompleted?: (taskId: string, outputFileId: string) => void;
  onItemFailed?: (
    taskId: string,
    error: { code: string; message: string }
  ) => void;
}

function isTerminal(status: TaskStatusDto['status']): boolean {
  return status === 'completed' || status === 'failed';
}

/**
 * 同时轮询多个任务的状态。
 *
 * 用单个 query 而不是 N 个 useTaskProgress:Hook 不能按可变长度循环调用。
 * 全部任务进入终态后停止轮询,每个任务的终态回调只触发一次。
 */
export function useTaskGroupProgress(
  taskIds: string[],
  options?: UseTaskGroupProgressOptions
) {
  const interval = options?.pollingInterval ?? 1000;
  const onItemCompleted = options?.onItemCompleted;
  const onItemFailed = options?.onItemFailed;
  const groupKey = taskIds.join(',');
  const reportedRef = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ['task-group-progress', groupKey],
    queryFn: async () =>
      Promise.all(
        taskIds.map(async taskId => {
          const { data, error } = await api.GET('/tasks/{id}/status', {
            params: { path: { id: taskId } },
          });
          if (error) throw error;
          return { taskId, ...(data as TaskStatusDto) };
        })
      ),
    enabled: taskIds.length > 0,
    refetchInterval: q => {
      const items = q.state.data;
      if (items && items.every(item => isTerminal(item.status))) return false;
      return interval;
    },
    refetchIntervalInBackground: false,
  });

  const items = useMemo<TaskGroupProgressItem[]>(
    () => query.data ?? [],
    [query.data]
  );

  useEffect(() => {
    reportedRef.current = new Set();
  }, [groupKey]);

  useEffect(() => {
    for (const item of items) {
      if (!isTerminal(item.status) || reportedRef.current.has(item.taskId)) {
        continue;
      }
      reportedRef.current.add(item.taskId);

      if (item.status === 'completed') {
        onItemCompleted?.(item.taskId, item.outputFileId ?? '');
      } else {
        onItemFailed?.(item.taskId, {
          code: item.errorCode ?? 'UNKNOWN',
          message: item.errorMessage ?? 'Task failed',
        });
      }
    }
  }, [items, onItemCompleted, onItemFailed]);

  return {
    items,
    completedCount: items.filter(item => item.status === 'completed').length,
    failedCount: items.filter(item => item.status === 'failed').length,
    settled: items.length > 0 && items.every(item => isTerminal(item.status)),
    query,
  };
}
