import { afterEach, expect, it, spyOn } from 'bun:test';
import { AccountSummaryCache } from './account-summary-cache.service';

const caches: AccountSummaryCache[] = [];
const create = () => {
  const cache = new AccountSummaryCache();
  caches.push(cache);
  return cache;
};
afterEach(() => {
  for (const cache of caches.splice(0)) cache.onModuleDestroy();
});
const summary = (count = 1) => ({
  activeTaskCount: count,
  failedTaskCount: 0,
  activeFileCount: 0,
  activeFileBytes: 0,
  recentTasks: [],
  recentFiles: [],
});

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
