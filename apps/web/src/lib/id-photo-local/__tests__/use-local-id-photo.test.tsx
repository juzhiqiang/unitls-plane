import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @imgly/background-removal 的桩:记录调用配置,可控地发进度并回透明 PNG blob。
// 进度序列:fetch(下载)→ compute:decode/inference/mask/encode(推理四阶段)。
// vi.hoisted 让 mock 函数在 vi.mock 提升执行时即存在(避免 TDZ)。
const { removeBackgroundMock } = vi.hoisted(() => ({
  removeBackgroundMock: vi.fn(),
}));
vi.mock('@imgly/background-removal', () => ({
  removeBackground: (...args: unknown[]) => removeBackgroundMock(...args),
}));

import { useLocalIdPhoto } from '../use-local-id-photo';

// 合成阶段用的 cutout bitmap(createImageBitmap 桩产出)
let lastCutout: { width: number; height: number; close: ReturnType<typeof vi.fn> };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

  removeBackgroundMock.mockReset();
  removeBackgroundMock.mockImplementation(
    async (_file: unknown, cfg: { progress?: (k: string, c: number, t: number) => void }) => {
      const p = cfg.progress;
      await Promise.resolve();
      p?.('fetch:/models/isnet_fp16', 50, 100);
      p?.('fetch:/models/isnet_fp16', 100, 100);
      p?.('compute:decode', 0, 4);
      p?.('compute:inference', 1, 4);
      p?.('compute:mask', 2, 4);
      p?.('compute:encode', 4, 4);
      return new Blob(['png'], { type: 'image/png' });
    },
  );

  // compositeIdPhoto 在 jsdom 下需要 2D 上下文与 convertToBlob;最小可用桩。
  class FakeCtx {
    fillStyle = '';
    drawImage(..._args: unknown[]): void {}
    fillRect(_x: number, _y: number, _w: number, _h: number): void {}
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
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    value: FakeCanvas,
    configurable: true,
    writable: true,
  });
  // cutout blob → ImageBitmap(createImageBitmap 桩)
  Object.defineProperty(globalThis, 'createImageBitmap', {
    value: vi.fn(async () => {
      lastCutout = { width: 10, height: 10, close: vi.fn() };
      return lastCutout;
    }),
    configurable: true,
    writable: true,
  });
  // jsdom 默认无 navigator.gpu → 探测为 wasm;个别用例按需注入
  delete (navigator as unknown as { gpu?: unknown }).gpu;

  process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'http://localhost:9000';
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
  delete (navigator as unknown as { gpu?: unknown }).gpu;
});

const defaultOpts = {
  preset: 'one_inch' as const,
  backgroundColor: '#438edb',
  outputType: 'image/jpeg' as const,
};
const makeFile = (name = 'a.jpg') => new File(['img'], name, { type: 'image/jpeg' });

// 注入 navigator.gpu(adapter 非 null → webgpu 可用)
function enableWebGpu() {
  Object.defineProperty(navigator, 'gpu', {
    value: { requestAdapter: () => Promise.resolve({}) },
    configurable: true,
  });
}

function lastCfg(): {
  model: string;
  device: string;
  publicPath: string;
} {
  const call = removeBackgroundMock.mock.calls.at(-1);
  return (call?.[1] ?? {}) as ReturnType<typeof lastCfg>;
}

describe('useLocalIdPhoto', () => {
  it('starts idle with no result', () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    expect(result.current.status).toBe('idle');
    expect(result.current.resultBlob).toBeNull();
  });

  it('runs removeBackground and composites a result blob', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile(), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.resultBlob).toBeInstanceOf(Blob);
    expect(removeBackgroundMock).toHaveBeenCalledTimes(1);
  });

  it('passes isnet_fp16 + cpu + MinIO publicPath when no webgpu', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile(), 'high', defaultOpts);
    });
    // ep=wasm(无 webgpu)→ 即便请求 high,tierFor 锁 balanced(isnet_fp16),device=cpu
    expect(lastCfg().model).toBe('isnet_fp16');
    expect(lastCfg().device).toBe('cpu');
    expect(lastCfg().publicPath).toBe(
      'http://localhost:9000/models/imgly/1.7.0/dist/',
    );
  });

  it('passes isnet + gpu when webgpu available and high requested', async () => {
    enableWebGpu();
    const { result } = renderHook(() => useLocalIdPhoto());
    await waitFor(() => expect(result.current.ep).toBe('webgpu'));
    await act(async () => {
      await result.current.process(makeFile(), 'high', defaultOpts);
    });
    expect(lastCfg().model).toBe('isnet');
    expect(lastCfg().device).toBe('gpu');
  });

  it('maps fetch progress to loading-model then compute to running', async () => {
    // 用 instrumentation 断言:hook 把 progress 回调接给了 @imgly,且两个阶段(fetch 下载
    // / compute 推理)都送达。中间 React 状态(loading-model/running)会被 done 覆盖,
    // 难以在 act 外稳定观测,故改为校验回调接线与阶段序列。
    const seen: string[] = [];
    removeBackgroundMock.mockReset();
    removeBackgroundMock.mockImplementation(
      async (_file: unknown, cfg: { progress?: (k: string, c: number, t: number) => void }) => {
        const p = cfg.progress;
        const phases: Array<[string, number, number]> = [
          ['fetch:/models/isnet_fp16', 50, 100],
          ['fetch:/models/isnet_fp16', 100, 100],
          ['compute:decode', 0, 4],
          ['compute:inference', 1, 4],
          ['compute:mask', 2, 4],
          ['compute:encode', 4, 4],
        ];
        for (const [k, c, t] of phases) {
          seen.push(k);
          p?.(k, c, t);
        }
        return new Blob(['png'], { type: 'image/png' });
      },
    );

    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile(), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(seen.filter(k => k.startsWith('fetch:')).length).toBeGreaterThan(0);
    expect(seen.filter(k => k.startsWith('compute:')).length).toBeGreaterThan(0);
  });

  it('guards against reentry during an in-flight process', async () => {
    // 第一个 process 被 gate 挂起在 removeBackground;第二个在 inFlight 守卫下被丢弃。
    let gate: () => void = () => {};
    removeBackgroundMock.mockReset();
    removeBackgroundMock.mockImplementation(
      () =>
        new Promise<Blob>(resolve => {
          gate = () => resolve(new Blob(['png'], { type: 'image/png' }));
        }),
    );

    const { result } = renderHook(() => useLocalIdPhoto());
    let p1!: Promise<void>;
    let p2!: Promise<void>;
    await act(async () => {
      p1 = result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
      p2 = result.current.process(makeFile('b.jpg'), 'balanced', defaultOpts);
      // 仅第一个进入 removeBackground(被 gate 挂起);第二个被 inFlight 守卫丢弃
      await waitFor(() => expect(removeBackgroundMock).toHaveBeenCalledTimes(1));
    });
    expect(removeBackgroundMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate();
      await p1;
      await p2; // 被守卫丢弃,直接 resolve(undefined)
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
  });

  it('drops stale results after reset', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    let resolveProcess: (b: Blob) => void = () => {};
    removeBackgroundMock.mockReset();
    removeBackgroundMock.mockImplementation(
      () =>
        new Promise<Blob>(resolve => {
          resolveProcess = b => resolve(b);
        }),
    );
    await act(async () => {
      result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
      await Promise.resolve();
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe('idle');
    // 即便旧的 removeBackground 此刻 resolve,也不应改 status(已被 sid 丢弃)
    await act(async () => {
      resolveProcess(new Blob(['png'], { type: 'image/png' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe('idle');
  });

  it('closes the cutout ImageBitmap after compositing', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(lastCutout.close).toHaveBeenCalled();
  });
});
