import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocalIdPhoto } from '../use-local-id-photo';

// 假 Worker:记录 postMessage,手动触发 onmessage 回包
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  posted: unknown[] = [];
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {}
}

let fake: FakeWorker;

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
  Object.defineProperty(globalThis, 'createImageBitmap', {
    value: vi.fn(async () => ({ width: 10, height: 10 })),
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

function findPosted(type: string): unknown | undefined {
  return fake.posted.find(m => (m as { type: string }).type === type);
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
      const p = result.current.process(
        new File(['img'], 'a.jpg', { type: 'image/jpeg' }),
        'balanced',
        {
          preset: 'one_inch',
          backgroundColor: '#438edb',
          outputType: 'image/jpeg',
        },
      );
      // 等 init post
      await waitFor(() =>
        expect(findPosted('init')).not.toBeUndefined(),
      );
      // worker 回 ready(webgpu=false → wasm)
      fake.onmessage!({
        data: {
          type: 'ready',
          ep: 'wasm',
          inputNames: ['input'],
          outputNames: ['out'],
        },
      });
      await waitFor(() => expect(findPosted('run')).not.toBeUndefined());
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
      result.current.process(
        new File(['img'], 'a.jpg'),
        'high',
        {
          preset: 'one_inch',
          backgroundColor: '#438edb',
          outputType: 'image/jpeg',
        },
      );
      await waitFor(() =>
        expect(findPosted('init')).not.toBeUndefined(),
      );
    });
    // ep=wasm(初始 null 视为不可用 webgpu)时,即便请求 high,实际 init 的是 balanced 模型 URL
    const init = findPosted('init') as { modelUrl: string } | undefined;
    expect(init?.modelUrl).toContain('rmbg-1.4');
    // 避免未 await 的 process promise 产生 lingering rejection 噪声
    expect(result.current.error).toBeNull();
  });
});
