import { afterEach, describe, expect, it, vi } from 'bun:test';
import { performance } from 'node:perf_hooks';
import {
  HealthService,
  type HealthChecks,
  type ReadyResult,
} from './health.service';

const originalRelease = process.env.RELEASE;
const originalBuildCommit = process.env.BUILD_COMMIT;
const originalBuildTime = process.env.BUILD_TIME;

function restoreEnvironment(
  name: 'RELEASE' | 'BUILD_COMMIT' | 'BUILD_TIME',
  value: string | undefined
) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function createChecks(overrides: Partial<HealthChecks> = {}): HealthChecks {
  return {
    database: vi.fn(async () => undefined),
    redis: vi.fn(async () => undefined),
    minio: vi.fn(async () => undefined),
    queues: vi.fn(async () => undefined),
    libreOffice: vi.fn(async () => true),
    ...overrides,
  };
}

function expectPrivateDetailsHidden(result: ReadyResult, secret: string) {
  expect(JSON.stringify(result)).not.toContain(secret);
  for (const component of Object.values(result.components)) {
    expect(Object.keys(component).sort()).toEqual(['durationMs', 'status']);
    expect(component.durationMs).toBeGreaterThanOrEqual(0);
  }
}

afterEach(() => {
  restoreEnvironment('RELEASE', originalRelease);
  restoreEnvironment('BUILD_COMMIT', originalBuildCommit);
  restoreEnvironment('BUILD_TIME', originalBuildTime);
  vi.restoreAllMocks();
});

describe('HealthService.ready', () => {
  for (const component of ['database', 'redis', 'minio', 'queues'] as const) {
    it(`returns 503 without exposing the ${component} error`, async () => {
      const secret = `${component}://user:password@private-host`;
      const checks = createChecks({
        [component]: vi.fn(async () => {
          throw new Error(secret);
        }),
      });

      const result = await new HealthService(checks).ready();

      expect(result.status).toBe('error');
      expect(result.httpStatus).toBe(503);
      expect(result.components[component].status).toBe('error');
      expectPrivateDetailsHidden(result, secret);
    });
  }

  it('reports missing LibreOffice as degraded while remaining ready', async () => {
    const result = await new HealthService(
      createChecks({ libreOffice: vi.fn(async () => false) })
    ).ready();

    expect(result.status).toBe('degraded');
    expect(result.httpStatus).toBe(200);
    expect(result.components.libreOffice.status).toBe('degraded');
  });

  it('returns 503 when a core dependency exceeds the timeout', async () => {
    let signal: globalThis.AbortSignal | undefined;
    const result = await new HealthService(
      createChecks({
        database: vi.fn(receivedSignal => {
          signal = receivedSignal;
          return new Promise(() => undefined);
        }),
      }),
      5
    ).ready();

    expect(result.status).toBe('error');
    expect(result.httpStatus).toBe(503);
    expect(result.components.database.status).toBe('error');
    expect(signal).toBeInstanceOf(globalThis.AbortSignal);
    expect(signal?.aborted).toBe(true);
  });

  it('handles a check that rejects after its timeout without an unhandled rejection', async () => {
    const unhandledRejection = vi.fn();
    process.on('unhandledRejection', unhandledRejection);

    try {
      const result = await new HealthService(
        createChecks({
          database: vi.fn(
            () =>
              new Promise((_, reject) => {
                setTimeout(() => reject(new Error('late failure')), 10);
              })
          ),
        }),
        5
      ).ready();
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(result.components.database.status).toBe('error');
      expect(unhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandledRejection);
    }
  });

  it('returns ok when every dependency is available', async () => {
    const result = await new HealthService(createChecks()).ready();

    expect(result.status).toBe('ok');
    expect(result.httpStatus).toBe(200);
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    expect(
      Object.values(result.components).every(
        component => component.status === 'ok'
      )
    ).toBe(true);
    expectPrivateDetailsHidden(result, 'never-present');
  });

  it('runs all dependency checks concurrently', async () => {
    const delayMs = 20;
    const delayed = () =>
      new Promise<void>(resolve => setTimeout(resolve, delayMs));
    const checks = createChecks({
      database: vi.fn(delayed),
      redis: vi.fn(delayed),
      minio: vi.fn(delayed),
      queues: vi.fn(delayed),
      libreOffice: vi.fn(async () => {
        await delayed();
        return true;
      }),
    });
    const start = performance.now();

    const result = await new HealthService(checks, 500).ready();

    expect(performance.now() - start).toBeLessThan(delayMs * 3.5);
    expect(result.status).toBe('ok');
  });

  it('clears timeout timers after checks settle', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    await new HealthService(createChecks(), 5).ready();

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(5);
  });

  it('shares one dependency check batch across concurrent readiness calls', async () => {
    const releases: Array<() => void> = [];
    const checks = createChecks({
      database: vi.fn(
        () =>
          new Promise<void>(resolve => {
            releases.push(resolve);
          })
      ),
    });
    const service = new HealthService(checks, 500);
    const first = service.ready();
    const second = service.ready();

    await Promise.resolve();
    try {
      for (const check of Object.values(checks)) {
        expect(check).toHaveBeenCalledTimes(1);
      }
    } finally {
      for (const release of releases) release();
    }

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(secondResult);
  });

  it('starts a fresh dependency check batch after the in-flight batch settles', async () => {
    const checks = createChecks();
    const service = new HealthService(checks);

    await Promise.all([service.ready(), service.ready()]);
    for (const check of Object.values(checks)) {
      expect(check).toHaveBeenCalledTimes(1);
    }

    await service.ready();
    for (const check of Object.values(checks)) {
      expect(check).toHaveBeenCalledTimes(2);
    }
  });

  it('keeps a timed-out batch in flight until its underlying checks settle', async () => {
    let release: (() => void) | undefined;
    let databaseCalls = 0;
    const checks = createChecks({
      database: vi.fn(() => {
        databaseCalls += 1;
        if (databaseCalls > 1) return Promise.resolve();
        return new Promise<void>(resolve => {
          release = resolve;
        });
      }),
    });
    const service = new HealthService(checks, 5);
    const firstResult = await service.ready();

    try {
      const secondResult = await service.ready();

      expect(secondResult).toBe(firstResult);
      expect(checks.database).toHaveBeenCalledTimes(1);
    } finally {
      release?.();
    }

    await new Promise(resolve => setTimeout(resolve, 0));
    await service.ready();
    expect(checks.database).toHaveBeenCalledTimes(2);
  });
});

describe('HealthService.live', () => {
  it('returns stable process metadata with safe defaults', () => {
    delete process.env.RELEASE;
    delete process.env.BUILD_COMMIT;
    delete process.env.BUILD_TIME;
    const service = new HealthService(createChecks());

    const first = service.live();
    const second = service.live();

    expect(first.status).toBe('ok');
    expect(new Date(first.timestamp).toISOString()).toBe(first.timestamp);
    expect(new Date(first.startedAt).toISOString()).toBe(first.startedAt);
    expect(first.startedAt).toBe(second.startedAt);
    expect(first.release).toBe('dev');
    expect(first.buildCommit).toBe('dev');
    expect(first).not.toHaveProperty('commit');
    expect(first.buildTime).toBeNull();
  });

  it('returns configured release metadata', () => {
    process.env.RELEASE = 'beta-1';
    process.env.BUILD_COMMIT = 'abc1234';
    process.env.BUILD_TIME = '2026-07-15T08:00:00.000Z';

    const result = new HealthService(createChecks()).live();

    expect(result.release).toBe('beta-1');
    expect(result.buildCommit).toBe('abc1234');
    expect(result).not.toHaveProperty('commit');
    expect(result.buildTime).toBe('2026-07-15T08:00:00.000Z');
  });
});
