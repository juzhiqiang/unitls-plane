import { describe, expect, it } from 'bun:test';
import {
  getEmailVerificationOptions,
  getSmtpConfig,
  isEmailVerificationRequired,
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

    expect(options).toMatchObject({
      sendOnSignUp: true,
      sendOnSignIn: true,
    });
    expect(typeof options.sendVerificationEmail).toBe('function');
  });
});

