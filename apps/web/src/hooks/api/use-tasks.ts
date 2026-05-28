import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { CreateTaskDto, TaskResponseDto, TaskStatusDto, TaskTypeValue } from './types';

export type TaskType = TaskTypeValue;
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface TaskQuery {
  page?: number;
  limit?: number;
  status?: TaskStatus;
  type?: TaskType;
}

export function useTasks(query?: TaskQuery) {
  return useQuery({
    queryKey: ['tasks', query],
    queryFn: async () => {
      const { data, error } = await api.GET('/tasks', {
        params: { query: { page: query?.page, limit: query?.limit, status: query?.status, type: query?.type } as any },
      });
      if (error) throw error;
      return data as unknown as { tasks: TaskResponseDto[]; total: number };
    },
    refetchInterval: (q) => {
      const tasks = (q.state.data as any)?.tasks as TaskResponseDto[] | undefined;
      if (tasks?.some((t) => t.status === 'pending' || t.status === 'processing')) {
        return 5000;
      }
      return false;
    },
  });
}

export function useTask(taskId: string) {
  return useQuery({
    queryKey: ['tasks', taskId],
    queryFn: async () => {
      const { data, error } = await api.GET('/tasks/{id}', {
        params: { path: { id: taskId } },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!taskId,
  });
}

export function useTaskStatus(taskId: string) {
  return useQuery({
    queryKey: ['tasks', taskId, 'status'],
    queryFn: async () => {
      const { data, error } = await api.GET('/tasks/{id}/status', {
        params: { path: { id: taskId } },
      });
      if (error) throw error;
      return data as TaskStatusDto;
    },
    enabled: !!taskId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'pending' || status === 'processing' ? 3000 : false;
    },
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (task: CreateTaskDto) => {
      const { data, error } = await api.POST('/tasks', { body: task as any });
      if (error) throw error;
      return data as TaskResponseDto;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useRetryTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const { data, error } = await api.POST('/tasks/{id}/retry' as any, {
        params: { path: { id: taskId } } as any,
      });
      if (error) throw error;
      return data as TaskResponseDto;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
