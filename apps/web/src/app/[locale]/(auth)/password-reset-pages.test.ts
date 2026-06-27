import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const authDir = dirname(fileURLToPath(import.meta.url));

describe('password reset auth pages', () => {
  it('links to forgot password from the login page', () => {
    const source = readFileSync(join(authDir, 'login', 'page.tsx'), 'utf8');

    expect(source).toContain('href="/forgot-password"');
    expect(source).toContain("t('forgotPasswordLink')");
  });

  it('provides forgot and reset password pages', () => {
    expect(existsSync(join(authDir, 'forgot-password', 'page.tsx'))).toBe(true);
    expect(existsSync(join(authDir, 'reset-password', 'page.tsx'))).toBe(true);
  });

  it('uses Better Auth password reset client methods', () => {
    const clientSource = readFileSync(
      join(authDir, '..', '..', '..', 'lib', 'auth-client.ts'),
      'utf8'
    );

    expect(clientSource).toContain('requestPasswordReset');
    expect(clientSource).toContain('resetPassword');
  });
});
