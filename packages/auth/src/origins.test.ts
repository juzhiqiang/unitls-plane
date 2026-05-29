import { describe, expect, it } from 'bun:test';
import {
  getAllowedCorsOrigins,
  getTrustedOrigins,
  isOriginAllowed,
  normalizeOrigin,
} from './origins';

describe('auth origin configuration', () => {
  it('normalizes configured origins from comma separated env values', () => {
    expect(
      getAllowedCorsOrigins({
        CORS_ORIGIN:
          ' http://localhost:3000/ , https://app.example.com/auth , invalid',
      })
    ).toEqual(['http://localhost:3000', 'https://app.example.com']);
  });

  it('allows local development aliases on the configured frontend port', () => {
    const env = {
      CORS_ORIGIN: 'http://localhost:3000',
      NODE_ENV: 'development',
    };

    expect(isOriginAllowed('http://localhost:3000', env)).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:3000', env)).toBe(true);
    expect(isOriginAllowed('http://192.168.1.20:3000', env)).toBe(true);
    expect(isOriginAllowed('http://192.168.1.20:3001', env)).toBe(false);
    expect(isOriginAllowed('https://evil.example.com', env)).toBe(false);
  });

  it('does not allow unconfigured private network origins in production', () => {
    const env = {
      CORS_ORIGIN: 'https://app.example.com',
      NODE_ENV: 'production',
    };

    expect(isOriginAllowed('https://app.example.com', env)).toBe(true);
    expect(isOriginAllowed('http://192.168.1.20:3000', env)).toBe(false);
  });

  it('adds the current development request origin to Better Auth trusted origins', () => {
    const origins = getTrustedOrigins(
      {
        BETTER_AUTH_URL: 'http://localhost:3001',
        CORS_ORIGIN: 'http://localhost:3000',
        NEXT_PUBLIC_API_URL: 'http://localhost:3001',
        NODE_ENV: 'development',
      },
      'http://127.0.0.1:3000'
    );

    expect(origins).toContain('http://localhost:3000');
    expect(origins).toContain('http://localhost:3001');
    expect(origins).toContain('http://127.0.0.1:3000');
  });

  it('returns null for malformed origins', () => {
    expect(normalizeOrigin('not a url')).toBeNull();
  });
});
