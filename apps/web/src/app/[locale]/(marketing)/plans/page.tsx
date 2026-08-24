import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPlanDisplayLimits } from '@utils-plane/utils';
import { PlanLimits } from '@/components/layout/PlanLimits';
import { getPublicSiteBaseUrl } from '@/lib/public-site';

const routePath = '/plans';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: 'PublicSite.plans.metadata',
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

export default async function PlansPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('PublicSite.plans');

  return (
    <PlanLimits
      eyebrow={t('eyebrow')}
      title={t('title')}
      intro={t('intro')}
      plans={getPlanDisplayLimits()}
      labels={{
        plan: t('columns.plan'),
        uploadLimit: t('columns.uploadLimit'),
        imageGenerate: t('columns.imageGenerate'),
        unavailable: t('columns.unavailable'),
        notes: t('columns.notes'),
      }}
      planLabels={t.raw('planLabels') as Record<string, string>}
      planNotes={t.raw('planNotes') as Record<string, string>}
      betaNote={t('betaNote')}
    />
  );
}
