import { Link } from '@/i18n/navigation';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BrandMark } from '@/components/brand/brand-mark';
import { PointerSpotlight } from '@/components/effects/pointer-spotlight';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations('Auth');
  const features = [t('feature1'), t('feature2'), t('feature3')];

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[1.1fr_1fr]">
      {/* Left — brand panel (desktop only) */}
      <aside className="scanlines relative hidden overflow-hidden border-r border-border lg:block">
        {/* Backdrop: aurora bloom + drifting grid */}
        <div className="absolute inset-0 z-0" aria-hidden>
          <div className="aurora" />
          <div className="grid-fade absolute inset-0" />
        </div>

        <PointerSpotlight
          radius={460}
          intensity={16}
          className="relative z-10 flex h-full flex-col justify-between p-10 xl:p-14"
        >
          {/* Wordmark */}
          <div>
            <Link href="/" className="group inline-flex items-center gap-2.5">
              <BrandMark className="h-7 w-7" />
              <span className="font-mono text-sm tracking-wider text-foreground transition-colors group-hover:text-accent">
                UTILS-PLANE
              </span>
            </Link>
          </div>

          {/* Tagline + feature list */}
          <div className="max-w-sm space-y-8">
            <p className="glitch-soft text-2xl font-medium leading-snug tracking-tight text-foreground">
              {t('brandTagline')}
            </p>
            <ul className="space-y-2.5">
              {features.map(f => (
                <li
                  key={f}
                  className="flex items-center gap-3 text-sm text-muted-foreground"
                >
                  <span className="font-mono text-accent">▸</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {/* System status footer */}
          <div className="space-y-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
              <span>
                {t('statusLabel')} / {t('systemStatus')}
              </span>
            </div>
            <div>{t('buildLabel')} / v1.0.0</div>
            <div className="my-2 h-px w-16 bg-border" />
            <div>&copy; 2026</div>
          </div>
        </PointerSpotlight>
      </aside>

      {/* Right — content column */}
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          {/* Mobile wordmark */}
          <Link
            href="/"
            className="mb-10 inline-flex items-center gap-2.5 lg:hidden"
          >
            <BrandMark className="h-7 w-7" />
            <span className="font-mono text-sm tracking-wider text-foreground">
              UTILS-PLANE
            </span>
          </Link>
          <div className="auth-enter">{children}</div>
        </div>
      </main>
    </div>
  );
}
