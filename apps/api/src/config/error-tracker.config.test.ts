import { describe, expect, it } from 'bun:test';
import { buildErrorTrackerOptions } from './error-tracker.config';

describe('buildErrorTrackerOptions', () => {
  it('returns null when ERROR_TRACKER_DSN is missing', () => {
    expect(buildErrorTrackerOptions({ NODE_ENV: 'test' })).toBeNull();
  });

  it('builds SDK options from backend environment variables', () => {
    expect(
      buildErrorTrackerOptions({
        ERROR_TRACKER_DSN: 'http://localhost:3002/ingest/api-project',
        ERROR_TRACKER_TOKEN: 'api-token',
        NODE_ENV: 'production',
        RELEASE: '2026.06.18',
        NEXT_PUBLIC_RELEASE: 'frontend-release',
      })
    ).toEqual({
      dsn: 'http://localhost:3002/ingest/api-project',
      token: 'api-token',
      environment: 'production',
      release: '2026.06.18',
    });
  });

  it('falls back to NEXT_PUBLIC_RELEASE and dev defaults', () => {
    expect(
      buildErrorTrackerOptions({
        ERROR_TRACKER_DSN: 'http://localhost:3002/ingest/api-project',
        NEXT_PUBLIC_RELEASE: 'shared-release',
      })
    ).toEqual({
      dsn: 'http://localhost:3002/ingest/api-project',
      environment: undefined,
      release: 'shared-release',
    });

    expect(
      buildErrorTrackerOptions({
        ERROR_TRACKER_DSN: 'http://localhost:3002/ingest/api-project',
      })
    ).toEqual({
      dsn: 'http://localhost:3002/ingest/api-project',
      environment: undefined,
      release: 'dev',
    });
  });
});
