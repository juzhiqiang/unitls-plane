type AuthErrorLike = {
  code?: string | null;
  message?: string | null;
};

const CODE_TO_KEY: Record<string, string> = {
  EMAIL_NOT_VERIFIED: 'errors.emailNotVerified',
  INVALID_EMAIL_OR_PASSWORD: 'errors.invalidCredentials',
  INVALID_EMAIL: 'errors.invalidEmail',
  INVALID_PASSWORD: 'errors.invalidPassword',
  PASSWORD_TOO_SHORT: 'errors.passwordTooShort',
  PASSWORD_TOO_LONG: 'errors.passwordTooLong',
  USER_ALREADY_EXISTS: 'errors.userAlreadyExists',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'errors.userAlreadyExists',
  EMAIL_VERIFICATION_RESENT: 'errors.emailVerificationResent',
  TOKEN_EXPIRED: 'errors.tokenExpired',
  INVALID_TOKEN: 'errors.invalidToken',
};

const MESSAGE_TO_KEY: Array<[RegExp, string]> = [
  [/email not verified/i, 'errors.emailNotVerified'],
  [/invalid email or password/i, 'errors.invalidCredentials'],
  [/invalid email/i, 'errors.invalidEmail'],
  [/invalid password/i, 'errors.invalidPassword'],
  [/password too short/i, 'errors.passwordTooShort'],
  [/password too long/i, 'errors.passwordTooLong'],
  [/user already exists/i, 'errors.userAlreadyExists'],
  [/verification email resent/i, 'errors.emailVerificationResent'],
  [/token expired/i, 'errors.tokenExpired'],
  [/invalid token/i, 'errors.invalidToken'],
];

export function getAuthErrorKey(error: AuthErrorLike): string {
  const code = error.code?.trim();
  if (code && CODE_TO_KEY[code]) return CODE_TO_KEY[code];

  const message = error.message?.trim();
  if (message) {
    const matched = MESSAGE_TO_KEY.find(([pattern]) => pattern.test(message));
    if (matched) return matched[1];
  }

  return 'errors.generic';
}
