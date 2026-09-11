import Redis from 'ioredis';

export const ACCOUNT_SUMMARY_REDIS = Symbol('ACCOUNT_SUMMARY_REDIS');
export const ACCOUNT_SUMMARY_REDIS_CHANNEL =
  'utils-plane:account-summary:invalidate';
export const ACCOUNT_SUMMARY_REDIS_KEY_PREFIX =
  'utils-plane:v1:account-summary:';

export interface AccountSummaryRedisAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  publish(channel: string, message: string): Promise<void>;
  subscribe(
    channel: string,
    onMessage: (message: string) => void
  ): Promise<void>;
  close(): Promise<void>;
}

interface RedisConnection {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: 'EX',
    seconds: number
  ): Promise<unknown>;
  del(key: string): Promise<unknown>;
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(channel: string): Promise<unknown>;
  on(
    event: 'message',
    listener: (channel: string, message: string) => void
  ): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'ready' | 'close', listener: () => void): this;
  off(
    event: 'message',
    listener: (channel: string, message: string) => void
  ): this;
  off(event: 'ready' | 'close', listener: () => void): this;
  quit(): Promise<unknown>;
  disconnect(): void;
}

export class RedisAccountSummaryAdapter implements AccountSummaryRedisAdapter {
  private readonly subscriptions = new Map<string, (message: string) => void>();
  private readonly activeSubscriptions = new Set<string>();
  private readonly subscriptionAttempts = new Map<string, Promise<void>>();
  private restorePromise?: Promise<void>;
  private closed = false;
  private closePromise?: Promise<void>;

  private readonly onMessage = (channel: string, message: string) => {
    this.subscriptions.get(channel)?.(message);
  };

  private readonly onSubscriberReady = () => {
    void this.restoreSubscriptions();
  };

  private readonly onSubscriberClose = () => {
    this.activeSubscriptions.clear();
  };

  constructor(
    private readonly client: RedisConnection,
    private readonly subscriber: RedisConnection
  ) {
    // Optional cache failures must never become unhandled process-level errors.
    this.client.on('error', () => undefined);
    this.subscriber.on('error', () => undefined);
    this.subscriber.on('message', this.onMessage);
    this.subscriber.on('ready', this.onSubscriberReady);
    this.subscriber.on('close', this.onSubscriberClose);
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.client.publish(channel, message);
  }

  async subscribe(
    channel: string,
    onMessage: (message: string) => void
  ): Promise<void> {
    if (this.closed) throw new Error('Redis account summary adapter is closed');
    this.subscriptions.set(channel, onMessage);
    await this.ensureSubscription(channel);
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.subscriber.off('message', this.onMessage);
    this.subscriber.off('ready', this.onSubscriberReady);
    this.subscriber.off('close', this.onSubscriberClose);
    this.subscriptions.clear();
    this.activeSubscriptions.clear();
    this.closePromise = Promise.all(
      [this.client, this.subscriber].map(connection =>
        closeRedisConnection(connection)
      )
    ).then(() => undefined);
    return this.closePromise;
  }

  private ensureSubscription(channel: string): Promise<void> {
    if (this.activeSubscriptions.has(channel)) return Promise.resolve();
    const pending = this.subscriptionAttempts.get(channel);
    if (pending) return pending;

    const attempt = Promise.resolve()
      .then(() => this.subscriber.subscribe(channel))
      .then(() => {
        if (!this.closed) this.activeSubscriptions.add(channel);
      })
      .finally(() => {
        if (this.subscriptionAttempts.get(channel) === attempt) {
          this.subscriptionAttempts.delete(channel);
        }
      });
    this.subscriptionAttempts.set(channel, attempt);
    return attempt;
  }

  private restoreSubscriptions(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.restorePromise) return this.restorePromise;

    this.restorePromise = Promise.all(
      [...this.subscriptions.keys()]
        .filter(channel => !this.activeSubscriptions.has(channel))
        .map(channel => this.ensureSubscription(channel).catch(() => undefined))
    )
      .then(() => undefined)
      .finally(() => {
        this.restorePromise = undefined;
      });
    return this.restorePromise;
  }
}

const ACCOUNT_SUMMARY_REDIS_CONNECT_TIMEOUT_MS = 300;
const ACCOUNT_SUMMARY_REDIS_COMMAND_TIMEOUT_MS = 500;
const ACCOUNT_SUMMARY_REDIS_DISCONNECT_TIMEOUT_MS = 500;

export function getAccountSummaryRedisOptions() {
  return {
    connectTimeout: ACCOUNT_SUMMARY_REDIS_CONNECT_TIMEOUT_MS,
    commandTimeout: ACCOUNT_SUMMARY_REDIS_COMMAND_TIMEOUT_MS,
    disconnectTimeout: ACCOUNT_SUMMARY_REDIS_DISCONNECT_TIMEOUT_MS,
    enableOfflineQueue: false,
    lazyConnect: false,
    maxRetriesPerRequest: 0,
    retryStrategy: (attempt: number) => Math.min(attempt * 1_000, 30_000),
  } as const;
}

async function closeRedisConnection(
  connection: RedisConnection
): Promise<void> {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = globalThis.setTimeout(
        () => reject(new Error('Redis connection close timed out')),
        ACCOUNT_SUMMARY_REDIS_DISCONNECT_TIMEOUT_MS
      );
      void Promise.resolve()
        .then(() => connection.quit())
        .then(() => resolve(), reject);
    });
  } catch {
    try {
      connection.disconnect();
    } catch {
      // The connection is already unavailable; there is nothing else to close.
    }
  } finally {
    if (timer) globalThis.clearTimeout(timer);
  }
}

export function createAccountSummaryRedisAdapter(
  env: Record<string, string | undefined> = process.env
): AccountSummaryRedisAdapter | null {
  if (env.ACCOUNT_SUMMARY_REDIS?.trim().toLowerCase() === 'false') return null;
  const url = env.REDIS_URL?.trim();
  if (!url) return null;

  const options = getAccountSummaryRedisOptions();
  const client = new Redis(url, options) as unknown as RedisConnection;
  const subscriber = new Redis(url, options) as unknown as RedisConnection;
  return new RedisAccountSummaryAdapter(client, subscriber);
}
