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
      // If already logged in, redirect to dashboard
      router.push('/dashboard');
    }
  }, [session, isPending, router]);

  if (isPending) {
    return (
      <div className="w-full max-w-md p-6">
        <div className="border border-border rounded-lg p-6 text-center">
          <p>{t('loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md p-6">
      <div className="border border-border rounded-lg p-6 text-center">
        <h1 className="text-2xl font-bold mb-4">{t('verifyEmailTitle')}</h1>
        <p className="text-muted-foreground mb-4">
          {t('verifyEmailBody')}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('verifyEmailSpam')}
        </p>
        <div className="mt-6">
          <Link
            href="/login"
            className="text-sm text-primary hover:underline"
          >
            {t('backToLogin')}
          </Link>
        </div>
      </div>
    </div>
  );
}
