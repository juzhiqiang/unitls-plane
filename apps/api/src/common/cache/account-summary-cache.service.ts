import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import type { AccountRepository } from '../../modules/account/account.repository';
import {
  ACCOUNT_SUMMARY_REDIS,
  ACCOUNT_SUMMARY_REDIS_CHANNEL,
  ACCOUNT_SUMMARY_REDIS_KEY_PREFIX,
  type AccountSummaryRedisAdapter,
} from './account-summary-redis';

type Summary = Awaited<ReturnType<AccountRepository['getSummary']>>;
type Entry = { expiresAt: number; value?: Summary; pending?: Promise<Summary> };

const LOCAL_TTL_MS = 2_000;
const REDIS_TTL_SECONDS = 2;
const LOCAL_MAX_ENTRIES = 1_000;
const CLEANUP_INTERVAL_MS = 5_000;
const MAX_REVALIDATION_ATTEMPTS = 2;
const REDIS_DRAIN_TIMEOUT_MS = 1_000;

@Injectable()
export class AccountSummaryCache implements OnModuleInit, OnModuleDestroy {
  private readonly entries = new Map<string, Entry>();
  private readonly logger = new Logger(AccountSummaryCache.name);
  private readonly pendingInvalidations = new Map<string, Promise<void>>();
  private readonly invalidationVersions = new Map<string, number>();
  private readonly redisOperations = new Map<string, Promise<void>>();
  private readonly activeLoads = new Map<string, number>();
  private timer?: ReturnType<typeof globalThis.setInterval>;
  private initialized = false;
  private destroyed = false;

  constructor(
    @Optional()
    @Inject(ACCOUNT_SUMMARY_REDIS)
    private readonly redis?: AccountSummaryRedisAdapter | null
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.initialized || this.destroyed) return;
    this.initialized = true;
    if (!this.timer) {
      this.timer = globalThis.setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of this.entries) {
          if (!entry.pending && entry.expiresAt <= now) {
            this.entries.delete(key);
            this.maybeCleanupInvalidationVersion(key);
          }
        }
      }, CLEANUP_INTERVAL_MS);
      this.timer.unref();
    }
    if (!this.redis) return;

    try {
      await this.redis.subscribe(ACCOUNT_SUMMARY_REDIS_CHANNEL, message => {
        const userId = parseInvalidationMessage(message);
        if (userId) this.markLocallyInvalid(userId);
      });
    } catch (error) {
      this.logger.warn(
        `Account summary Redis subscription unavailable: ${formatError(error)}`
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.timer) globalThis.clearInterval(this.timer);
    this.timer = undefined;
    this.entries.clear();
    this.pendingInvalidations.clear();
    this.invalidationVersions.clear();
    this.activeLoads.clear();
    await this.waitForRedisOperations();
    this.redisOperations.clear();
    try {
      await this.redis?.close();
    } catch (error) {
      this.logger.warn(
        `Account summary Redis close failed: ${formatError(error)}`
      );
    }
  }

  private async waitForRedisOperations(): Promise<void> {
    const operations = [...this.redisOperations.values()];
    if (operations.length === 0) return;

    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    let timedOut = false;
    try {
      await Promise.race([
        Promise.allSettled(operations).then(() => undefined),
        new Promise<void>(resolve => {
          timer = globalThis.setTimeout(() => {
            timedOut = true;
            resolve();
          }, REDIS_DRAIN_TIMEOUT_MS);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) globalThis.clearTimeout(timer);
    }
    if (timedOut) {
      this.logger.warn(
        `Account summary Redis drain timed out after ${REDIS_DRAIN_TIMEOUT_MS}ms`
      );
    }
  }

  invalidate(userId: string | null | undefined): Promise<void> {
    if (!userId || this.destroyed) return Promise.resolve();
    this.markLocallyInvalid(userId);

    const operation = this.queueRedisOperation(userId);
    this.pendingInvalidations.set(userId, operation);
    void operation.then(() => {
      if (this.pendingInvalidations.get(userId) === operation) {
        this.pendingInvalidations.delete(userId);
      }
      this.maybeCleanupInvalidationVersion(userId);
    });
    return operation;
  }

  get(userId: string, read: () => Promise<Summary>): Promise<Summary> {
    if (!userId || this.destroyed) return read();
    const cached = this.entries.get(userId);
    if (cached && (cached.pending || cached.expiresAt > Date.now())) {
      this.entries.delete(userId);
      this.entries.set(userId, cached);
      return cached.pending ?? Promise.resolve(cached.value!);
    }
    this.entries.delete(userId);
    this.maybeCleanupInvalidationVersion(userId);
    const entry: Entry = { expiresAt: 0 };
    this.entries.set(userId, entry);
    // Keep the historical synchronous loader start when the shared layer is disabled.
    if (!this.redis) {
      const version = this.getInvalidationVersion(userId);
      let result: Promise<Summary>;
      try {
        result = read();
      } catch (error) {
        this.entries.delete(userId);
        this.maybeCleanupInvalidationVersion(userId);
        return Promise.reject(error);
      }
      entry.pending = result.then(
        value => {
          this.saveLocal(userId, entry, value, version);
          return value;
        },
        error => {
          if (this.entries.get(userId) === entry) this.entries.delete(userId);
          throw error;
        }
      );
    } else {
      entry.pending = this.load(userId, read, entry);
    }
    if (this.entries.size > LOCAL_MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
        this.maybeCleanupInvalidationVersion(oldestKey);
      }
    }
    return entry.pending;
  }

  private async load(
    userId: string,
    read: () => Promise<Summary>,
    entry: Entry
  ): Promise<Summary> {
    this.activeLoads.set(userId, (this.activeLoads.get(userId) ?? 0) + 1);
    try {
      for (let attempt = 0; attempt < MAX_REVALIDATION_ATTEMPTS; attempt++) {
        const invalidation = this.pendingInvalidations.get(userId);
        if (invalidation) await invalidation;
        const version = this.getInvalidationVersion(userId);
        const shared = await this.readRedis(userId);
        if (this.getInvalidationVersion(userId) !== version) continue;
        if (shared !== undefined) {
          this.saveLocal(userId, entry, shared, version);
          return shared;
        }

        const value = await read();
        if (this.getInvalidationVersion(userId) !== version) continue;
        if (this.entries.get(userId) === entry) {
          await this.queueRedisOperation(userId, async () => {
            if (
              this.destroyed ||
              this.getInvalidationVersion(userId) !== version ||
              this.entries.get(userId) !== entry
            ) {
              return;
            }
            await this.writeRedis(userId, value);
          });
          this.saveLocal(userId, entry, value, version);
        }
        return value;
      }

      // A busy account may be invalidated continuously. Return the latest
      // database result without caching rather than starving the request.
      const value = await read();
      if (this.entries.get(userId) === entry) this.entries.delete(userId);
      return value;
    } catch (error) {
      if (this.entries.get(userId) === entry) this.entries.delete(userId);
      throw error;
    } finally {
      const active = this.activeLoads.get(userId) ?? 0;
      if (active <= 1) this.activeLoads.delete(userId);
      else this.activeLoads.set(userId, active - 1);
      this.maybeCleanupInvalidationVersion(userId);
    }
  }

  private markLocallyInvalid(userId: string): void {
    if (this.destroyed) return;
    this.entries.delete(userId);
    this.invalidationVersions.set(
      userId,
      this.getInvalidationVersion(userId) + 1
    );
    this.maybeCleanupInvalidationVersion(userId);
  }

  private getInvalidationVersion(userId: string): number {
    return this.invalidationVersions.get(userId) ?? 0;
  }

  private saveLocal(
    userId: string,
    entry: Entry,
    value: Summary,
    version: number
  ): void {
    if (
      this.destroyed ||
      this.entries.get(userId) !== entry ||
      this.getInvalidationVersion(userId) !== version
    )
      return;
    entry.value = value;
    entry.pending = undefined;
    entry.expiresAt = Date.now() + LOCAL_TTL_MS;
  }

  private queueRedisOperation(
    userId: string,
    operation?: () => Promise<void>
  ): Promise<void> {
    if (!this.redis || this.destroyed) return Promise.resolve();
    const previous = this.redisOperations.get(userId) ?? Promise.resolve();
    const run = () => operation?.() ?? this.performInvalidation(userId);
    let next: Promise<void>;
    if (this.redisOperations.has(userId)) {
      next = previous
        .catch(() => undefined)
        .then(run)
        .catch(error => {
          this.logRedisFailure('queued operation', error);
        });
    } else {
      try {
        next = Promise.resolve(run()).catch(error => {
          this.logRedisFailure('queued operation', error);
        });
      } catch (error) {
        this.logRedisFailure('queued operation', error);
        next = Promise.resolve();
      }
    }
    this.redisOperations.set(userId, next);
    void next.then(() => {
      if (this.redisOperations.get(userId) === next) {
        this.redisOperations.delete(userId);
      }
      this.maybeCleanupInvalidationVersion(userId);
    });
    return next;
  }

  private async performInvalidation(userId: string): Promise<void> {
    if (!this.redis || this.destroyed) return;
    let deleted = false;
    try {
      await this.redis.del(redisKey(userId));
      deleted = true;
    } catch (error) {
      this.logRedisFailure('delete', error);
    }
    if (!deleted || this.destroyed) return;
    try {
      await this.redis.publish(
        ACCOUNT_SUMMARY_REDIS_CHANNEL,
        JSON.stringify({ userId })
      );
    } catch (error) {
      this.logRedisFailure('publish', error);
    }
  }

  private async readRedis(userId: string): Promise<Summary | undefined> {
    if (!this.redis) return undefined;
    let raw: string | null;
    try {
      raw = await this.redis.get(redisKey(userId));
    } catch (error) {
      this.logRedisFailure('read', error);
      return undefined;
    }
    if (raw === null) return undefined;
    try {
      const value: unknown = JSON.parse(raw);
      if (!isSummary(value)) throw new Error('invalid account summary payload');
      return value;
    } catch (error) {
      this.logRedisFailure('parse', error);
      await this.queueRedisOperation(userId, async () => {
        if (!this.redis || this.destroyed) return;
        try {
          await this.redis.del(redisKey(userId));
        } catch (deleteError) {
          this.logRedisFailure('delete corrupt value', deleteError);
        }
      });
      return undefined;
    }
  }

  private async writeRedis(userId: string, value: Summary): Promise<void> {
    if (!this.redis || this.destroyed) return;
    try {
      await this.redis.set(
        redisKey(userId),
        JSON.stringify(value),
        REDIS_TTL_SECONDS
      );
    } catch (error) {
      this.logRedisFailure('write', error);
    }
  }

  private logRedisFailure(operation: string, error: unknown): void {
    this.logger.warn(
      `Account summary Redis ${operation} unavailable: ${formatError(error)}`
    );
  }

  private maybeCleanupInvalidationVersion(userId: string): void {
    if (
      this.destroyed ||
      !this.invalidationVersions.has(userId) ||
      this.entries.has(userId) ||
      this.pendingInvalidations.has(userId) ||
      this.redisOperations.has(userId) ||
      this.activeLoads.has(userId)
    )
      return;
    this.invalidationVersions.delete(userId);
  }
}

function redisKey(userId: string): string {
  return `${ACCOUNT_SUMMARY_REDIS_KEY_PREFIX}${userId}`;
}

function parseInvalidationMessage(message: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(message);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'userId' in parsed &&
      typeof parsed.userId === 'string'
    ) {
      return parsed.userId;
    }
  } catch {
    // Older publishers may send the user ID directly.
  }
  return message || undefined;
}

function isSummary(value: unknown): value is Summary {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.activeTaskCount === 'number' &&
    typeof candidate.failedTaskCount === 'number' &&
    typeof candidate.activeFileCount === 'number' &&
    typeof candidate.activeFileBytes === 'number' &&
    Array.isArray(candidate.recentTasks) &&
    Array.isArray(candidate.recentFiles)
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
