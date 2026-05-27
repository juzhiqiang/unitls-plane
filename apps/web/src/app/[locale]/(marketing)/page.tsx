import { Link } from "@/i18n/navigation";
import { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="relative">
      {/* Background grid pattern */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(to right, currentColor 1px, transparent 1px),
                            linear-gradient(to bottom, currentColor 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />

      {/* Hero Section */}
      <section className="relative min-h-[70vh] sm:min-h-[80vh] flex items-center py-16 sm:py-20">
        <div className="container-main">
          <div className="max-w-2xl">
            <div className="text-sm text-muted-foreground mb-4 font-mono">
              <span className="text-accent">01</span> / 04
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-7xl font-medium tracking-tight text-foreground leading-tight">
              {t("hero.titleLine1")}
              <br />
              {t("hero.titleLine2")}
            </h1>
            <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-lg">
              {t("hero.subtitle")}
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:gap-4">
              <Link href="/image">
                <Button size="lg" className="h-11 px-6 w-full sm:w-auto">
                  {t("hero.ctaPrimary")}
                </Button>
              </Link>
              <Link href="/docs">
                <Button variant="outline" size="lg" className="h-11 px-6 w-full sm:w-auto">
                  {t("hero.ctaSecondary")}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 sm:py-24 border-t border-border">
        <div className="container-main">
          <div className="text-sm text-muted-foreground mb-4 font-mono">
            <span className="text-accent">02</span> / 04 — {t("features.label")}
          </div>
          <h2 className="text-3xl md:text-4xl font-medium tracking-tight">
            {t("features.heading")}
          </h2>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <Link key={feature.title} href={feature.href}>
                <Card className="h-full transition-colors hover:border-accent/50">
                  <CardContent className="p-6">
                    <feature.icon
                      className="h-8 w-8 text-accent mb-4"
                      strokeWidth={1.5}
                    />
                    <h3 className="text-lg font-medium">{feature.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Highlights Section */}
      <section className="py-16 sm:py-24 border-t border-border">
        <div className="container-main">
          <div className="text-sm text-muted-foreground mb-4 font-mono">
            <span className="text-accent">03</span> / 04 — {t("highlights.label")}
          </div>
          <h2 className="text-3xl md:text-4xl font-medium tracking-tight">
            {t("highlights.heading")}
          </h2>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {highlights.map((item) => (
              <div
                key={item.title}
                className="p-6 border border-border rounded-lg"
              >
                <item.icon
                  className="h-6 w-6 text-accent mb-4"
                  strokeWidth={1.5}
                />
                <h3 className="text-lg font-medium">{item.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 sm:py-24 border-t border-border">
        <div className="container-main text-center">
          <div className="text-sm text-muted-foreground mb-4 font-mono">
            <span className="text-accent">04</span> / 04
          </div>
          <h2 className="text-3xl md:text-4xl font-medium tracking-tight">
            {t("cta.heading")}
          </h2>
          <p className="mt-4 text-muted-foreground max-w-md mx-auto">
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
