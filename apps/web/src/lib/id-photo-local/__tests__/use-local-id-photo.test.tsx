import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocalIdPhoto } from '../use-local-id-photo';

// 假 Worker:记录 postMessage,记录 terminate 调用,手动触发 onmessage 回包
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  posted: unknown[] = [];
  terminate = vi.fn(() => {});
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
}

let fake: FakeWorker;
// 最近一次 createImageBitmap 产出的 bitmap,便于断言 close 调用(MEDIUM 9)
let lastBitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };

beforeEach(() => {
  // @testing-library/react v16 需要 act 环境标记,否则 renderHook/act 不刷新状态
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

  fake = new FakeWorker();

  // compositeIdPhoto 在 jsdom 下需要 2D 上下文与 convertToBlob;用最小可用桩,
  // 使合成通路跑到 convertToBlob 返回固定 Blob。
  class FakeCtx {
    fillStyle = '';
    drawImage(..._args: unknown[]): void {
      /* no-op */
    }
    getImageData(_x: number, _y: number, w: number, h: number) {
      return {
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      } as ImageData;
    }
    putImageData(
      _d: { data: Uint8ClampedArray },
      _dx?: number,
      _dy?: number,
    ): void {
      /* no-op */
    }
    fillRect(_x: number, _y: number, _w: number, _h: number): void {
      /* no-op */
    }
  }
  class FakeCanvas {
    ctx: FakeCtx;
    constructor(public width: number, public height: number) {
      this.ctx = new FakeCtx();
    }
    getContext(): FakeCtx {
      return this.ctx;
    }
    convertToBlob(): Promise<Blob> {
      return Promise.resolve(new Blob(['x']));
    }
  }

  // Bun test runner 的 vi shim 无 stubGlobal,用 Object.defineProperty 直接挂全局
  Object.defineProperty(globalThis, 'Worker', {
    value: function WorkerStub() {
      return fake;
    },
    configurable: true,
    writable: true,
  });
  // 返回带 close 的 bitmap,模拟真实 ImageBitmap 生命周期(MEDIUM 9)
  Object.defineProperty(globalThis, 'createImageBitmap', {
    value: vi.fn(async () => {
      lastBitmap = {
        width: 10,
        height: 10,
        close: vi.fn(),
      };
      return lastBitmap;
    }),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    value: FakeCanvas,
    configurable: true,
    writable: true,
  });

  // modelUrl 依赖 NEXT_PUBLIC_S3_PUBLIC_URL,否则抛错
  process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'http://localhost:9000';
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
});

function postedOf(type: string): unknown[] {
  return fake.posted.filter(m => (m as { type: string }).type === type);
}

const defaultOpts = {
  preset: 'one_inch' as const,
  backgroundColor: '#438edb',
  outputType: 'image/jpeg' as const,
};

function makeFile(name = 'a.jpg'): File {
  return new File(['img'], name, { type: 'image/jpeg' });
}

describe('useLocalIdPhoto', () => {
  it('starts in idle with no result', () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    expect(result.current.status).toBe('idle');
    expect(result.current.resultBlob).toBeNull();
  });

  it('runs segmentation and composites a result blob', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      const p = result.current.process(makeFile(), 'balanced', defaultOpts);
      // 等 init post
      await waitFor(() => expect(postedOf('init').length).toBeGreaterThanOrEqual(1));
      // worker 回 ready(webgpu=false → wasm)
      fake.onmessage!({
        data: {
          type: 'ready',
          ep: 'wasm',
          inputNames: ['input'],
          outputNames: ['out'],
        },
      });
      await waitFor(() => expect(postedOf('run').length).toBeGreaterThanOrEqual(1));
      // worker 回 result mask
      fake.onmessage!({
        data: {
          type: 'result',
          mask: new Float32Array(100),
          maskW: 10,
          maskH: 10,
        },
      });
      await p;
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.resultBlob).toBeInstanceOf(Blob);
  });

  it('locks balanced tier when webgpu unavailable', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      result.current.process(makeFile(), 'high', defaultOpts);
      await waitFor(() => expect(postedOf('init').length).toBeGreaterThanOrEqual(1));
    });
    // ep=wasm(初始 null 视为不可用 webgpu)时,即便请求 high,实际 init 的是 balanced 模型 URL
    const init = postedOf('init')[0] as { modelUrl: string } | undefined;
    expect(init?.modelUrl).toContain('rmbg-1.4');
    // 避免未 await 的 process promise 产生 lingering rejection 噪声
    expect(result.current.error).toBeNull();
  });

  // CRITICAL 2:tier 切换后按新 tier 重载模型,而非复用旧 session 直接 run
  it('reloads the high-precision model when tier changes after ready', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    // 首次 process balanced(ep=null → 视为无 webgpu → balanced)
    await act(async () => {
      result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
      await waitFor(() => expect(postedOf('init').length).toBeGreaterThanOrEqual(1));
    });
    expect(
      (postedOf('init')[0] as { modelUrl: string }).modelUrl,
    ).toContain('rmbg-1.4');
    // worker 回 ready,探测到 webgpu → ep=webgpu,但 loadedTier 仍为 balanced
    await act(async () => {
      fake.onmessage!({
        data: {
          type: 'ready',
          ep: 'webgpu',
          inputNames: ['input'],
          outputNames: ['out'],
        },
      });
      await waitFor(() => expect(postedOf('run').length).toBeGreaterThanOrEqual(1));
    });
    // 再次 process,请求 high → effectiveTier high ≠ loaded balanced → 重发 init(rmbg-2.0)
    await act(async () => {
      result.current.process(makeFile('b.jpg'), 'high', defaultOpts);
      await waitFor(() => expect(postedOf('init').length).toBe(2));
    });
    const inits = postedOf('init');
    expect(inits.length).toBe(2);
    expect((inits[1] as { modelUrl: string }).modelUrl).toContain('rmbg-2.0');
  });

  // MEDIUM 6:reset 清 readyRef/loadedTier,再次 process 必须重新 init 而非直接 run
  it('re-inits after reset clears ready state', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
      await waitFor(() => expect(postedOf('init').length).toBeGreaterThanOrEqual(1));
      fake.onmessage!({
        data: {
          type: 'ready',
          ep: 'wasm',
          inputNames: ['in'],
          outputNames: ['out'],
        },
      });
      await waitFor(() => expect(postedOf('run').length).toBeGreaterThanOrEqual(1));
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.ep).toBeNull();
    const runsBefore = postedOf('run').length;
    await act(async () => {
      result.current.process(makeFile('b.jpg'), 'balanced', defaultOpts);
      await waitFor(() => expect(postedOf('init').length).toBe(2));
    });
    // 第二次 process 发了 init(readyRef 已清),且在 ready 回包前不应多发 run
    expect(postedOf('init').length).toBe(2);
    expect(postedOf('run').length).toBe(runsBefore);
  });

  // HIGH 3:unmount 时 terminate worker
  it('terminates the worker on unmount', async () => {
    const { result, unmount } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
      await waitFor(() => expect(postedOf('init').length).toBeGreaterThanOrEqual(1));
    });
    unmount();
    expect(fake.terminate).toHaveBeenCalled();
  });

  // MEDIUM 7:running 中 reset 使 sessionId 失效,旧 worker result 回包被丢弃,不会误置 compositing
  it('drops stale worker results after reset', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
      await waitFor(() => expect(postedOf('init').length).toBeGreaterThanOrEqual(1));
      fake.onmessage!({
        data: {
          type: 'ready',
          ep: 'wasm',
          inputNames: ['in'],
          outputNames: ['out'],
        },
      });
      await waitFor(() => expect(postedOf('run').length).toBeGreaterThanOrEqual(1));
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe('idle');
    // 旧 sessionId 的 result 回包必须被忽略
    await act(async () => {
      fake.onmessage!({
        data: {
          type: 'result',
          mask: new Float32Array(100),
          maskW: 10,
          maskH: 10,
        },
      });
    });
    expect(result.current.status).not.toBe('compositing');
    expect(result.current.status).toBe('idle');
  });

  // MEDIUM 9:合成完成后关闭 ImageBitmap,避免泄漏
  it('closes the ImageBitmap after compositing completes', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      const p = result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
      await waitFor(() => expect(postedOf('init').length).toBeGreaterThanOrEqual(1));
      fake.onmessage!({
        data: {
          type: 'ready',
          ep: 'wasm',
          inputNames: ['in'],
          outputNames: ['out'],
        },
      });
      await waitFor(() => expect(postedOf('run').length).toBeGreaterThanOrEqual(1));
      fake.onmessage!({
        data: {
          type: 'result',
          mask: new Float32Array(100),
          maskW: 10,
          maskH: 10,
        },
      });
      await p;
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(lastBitmap.close).toHaveBeenCalled();
  });

  // MEDIUM 10:createImageBitmap 期间的重入被守卫,不会并发第二次 init
  it('guards against reentry during createImageBitmap', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      // 第一次 process:进入 await createImageBitmap 前已置 inFlight
      result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
      // 立即第二次(首次仍在 await bitmap)→ 必须被守卫丢弃
      result.current.process(makeFile('b.jpg'), 'balanced', defaultOpts);
      await waitFor(() => expect(postedOf('init').length).toBe(1));
    });
    expect(postedOf('init').length).toBe(1);
  });
});
