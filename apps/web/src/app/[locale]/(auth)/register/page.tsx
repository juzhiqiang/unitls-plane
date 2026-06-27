'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, Link } from '@/i18n/navigation';
import { signUp } from '@/lib/auth-client';
import { getAuthErrorKey } from '@/lib/auth-error';
import { AuthField } from '@/components/auth/auth-field';
import { PasswordStrength } from '@/components/auth/password-strength';

export default function RegisterPage() {
  const t = useTranslations('Auth');
  const locale = useLocale();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error: authError } = await signUp.email({
      email,
      password,
      name,
      callbackURL: `${window.location.origin}/${locale}/login?verified=1`,
    });

    setLoading(false);

    if (authError) {
      setError(t(getAuthErrorKey(authError)));
      return;
    }

    router.push('/verify-email');
    router.refresh();
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {t('sectionRegister')}
        </span>
        <h1 className="glitch-soft text-2xl font-medium tracking-tight text-foreground">
          {t('registerTitle')}
        </h1>
      </div>

      <form onSubmit={handleRegister} className="space-y-5">
        <AuthField
          id="name"
          label={t('username')}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          required
        />

        <AuthField
          id="email"
          label={t('email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        <div className="space-y-2">
          <AuthField
            id="password"
            label={t('password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <PasswordStrength
            value={password}
            labels={{
              label: t('passwordStrength'),
              weak: t('pwWeak'),
              fair: t('pwFair'),
              good: t('pwGood'),
              strong: t('pwStrong'),
            }}
          />
        </div>

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
          {loading ? t('signingUp') : t('registerButton')}
          {!loading && (
            <span className="transition-transform group-hover:translate-x-0.5">→</span>
          )}
        </button>
      </form>

      <p className="text-sm text-muted-foreground">
        {t('hasAccount')}{' '}
        <Link
          href="/login"
          className="text-accent underline decoration-accent/40 underline-offset-[3px] transition-colors hover:decoration-accent"
        >
          {t('loginLink')}
        </Link>
      </p>
    </div>
  );
}
