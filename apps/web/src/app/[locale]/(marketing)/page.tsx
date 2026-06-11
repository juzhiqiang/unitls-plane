import { Link } from "@/i18n/navigation";
import { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { PointerSpotlight } from "@/components/effects/pointer-spotlight";
import { ToolCatalogGrid } from "@/components/tools/tool-catalog-grid";
import { ToolTrustStrip } from "@/components/tools/tool-trust-strip";
import {
  recommendedTools,
  type ToolGroup,
} from "@/lib/tools/tool-metadata";

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

  const recommendedGroup = [
    {
      key: "recommended",
      titleKey: "Marketing.tools.heading",
      descriptionKey: "Marketing.tools.description",
      tools: recommendedTools,
    },
  ] satisfies ToolGroup[];

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
        <section className="relative flex min-h-[68vh] items-center py-14 sm:min-h-[72vh] sm:py-18">
          <div className="container-main">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1fr)] lg:items-end">
              <div className="max-w-2xl">
                <div className="mb-5 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
                  <span className="text-accent">01</span> / 03 - {t("hero.titleLine1")}
                </div>
                <h1 className="text-4xl font-medium leading-tight tracking-tight text-foreground sm:text-5xl md:text-6xl">
                  {t("hero.titleLine1")}
                  <br />
                  <span className="text-accent">{t("hero.titleLine2")}</span>
                </h1>
                <p className="mt-6 max-w-xl text-base text-muted-foreground sm:text-lg">
                  {t("hero.subtitle")}
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:gap-4">
                  <Link href="/image/compress">
                    <Button size="lg" className="h-11 w-full px-6 sm:w-auto">
                      {t("hero.ctaPrimary")}
                    </Button>
                  </Link>
                  <Link href="/pdf/merge">
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

              <div className="space-y-4">
                <ToolTrustStrip
                  processing="local-first"
                  retention="browser-session"
                  requiresLogin={false}
                  recovery={t("tools.recovery")}
                />
                <ToolCatalogGrid groups={recommendedGroup} />
              </div>
            </div>
          </div>
        </section>
      </PointerSpotlight>

      <section className="border-t border-border py-14 sm:py-20">
        <div className="container-main">
          <div className="mb-4 font-mono text-sm text-muted-foreground">
            <span className="text-accent">02</span> / 03 - {t("highlights.label")}
          </div>
          <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-3">
            {["performance", "privacy", "free"].map((key, index) => (
              <div key={key} className="bg-card p-5">
                <div className="mb-4 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <h2 className="text-base font-medium">
                  {t(`highlights.${key}.title`)}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t(`highlights.${key}.description`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <div className="container-main">
          <div className="mb-4 font-mono text-sm text-muted-foreground">
            <span className="text-accent">03</span> / 03
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-medium tracking-tight md:text-3xl">
                {t("cta.heading")}
              </h2>
              <p className="mt-2 max-w-lg text-sm text-muted-foreground">
                {t("cta.description")}
              </p>
            </div>
            <Link href="/dashboard">
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
