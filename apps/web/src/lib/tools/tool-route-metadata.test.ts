import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routing } from '@/i18n/routing';
import { allTools, getToolByHref } from './tool-metadata';

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(
    async ({ locale }: { locale: string }) =>
      (key: string) =>
        `${locale}:${key}`
  ),
}));

import {
  createCategoryRouteMetadata,
  createToolRouteMetadata,
} from './tool-route-metadata';

const DEFAULT_HOME_TITLES = new Set([
  'zh:Common.meta.title',
  'en:Common.meta.title',
]);

function expectedAlternates(path: string, locale: 'zh' | 'en') {
  const baseUrl = 'http://localhost:3000';

  return {
    canonical: `${baseUrl}/${locale}${path}`,
    languages: {
      zh: `${baseUrl}/zh${path}`,
      en: `${baseUrl}/en${path}`,
      'x-default': `${baseUrl}/${routing.defaultLocale}${path}`,
    },
  };
}

describe('tool route metadata', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates localized canonical and alternate URLs for every unique tool route', async () => {
    const hrefs = [...new Set(allTools.map(tool => tool.href))];

    for (const href of hrefs) {
      const tool = getToolByHref(href);
      const metadata = await createToolRouteMetadata('zh', href);

      expect(metadata.title).toBe(`zh:${tool?.titleKey}`);
      expect(DEFAULT_HOME_TITLES).not.toContain(metadata.title);
      expect(metadata.description).toBe(`zh:${tool?.descriptionKey}`);
      expect(metadata.alternates).toEqual(expectedAlternates(href, 'zh'));
    }
  });

  it('uses different localized metadata for the image and PDF categories', async () => {
    const imageMetadata = await createCategoryRouteMetadata('en', 'image');
    const pdfMetadata = await createCategoryRouteMetadata('en', 'pdf');

    expect(imageMetadata).toEqual({
      title: 'en:ImageTool.title',
      description: 'en:ImageTool.description',
      alternates: expectedAlternates('/image', 'en'),
    });
    expect(pdfMetadata).toEqual({
      title: 'en:PdfTool.title',
      description: 'en:PdfTool.description',
      alternates: expectedAlternates('/pdf', 'en'),
    });
    expect(imageMetadata.title).not.toBe(pdfMetadata.title);
  });

  it('normalizes a configured base URL with a trailing slash', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.com/');

    const metadata = await createToolRouteMetadata('en', '/font');

    expect(metadata.alternates).toEqual({
      canonical: 'https://example.com/en/font',
      languages: {
        zh: 'https://example.com/zh/font',
        en: 'https://example.com/en/font',
        'x-default': 'https://example.com/zh/font',
      },
    });
  });

  it('uses the shared fallback for a whitespace-only base URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '   ');

    const metadata = await createToolRouteMetadata('zh', '/font');

    expect(metadata.alternates).toEqual(expectedAlternates('/font', 'zh'));
  });

  it('rejects an invalid configured base URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'ftp://example.com');

    await expect(createToolRouteMetadata('zh', '/font')).rejects.toThrow(
      'NEXT_PUBLIC_APP_URL'
    );
  });

  it('returns empty metadata for an unknown tool route', async () => {
    await expect(
      createToolRouteMetadata('zh', '/missing-tool')
    ).resolves.toEqual({});
  });
});
