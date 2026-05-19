import createClient from 'openapi-fetch';
import type { paths } from '@utils-plane/api-client';
import { authClient } from './auth-client';

export function createApiClientInstance(baseUrl: string) {
  const client = createClient<paths>({
    baseUrl,
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, credentials: 'include' }),
  });

  client.use({
    async onRequest({ request }) {
      const { data: session } = await authClient.getSession();
      if (session?.session?.token) {
        request.headers.set('Authorization', `Bearer ${session.session.token}`);
      }
      return request;
    },
  });

  return client;
}

export const api = createApiClientInstance(
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
);

export type ApiClient = typeof api;