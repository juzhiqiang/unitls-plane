'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { requestPasswordReset } from '@/lib/auth-client';
import { getAuthErrorKey } from '@/lib/auth-error';
import { AuthField } from '@/components/auth/auth-field';

export default function ForgotPasswordPage() {
  const t = useTranslations('Auth');
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error: authError } = await requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/${locale}/reset-password`,
    });

    setLoading(false);

    if (authError) {
      setError(t(getAuthErrorKey(authError)));
      return;
    }

    setSent(true);
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {t('sectionForgotPassword')}
        </span>
        <h1 className="glitch-soft text-2xl font-medium tracking-tight text-foreground">
          {t('forgotPasswordTitle')}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {sent && (
          <p
            role="status"
            className="rounded-md border border-accent/40 bg-accent/5 p-3 font-mono text-xs text-accent"
          >
            {t('passwordResetSent')}
          </p>
        )}

        <AuthField
          id="email"
          label={t('email')}
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 p-3 font-mono text-xs text-destructive"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="group inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-foreground text-sm font-mono text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? t('sendingResetEmail') : t('sendResetEmail')}
          {!loading && (
            <span className="transition-transform group-hover:translate-x-0.5">
              →
            </span>
          )}
        </button>
      </form>

      <p className="text-sm text-muted-foreground">
        <Link
          href="/login"
          className="text-accent underline decoration-accent/40 underline-offset-[3px] transition-colors hover:decoration-accent"
        >
          {t('backToLogin')}
        </Link>
      </p>
    </div>
  );
}
