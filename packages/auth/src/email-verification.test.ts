import { describe, expect, it } from 'bun:test';
import {
  buildVerificationEmailUrl,
  getEmailAndPasswordOptions,
  getEmailVerificationOptions,
  getBetterAuthBaseURL,
  getEmailVerificationCallbackURL,
  getSmtpConfig,
  isEmailVerificationRequired,
  sendExistingUserVerificationEmail,
} from './email-verification';

describe('email verification configuration', () => {
  it('requires email verification by default in production', () => {
    expect(
      isEmailVerificationRequired({
        NODE_ENV: 'production',
      })
    ).toBe(true);
  });

  it('does not require email verification in development by default', () => {
    expect(
      isEmailVerificationRequired({
        NODE_ENV: 'development',
      })
    ).toBe(false);
  });

  it('allows explicit override for email verification', () => {
    expect(
      isEmailVerificationRequired({
        NODE_ENV: 'production',
        REQUIRE_EMAIL_VERIFICATION: 'false',
      })
    ).toBe(false);

    expect(
      isEmailVerificationRequired({
        NODE_ENV: 'development',
        REQUIRE_EMAIL_VERIFICATION: 'true',
      })
    ).toBe(true);
  });

  it('parses complete SMTP config', () => {
    expect(
      getSmtpConfig({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'user',
        SMTP_PASSWORD: 'password',
        SMTP_FROM: 'Utils Plane <no-reply@example.com>',
      })
    ).toEqual({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      user: 'user',
      password: 'password',
      from: 'Utils Plane <no-reply@example.com>',
    });
  });

  it('throws when production email verification lacks SMTP config', () => {
    expect(() =>
      getEmailVerificationOptions({
        NODE_ENV: 'production',
      })
    ).toThrow('SMTP_HOST');
  });

  it('returns email verification options when SMTP config is complete', () => {
    const options = getEmailVerificationOptions({
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'password',
      SMTP_FROM: 'no-reply@example.com',
    });

    expect(typeof options.sendVerificationEmail).toBe('function');
  });

  it('enables password reset emails when SMTP config is complete', () => {
    const options = getEmailAndPasswordOptions({
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'password',
      SMTP_FROM: 'no-reply@example.com',
    });

    expect(typeof options.sendResetPassword).toBe('function');
    expect(options.revokeSessionsOnPasswordReset).toBe(true);
  });

  it('builds the Better Auth base URL with the auth path', () => {
    expect(
      getBetterAuthBaseURL({
        BETTER_AUTH_URL: 'https://api.example.com',
      })
    ).toBe('https://api.example.com/api/auth');
  });

  it('builds the verification email URL with the auth verify endpoint', () => {
    expect(
      buildVerificationEmailUrl(
        {
          BETTER_AUTH_URL: 'https://api.example.com',
          CORS_ORIGIN: 'https://app.example.com',
        },
        'token-123'
      )
    ).toBe(
      'https://api.example.com/api/auth/verify-email?token=token-123&callbackURL=https%3A%2F%2Fapp.example.com%2Fzh%2Flogin%3Fverified%3D1'
    );
  });

  it('supports a base URL that already includes the auth path', () => {
    expect(
      getBetterAuthBaseURL({
        BETTER_AUTH_URL: 'https://api.example.com/api/auth',
      })
    ).toBe('https://api.example.com/api/auth');
  });

  it('builds the default email verification callback URL from CORS origin', () => {
    expect(
      getEmailVerificationCallbackURL({
        CORS_ORIGIN: 'https://app.example.com',
      })
    ).toBe('https://app.example.com/zh/login?verified=1');
  });

  it('allows overriding the email verification callback URL', () => {
    expect(
      getEmailVerificationCallbackURL({
        CORS_ORIGIN: 'https://app.example.com',
        EMAIL_VERIFICATION_CALLBACK_URL: 'https://app.example.com/en/login',
      })
    ).toBe('https://app.example.com/en/login');
  });

  it('skips resending verification email for an already verified existing user', async () => {
    const options = getEmailAndPasswordOptions({
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'test-secret',
      BETTER_AUTH_URL: 'https://api.example.com',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'password',
      SMTP_FROM: 'no-reply@example.com',
    });

    await expect(
      options.onExistingUserSignUp?.({
        user: { email: 'done@example.com', emailVerified: true },
      })
    ).resolves.toBeUndefined();
  });

  it('resends verification email for an unverified existing user', async () => {
    const sent: Array<{ email: string; url: string }> = [];

    await sendExistingUserVerificationEmail({
      env: {
        NODE_ENV: 'development',
        BETTER_AUTH_SECRET: 'test-secret',
        BETTER_AUTH_URL: 'https://api.example.com',
        CORS_ORIGIN: 'https://app.example.com',
      },
      user: { email: 'pending@example.com', emailVerified: false },
      sendVerificationEmail: async ({ user, url }) => {
        sent.push({ email: user.email, url });
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.email).toBe('pending@example.com');
    expect(sent[0]?.url).toStartWith(
      'https://api.example.com/api/auth/verify-email?token='
    );
  });
});
