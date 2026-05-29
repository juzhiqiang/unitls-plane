import { Link } from "@/i18n/navigation";
import { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { PointerSpotlight } from "@/components/effects/pointer-spotlight";
import { Image, FileType, Type, Shield, Zap, Globe } from "lucide-react";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Common.meta" });

  return {
    title: t("title"),
    description: t("description"),
    openGraph: {
      title: t("title"),
      description: t("ogDescription"),
      type: "website",
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

  const t = await getTranslations("Marketing");

  const features = [
    {
      icon: Image,
      title: t("features.image.title"),
      description: t("features.image.description"),
      href: "/image",
    },
    {
      icon: FileType,
      title: t("features.pdf.title"),
      description: t("features.pdf.description"),
      href: "/pdf",
    },
    {
      icon: Type,
      title: t("features.font.title"),
      description: t("features.font.description"),
      href: "/font",
    },
  ];

  const highlights = [
    {
      icon: Zap,
      title: t("highlights.performance.title"),
      description: t("highlights.performance.description"),
    },
    {
      icon: Shield,
      title: t("highlights.privacy.title"),
      description: t("highlights.privacy.description"),
    },
    {
      icon: Globe,
      title: t("highlights.free.title"),
      description: t("highlights.free.description"),
    },
  ];

  return (
    <div className="relative overflow-hidden">
      {/* Hero backdrop — aurora bloom + drifting grid + scanlines */}
      <div
        className="scanlines pointer-events-none absolute inset-x-0 top-0 h-[100vh]"
        aria-hidden
      >
        <div className="aurora" />
        <div className="grid-fade absolute inset-0" />
      </div>

      {/* Hero Section */}
      <PointerSpotlight radius={640} intensity={9}>
        <section className="relative flex min-h-[78vh] items-center py-16 sm:min-h-[82vh] sm:py-20">
          <div className="container-main">
            <div className="max-w-2xl">
              <div className="mb-5 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
                <span className="text-accent">01</span> / 04 — {t("hero.titleLine1")}
              </div>
              <h1 className="glitch-soft text-4xl font-medium leading-tight tracking-tight text-foreground sm:text-5xl md:text-7xl">
                {t("hero.titleLine1")}
                <br />
                <span className="text-accent">{t("hero.titleLine2")}</span>
              </h1>
              <p className="mt-6 max-w-lg text-base text-muted-foreground sm:text-lg">
                {t("hero.subtitle")}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:gap-4">
                <Link href="/image">
                  <Button size="lg" className="h-11 w-full px-6 sm:w-auto">
                    {t("hero.ctaPrimary")}
                  </Button>
                </Link>
                <Link href="/docs">
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-11 w-full px-6 sm:w-auto"
                  >
                    {t("hero.ctaSecondary")}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </PointerSpotlight>

      {/* Features Section */}
      <section className="border-t border-border py-16 sm:py-24">
        <div className="container-main">
          <div className="mb-4 font-mono text-sm text-muted-foreground">
            <span className="text-accent">02</span> / 04 — {t("features.label")}
          </div>
          <h2 className="text-3xl font-medium tracking-tight md:text-4xl">
            {t("features.heading")}
          </h2>

          <PointerSpotlight radius={520} intensity={7} className="mt-12 rounded-xl">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <Link
                  key={feature.title}
                  href={feature.href}
                  className="tool-card group block h-full rounded-lg border border-border bg-card p-6"
                >
                  <feature.icon
                    className="mb-4 h-8 w-8 text-accent transition-transform duration-200 group-hover:-translate-y-0.5"
                    strokeWidth={1.5}
                  />
                  <h3 className="text-lg font-medium transition-colors group-hover:text-accent">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {feature.description}
                  </p>
                  <span className="mt-4 inline-flex translate-x-0 items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-accent opacity-0 transition-all duration-200 group-hover:translate-x-1 group-hover:opacity-100">
                    open <span aria-hidden>→</span>
                  </span>
                </Link>
              ))}
            </div>
          </PointerSpotlight>
        </div>
      </section>

      {/* Highlights Section */}
      <section className="border-t border-border py-16 sm:py-24">
        <div className="container-main">
          <div className="mb-4 font-mono text-sm text-muted-foreground">
            <span className="text-accent">03</span> / 04 — {t("highlights.label")}
          </div>
          <h2 className="text-3xl font-medium tracking-tight md:text-4xl">
            {t("highlights.heading")}
          </h2>

          <PointerSpotlight radius={520} intensity={7} className="mt-12 rounded-xl">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {highlights.map((item, i) => (
                <div
                  key={item.title}
                  className="tool-card group rounded-lg border border-border bg-card p-6"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <item.icon
                      className="h-6 w-6 text-accent"
                      strokeWidth={1.5}
                    />
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground/60">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <h3 className="text-lg font-medium transition-colors group-hover:text-accent">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </PointerSpotlight>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative overflow-hidden border-t border-border py-16 sm:py-24">
        <div className="aurora pointer-events-none" aria-hidden />
        <div className="container-main relative text-center">
          <div className="mb-4 font-mono text-sm text-muted-foreground">
            <span className="text-accent">04</span> / 04
          </div>
          <h2 className="text-3xl font-medium tracking-tight md:text-4xl">
            {t("cta.heading")}
          </h2>
          <p className="mx-auto mt-4 max-w-md text-muted-foreground">
            {t("cta.description")}
          </p>
          <div className="mt-8">
            <Link href="/image">
              <Button size="lg" className="h-11 px-8">
                {t("cta.button")}
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
