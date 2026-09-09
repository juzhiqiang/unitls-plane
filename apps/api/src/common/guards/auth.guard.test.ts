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
  controller: object = class TestController {},
  response: Record<string, unknown> = {}
) {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
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
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
  };
  const reflector = { getAllAndOverride: vi.fn(() => false) };
  const guard = new AuthGuard(reflector as never);
  const getSession = vi
    .spyOn(auth.api, 'getSession')
    .mockResolvedValue(cachedSession as never);

  verifySession.mockResolvedValue(null);

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
  verifySession.mockResolvedValue({ session, headers: undefined });
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

it('forwards renewal set-cookie headers from verifySession to the response', async () => {
  const request: Record<string, unknown> = {
    headers: { cookie: 'better-auth.session_token=active-token' },
  };
  const renewalHeaders = new Headers();
  renewalHeaders.append(
    'set-cookie',
    'better-auth.session_token=renewed-token; Path=/; HttpOnly; SameSite=Lax'
  );
  renewalHeaders.append(
    'set-cookie',
    'better-auth.session_data=renewed-data; Path=/; HttpOnly; SameSite=Lax'
  );
  const session = {
    user: { id: 'user-1', email: 'owner@example.com' },
    session: { id: 'session-1', userId: 'user-1' },
  };
  verifySession.mockResolvedValue({ session, headers: renewalHeaders });
  const response = {
    setHeader: vi.fn(),
    getHeader: vi.fn(() => undefined),
  };
  const guard = new AuthGuard(new Reflector());

  await expect(
    guard.canActivate(
      createContext(request, vi.fn(), class {}, response) as never
    )
  ).resolves.toBe(true);

  expect(request.user).toBe(session.user);
  expect(request.session).toBe(session.session);
  expect(response.setHeader).toHaveBeenCalledTimes(1);
  expect(response.setHeader).toHaveBeenCalledWith('set-cookie', [
    'better-auth.session_token=renewed-token; Path=/; HttpOnly; SameSite=Lax',
    'better-auth.session_data=renewed-data; Path=/; HttpOnly; SameSite=Lax',
  ]);
});

it('appends renewal cookies when the response already carries set-cookie', async () => {
  const request: Record<string, unknown> = {
    headers: { cookie: 'better-auth.session_token=active-token' },
  };
  const renewalHeaders = new Headers();
  renewalHeaders.append(
    'set-cookie',
    'better-auth.session_token=renewed-token; Path=/; HttpOnly; SameSite=Lax'
  );
  verifySession.mockResolvedValue({
    session: {
      user: { id: 'user-1', email: 'owner@example.com' },
      session: { id: 'session-1', userId: 'user-1' },
    },
    headers: renewalHeaders,
  });
  const existing = ['better-auth.session_data=existing; Path=/'];
  const response = {
    setHeader: vi.fn(),
    getHeader: vi.fn(() => existing),
  };
  const guard = new AuthGuard(new Reflector());

  await expect(
    guard.canActivate(
      createContext(request, vi.fn(), class {}, response) as never
    )
  ).resolves.toBe(true);

  expect(response.setHeader).toHaveBeenCalledWith('set-cookie', [
    'better-auth.session_data=existing; Path=/',
    'better-auth.session_token=renewed-token; Path=/; HttpOnly; SameSite=Lax',
  ]);
});

it('writes no cookie headers when verifySession returns no set-cookie', async () => {
  const request: Record<string, unknown> = {
    headers: { cookie: 'better-auth.session_token=active-token' },
  };
  verifySession.mockResolvedValue({
    session: {
      user: { id: 'user-1', email: 'owner@example.com' },
      session: { id: 'session-1', userId: 'user-1' },
    },
    headers: new Headers(),
  });
  const response = {
    setHeader: vi.fn(),
    getHeader: vi.fn(),
  };
  const guard = new AuthGuard(new Reflector());

  await expect(
    guard.canActivate(
      createContext(request, vi.fn(), class {}, response) as never
    )
  ).resolves.toBe(true);

  expect(response.setHeader).not.toHaveBeenCalled();
});
