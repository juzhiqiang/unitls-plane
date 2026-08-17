import { describe, expect, it, vi, beforeEach } from 'vitest';

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

  it('postprocess clamps mask values and resizes to dst size', async () => {
    const { postprocess } = await import('../portrait-segmenter.worker');
    // rawData 超出 [0,1] → clamp;同尺寸 2x2 → 1:1 拷贝验证数据通路。
    // 注意:postprocess 经 8-bit ImageData 往返(a*255 存为 Uint8ClampedArray),
    // 故 0.5 → 127.5 → 128 → 0.50196,精度上限约 1/255,与 composite.ts 的 8-bit alpha 一致。
    const rawData = new Float32Array([2.0, -1.0, 0.5, 1.5]);
    const alpha = postprocess(rawData, 2, 2, 2, 2);
    expect(alpha).toBeInstanceOf(Float32Array);
    expect(alpha.length).toBe(4);
    expect(alpha[0]!).toBeCloseTo(1.0, 5); // clamp(2.0) → 1
    expect(alpha[1]!).toBeCloseTo(0.0, 5); // clamp(-1.0) → 0
    expect(alpha[2]!).toBeCloseTo(0.5, 2); // 8-bit 往返,2 位小数足够
    expect(alpha[3]!).toBeCloseTo(1.0, 5); // clamp(1.5) → 1
  });

  it('detectEp returns wasm when no gpu adapter', async () => {
    const { detectEp } = await import('../portrait-segmenter.worker');
    expect(await detectEp()).toBe('wasm');
  });
});
