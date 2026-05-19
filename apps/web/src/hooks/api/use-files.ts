import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function useFiles(query?: { page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['files', query],
    queryFn: async () => {
      const { data, error } = await api.GET('/files', {
        params: { query: { page: String(query?.page ?? 1), limit: String(query?.limit ?? 10) } },
      });
      if (error) throw error;
      return data;
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
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
}

export function useFile(fileId: string) {
  return useQuery({
    queryKey: ['files', fileId],
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
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
}