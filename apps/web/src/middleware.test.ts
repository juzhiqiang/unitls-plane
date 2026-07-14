import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

describe('middleware auth routes', () => {
  it('does not redirect the login page just because a session cookie exists', () => {
    const response = middleware(
      request('/zh/login', 'better-auth.session_token=stale-token')
    );

    expect(response.status).not.toBe(307);
    expect(response.headers.get('location')).toBeNull();
  });

  it('still redirects protected pages without a session cookie to login', () => {
    const response = middleware(request('/zh/dashboard'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/zh/login?next=%2Fdashboard'
    );
  });

  it('allows unauthenticated users to see the verify email page', () => {
    const response = middleware(request('/zh/verify-email'));

    expect(response.status).not.toBe(307);
    expect(response.headers.get('location')).toBeNull();
  });

  it('allows unauthenticated users to reset their password', () => {
    for (const path of ['/zh/forgot-password', '/zh/reset-password']) {
      const response = middleware(request(path));

      expect(response.status).not.toBe(307);
      expect(response.headers.get('location')).toBeNull();
    }
  });

  it('allows unauthenticated users to read public trust pages', () => {
    for (const locale of ['zh', 'en']) {
      for (const page of ['privacy', 'terms', 'beta']) {
        const response = middleware(request(`/${locale}/${page}`));

        expect(response.status).not.toBe(307);
        expect(response.headers.get('location')).toBeNull();
      }
    }
  });
});
