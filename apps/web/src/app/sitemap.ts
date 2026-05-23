import { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';

const ROUTES: Array<{
  path: string;
  changeFrequency: 'weekly' | 'monthly';
  priority: number;
}> = [
  { path: '', changeFrequency: 'weekly', priority: 1 },
  { path: '/image', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/pdf', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/font', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/login', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/register', changeFrequency: 'monthly', priority: 0.5 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const now = new Date();

  return ROUTES.flatMap((route) =>
    routing.locales.map((locale) => {
      const languages = Object.fromEntries(
        routing.locales.map((l) => [l, `${baseUrl}/${l}${route.path}`]),
      );
      return {
        url: `${baseUrl}/${locale}${route.path}`,
        lastModified: now,
        changeFrequency: route.changeFrequency,
        priority: route.priority,
        alternates: {
          languages: {
            ...languages,
            'x-default': `${baseUrl}/${routing.defaultLocale}${route.path}`,
          },
        },
      };
    }),
  );
}
