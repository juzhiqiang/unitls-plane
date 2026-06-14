import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { BrandMark } from "@/components/brand/brand-mark";
import { MarketingNav } from "@/components/layout/marketing-nav";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("Marketing");

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="container-main flex h-14 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <BrandMark className="h-7 w-7" />
            <span className="font-medium text-foreground">Utils Plane</span>
          </Link>

          <MarketingNav
            labels={{
              tools: t("nav.tools"),
              login: t("nav.login"),
              getStarted: t("nav.getStarted"),
              dashboard: t("nav.dashboard"),
              settings: t("nav.settings"),
              logOut: t("nav.logOut"),
              defaultUser: t("nav.defaultUser"),
            }}
          />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="border-t border-border bg-card py-8">
        <div className="container-main">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <BrandMark className="h-5 w-5" title="" />
              <span className="text-sm text-muted-foreground">
                Utils Plane &copy; 2026
              </span>
            </div>

            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <a href="/docs" className="hover:text-foreground transition-colors">
                {t("footer.docs")}
              </a>
              <a href="/github" className="hover:text-foreground transition-colors">
                {t("footer.github")}
              </a>
              <a href="/terms" className="hover:text-foreground transition-colors">
                {t("footer.terms")}
              </a>
              <a href="/privacy" className="hover:text-foreground transition-colors">
                {t("footer.privacy")}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
