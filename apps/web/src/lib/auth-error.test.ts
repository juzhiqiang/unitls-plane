import { describe, expect, it } from 'vitest';
import { getAuthErrorKey } from './auth-error';

describe('getAuthErrorKey', () => {
  it('maps Better Auth email verification errors to stable message keys', () => {
    expect(
      getAuthErrorKey({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Email not verified',
      })
    ).toBe('errors.emailNotVerified');
  });

  it('maps known backend auth messages when no code is available', () => {
    expect(
      getAuthErrorKey({
        message: 'Invalid email or password',
      })
    ).toBe('errors.invalidCredentials');
  });

  it('falls back to a generic auth error key', () => {
    expect(getAuthErrorKey({ message: 'Unexpected error' })).toBe(
      'errors.generic'
    );
  });
});
