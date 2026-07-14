import { afterEach, expect, it, vi } from 'bun:test';
import * as authModule from './index';

const { auth, verifySession } = authModule;

type SessionCookieCleanup = (headers: Headers) => Promise<string[]>;

function getSessionCookieCleanup(): SessionCookieCleanup | undefined {
  return (
    authModule as typeof authModule & {
      getSessionCookieExpirationHeaders?: SessionCookieCleanup;
    }
  ).getSessionCookieExpirationHeaders;
}

afterEach(() => {
  vi.restoreAllMocks();
});

it('forces protected session verification to bypass the cookie cache', async () => {
  const getSession = vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
  const headers = new Headers({
    cookie: 'better-auth.session_data=stale-session',
  });

  await verifySession(headers);

  expect(getSession).toHaveBeenCalledWith({
    headers,
    query: { disableCookieCache: true },
  });
});

it('uses Better-Auth to expire token, cache, and chunked session cookies', async () => {
  const cleanup = getSessionCookieCleanup();
  if (!cleanup) {
    expect(cleanup).toBeTypeOf('function');
    return;
  }

  const cookies = await cleanup(
    new Headers({
      cookie: [
        'better-auth.session_token=invalid-token',
        'better-auth.session_data.0=part-zero',
        'better-auth.session_data.1=part-one',
      ].join('; '),
    })
  );

  for (const name of [
    'better-auth.session_token',
    'better-auth.session_data',
    'better-auth.session_data.0',
    'better-auth.session_data.1',
  ]) {
    expect(cookies.some(cookie => cookie.startsWith(`${name}=`))).toBe(true);
  }
  expect(cookies.every(cookie => cookie.includes('Max-Age=0'))).toBe(true);
});

it('preserves secure Better-Auth cookie names from the official response', async () => {
  const cleanup = getSessionCookieCleanup();
  if (!cleanup) {
    expect(cleanup).toBeTypeOf('function');
    return;
  }
  const response = new Response(null);
  response.headers.append(
    'set-cookie',
    '__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly'
  );
  response.headers.append(
    'set-cookie',
    '__Secure-better-auth.session_data.0=; Max-Age=0; Path=/; HttpOnly'
  );
  vi.spyOn(auth.api, 'signOut').mockResolvedValue(response as never);

  const cookies = await cleanup(new Headers());

  expect(cookies).toEqual([
    '__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly',
    '__Secure-better-auth.session_data.0=; Max-Age=0; Path=/; HttpOnly',
  ]);
});

it('treats session cookie cleanup as best effort after account deletion', async () => {
  const cleanup = getSessionCookieCleanup();
  if (!cleanup) {
    expect(cleanup).toBeTypeOf('function');
    return;
  }
  vi.spyOn(auth.api, 'signOut').mockRejectedValue(
    new Error('session row already deleted')
  );

  await expect(cleanup(new Headers())).resolves.toEqual([]);
});
