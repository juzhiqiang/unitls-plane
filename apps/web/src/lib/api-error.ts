import { toast } from 'sonner';

export interface ApiError {
  code?: string;
  message: string;
  status?: number;
}

export function handleApiError(error: unknown) {
  const err = error as ApiError;
  const code = err?.code ?? 'UNKNOWN';
  const message = err?.message ?? 'Something went wrong';

  toast.error(message, {
    description: code !== 'UNKNOWN' ? `Code: ${code}` : undefined,
  });
}

export function isApiError(error: unknown): error is ApiError {
  return typeof error === 'object' && error !== null && 'message' in error;
}