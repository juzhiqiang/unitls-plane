import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { getPublicSiteBaseUrl } from '@/lib/public-site';

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

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getPublicSiteBaseUrl();
  const privatePaths = routing.locales.flatMap(locale =>
    PRIVATE_SEGMENTS.map(segment => `/${locale}/${segment}`)
  );

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [...privatePaths, '/api/', '/admin/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
