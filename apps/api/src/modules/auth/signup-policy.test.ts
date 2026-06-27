import { describe, expect, it, mock } from 'bun:test';
import { ConflictException } from '@nestjs/common';
import { ensureEmailCanSignUp } from './signup-policy';

describe('ensureEmailCanSignUp', () => {
  it('rejects sign-up for an already verified email', async () => {
    await expect(
      ensureEmailCanSignUp({
        email: 'done@example.com',
        findUserByEmail: async () => ({
          email: 'done@example.com',
          emailVerified: true,
        }),
        resendVerificationEmail: mock(async () => {}),
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('resends verification and rejects sign-up for an unverified email', async () => {
    const resendVerificationEmail = mock(async () => {});

    await expect(
      ensureEmailCanSignUp({
        email: 'pending@example.com',
        findUserByEmail: async () => ({
          email: 'pending@example.com',
          emailVerified: false,
        }),
        resendVerificationEmail,
      })
    ).rejects.toBeInstanceOf(ConflictException);

    expect(resendVerificationEmail).toHaveBeenCalledWith({
      email: 'pending@example.com',
      emailVerified: false,
    });
  });

  it('allows sign-up for a new email', async () => {
    await expect(
      ensureEmailCanSignUp({
        email: 'new@example.com',
        findUserByEmail: async () => null,
        resendVerificationEmail: mock(async () => {}),
      })
    ).resolves.toBeUndefined();
  });
});
