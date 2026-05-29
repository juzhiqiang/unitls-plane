'use client';

import { useSession } from '@/lib/auth-client';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, Link } from '@/i18n/navigation';

export default function VerifyEmailPage() {
  const t = useTranslations('Auth');
  const { data: session, isPending } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!isPending && session) {
      router.push('/dashboard');
    }
  }, [session, isPending, router]);

  if (isPending) {
    return (
      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        [ {t('loading')} ]
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {t('sectionVerify')}
        </span>
        <h1 className="text-2xl font-medium tracking-tight text-foreground">
          {t('verifyEmailTitle')}
        </h1>
      </div>

      <div className="space-y-3 border-l-2 border-accent pl-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t('verifyEmailBody')}
        </p>
        <p className="text-xs text-muted-foreground/80">{t('verifyEmailSpam')}</p>
      </div>

      <Link
        href="/login"
        className="group inline-flex items-center gap-2 text-sm text-accent underline decoration-accent/40 underline-offset-[3px] transition-colors hover:decoration-accent"
      >
        <span className="transition-transform group-hover:-translate-x-0.5">←</span>
        {t('backToLogin')}
      </Link>
    </div>
  );
}
