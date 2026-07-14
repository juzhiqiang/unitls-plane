import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertProductionSupportEmail,
  getPublicSiteBaseUrl,
  getSupportEmail,
} from './public-site';

describe('public site support email', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the configured support address after trimming it', () => {
    expect(getSupportEmail('  support@example.com  ')).toBe(
      'support@example.com'
    );
  });

  it('uses the local development address when the environment is empty', () => {
    expect(getSupportEmail('')).toBe('support@utils-plane.local');
    expect(getSupportEmail('   ')).toBe('support@utils-plane.local');
  });

  it.each([undefined, ''])(
    'keeps the fallback address in production when configuration is %s',
    configuredEmail => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_SUPPORT_EMAIL', '');

      expect(getSupportEmail(configuredEmail)).toBe(
        'support@utils-plane.local'
      );
    }
  );

  it.each(['support@example.com', 'help+beta@sub.example.co.uk'])(
    'accepts a production-safe email address: %s',
    email => {
      expect(assertProductionSupportEmail(email)).toBe(email);
    }
  );

  it.each([
    'support@utils-plane.local',
    'support@localhost',
    '.support@example.com',
    'support..team@example.com',
    'support.@example.com',
    'missing-at.example.com',
    'support@example',
    'support @example.com',
  ])('rejects a non-production support address: %s', email => {
    expect(() => assertProductionSupportEmail(email)).toThrow(
      'NEXT_PUBLIC_SUPPORT_EMAIL'
    );
  });
});

describe('public site base URL', () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    if (originalAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    }
  });

  it.each([undefined, '', '   '])(
    'uses the local address when configuration is %s',
    configuredUrl => {
      expect(getPublicSiteBaseUrl(configuredUrl)).toBe('http://localhost:3000');
    }
  );

  it('normalizes a valid absolute HTTP(S) URL', () => {
    expect(getPublicSiteBaseUrl(' https://Tools.Example.COM:443/// ')).toBe(
      'https://tools.example.com'
    );
  });

  it.each([
    'ftp://example.com',
    'javascript:alert(1)',
    '/relative-path',
    'example.com',
    'not a URL',
    'https://[invalid',
    'https://user:password@example.com',
    'https://example.com?source=beta',
    'https://example.com#section',
  ])('rejects an unsafe or invalid public URL: %s', configuredUrl => {
    expect(() => getPublicSiteBaseUrl(configuredUrl)).toThrow(
      'NEXT_PUBLIC_APP_URL'
    );
  });
});
