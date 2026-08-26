import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { useSession } from '@/lib/auth-client';
import { api } from '@/lib/api-client';
import type {
  CreateTaskDto,
  ImageGeneratePresetDto,
  ImageGenerateProviderDto,
  TaskResponseDto,
  TaskStatusDto,
  TaskTypeValue,
} from './types';
import { accountQueryKeys, taskQueryKeys } from './query-keys';

export type TaskType = TaskTypeValue;
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface TaskQuery {
  page?: number;
  limit?: number;
  status?: TaskStatus;
  type?: TaskType;
}

function refreshTaskQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['tasks'] });
  queryClient.invalidateQueries({
    queryKey: accountQueryKeys.summaries(),
  });
  queryClient.invalidateQueries({
    queryKey: taskQueryKeys.imageGenerateQuota(),
  });
}

export function useTasks(query?: TaskQuery) {
  return useQuery({
    queryKey: ['tasks', query],
    queryFn: async () => {
      const { data, error } = await api.GET('/tasks', {
        params: {
          query: {
            page: query?.page,
            limit: query?.limit,
            status: query?.status,
            type: query?.type,
          } as any,
        },
      });
      if (error) throw error;
      return data as unknown as { tasks: TaskResponseDto[]; total: number };
    },
    refetchInterval: q => {
      const tasks = (q.state.data as any)?.tasks as
        | TaskResponseDto[]
        | undefined;
      if (
        tasks?.some(t => t.status === 'pending' || t.status === 'processing')
      ) {
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
    refetchInterval: query => {
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
      refreshTaskQueries(queryClient);
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
      refreshTaskQueries(queryClient);
    },
  });
}

export function useImageGenerateQuota() {
  const { data: session, isPending: sessionPending } = useSession();
  const userId = session?.user.id;

  return useQuery({
    queryKey: taskQueryKeys.imageGenerateQuota(),
    queryFn: async () => {
      const { data, error } = await api.GET('/tasks/image-generate/quota');
      if (error) throw error;
      return data as { limit: number; used: number; remaining: number };
    },
    enabled: !sessionPending && !!userId,
  });
}

/**
 * 可用生图来源。来自服务端的 AI_IMAGE_PROVIDERS 配置,进程生命周期内不会变,
 * 所以设成永不过期:每次进生图页重新拉一遍没有意义。
 */
export function useImageGenerateProviders() {
  const { data: session, isPending: sessionPending } = useSession();
  const userId = session?.user.id;

  return useQuery({
    queryKey: taskQueryKeys.imageGenerateProviders(),
    queryFn: async () => {
      const { data, error } = await api.GET('/tasks/image-generate/providers');
      if (error) throw error;
      return data as ImageGenerateProviderDto[];
    },
    enabled: !sessionPending && !!userId,
    staleTime: Infinity,
  });
}

/**
 * AI 生图提示词模板。走 DB + MinIO presets 桶下发（见 image_generate_presets 表），
 * 端点是公开的，所以这里不做 session 门控。
 *
 * 服务端按 lang 返回单语言扁平对象，故 queryKey 带上当前 locale：
 * 切语言要重新拉一次，同一语言内容在进程生命周期内不会变，设成永不过期。
 */
export function useImageGeneratePresets() {
  const locale = useLocale();
  const lang = locale === 'en' ? 'en' : 'zh';

  return useQuery({
    queryKey: taskQueryKeys.imageGeneratePresets(lang),
    queryFn: async () => {
      const { data, error } = await api.GET('/tasks/image-generate/presets', {
        params: { query: { lang } } as any,
      });
      if (error) throw error;
      return data as ImageGeneratePresetDto[];
    },
    staleTime: Infinity,
  });
}
