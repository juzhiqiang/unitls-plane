import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Metadata } from 'next';
import { describe, expect, it } from 'vitest';

const authDir = dirname(fileURLToPath(import.meta.url));
const AUTH_PAGE_SEGMENTS = [
  'login',
  'register',
  'verify-email',
  'forgot-password',
  'reset-password',
];

describe('auth layout metadata', () => {
  it('prevents every auth flow page from being indexed', async () => {
    for (const segment of AUTH_PAGE_SEGMENTS) {
      expect(existsSync(join(authDir, segment, 'page.tsx')), segment).toBe(
        true
      );
    }

    const layoutModule = (await import('./layout')) as {
      metadata?: Metadata;
    };

    expect(layoutModule.metadata?.robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it('links the shared release version to the public changelog', async () => {
    const source = readFileSync(join(authDir, 'layout.tsx'), 'utf8');

    expect(source).toContain("from '@utils-plane/utils'");
    expect(source).toContain('APP_VERSION_LABEL');
    expect(source).toMatch(/<Link\s+href="\/changelog"/);
    expect(source).toContain('{APP_VERSION_LABEL}');
    expect(source).not.toContain('v1.0.0');
  });
});
