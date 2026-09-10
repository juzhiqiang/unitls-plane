import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { accountQueryKeys } from './query-keys';

export interface FileRecord {
  id: string;
  userId: string | null;
  filename: string;
  originalSize: number;
  storageKey: string;
  bucket: string;
  mimeType: string;
  metadata: unknown;
  expiresAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileListResponse {
  files: FileRecord[];
  total: number | null;
  nextCursor: string | null;
}

export interface FileQuery {
  page?: number;
  limit?: number;
  mimeType?: string;
  search?: string;
  cursor?: string;
  includeTotal?: boolean;
}

function refreshFileQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['files'] });
}

function refreshActiveFileQueries(
  queryClient: ReturnType<typeof useQueryClient>
) {
  refreshFileQueries(queryClient);
  queryClient.invalidateQueries({
    queryKey: accountQueryKeys.summaries(),
  });
}

export function useFiles(query?: FileQuery, userId?: string) {
  return useQuery({
    queryKey: ['files', userId, query],
    queryFn: async () => {
      const params: Record<string, string> = {
        page: String(query?.page ?? 1),
        limit: String(query?.limit ?? 10),
      };
      if (query?.mimeType) params.mimeType = query.mimeType;
      if (query?.search) params.search = query.search;
      if (query?.cursor !== undefined) {
        params.cursor = query.cursor;
        params.includeTotal = String(query.includeTotal ?? false);
      } else if (query?.includeTotal !== undefined) {
        params.includeTotal = String(query.includeTotal);
      }

      const { data, error } = await api.GET('/files', {
        params: { query: params as any },
      });
      if (error) throw error;
      return data as unknown as FileListResponse;
    },
  });
}

export function useTrashedFiles(
  query?: {
    page?: number;
    limit?: number;
    cursor?: string;
    includeTotal?: boolean;
  },
  userId?: string
) {
  return useQuery({
    queryKey: ['files', 'trash', userId, query],
    queryFn: async () => {
      const { data, error } = await api.GET('/files/trash' as any, {
        params: {
          query: {
            page: String(query?.page ?? 1),
            limit: String(query?.limit ?? 10),
            ...(query?.cursor !== undefined ? { cursor: query.cursor } : {}),
            ...(query?.cursor !== undefined || query?.includeTotal !== undefined
              ? { includeTotal: String(query.includeTotal ?? false) }
              : {}),
          },
        },
      });
      if (error) throw error;
      return data as unknown as FileListResponse;
    },
  });
}

export function useUploadFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const { data, error } = await api.POST('/files/upload', {
        body: formData as unknown as undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      refreshActiveFileQueries(queryClient);
    },
  });
}

export function useFile(fileId: string, userId?: string) {
  return useQuery({
    queryKey: ['files', userId, fileId],
    queryFn: async () => {
      const { data, error } = await api.GET('/files/{id}', {
        params: { path: { id: fileId } },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!fileId,
  });
}

export function useDeleteFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (fileId: string) => {
      const { data, error } = await api.DELETE('/files/{id}', {
        params: { path: { id: fileId } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      refreshActiveFileQueries(queryClient);
    },
  });
}

export function useBatchDeleteFiles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await api.POST('/files/batch-delete' as any, {
        body: { ids } as any,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      refreshActiveFileQueries(queryClient);
    },
  });
}

export function useRestoreFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (fileId: string) => {
      const { data, error } = await api.POST('/files/{id}/restore' as any, {
        params: { path: { id: fileId } } as any,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      refreshActiveFileQueries(queryClient);
    },
  });
}

export function usePermanentDeleteFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (fileId: string) => {
      const { data, error } = await api.DELETE('/files/{id}/permanent' as any, {
        params: { path: { id: fileId } } as any,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      refreshFileQueries(queryClient);
    },
  });
}

export function useBatchRestoreFiles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await api.POST('/files/batch-restore' as any, {
        body: { ids } as any,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      refreshActiveFileQueries(queryClient);
    },
  });
}

export function useBatchPermanentDeleteFiles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await api.POST(
        '/files/batch-permanent-delete' as any,
        {
          body: { ids } as any,
        }
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      refreshFileQueries(queryClient);
    },
  });
}

export function useEmptyTrash() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await api.DELETE('/files/trash/empty' as any, {});
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      refreshFileQueries(queryClient);
    },
  });
}
