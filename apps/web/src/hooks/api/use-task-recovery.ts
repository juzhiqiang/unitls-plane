'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import {
  taskIdentityHeaders,
  taskReceipts,
  type TaskReceipt,
} from '@/lib/tasks/task-receipts';
import type { TaskStatusDto } from './types';

export type RecoveredTaskStatus = Omit<TaskStatusDto, 'status'> & {
  taskId: string;
  status: TaskStatusDto['status'] | 'not_found' | 'unconfirmed';
};

/** 批量查询已知任务，逐批找回最多 5 个未确认提交，避免刷新时突发大量请求。 */
export function useTaskRecovery(
  scope: string,
  receipts: readonly TaskReceipt[]
) {
  const signature = receipts
    .map(row => `${row.key}:${row.taskId ?? ''}`)
    .join(',');
  return useQuery({
    queryKey: ['task-recovery', scope, signature],
    enabled: receipts.length > 0,
    queryFn: async ({ signal }) => {
      const known = receipts.filter(row => row.taskId);
      const statuses: RecoveredTaskStatus[] = [];
      if (known.length) {
        const { data, error } = await api.GET('/tasks/status', {
          params: { query: { ids: known.map(row => row.taskId).join(',') } },
          signal,
        });
        if (error) throw error;
        for (const receipt of known) {
          const row = data?.find(item => item.taskId === receipt.taskId);
          if (!row) throw new Error('Incomplete task status response');
          statuses.push(row);
        }
      }
      // 未确认任务一般只有一条。轮转窗口使大量断线回执也能逐步被检查。
      const unknown = receipts.filter(row => !row.taskId);
      const offset = unknown.length
        ? (Math.floor(Date.now() / 5000) * 5) % unknown.length
        : 0;
      const selected = [
        ...unknown.slice(offset),
        ...unknown.slice(0, offset),
      ].slice(0, 5);
      for (const receipt of selected) {
        const { data, error, response } = await api.GET(
          '/tasks/submissions/{key}',
          {
            params: { path: { key: receipt.key } },
            headers: taskIdentityHeaders(scope),
            signal,
          }
        );
        if (error) {
          if (response.status === 410) {
            statuses.push({
              taskId: receipt.key,
              status: 'not_found',
              progress: 0,
            });
            continue;
          }
          if (response.status !== 404) throw error;
        } else if (data) {
          taskReceipts.confirm(scope, receipt, data, false);
          statuses.push({ ...data, taskId: data.id });
        }
      }
      return statuses;
    },
    retry: false,
    refetchInterval: query => {
      if (query.state.error || receipts.some(row => !row.taskId)) return 5000;
      return query.state.data?.every(row =>
        ['completed', 'failed', 'not_found'].includes(row.status)
      )
        ? false
        : 5000;
    },
    refetchIntervalInBackground: false,
  });
}
