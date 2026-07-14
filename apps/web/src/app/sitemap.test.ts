import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routing } from '@/i18n/routing';
import { allTools } from '@/lib/tools/tool-metadata';
import robots from './robots';
import sitemap from './sitemap';

const PUBLIC_PATHS = [
  ...new Set([
    '',
    '/image',
    '/pdf',
    '/font',
    '/privacy',
    '/terms',
    '/beta',
    ...allTools.map(tool => tool.href),
  ]),
];

const PRIVATE_SEGMENTS = [
  'login',
  'register',
  'verify-email',
  'forgot-password',
  'reset-password',
  'dashboard',
  'files',
  'tasks',
  'settings',
];

describe('public site discovery routes', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.com/');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists every public page in both locales with matching alternates', () => {
    const entries = sitemap();

    expect(entries).toHaveLength(PUBLIC_PATHS.length * routing.locales.length);

    for (const path of PUBLIC_PATHS) {
      for (const locale of routing.locales) {
        const url = `https://example.com/${locale}${path}`;
        const entry = entries.find(item => item.url === url);

        expect(entry, url).toBeDefined();
        expect(entry?.alternates?.languages).toEqual({
          zh: `https://example.com/zh${path}`,
          en: `https://example.com/en${path}`,
          'x-default': `https://example.com/${routing.defaultLocale}${path}`,
        });

        if (path === '') {
          expect(entry).toMatchObject({
            changeFrequency: 'weekly',
            priority: 1,
          });
        } else if (['/image', '/pdf', '/font'].includes(path)) {
          expect(entry).toMatchObject({
            changeFrequency: 'monthly',
            priority: 0.8,
          });
        } else {
          expect(entry).toMatchObject({
            changeFrequency: 'monthly',
            priority: 0.7,
          });
        }
      }
    }
  });

  it('excludes authentication and workbench routes without double slashes', () => {
    const urls = sitemap().map(entry => entry.url);

    for (const locale of routing.locales) {
      for (const segment of PRIVATE_SEGMENTS) {
        expect(urls).not.toContain(`https://example.com/${locale}/${segment}`);
      }
    }

    expect(
      urls.every(url => !url.slice('https://'.length).includes('//'))
    ).toBe(true);
  });

  it('disallows localized private routes and preserves the sitemap URL', () => {
    const result = robots();
    const expectedPrivatePaths = routing.locales.flatMap(locale =>
      PRIVATE_SEGMENTS.map(segment => `/${locale}/${segment}`)
    );

    expect(result).toEqual({
      rules: [
        {
          userAgent: '*',
          allow: '/',
          disallow: [...expectedPrivatePaths, '/api/', '/admin/'],
        },
      ],
      sitemap: 'https://example.com/sitemap.xml',
    });
  });

  it('uses the shared fallback for whitespace-only configuration', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '   ');

    expect(sitemap()[0]?.url).toBe('http://localhost:3000/zh');
    expect(robots().sitemap).toBe('http://localhost:3000/sitemap.xml');
  });

  it('rejects invalid configuration in both discovery routes', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'ftp://example.com');

    expect(() => sitemap()).toThrow('NEXT_PUBLIC_APP_URL');
    expect(() => robots()).toThrow('NEXT_PUBLIC_APP_URL');
  });
});
