import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetImageWorkerForTests,
  runInImageWorker,
} from '../image-worker-client';
import type { ImageWorkerJob } from '../image-worker-protocol';

const JOB: ImageWorkerJob = {
  op: 'convert',
  blob: new Blob(['x']),
  toType: 'image/webp',
  quality: 0.9,
};

/** 可控的 Worker 桩:按需回成功、回错误,或直接构造失败。 */
function stubWorker(behaviour: {
  constructThrows?: boolean;
  reply?: (id: number) => unknown;
  postThrows?: boolean;
}) {
  const instances: Array<{ terminate: () => void }> = [];

  class FakeWorker {
    private listeners = new Map<string, Array<(e: unknown) => void>>();
    terminate = vi.fn();

    constructor() {
      if (behaviour.constructThrows) throw new Error('no worker');
      instances.push(this);
    }

    addEventListener(type: string, fn: (e: unknown) => void) {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    }

    postMessage(request: { id: number }) {
      if (behaviour.postThrows) throw new Error('structured clone failed');
      const reply = behaviour.reply?.(request.id);
      if (reply === undefined) return;
      queueMicrotask(() => {
        for (const fn of this.listeners.get('message') ?? []) {
          fn({ data: reply } as unknown);
        }
      });
    }
  }

  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('OffscreenCanvas', function OffscreenCanvas() {});
  return instances;
}

beforeEach(() => {
  resetImageWorkerForTests();
});

afterEach(() => {
  resetImageWorkerForTests();
  vi.unstubAllGlobals();
});

describe('runInImageWorker', () => {
  it('returns the worker result without touching the fallback', async () => {
    const expected = new Blob(['from-worker']);
    stubWorker({ reply: id => ({ id, ok: true, blob: expected }) });
    const fallback = vi.fn();

    await expect(runInImageWorker(JOB, fallback)).resolves.toBe(expected);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back when OffscreenCanvas is unavailable', async () => {
    vi.stubGlobal('Worker', function Worker() {});
    vi.stubGlobal('OffscreenCanvas', undefined);
    const expected = new Blob(['main-thread']);

    await expect(runInImageWorker(JOB, async () => expected)).resolves.toBe(
      expected
    );
  });

  it('falls back when the worker cannot be constructed', async () => {
    stubWorker({ constructThrows: true });
    const expected = new Blob(['main-thread']);

    await expect(runInImageWorker(JOB, async () => expected)).resolves.toBe(
      expected
    );
  });

  it('falls back when the worker reports an error', async () => {
    stubWorker({ reply: id => ({ id, ok: false, error: 'boom' }) });
    const expected = new Blob(['main-thread']);

    // 搬进 Worker 是性能优化,不该变成新的失败来源。
    await expect(runInImageWorker(JOB, async () => expected)).resolves.toBe(
      expected
    );
  });

  it('falls back when postMessage throws', async () => {
    stubWorker({ postThrows: true });
    const expected = new Blob(['main-thread']);

    await expect(runInImageWorker(JOB, async () => expected)).resolves.toBe(
      expected
    );
  });

  it('reuses one worker across jobs', async () => {
    const instances = stubWorker({
      reply: id => ({ id, ok: true, blob: new Blob([String(id)]) }),
    });

    await runInImageWorker(JOB, async () => new Blob());
    await runInImageWorker(JOB, async () => new Blob());

    expect(instances).toHaveLength(1);
  });

  it('stops retrying construction after it fails once', async () => {
    let constructed = 0;
    class FailingWorker {
      constructor() {
        constructed += 1;
        throw new Error('no worker');
      }
    }
    vi.stubGlobal('Worker', FailingWorker);
    vi.stubGlobal('OffscreenCanvas', function OffscreenCanvas() {});

    await runInImageWorker(JOB, async () => new Blob());
    await runInImageWorker(JOB, async () => new Blob());

    // 每张图都付一次构造失败的开销是没有意义的。
    expect(constructed).toBe(1);
  });

  it('routes concurrent jobs back to their own callers', async () => {
    stubWorker({
      reply: id => ({ id, ok: true, blob: new Blob([`r${id}`]) }),
    });

    const [a, b] = await Promise.all([
      runInImageWorker(JOB, async () => new Blob(['fa'])),
      runInImageWorker(JOB, async () => new Blob(['fb'])),
    ]);

    await expect(a.text()).resolves.toBe('r1');
    await expect(b.text()).resolves.toBe('r2');
  });
});
