import type { SdkOptions } from '@error-tracker/sdk/node';

type ErrorTrackerEnv = Partial<
  Record<
    | 'ERROR_TRACKER_DSN'
    | 'ERROR_TRACKER_TOKEN'
    | 'NODE_ENV'
    | 'RELEASE'
    | 'NEXT_PUBLIC_RELEASE',
    string
  >
>;

export function buildErrorTrackerOptions(
  env: ErrorTrackerEnv
): SdkOptions | null {
  if (!env.ERROR_TRACKER_DSN) {
    return null;
  }

  return {
    dsn: env.ERROR_TRACKER_DSN,
    ...(env.ERROR_TRACKER_TOKEN ? { token: env.ERROR_TRACKER_TOKEN } : {}),
    environment: env.NODE_ENV,
    release: env.RELEASE ?? env.NEXT_PUBLIC_RELEASE ?? 'dev',
  };
}
