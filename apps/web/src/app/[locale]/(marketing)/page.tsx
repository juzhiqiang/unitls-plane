import { Link } from '@/i18n/navigation';
import { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { HeroWorkbenchScene } from '@/components/effects/hero-workbench-scene';
import { PointerSpotlight } from '@/components/effects/pointer-spotlight';
import { HomepageQuickTools } from '@/components/tools/homepage-quick-tools';
import { ToolTrustStrip } from '@/components/tools/tool-trust-strip';
import { createHomepageQuickTools } from '@/lib/tools/homepage-tools';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Common.meta' });

  return {
    title: t('title'),
    description: t('description'),
    openGraph: {
      title: t('title'),
      description: t('ogDescription'),
      type: 'website',
    },
  };
}

export default async function MarketingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Marketing');
  const quickTools = createHomepageQuickTools();

  return (
    <div className="relative overflow-hidden">
      <div
        className="scanlines pointer-events-none absolute inset-x-0 top-0 h-[100vh]"
        aria-hidden
      >
        <div className="aurora" />
        <div className="grid-fade absolute inset-0" />
      </div>

      <PointerSpotlight radius={640} intensity={9}>
        <section className="relative flex min-h-[78vh] items-center py-12 sm:py-16">
          <div className="container-main">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,0.76fr)_minmax(460px,1fr)] lg:items-center">
              <div className="max-w-2xl">
                <div className="mb-5 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
                  <span className="text-accent">01</span> / 04 -{' '}
                  {t('hero.titleLine1')}
                </div>
                <h1 className="hero-title-effect max-w-[9em] text-5xl font-medium leading-[0.95] tracking-tight text-foreground sm:text-6xl md:text-7xl">
                  <span className="hero-title-line">
                    {t('hero.titleLine1')}
                  </span>
                  <br />
                  <span className="hero-title-line hero-title-accent">
                    {t('hero.titleLine2')}
                  </span>
                </h1>
                <p className="mt-6 max-w-xl text-base text-muted-foreground sm:text-lg">
                  {t('hero.subtitle')}
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:gap-4">
                  <Button
                    asChild
                    size="lg"
                    className="h-11 w-full px-6 sm:w-auto"
                  >
                    <Link href="/image/compress">{t('hero.ctaPrimary')}</Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-11 w-full px-6 sm:w-auto"
                  >
                    <Link href="/pdf/merge">{t('hero.ctaSecondary')}</Link>
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <HeroWorkbenchScene />
                <ToolTrustStrip
                  processing="local-first"
                  retention="browser-session"
                  requiresLogin={false}
                  recovery={t('tools.recovery')}
                />
              </div>
            </div>
          </div>
        </section>
      </PointerSpotlight>

      <section className="homepage-apple-band border-t border-border py-16 sm:py-24">
        <div className="container-main">
          <div className="mx-auto mb-10 max-w-3xl text-center">
            <div className="mb-4 font-mono text-sm text-muted-foreground">
              <span className="text-accent">02</span> / 04
            </div>
            <h2 className="text-4xl font-medium leading-none tracking-tight sm:text-5xl md:text-6xl">
              {t('tools.heading')}
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
              {t('tools.description')}
            </p>
          </div>
          <HomepageQuickTools tools={quickTools} />
        </div>
      </section>

      <section className="border-t border-border py-16 sm:py-24">
        <div className="container-main">
          <div className="mb-10 max-w-4xl">
            <div className="mb-4 font-mono text-sm text-muted-foreground">
              <span className="text-accent">03</span> / 04 -{' '}
              {t('highlights.label')}
            </div>
            <h2 className="text-4xl font-medium leading-none tracking-tight sm:text-5xl md:text-6xl">
              {t('highlights.heading')}
            </h2>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {['performance', 'privacy', 'free'].map((key, index) => (
              <div key={key} className="workflow-stat-panel p-6">
                <div className="mb-10 font-mono text-5xl text-accent/80 md:text-6xl">
                  {String(index + 1).padStart(2, '0')}
                </div>
                <h3 className="text-xl font-medium tracking-tight">
                  {t(`highlights.${key}.title`)}
                </h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {t(`highlights.${key}.description`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="homepage-final-cta-band border-t border-border py-20 sm:py-28">
        <div className="container-main">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-6 font-mono text-sm text-muted-foreground">
              <span className="text-accent">04</span> / 04
            </div>
            <div className="homepage-cta-core mx-auto mb-8" aria-hidden />
            <h2 className="mx-auto max-w-3xl text-4xl font-medium leading-none tracking-tight sm:text-5xl md:text-6xl">
              {t('cta.heading')}
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
              {t('cta.description')}
            </p>
            <div className="mt-8">
              <Button asChild size="lg" className="h-11 px-8">
                <Link href="/dashboard">{t('cta.button')}</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
