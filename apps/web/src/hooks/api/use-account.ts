import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { api } from '@/lib/api-client';
import { accountQueryKeys } from './query-keys';

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
