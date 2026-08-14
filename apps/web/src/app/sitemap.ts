import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { getPublicSiteBaseUrl } from '@/lib/public-site';
import { allTools } from '@/lib/tools/tool-metadata';

const PUBLIC_PATHS = Array.from(
  new Set([
    '',
    '/image',
    '/pdf',
    '/font',
    '/privacy',
    '/terms',
    '/beta',
    '/plans',
    '/changelog',
    ...allTools.map(tool => tool.href),
  ])
);

const CATEGORY_PATHS = new Set(['/image', '/pdf', '/font']);

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getPublicSiteBaseUrl();
  const now = new Date();

  return PUBLIC_PATHS.flatMap(path =>
    routing.locales.map(locale => {
      const languages = Object.fromEntries(
        routing.locales.map(language => [
          language,
          `${baseUrl}/${language}${path}`,
        ])
      );

      return {
        url: `${baseUrl}/${locale}${path}`,
        lastModified: now,
        changeFrequency: path === '' ? 'weekly' : 'monthly',
        priority: path === '' ? 1 : CATEGORY_PATHS.has(path) ? 0.8 : 0.7,
        alternates: {
          languages: {
            ...languages,
            'x-default': `${baseUrl}/${routing.defaultLocale}${path}`,
          },
        },
      };
    })
  );
}
