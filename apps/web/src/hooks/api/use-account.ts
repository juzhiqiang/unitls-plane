import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { api } from '@/lib/api-client';
import { accountQueryKeys } from './query-keys';

export function getAccountExportUrl() {
  const apiUrl = (
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
  ).replace(/\/+$/, '');
  return `${apiUrl}/account/export`;
}

export async function downloadAccountExport(): Promise<void> {
  const anchor = document.createElement('a');
  anchor.href = getAccountExportUrl();
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (email: string) => {
      const { error } = await api.DELETE('/account', {
        body: { confirmationEmail: email },
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.clear(),
  });
}

export function useAccountSummary() {
  const { data: session, isPending: sessionPending } = useSession();
  const userId = session?.user.id;

  return useQuery({
    queryKey: accountQueryKeys.summary(userId),
    queryFn: async () => {
      const { data, error } = await api.GET('/account/summary');
      if (error) throw error;
      return data;
    },
    enabled: !sessionPending && !!userId,
    refetchInterval: query =>
      query.state.data?.activeTaskCount ? 5000 : 30000,
  });
}
