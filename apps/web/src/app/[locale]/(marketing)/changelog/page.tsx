import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Changelog, type ChangelogEntry } from '@/components/layout/Changelog';
import { getPublicSiteBaseUrl } from '@/lib/public-site';

const routePath = '/changelog';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: 'PublicSite.changelog.metadata',
  });
  const baseUrl = getPublicSiteBaseUrl();
  const canonical = `${baseUrl}/${locale}${routePath}`;

  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical,
      languages: {
        zh: `${baseUrl}/zh${routePath}`,
        en: `${baseUrl}/en${routePath}`,
        'x-default': `${baseUrl}/zh${routePath}`,
      },
    },
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
      url: canonical,
    },
  };
}

export default async function ChangelogPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('PublicSite.changelog');

  return (
    <Changelog
      eyebrow={t('eyebrow')}
      title={t('title')}
      intro={t('intro')}
      entries={t.raw('entries') as ChangelogEntry[]}
    />
  );
}
