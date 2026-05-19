import createClient from 'openapi-fetch';
import type { paths } from './schema';

export function createApiClient(
  baseUrl: string,
  getToken?: () => Promise<string | null>
) {
  const client = createClient<paths>({ baseUrl });

  client.use({
    async onRequest({ request }) {
      const token = await getToken?.();
      if (token) {
        request.headers.set('Authorization', `Bearer ${token}`);
      }
      return request;
    },
  });

  return client;
}

export type { paths, components } from './schema';