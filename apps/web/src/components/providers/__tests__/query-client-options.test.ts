import { describe, expect, it } from 'vitest';
import { queryClientOptions } from '../query-client-options';

describe('queryClientOptions', () => {
  it('uses performance-friendly defaults for cached API data', () => {
    expect(queryClientOptions.defaultOptions?.queries).toMatchObject({
      staleTime: 30_000,
      gcTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
    });
  });
});
