import { afterEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: getSessionMock,
  },
}));

import { createApiClientInstance } from '../api-client';

describe('createApiClientInstance', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('uses cookies without resolving a session or adding an Authorization header', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { token: 'unexpected-token' } },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createApiClientInstance('https://api.example.com');
    await client.GET('/account/summary');

    expect.soft(getSessionMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [input, init] = fetchMock.mock.calls[0] as ConstructorParameters<
      typeof globalThis.Request
    >;
    const effectiveRequest = new globalThis.Request(input, init);
    expect.soft(effectiveRequest.headers.has('Authorization')).toBe(false);
    expect.soft(init).toMatchObject({ credentials: 'include' });
  });
});
