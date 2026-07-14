import { existsSync } from 'node:fs';
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
});
