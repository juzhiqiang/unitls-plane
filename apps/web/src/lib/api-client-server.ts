import createClient from 'openapi-fetch';
import type { paths } from '@utils-plane/api-client';

export function createApiClientInstance(baseUrl: string) {
  return createClient<paths>({
    baseUrl,
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, credentials: 'include' }),
  });
}

export const api = createApiClientInstance(
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
);

export type ApiClient = typeof api;