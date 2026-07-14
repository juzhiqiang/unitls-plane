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

const ACCOUNT_EXPORT_FALLBACK_FILENAME = 'utils-plane-export.zip';

function getAccountExportFilename(contentDisposition: string | null): string {
  if (!contentDisposition) return ACCOUNT_EXPORT_FALLBACK_FILENAME;

  const encoded = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = contentDisposition.match(/filename="([^"]+)"/i)?.[1];
  let filename = encoded ?? plain;
  if (!filename) return ACCOUNT_EXPORT_FALLBACK_FILENAME;

  try {
    filename = decodeURIComponent(filename);
  } catch {
    return ACCOUNT_EXPORT_FALLBACK_FILENAME;
  }

  filename = filename.replace(/\\/g, '/').split('/').pop()?.trim() ?? '';
  filename = filename
    .replace(/[\u0000-\u001f\u007f-\u009f<>:"/\\|?*]/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 180);
  return filename || ACCOUNT_EXPORT_FALLBACK_FILENAME;
}

export async function downloadAccountExport(): Promise<void> {
  const response = await fetch(getAccountExportUrl(), {
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Account export request failed');

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = getAccountExportFilename(
    response.headers.get('content-disposition')
  );
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
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
