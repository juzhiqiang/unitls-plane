import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { CreateTaskDto, TaskResponseDto, TaskStatusDto } from './types';

export function useTasks(query?: { page?: number; limit?: number; status?: TaskResponseDto['status'] }) {
  return useQuery({
    queryKey: ['tasks', query],
    queryFn: async () => {
      const { data, error } = await api.GET('/tasks', {
        params: { query: { page: query?.page, limit: query?.limit, status: query?.status } },
      });
      if (error) throw error;
      return data;
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