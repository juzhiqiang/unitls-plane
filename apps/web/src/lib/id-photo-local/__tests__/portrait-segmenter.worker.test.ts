import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// mock onnxruntime-web/webgpu:捕获 create 的模型字节、返回假 session
const fakeOutputs = {
  out: { getData: async () => new Float32Array([0.1, 0.9, 0.9, 0.1]) },
};
const runMock = vi.fn().mockResolvedValue(fakeOutputs);
const createMock = vi.fn().mockResolvedValue({
  inputNames: ['input'],
  outputNames: ['out'],
  run: runMock,
});
vi.mock('onnxruntime-web/webgpu', () => ({
  InferenceSession: { create: createMock },
  Tensor: class {
    constructor(
      public type: string,
      public data: unknown,
      public dims: number[],
    ) {}
  },
  env: { wasm: { wasmPaths: '', numThreads: 1, simd: true, proxy: false } },
}));

// stub OffscreenCanvas + 2D context:putImageData 持久化、drawImage 从 FakeCanvas 1:1 拷贝,
// 使 postprocess 的 clamp 与同尺寸数据通路可在 jsdom 下验证。
class FakeCtx {
  imageData: Uint8ClampedArray;
  constructor(w: number, h: number) {
    this.imageData = new Uint8ClampedArray(w * h * 4);
  }
  drawImage(src?: unknown, ..._rest: unknown[]): void {
    const maybe = src as { ctx?: FakeCtx } | null;
    if (maybe?.ctx) {
      const srcData = maybe.ctx.imageData;
      const n = Math.min(srcData.length, this.imageData.length);
      this.imageData.set(srcData.subarray(0, n));
    }
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    return {
      data: this.imageData.subarray(0, w * h * 4),
      width: w,
      height: h,
    } as ImageData;
  }
  putImageData(d: { data: Uint8ClampedArray }, _dx?: number, _dy?: number): void {
    const n = Math.min(d.data.length, this.imageData.length);
    this.imageData.set(d.data.subarray(0, n));
  }
  createImageData(w: number, h: number) {
    return {
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    } as ImageData;
  }
}
class FakeCanvas {
  ctx: FakeCtx;
  constructor(public width: number, public height: number) {
    this.ctx = new FakeCtx(width, height);
  }
  getContext(_id?: string): FakeCtx {
    return this.ctx;
  }
  convertToBlob(): Promise<Blob> {
    return Promise.resolve(new Blob());
  }
}

beforeEach(() => {
  // stub navigator.gpu(无 adapter → detectEp 返回 wasm)
  Object.defineProperty(navigator, 'gpu', {
    value: { requestAdapter: async () => null },
    configurable: true,
  });
  // stub OffscreenCanvas
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    value: FakeCanvas,
    configurable: true,
  });
});

describe('portrait-segmenter.worker pure functions', () => {
  it('preprocess normalizes RGB into NCHW float32', async () => {
    const { preprocess } = await import('../portrait-segmenter.worker');
    const bitmap = { width: 8, height: 8 } as ImageBitmap;
    const { data, dims } = preprocess(bitmap, 8);
    expect(dims).toEqual([1, 3, 8, 8]);
    expect(data.length).toBe(3 * 8 * 8);
    // jsdom 下 ImageBitmap 是桩对象,drawImage 不写入像素,故归一化结果为 (0/255 - mean)/std;
    // 仅校验结构,数值校准以 docs/id-photo-models.md 实测为准(Task 2 后)。
    expect(data).toBeInstanceOf(Float32Array);
  });

  it('postprocess applies sigmoid then resizes to dst size', async () => {
    const { postprocess } = await import('../portrait-segmenter.worker');
    // postprocess 无条件对输入做 sigmoid(消除"注释掉的 sigmoid 隐患",HIGH 5):
    // 大正 logits → ~1,大负 logits → ~0,中值经 8-bit ImageData 往返(a*255 存为
    // Uint8ClampedArray 再 /255),精度上限约 1/255,与 composite.ts 的 8-bit alpha 一致。
    const rawData = new Float32Array([10.0, -10.0, 0.0, 0.5]);
    const alpha = postprocess(rawData, 2, 2, 2, 2);
    expect(alpha).toBeInstanceOf(Float32Array);
    expect(alpha.length).toBe(4);
    expect(alpha[0]!).toBeCloseTo(1.0, 5); // sigmoid(10) ≈ 0.99995 → 255 → 1
    expect(alpha[1]!).toBeCloseTo(0.0, 5); // sigmoid(-10) ≈ 0.000045 → 0 → 0
    expect(alpha[2]!).toBeCloseTo(0.5, 2); // sigmoid(0) = 0.5 → 127.5→128 → 0.50196
    expect(alpha[3]!).toBeCloseTo(0.62, 2); // sigmoid(0.5) ≈ 0.6225 → 159 → 0.6235
  });

  it('detectEp returns wasm when no gpu adapter', async () => {
    const { detectEp } = await import('../portrait-segmenter.worker');
    expect(await detectEp()).toBe('wasm');
  });
});

describe('fetchModelWithProgress', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function okResponse(bytes: Uint8Array) {
    let yielded = false;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (!yielded) {
              yielded = true;
              return { done: false, value: bytes };
            }
            return { done: true };
          },
        }),
      },
      headers: { get: () => String(bytes.length) },
    };
  }

  function failResponse(status = 500) {
    return {
      ok: false,
      status,
      body: null,
      headers: { get: () => null },
    };
  }

  it('returns bytes on first success without retry', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(new Uint8Array([1, 2, 3, 4])));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const onProgress = vi.fn();
    const { fetchModelWithProgress } = await import('../portrait-segmenter.worker');
    const result = await fetchModelWithProgress('http://x/m.onnx', onProgress);
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalled();
  });

  it('retries once after first failure then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failResponse(503))
      .mockResolvedValueOnce(okResponse(new Uint8Array([9, 8, 7])));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchModelWithProgress } = await import('../portrait-segmenter.worker');
    const result = await fetchModelWithProgress('http://x/m.onnx', () => {});
    expect(result).toEqual(new Uint8Array([9, 8, 7]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after second failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(failResponse(404));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchModelWithProgress } = await import('../portrait-segmenter.worker');
    await expect(
      fetchModelWithProgress('http://x/m.onnx', () => {}),
    ).rejects.toThrow('model fetch failed: 404');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
