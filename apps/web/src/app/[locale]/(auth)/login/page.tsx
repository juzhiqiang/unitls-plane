'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { signIn } from '@/lib/auth-client';
import { AuthField } from '@/components/auth/auth-field';

export default function LoginPage() {
  const t = useTranslations('Auth');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const next = searchParams.get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error: authError } = await signIn.email({
      email,
      password,
    });

    setLoading(false);

    if (authError) {
      setError(authError.message || 'Login failed');
      return;
    }

    const target = next && next.startsWith('/') ? next : '/dashboard';
    window.location.href = `/${locale}${target}`;
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {t('sectionLogin')}
        </span>
        <h1 className="glitch-soft text-2xl font-medium tracking-tight text-foreground">
          {t('loginTitle')}
        </h1>
      </div>

      <form onSubmit={handleEmailLogin} className="space-y-5">
        <AuthField
          id="email"
          label={t('email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        <AuthField
          id="password"
          label={t('password')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
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
          {loading ? t('signingIn') : t('loginButton')}
          {!loading && (
            <span className="transition-transform group-hover:translate-x-0.5">→</span>
          )}
        </button>
      </form>

      <p className="text-sm text-muted-foreground">
        {t('noAccount')}{' '}
        <Link
          href="/register"
          className="text-accent underline decoration-accent/40 underline-offset-[3px] transition-colors hover:decoration-accent"
        >
          {t('registerLink')}
        </Link>
      </p>
    </div>
  );
}
