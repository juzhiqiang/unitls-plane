import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 推理层已在 segmentation.test.ts 单独覆盖;这里只验证 hook 的编排
// (重入守卫、进度接线、过期丢弃、合成与资源释放)。
const { segmentMock } = vi.hoisted(() => ({ segmentMock: vi.fn() }));

vi.mock('@/lib/id-photo-local/segmentation', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/lib/id-photo-local/segmentation')>();
  return {
    ...actual,
    segmentToCutout: (...args: unknown[]) => segmentMock(...args),
  };
});

import { useLocalIdPhoto } from '@/lib/id-photo-local/use-local-id-photo';

let lastCutout: {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'http://localhost:9000';

  lastCutout = { width: 10, height: 10, close: vi.fn() };
  segmentMock.mockReset();
  segmentMock.mockImplementation(async () => ({
    bitmap: lastCutout,
    sourceBackground: { r: 240, g: 240, b: 240 },
  }));

  // compositeIdPhoto 在 jsdom 下需要 2D 上下文与 convertToBlob;最小可用桩。
  class FakeCtx {
    fillStyle = '';
    drawImage(..._args: unknown[]): void {}
    fillRect(_x: number, _y: number, _w: number, _h: number): void {}
    getImageData(
      _x: number,
      _y: number,
      width: number,
      height: number
    ): { data: Uint8ClampedArray } {
      return { data: new Uint8ClampedArray(width * height * 4).fill(255) };
    }
    putImageData(): void {}
    translate(): void {}
    rotate(): void {}
  }
  class FakeCanvas {
    ctx: FakeCtx;
    constructor(
      public width: number,
      public height: number
    ) {
      this.ctx = new FakeCtx();
    }
    getContext(): FakeCtx {
      return this.ctx;
    }
    convertToBlob(): Promise<Blob> {
      return Promise.resolve(new Blob(['x']));
    }
  }
  Object.defineProperty(globalThis, 'ImageData', {
    value: class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number
      ) {}
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    value: FakeCanvas,
    configurable: true,
    writable: true,
  });
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
const makeFile = (name = 'a.jpg') =>
  new File(['img'], name, { type: 'image/jpeg' });

// 注入 navigator.gpu(adapter 非 null → webgpu 可用)
function enableWebGpu() {
  Object.defineProperty(navigator, 'gpu', {
    value: { requestAdapter: () => Promise.resolve({}) },
    configurable: true,
  });
}

/** 最近一次 segmentToCutout 调用的 (file, tier, ep, options)。 */
function lastSegmentCall(): {
  file: File;
  tier: string;
  ep: string;
  options: {
    onDownloadProgress?: (ratio: number) => void;
    isStale?: () => boolean;
  };
} {
  const [file, tier, ep, options] = segmentMock.mock.calls.at(-1) ?? [];
  return { file, tier, ep, options };
}

describe('useLocalIdPhoto', () => {
  it('starts idle with no result', () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    expect(result.current.status).toBe('idle');
    expect(result.current.resultBlob).toBeNull();
  });

  it('runs segmentation and composites a result blob', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile(), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.resultBlob).toBeInstanceOf(Blob);
    expect(segmentMock).toHaveBeenCalledTimes(1);
    expect(lastSegmentCall().tier).toBe('balanced');
    expect(lastSegmentCall().ep).toBe('wasm');
  });

  it('uses webgpu when available and passes the requested tier', async () => {
    enableWebGpu();
    const { result } = renderHook(() => useLocalIdPhoto());
    await waitFor(() => expect(result.current.ep).toBe('webgpu'));
    await act(async () => {
      await result.current.process(makeFile(), 'high', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(lastSegmentCall().tier).toBe('high');
    expect(lastSegmentCall().ep).toBe('webgpu');
  });

  it('maps download progress into progress state', async () => {
    // 中间 React 状态会被 done 覆盖,难以在 act 外稳定观测,故校验回调接线:
    // hook 必须把 onDownloadProgress 接给 segmentation,并消费 0..1 比例。
    segmentMock.mockImplementation(
      async (
        _file: File,
        _tier: string,
        _ep: string,
        options: { onDownloadProgress?: (ratio: number) => void }
      ) => {
        options.onDownloadProgress?.(0.5);
        return {
          bitmap: lastCutout,
          sourceBackground: { r: 240, g: 240, b: 240 },
        };
      }
    );

    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile(), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.progress).toBe(0.5);
    expect(typeof lastSegmentCall().options.onDownloadProgress).toBe(
      'function'
    );
  });

  it('guards against reentry during an in-flight process', async () => {
    let gate: () => void = () => {};
    segmentMock.mockImplementation(
      () =>
        new Promise(resolve => {
          gate = () =>
            resolve({
              bitmap: lastCutout,
              sourceBackground: { r: 240, g: 240, b: 240 },
            });
        })
    );

    const { result } = renderHook(() => useLocalIdPhoto());
    let p1!: Promise<void>;
    let p2!: Promise<void>;
    await act(async () => {
      p1 = result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
      p2 = result.current.process(makeFile('b.jpg'), 'balanced', defaultOpts);
      await waitFor(() => expect(segmentMock).toHaveBeenCalledTimes(1));
    });
    expect(segmentMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate();
      await p1;
      await p2; // 被守卫丢弃,直接 resolve(undefined)
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
  });

  it('drops stale results after reset', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    let resolveProcess: () => void = () => {};
    segmentMock.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveProcess = () =>
            resolve({
              bitmap: lastCutout,
              sourceBackground: { r: 240, g: 240, b: 240 },
            });
        })
    );
    await act(async () => {
      result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
      await Promise.resolve();
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe('idle');
    // 即便旧的推理此刻 resolve,也不应改 status(已被 sid 丢弃)
    await act(async () => {
      resolveProcess();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe('idle');
  });

  it('surfaces segmentation failures as error state', async () => {
    segmentMock.mockRejectedValueOnce(new Error('ort backend failed'));
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('ort backend failed');
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
