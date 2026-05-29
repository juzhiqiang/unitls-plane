import { URL } from 'node:url';

type Env = Record<string, string | undefined>;

const DEFAULT_WEB_ORIGIN = 'http://localhost:3000';
const DEFAULT_API_ORIGIN = 'http://localhost:3001';

export function normalizeOrigin(
  value: string | null | undefined
): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '*') return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function parseOrigins(value: string | undefined): string[] {
  return unique(
    (value ?? '')
      .split(',')
      .map(item => normalizeOrigin(item))
      .filter((origin): origin is string => Boolean(origin))
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function portFor(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === 'https:' ? '443' : '80';
}

function isLocalhostName(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function isPrivateNetworkName(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (isLocalhostName(host) || host === '0.0.0.0') return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true;
  }
  return false;
}

function hasMatchingDevelopmentPort(
  origin: URL,
  allowedOrigins: string[]
): boolean {
  return allowedOrigins.some(allowedOrigin => {
    const allowed = new URL(allowedOrigin);
    return (
      allowed.protocol === origin.protocol &&
      portFor(allowed) === portFor(origin) &&
      isLocalhostName(allowed.hostname)
    );
  });
}

function getLocalhostAliases(origins: string[]): string[] {
  const aliases: string[] = [];

  for (const origin of origins) {
    const url = new URL(origin);
    if (!isLocalhostName(url.hostname)) continue;

    const port = url.port ? `:${url.port}` : '';
    aliases.push(`${url.protocol}//localhost${port}`);
    aliases.push(`${url.protocol}//127.0.0.1${port}`);
  }

  return aliases;
}

export function getAllowedCorsOrigins(env: Env = process.env): string[] {
  const configured = parseOrigins(env.CORS_ORIGIN);
  const origins = configured.length > 0 ? configured : [DEFAULT_WEB_ORIGIN];

  if (env.NODE_ENV === 'development') {
    origins.push(...getLocalhostAliases(origins));
  }

  return unique(origins);
}

export function isOriginAllowed(
  origin: string | null | undefined,
  env: Env = process.env
): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  const allowedOrigins = getAllowedCorsOrigins(env);
  if (allowedOrigins.includes(normalized)) return true;
  if (env.NODE_ENV !== 'development') return false;

  const originUrl = new URL(normalized);
  return (
    originUrl.protocol === 'http:' &&
    isPrivateNetworkName(originUrl.hostname) &&
    hasMatchingDevelopmentPort(originUrl, allowedOrigins)
  );
}

export function getTrustedOrigins(
  env: Env = process.env,
  requestOrigin?: string | null
): string[] {
  const origins = [
    ...getAllowedCorsOrigins(env),
    normalizeOrigin(env.BETTER_AUTH_URL) ?? DEFAULT_API_ORIGIN,
    normalizeOrigin(env.NEXT_PUBLIC_API_URL),
  ].filter((origin): origin is string => Boolean(origin));

  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
  if (
    normalizedRequestOrigin &&
    isOriginAllowed(normalizedRequestOrigin, env)
  ) {
    origins.push(normalizedRequestOrigin);
  }

  return unique(origins);
}
