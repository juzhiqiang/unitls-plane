import { Inject, Injectable, Optional } from '@nestjs/common';
import { performance } from 'node:perf_hooks';

export const HEALTH_CHECKS = Symbol('HEALTH_CHECKS');
export const HEALTH_TIMEOUT_MS = Symbol('HEALTH_TIMEOUT_MS');

export interface HealthChecks {
  database(signal: globalThis.AbortSignal): Promise<void>;
  redis(signal: globalThis.AbortSignal): Promise<void>;
  minio(signal: globalThis.AbortSignal): Promise<void>;
  queues(signal: globalThis.AbortSignal): Promise<void>;
  libreOffice(signal: globalThis.AbortSignal): Promise<boolean>;
}

type ComponentStatus = 'ok' | 'degraded' | 'error';

interface ComponentResult {
  status: ComponentStatus;
  durationMs: number;
}

interface CheckExecution {
  result: Promise<ComponentResult>;
  settled: Promise<void>;
}

interface ReadinessBatch {
  result: Promise<ReadyResult>;
  settled: Promise<void>;
}

export interface ReadyResult {
  status: ComponentStatus;
  timestamp: string;
  httpStatus: 200 | 503;
  components: Record<keyof HealthChecks, ComponentResult>;
}

export interface LiveResult {
  status: 'ok';
  timestamp: string;
  startedAt: string;
  release: string;
  buildCommit: string;
  buildTime: string | null;
}

@Injectable()
export class HealthService {
  private readonly startedAt = new Date(
    Date.now() - process.uptime() * 1000
  ).toISOString();
  private readyInFlight?: ReadinessBatch;

  constructor(
    @Inject(HEALTH_CHECKS) private readonly checks: HealthChecks,
    @Optional()
    @Inject(HEALTH_TIMEOUT_MS)
    private readonly timeoutMs = 3000
  ) {}

  live(): LiveResult {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      startedAt: this.startedAt,
      release: process.env.RELEASE ?? 'dev',
      buildCommit: process.env.BUILD_COMMIT ?? 'dev',
      buildTime: process.env.BUILD_TIME ?? null,
    };
  }

  ready(): Promise<ReadyResult> {
    if (this.readyInFlight) return this.readyInFlight.result;

    const batch = this.createReadinessBatch();
    this.readyInFlight = batch;
    void Promise.allSettled([batch.result, batch.settled]).then(() => {
      if (this.readyInFlight === batch) {
        this.readyInFlight = undefined;
      }
    });
    return batch.result;
  }

  private createReadinessBatch(): ReadinessBatch {
    const database = this.runCheck(
      signal => this.checks.database(signal),
      'error'
    );
    const redis = this.runCheck(signal => this.checks.redis(signal), 'error');
    const minio = this.runCheck(signal => this.checks.minio(signal), 'error');
    const queues = this.runCheck(signal => this.checks.queues(signal), 'error');
    const libreOffice = this.runCheck(
      signal => this.checks.libreOffice(signal),
      'degraded'
    );
    const executions = [database, redis, minio, queues, libreOffice];

    return {
      result: Promise.all([
        database.result,
        redis.result,
        minio.result,
        queues.result,
        libreOffice.result,
      ]).then(([database, redis, minio, queues, libreOffice]) => {
        const components = { database, redis, minio, queues, libreOffice };
        const statuses = Object.values(components).map(
          component => component.status
        );
        const status: ComponentStatus = statuses.includes('error')
          ? 'error'
          : statuses.includes('degraded')
            ? 'degraded'
            : 'ok';

        return {
          status,
          timestamp: new Date().toISOString(),
          httpStatus: status === 'error' ? 503 : 200,
          components,
        };
      }),
      settled: Promise.all(executions.map(execution => execution.settled)).then(
        () => undefined
      ),
    };
  }

  private runCheck(
    check: (signal: globalThis.AbortSignal) => Promise<void | boolean>,
    failureStatus: Exclude<ComponentStatus, 'ok'>
  ): CheckExecution {
    const startedAt = performance.now();
    const controller = new globalThis.AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const checkPromise = Promise.resolve().then(() => check(controller.signal));
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Health check timed out'));
      }, this.timeoutMs);
    });

    return {
      result: (async () => {
        try {
          const result = await Promise.race([checkPromise, timeoutPromise]);

          return {
            status: result === false ? failureStatus : 'ok',
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          };
        } catch {
          return {
            status: failureStatus,
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          };
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      })(),
      settled: checkPromise.then(
        () => undefined,
        () => undefined
      ),
    };
  }
}
