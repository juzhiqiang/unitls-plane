import { afterEach, beforeEach, expect, it, mock, vi } from 'bun:test';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { auth, getSessionCookieExpirationHeaders } from '@utils-plane/auth';
import {
  IS_PUBLIC_KEY,
  SKIP_SESSION_KEY,
} from '../decorators/public.decorator';
import { HealthController } from '../../modules/health/health.controller';

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

function createContext(
  request: Record<string, unknown>,
  handler: (...args: never[]) => unknown = vi.fn(),
  controller: object = class TestController {}
) {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

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

it('skips session verification before reading request headers', async () => {
  const request = {} as Record<string, unknown>;
  Object.defineProperty(request, 'headers', {
    get: () => {
      throw new Error('headers must not be read');
    },
  });
  const reflector = {
    getAllAndOverride: vi.fn((key: string) => key === SKIP_SESSION_KEY),
  };
  const guard = new AuthGuard(reflector as never);

  await expect(
    guard.canActivate(createContext(request) as never)
  ).resolves.toBe(true);

  expect(verifySession).not.toHaveBeenCalled();
});

it('keeps resolving optional sessions for ordinary public routes', async () => {
  const request: Record<string, unknown> = {
    headers: { cookie: 'better-auth.session_token=active-session' },
  };
  const session = {
    user: { id: 'user-1', email: 'owner@example.com' },
    session: { id: 'session-1', userId: 'user-1' },
  };
  verifySession.mockResolvedValue(session);
  const reflector = {
    getAllAndOverride: vi.fn((key: string) => key === IS_PUBLIC_KEY),
  };
  const guard = new AuthGuard(reflector as never);

  await expect(
    guard.canActivate(createContext(request) as never)
  ).resolves.toBe(true);

  expect(verifySession).toHaveBeenCalledTimes(1);
  expect(request.user).toBe(session.user);
  expect(request.session).toBe(session.session);
});

it('allows health requests without verifying a rejecting cookie session', async () => {
  const request: Record<string, unknown> = {
    headers: { cookie: 'better-auth.session_data=invalid-session' },
  };
  verifySession.mockRejectedValue(new Error('session backend unavailable'));
  const guard = new AuthGuard(new Reflector());
  const context = createContext(
    request,
    HealthController.prototype.live,
    HealthController
  );

  await expect(guard.canActivate(context as never)).resolves.toBe(true);

  expect(verifySession).not.toHaveBeenCalled();
  expect(request).not.toHaveProperty('user');
});
