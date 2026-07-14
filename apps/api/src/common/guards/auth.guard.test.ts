import { afterEach, beforeEach, expect, it, mock, vi } from 'bun:test';
import { UnauthorizedException } from '@nestjs/common';
import { auth, getSessionCookieExpirationHeaders } from '@utils-plane/auth';

const cachedSession = {
  user: { id: 'deleted-user', email: 'owner@example.com' },
  session: { id: 'deleted-session', userId: 'deleted-user' },
};
const verifySession = vi.fn().mockResolvedValue(null);

mock.module('@utils-plane/auth', () => ({
  auth,
  getSessionCookieExpirationHeaders,
  verifySession,
}));

const { AuthGuard } = await import('./auth.guard');

beforeEach(() => {
  vi.clearAllMocks();
  verifySession.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('rejects a stale cookie-cache session after the database session is gone', async () => {
  const request: Record<string, unknown> = {
    headers: { cookie: 'better-auth.session_data=stale-session' },
  };
  const context = {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  };
  const reflector = { getAllAndOverride: vi.fn(() => false) };
  const guard = new AuthGuard(reflector as never);
  const getSession = vi
    .spyOn(auth.api, 'getSession')
    .mockResolvedValue(cachedSession as never);

  await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(
    UnauthorizedException
  );

  expect(verifySession).toHaveBeenCalledTimes(1);
  const [headers] = verifySession.mock.calls[0] as [Headers];
  expect(headers.get('cookie')).toBe('better-auth.session_data=stale-session');
  expect(getSession).not.toHaveBeenCalled();
  expect(request).not.toHaveProperty('user');
});
