import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'bun:test';
import {
  ACCOUNT_SUMMARY_REDIS_CHANNEL,
  RedisAccountSummaryAdapter,
  createAccountSummaryRedisAdapter,
  getAccountSummaryRedisOptions,
} from './account-summary-redis';

class FakeRedisClient extends EventEmitter {
  get = vi.fn(async () => 'value');
  set = vi.fn(async () => 'OK');
  del = vi.fn(async () => 1);
  publish = vi.fn(async () => 1);
  subscribe = vi.fn(async () => 1);
  quit = vi.fn(async () => 'OK');
  disconnect = vi.fn(() => undefined);
}

it('disables the optional adapter when the feature flag is false or the URL is absent', () => {
  expect(
    createAccountSummaryRedisAdapter({
      REDIS_URL: 'redis://localhost:6379',
      ACCOUNT_SUMMARY_REDIS: 'false',
    })
  ).toBeNull();
  expect(createAccountSummaryRedisAdapter({})).toBeNull();
});

it('uses fail-fast commands while retaining a reconnect strategy', () => {
  const options = getAccountSummaryRedisOptions();

  expect(options).toMatchObject({
    connectTimeout: 300,
    commandTimeout: 500,
    disconnectTimeout: 500,
    enableOfflineQueue: false,
    lazyConnect: false,
    maxRetriesPerRequest: 0,
  });
  expect(options.retryStrategy?.(1)).toBeGreaterThan(0);
  expect(options.retryStrategy?.(100)).toBeLessThanOrEqual(30_000);
});

it('maps cache commands and forwards subscriber messages', async () => {
  const client = new FakeRedisClient();
  const subscriber = new FakeRedisClient();
  const adapter = new RedisAccountSummaryAdapter(client, subscriber);
  const onMessage = vi.fn();

  await expect(adapter.get('key')).resolves.toBe('value');
  await adapter.set('key', 'json', 2);
  await adapter.del('key');
  await adapter.publish(ACCOUNT_SUMMARY_REDIS_CHANNEL, 'message');
  await adapter.subscribe(ACCOUNT_SUMMARY_REDIS_CHANNEL, onMessage);
  subscriber.emit('message', ACCOUNT_SUMMARY_REDIS_CHANNEL, 'message');

  expect(client.get).toHaveBeenCalledWith('key');
  expect(client.set).toHaveBeenCalledWith('key', 'json', 'EX', 2);
  expect(client.del).toHaveBeenCalledWith('key');
  expect(client.publish).toHaveBeenCalledWith(
    ACCOUNT_SUMMARY_REDIS_CHANNEL,
    'message'
  );
  expect(subscriber.subscribe).toHaveBeenCalledWith(
    ACCOUNT_SUMMARY_REDIS_CHANNEL
  );
  expect(onMessage).toHaveBeenCalledWith('message');
});

it('retries a failed subscription after the Redis connection becomes ready', async () => {
  const client = new FakeRedisClient();
  const subscriber = new FakeRedisClient();
  subscriber.subscribe
    .mockRejectedValueOnce(new Error('Redis is offline'))
    .mockResolvedValueOnce(1);
  const adapter = new RedisAccountSummaryAdapter(client, subscriber);

  await expect(
    adapter.subscribe(ACCOUNT_SUMMARY_REDIS_CHANNEL, () => undefined)
  ).rejects.toThrow('Redis is offline');

  subscriber.emit('ready');
  await waitFor(() => subscriber.subscribe.mock.calls.length === 2);

  expect(subscriber.subscribe).toHaveBeenNthCalledWith(
    2,
    ACCOUNT_SUMMARY_REDIS_CHANNEL
  );
  await adapter.close();
});

it('closes both independent Redis connections', async () => {
  const client = new FakeRedisClient();
  const subscriber = new FakeRedisClient();
  const adapter = new RedisAccountSummaryAdapter(client, subscriber);

  await adapter.close();

  expect(client.quit).toHaveBeenCalledTimes(1);
  expect(subscriber.quit).toHaveBeenCalledTimes(1);
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
