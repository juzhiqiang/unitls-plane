const LOCAL_SUPPORT_EMAIL = 'support@utils-plane.local';
const DEFAULT_APP_URL = 'http://localhost:3000';
const PRODUCTION_EMAIL_PATTERN =
  /^[A-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

export function assertProductionSupportEmail(email: string): string {
  const normalizedEmail = email.trim();
  const domain = normalizedEmail.split('@')[1]?.toLowerCase();

  if (
    !PRODUCTION_EMAIL_PATTERN.test(normalizedEmail) ||
    domain?.endsWith('.local')
  ) {
    throw new Error(
      'NEXT_PUBLIC_SUPPORT_EMAIL must be a valid public email address in production.'
    );
  }

  return normalizedEmail;
}

export function getSupportEmail(
  configuredEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL
): string {
  return configuredEmail?.trim() || LOCAL_SUPPORT_EMAIL;
}

export function getPublicSiteBaseUrl(
  configuredUrl = process.env.NEXT_PUBLIC_APP_URL
): string {
  const normalizedUrl = configuredUrl?.trim();

  if (!normalizedUrl) {
    return DEFAULT_APP_URL;
  }

  let publicUrl: URL;

  try {
    publicUrl = new URL(normalizedUrl);
  } catch {
    throw new Error(
      'NEXT_PUBLIC_APP_URL must be an absolute HTTP(S) URL without credentials, query, or hash.'
    );
  }

  if (
    !['http:', 'https:'].includes(publicUrl.protocol) ||
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.search ||
    publicUrl.hash
  ) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL must be an absolute HTTP(S) URL without credentials, query, or hash.'
    );
  }

  return publicUrl.toString().replace(/\/+$/, '');
}
