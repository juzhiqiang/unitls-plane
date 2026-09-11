import { afterEach, expect, it, spyOn, vi } from 'bun:test';
import { AccountSummaryCache } from './account-summary-cache.service';

type RedisAdapter = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlSeconds: number) => Promise<void>;
  del: (key: string) => Promise<void>;
  publish: (channel: string, message: string) => Promise<void>;
  subscribe: (
    channel: string,
    onMessage: (message: string) => void
  ) => Promise<void>;
  close: () => Promise<void>;
};

const caches: AccountSummaryCache[] = [];
const create = (redis?: RedisAdapter) => {
  const Cache = AccountSummaryCache as unknown as new (
    adapter?: RedisAdapter
  ) => AccountSummaryCache;
  const cache = new Cache(redis);
  caches.push(cache);
  return cache;
};
afterEach(async () => {
  await Promise.all(caches.splice(0).map(cache => cache.onModuleDestroy()));
});
const summary = (count = 1) => ({
  activeTaskCount: count,
  failedTaskCount: 0,
  activeFileCount: 0,
  activeFileBytes: 0,
  recentTasks: [],
  recentFiles: [],
});

function fakeRedis(): RedisAdapter & {
  onMessage?: (message: string) => void;
} {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    del: vi.fn(async () => undefined),
    publish: vi.fn(async () => undefined),
    subscribe: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

it('coalesces pending reads and caches success for two seconds', async () => {
  const cache = create();
  let resolve!: (value: ReturnType<typeof summary>) => void;
  let calls = 0;
  const read = () => {
    calls++;
    return new Promise<ReturnType<typeof summary>>(r => {
      resolve = r;
    });
  };
  const now = spyOn(Date, 'now').mockReturnValue(1000);
  try {
    const first = cache.get('u', read);
    expect(cache.get('u', read)).toBe(first);
    resolve(summary());
    await first;
    await cache.get('u', read);
    expect(calls).toBe(1);
    now.mockReturnValue(3000);
    const next = cache.get('u', read);
    expect(calls).toBe(2);
    resolve(summary(2));
    expect((await next).activeTaskCount).toBe(2);
  } finally {
    now.mockRestore();
  }
});

it('reads a shared Redis value before the database and then uses the local cache', async () => {
  const redis = fakeRedis();
  redis.get = vi.fn(async () => JSON.stringify(summary(7)));
  const cache = create(redis);
  const read = vi.fn(async () => summary(9));

  await expect(cache.get('shared-user', read)).resolves.toEqual(summary(7));
  await expect(cache.get('shared-user', read)).resolves.toEqual(summary(7));

  expect(redis.get).toHaveBeenCalledTimes(1);
  expect(read).not.toHaveBeenCalled();
});

it('falls back to the database when Redis is unavailable and writes the successful result', async () => {
  const redis = fakeRedis();
  redis.get = vi.fn(async () => {
    throw new Error('redis unavailable');
  });
  const cache = create(redis);
  const value = summary(8);

  await expect(cache.get('fallback-user', async () => value)).resolves.toBe(
    value
  );
  expect(redis.set).toHaveBeenCalledWith(
    expect.stringContaining('fallback-user'),
    JSON.stringify(value),
    2
  );
});

it('deletes malformed Redis values before falling back to the database', async () => {
  const redis = fakeRedis();
  redis.get = vi.fn(async () => '{malformed');
  const cache = create(redis);

  await expect(
    cache.get('corrupt-user', async () => summary(3))
  ).resolves.toEqual(summary(3));
  expect(redis.del).toHaveBeenCalledWith(
    expect.stringContaining('corrupt-user')
  );
});

it('serializes malformed-value cleanup with other Redis operations for one user', async () => {
  const redis = fakeRedis();
  const events: string[] = [];
  let getCalls = 0;
  let deleteCalls = 0;
  let releaseFirstDelete!: () => void;
  let firstDeleteStarted!: () => void;
  const deleteGate = new Promise<void>(resolve => {
    releaseFirstDelete = resolve;
  });
  const firstDeleteReady = new Promise<void>(resolve => {
    firstDeleteStarted = resolve;
  });

  redis.get = vi.fn(async () => {
    getCalls += 1;
    return getCalls === 1 ? '{malformed' : null;
  });
  redis.del = vi.fn(async () => {
    deleteCalls += 1;
    const call = deleteCalls;
    events.push(`delete:${call}:start`);
    if (call === 1) {
      firstDeleteStarted();
      await deleteGate;
    }
    events.push(`delete:${call}:end`);
  });
  redis.publish = vi.fn(async () => {
    events.push('publish');
  });
  const cache = create(redis);

  const pendingRead = cache.get('corrupt-queue-user', async () => summary(3));
  await firstDeleteReady;
  const invalidation = cache.invalidate('corrupt-queue-user');
  await Promise.resolve();

  expect(events).toEqual(['delete:1:start']);

  releaseFirstDelete();
  await Promise.all([pendingRead, invalidation]);

  expect(events).toEqual([
    'delete:1:start',
    'delete:1:end',
    'delete:2:start',
    'delete:2:end',
    'publish',
  ]);
});

it('invalidates local state before deleting and broadcasting the shared key', async () => {
  const redis = fakeRedis();
  const events: string[] = [];
  let releaseDelete!: () => void;
  redis.del = vi.fn(async () => {
    events.push('delete:start');
    await new Promise<void>(resolve => {
      releaseDelete = resolve;
    });
    events.push('delete:end');
  });
  redis.publish = vi.fn(async () => {
    events.push('publish');
  });
  const cache = create(redis);
  await cache.get('invalidate-user', async () => summary(1));

  const invalidation = cache.invalidate('invalidate-user');
  await Promise.resolve();
  expect(events).toEqual(['delete:start']);
  releaseDelete();
  await invalidation;
  expect(events).toEqual(['delete:start', 'delete:end', 'publish']);
  await expect(
    cache.get('invalidate-user', async () => summary(2))
  ).resolves.toEqual(summary(2));
});

it('does not broadcast an invalidation when deleting the shared key fails', async () => {
  const redis = fakeRedis();
  redis.del = vi.fn(async () => {
    throw new Error('redis delete unavailable');
  });
  const cache = create(redis);

  await cache.invalidate('delete-failure-user');

  expect(redis.publish).not.toHaveBeenCalled();
});

it('does not continue an invalidation broadcast after module destruction', async () => {
  const redis = fakeRedis();
  let releaseDelete!: () => void;
  let deleteStarted!: () => void;
  const deleteGate = new Promise<void>(resolve => {
    releaseDelete = resolve;
  });
  const deletionReady = new Promise<void>(resolve => {
    deleteStarted = resolve;
  });
  redis.del = vi.fn(async () => {
    deleteStarted();
    await deleteGate;
  });
  const cache = create(redis);

  const invalidation = cache.invalidate('destroy-race-user');
  await deletionReady;
  const destroying = cache.onModuleDestroy();
  releaseDelete();

  await Promise.all([invalidation, destroying]);

  expect(redis.publish).not.toHaveBeenCalled();
});

it('waits for an in-flight Redis write before closing the adapter', async () => {
  const redis = fakeRedis();
  let releaseSet!: () => void;
  let setStarted!: () => void;
  const setGate = new Promise<void>(resolve => {
    releaseSet = resolve;
  });
  const setReady = new Promise<void>(resolve => {
    setStarted = resolve;
  });
  redis.set = vi.fn(async () => {
    setStarted();
    await setGate;
  });
  const cache = create(redis);

  const pendingRead = cache.get('destroy-drain-user', async () => summary(12));
  await setReady;

  const destroying = cache.onModuleDestroy();
  await Promise.resolve();
  expect(redis.close).not.toHaveBeenCalled();

  releaseSet();
  await Promise.all([pendingRead, destroying]);
  expect(redis.close).toHaveBeenCalledTimes(1);
});

it('bypasses the shared cache after module destruction', async () => {
  const redis = fakeRedis();
  const cache = create(redis);
  const read = vi.fn(async () => summary(6));

  await cache.onModuleDestroy();

  await expect(cache.get('destroyed-cache-user', read)).resolves.toEqual(
    summary(6)
  );
  expect(read).toHaveBeenCalledTimes(1);
  expect(redis.get).not.toHaveBeenCalled();
  expect(redis.set).not.toHaveBeenCalled();
});

it('does not let an in-flight database read repopulate Redis after invalidation', async () => {
  const redis = fakeRedis();
  const values = new Map<string, string>();
  let releaseSet!: () => void;
  let setStarted!: () => void;
  const setReady = new Promise<void>(resolve => {
    setStarted = resolve;
  });
  const setGate = new Promise<void>(resolve => {
    releaseSet = resolve;
  });
  redis.get = vi.fn(async key => values.get(key) ?? null);
  redis.set = vi.fn(async (key, value) => {
    setStarted();
    await setGate;
    values.set(key, value);
  });
  redis.del = vi.fn(async key => {
    values.delete(key);
  });
  const cache = create(redis);

  const read = vi.fn(async () => summary(11));
  const pendingRead = cache.get('race-user', read);
  await setReady;

  const invalidation = cache.invalidate('race-user');
  releaseSet();
  await Promise.all([invalidation, pendingRead]);

  expect(values.size).toBe(0);
});

it('waits for an in-flight invalidation before retrying a stale Redis read', async () => {
  const redis = fakeRedis();
  const oldValue = JSON.stringify(summary(1));
  let releaseFirstRead!: () => void;
  let releaseDelete!: () => void;
  let deleteStarted!: () => void;
  const firstRead = new Promise<void>(resolve => {
    releaseFirstRead = resolve;
  });
  const deleteGate = new Promise<void>(resolve => {
    releaseDelete = resolve;
  });
  const deletionStarted = new Promise<void>(resolve => {
    deleteStarted = resolve;
  });
  let deleted = false;
  let readCount = 0;
  redis.get = vi.fn(async () => {
    readCount++;
    if (readCount === 1) await firstRead;
    return deleted ? null : oldValue;
  });
  redis.del = vi.fn(async () => {
    deleteStarted();
    await deleteGate;
    deleted = true;
  });
  const cache = create(redis);
  const read = vi.fn(async () => summary(2));
  const pendingRead = cache.get('read-race-user', read);

  const invalidation = cache.invalidate('read-race-user');
  await deletionStarted;
  releaseFirstRead();
  await Promise.resolve();
  releaseDelete();

  await invalidation;
  await expect(pendingRead).resolves.toEqual(summary(2));
  expect(read).toHaveBeenCalledTimes(1);
});

it('handles an external invalidation message locally without rebroadcasting it', async () => {
  const redis = fakeRedis();
  let onMessage!: (message: string) => void;
  redis.subscribe = vi.fn(async (_channel, callback) => {
    onMessage = callback;
  });
  const cache = create(redis);
  await cache.onModuleInit();
  await cache.get('remote-user', async () => summary(1));

  onMessage(JSON.stringify({ userId: 'remote-user' }));

  await expect(
    cache.get('remote-user', async () => summary(2))
  ).resolves.toEqual(summary(2));
  expect(redis.del).not.toHaveBeenCalled();
  expect(redis.publish).not.toHaveBeenCalled();
});

it('closes the injected Redis adapter when the module is destroyed', async () => {
  const redis = fakeRedis();
  const cache = create(redis);

  await cache.onModuleInit();
  await cache.onModuleDestroy();

  expect(redis.close).toHaveBeenCalledTimes(1);
});

it('does not retain invalidation bookkeeping for idle users', async () => {
  const redis = fakeRedis();
  const cache = create(redis);

  for (let index = 0; index < 1_200; index += 1) {
    await cache.invalidate(`idle-user-${index}`);
  }

  const state = cache as unknown as {
    invalidationVersions: Map<string, number>;
  };
  expect(state.invalidationVersions.size).toBe(0);
});

it('evicts least recently used entries at 1000, including pending reads', async () => {
  const cache = create();
  const pending = cache.get('pending', () => new Promise(() => {}));
  for (let i = 0; i < 999; i++)
    await cache.get(String(i), async () => summary());
  await cache.get('0', async () => summary(99));
  await cache.get('extra', async () => summary());
  expect(cache.get('pending', async () => summary(2))).not.toBe(pending);
  expect((await cache.get('0', async () => summary(99))).activeTaskCount).toBe(
    1
  );
});

it('does not refill an invalidated entry from an old read', async () => {
  const cache = create();
  let resolve!: (value: ReturnType<typeof summary>) => void;
  const old = cache.get(
    'u',
    () =>
      new Promise(r => {
        resolve = r;
      })
  );
  cache.invalidate('u');
  await cache.get('u', async () => summary(2));
  resolve(summary(1));
  await old;
  expect((await cache.get('u', async () => summary(3))).activeTaskCount).toBe(
    2
  );
});

it('retries failed reads without removing a newer entry', async () => {
  const cache = create();
  await expect(
    cache.get('u', async () => {
      throw new Error('db');
    })
  ).rejects.toThrow('db');
  expect((await cache.get('u', async () => summary(2))).activeTaskCount).toBe(
    2
  );
  cache.invalidate('u');
  let reject!: (error: Error) => void;
  const old = cache.get(
    'u',
    () =>
      new Promise((_, r) => {
        reject = r;
      })
  );
  cache.invalidate('u');
  await cache.get('u', async () => summary(3));
  reject(new Error('old'));
  await expect(old).rejects.toThrow('old');
  expect((await cache.get('u', async () => summary(4))).activeTaskCount).toBe(
    3
  );
});

it('periodically removes expired successful entries and stops its timer on destroy', async () => {
  let cleanup!: () => void;
  const unref = spyOn(globalThis, 'setInterval').mockImplementation(((
    fn: () => void,
    ms: number
  ) => {
    expect(ms).toBe(5000);
    cleanup = fn;
    return { unref() {} };
  }) as never);
  const clear = spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
  const now = spyOn(Date, 'now').mockReturnValue(0);
  try {
    const cache = create();
    cache.onModuleInit();
    await cache.get('u', async () => summary());
    now.mockReturnValue(5000);
    cleanup();
    // Inspect retained storage to distinguish active reclamation from read-time expiry.
    expect(
      (cache as unknown as { entries: Map<string, unknown> }).entries.size
    ).toBe(0);
    cache.onModuleDestroy();
    expect(clear).toHaveBeenCalledTimes(1);
  } finally {
    unref.mockRestore();
    clear.mockRestore();
    now.mockRestore();
  }
});
