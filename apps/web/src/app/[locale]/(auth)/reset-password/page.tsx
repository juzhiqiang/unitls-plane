'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { resetPassword } from '@/lib/auth-client';
import { getAuthErrorKey } from '@/lib/auth-error';
import { AuthField } from '@/components/auth/auth-field';
import { PasswordStrength } from '@/components/auth/password-strength';

export default function ResetPasswordPage() {
  const t = useTranslations('Auth');
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const tokenError = searchParams.get('error');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError(t(getAuthErrorKey({ code: tokenError ?? 'INVALID_TOKEN' })));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('errors.passwordMismatch'));
      return;
    }

    setLoading(true);

    const { error: authError } = await resetPassword({
      newPassword: password,
      token,
    });

    setLoading(false);

    if (authError) {
      setError(t(getAuthErrorKey(authError)));
      return;
    }

    setUpdated(true);
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {t('sectionResetPassword')}
        </span>
        <h1 className="glitch-soft text-2xl font-medium tracking-tight text-foreground">
          {t('resetPasswordTitle')}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {(updated || tokenError) && (
          <p
            role={updated ? 'status' : 'alert'}
            className={
              updated
                ? 'rounded-md border border-accent/40 bg-accent/5 p-3 font-mono text-xs text-accent'
                : 'rounded-md border border-destructive/30 p-3 font-mono text-xs text-destructive'
            }
          >
            {updated
              ? t('passwordResetUpdated')
              : t(getAuthErrorKey({ code: tokenError }))}
          </p>
        )}

        {!updated && (
          <>
            <div className="space-y-2">
              <AuthField
                id="password"
                label={t('newPassword')}
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
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

            <AuthField
              id="confirm-password"
              label={t('confirmPassword')}
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
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
              {loading ? t('resettingPassword') : t('resetPasswordButton')}
              {!loading && (
                <span className="transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              )}
            </button>
          </>
        )}
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
