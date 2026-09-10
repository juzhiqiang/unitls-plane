import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { useSession } from '@/lib/auth-client';
import { api } from '@/lib/api-client';
import type {
  CreateTaskDto,
  ImageGeneratePresetDto,
  ImageGenerateProviderDto,
  ImageGenerateSessionDto,
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
  cursor?: string;
  includeTotal?: boolean;
}

function refreshTaskQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['tasks'] });
  queryClient.invalidateQueries({
    queryKey: accountQueryKeys.summaries(),
  });
  queryClient.invalidateQueries({
    queryKey: taskQueryKeys.imageGenerateQuota(),
  });
  // 建任务后会话列表与会话任务都要刷新(会话从任务派生)。
  queryClient.invalidateQueries({
    queryKey: taskQueryKeys.imageGenerateSessions(),
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
            cursor: query?.cursor,
            includeTotal: query?.cursor !== undefined
              ? (query.includeTotal ?? false)
              : query?.includeTotal,
          } as any,
        },
      });
      if (error) throw error;
      return data as unknown as {
        tasks: TaskResponseDto[];
        total: number | null;
        nextCursor: string | null;
      };
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
      // openapi 生成的 sizes 类型是 string[][],与手写 DTO 不重叠,经 unknown 转换。
      return data as unknown as ImageGenerateProviderDto[];
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

/**
 * 生图会话列表(对话式布局左侧栏)。会话由当前账号的 image_generate 任务按
 * sessionId 派生,所以生图必须登录,这里同样做 session 门控。
 */
export function useImageGenerateSessions() {
  const { data: session, isPending: sessionPending } = useSession();
  const userId = session?.user.id;

  return useQuery({
    queryKey: taskQueryKeys.imageGenerateSessions(),
    queryFn: async () => {
      const { data, error } = await api.GET(
        '/tasks/image-generate/sessions' as any,
        {} as any
      );
      if (error) throw error;
      return data as ImageGenerateSessionDto[];
    },
    enabled: !sessionPending && !!userId,
  });
}

/**
 * 单个会话的任务列表(消息流数据源),createdAt 正序。
 * 还有 pending/processing 任务时每 5s 轮询,与 useTasks 同节奏。
 */
export function useImageGenerateSessionTasks(sessionId: string) {
  const { data: session, isPending: sessionPending } = useSession();
  const userId = session?.user.id;

  return useQuery({
    queryKey: taskQueryKeys.imageGenerateSessionTasks(sessionId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        '/tasks/image-generate/sessions/{sessionId}/tasks' as any,
        { params: { path: { sessionId } } as any }
      );
      if (error) throw error;
      return data as unknown as { tasks: TaskResponseDto[]; total: number };
    },
    enabled: !sessionPending && !!userId && !!sessionId,
    refetchInterval: query => {
      const tasks = (
        query.state.data as { tasks?: TaskResponseDto[] } | undefined
      )?.tasks;
      if (
        tasks?.some(t => t.status === 'pending' || t.status === 'processing')
      ) {
        return 5000;
      }
      return false;
    },
  });
}

/** 删除一个生图会话(任务行 + 产物/参考图文件硬删,不进回收站)。 */
export function useDeleteImageGenerateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await api.DELETE(
        '/tasks/image-generate/sessions/{sessionId}' as any,
        { params: { path: { sessionId } } as any }
      );
      if (error) throw error;
      return data as unknown as { deletedTasks: number };
    },
    onSuccess: () => {
      // 会话从任务派生:删任务后列表、会话任务与任务列表缓存都要刷新。
      queryClient.invalidateQueries({
        queryKey: taskQueryKeys.imageGenerateSessions(),
      });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({
        queryKey: accountQueryKeys.summaries(),
      });
    },
  });
}
