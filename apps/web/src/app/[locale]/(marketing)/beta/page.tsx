import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  LegalDocument,
  type LegalSection,
} from '@/components/layout/LegalDocument';
import { getPublicSiteBaseUrl, getSupportEmail } from '@/lib/public-site';

const routePath = '/beta';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: 'PublicSite.beta.metadata',
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

export default async function BetaPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('PublicSite.beta');
  const supportEmail = getSupportEmail();

  return (
    <LegalDocument
      title={t('title')}
      effectiveDate={t('effectiveDate')}
      intro={t('intro')}
      sections={t.raw('sections') as LegalSection[]}
      operatorLabel={t('operatorLabel')}
      operator={t('operator')}
      supportLabel={t('supportLabel')}
      supportEmail={supportEmail}
    />
  );
}
