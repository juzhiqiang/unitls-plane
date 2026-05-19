import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="container-main flex h-14 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-sm bg-accent" />
            <span className="font-medium text-foreground">Utils Plane</span>
          </Link>

          <nav className="flex items-center gap-4">
            <Link
              href="/image"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              工具
            </Link>
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              登录
            </Link>
            <Link href="/register">
              <Button size="sm" className="h-8">
                开始使用
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="border-t border-border bg-card py-8">
        <div className="container-main">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded-sm bg-accent" />
              <span className="text-sm text-muted-foreground">
                Utils Plane © 2026
              </span>
            </div>

            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <a href="/docs" className="hover:text-foreground transition-colors">
                文档
              </a>
              <a href="/github" className="hover:text-foreground transition-colors">
                GitHub
              </a>
              <a href="/terms" className="hover:text-foreground transition-colors">
                服务条款
              </a>
              <a href="/privacy" className="hover:text-foreground transition-colors">
                隐私政策
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}