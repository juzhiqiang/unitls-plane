import { describe, expect, it } from 'bun:test';
import { hasSessionCredentials } from '../../../src/common/auth/session-credentials';

describe('hasSessionCredentials', () => {
  it('treats a missing credential set as anonymous', () => {
    expect(hasSessionCredentials({})).toBe(false);
    expect(hasSessionCredentials({ cookie: '' })).toBe(false);
    expect(hasSessionCredentials({ cookie: 'theme=dark; locale=zh' })).toBe(
      false
    );
  });

  it.each([
    'better-auth.session_token=token',
    'better-auth.session_data=data',
    '__Secure-better-auth.session_token=token',
    '__Secure-better-auth.session_data=data',
    'better-auth.session_token.0=token',
    'better-auth.session_token.1=token',
    '__Secure-better-auth.session_data.12=data',
  ])('detects the Better-Auth session cookie %s', cookie => {
    expect(hasSessionCredentials({ cookie })).toBe(true);
  });

  it('matches cookie names exactly', () => {
    for (const cookie of [
      'not-better-auth.session_token=token',
      'better-auth.session_token_extra=token',
      'better-auth.session_tokens=token',
      'better-auth.session_token.bad=token',
      '__Secure-better-auth.session_data.0.1=data',
    ]) {
      expect(hasSessionCredentials({ cookie })).toBe(false);
    }
  });

  it('treats any Authorization header as a credential', () => {
    expect(hasSessionCredentials({ authorization: 'Bearer token' })).toBe(true);
    expect(hasSessionCredentials({ authorization: '' })).toBe(true);
    expect(hasSessionCredentials({ authorization: ['Bearer token'] })).toBe(
      true
    );
  });

  it('reads the session cookie among unrelated cookies', () => {
    expect(
      hasSessionCredentials({
        cookie: 'theme=dark; better-auth.session_token.1=token; locale=zh',
      })
    ).toBe(true);
  });
});
