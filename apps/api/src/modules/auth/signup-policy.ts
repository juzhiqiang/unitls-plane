import { ConflictException } from '@nestjs/common';

export type ExistingAuthUser = {
  email: string;
  emailVerified?: boolean;
};

type EnsureEmailCanSignUpInput = {
  email: string;
  findUserByEmail: (email: string) => Promise<ExistingAuthUser | null>;
  resendVerificationEmail: (user: ExistingAuthUser) => Promise<void>;
};

export async function ensureEmailCanSignUp({
  email,
  findUserByEmail,
  resendVerificationEmail,
}: EnsureEmailCanSignUpInput): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return;

  const existing = await findUserByEmail(normalizedEmail);
  if (!existing) return;

  if (existing.emailVerified) {
    throw new ConflictException({
      code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
      message: 'User already exists. Use another email.',
    });
  }

  await resendVerificationEmail(existing);
  throw new ConflictException({
    code: 'EMAIL_VERIFICATION_RESENT',
    message: 'Verification email resent.',
  });
}
