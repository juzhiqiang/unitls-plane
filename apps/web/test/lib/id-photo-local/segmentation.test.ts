import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * onnxruntime-web 的桩:记录 create 配置与 run 的输入张量。
 * 用 vi.hoisted 保证 mock 工厂提升执行时这些引用已存在。
 */
const { envStub, createMock, runMock, createdTensors } = vi.hoisted(() => {
  const createdTensors: Array<{
    type: string;
    data: Float32Array;
    dims: number[];
  }> = [];
  return {
    envStub: { wasm: { wasmPaths: '' } },
    createMock: vi.fn(),
    runMock: vi.fn(),
    createdTensors,
  };
});

vi.mock('onnxruntime-web', () => ({
  env: envStub,
  InferenceSession: {
    create: (...args: unknown[]) => createMock(...args),
  },
  Tensor: class {
    type: string;
    data: Float32Array;
    dims: number[];
    constructor(type: string, data: Float32Array, dims: number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
      createdTensors.push(this);
    }
  },
}));

import { ORT_VERSION, tierFor } from '@/lib/id-photo-local/model-registry';
import {
  StaleSegmentationError,
  fitWithinLongEdge,
  resetSegmentationCacheForTests,
  segmentToCutout,
} from '@/lib/id-photo-local/segmentation';

/** 源图 1000×500 经 modnetInputSize 得到 992×480(长边 512 上限内,32 对齐,不补边)。 */
const SRC_WIDTH = 1000;
const SRC_HEIGHT = 500;
const INPUT_WIDTH = 992;
const INPUT_HEIGHT = 480;

function rgbaAt(index: number): [number, number, number, number] {
  return [index % 256, (index * 7) % 256, (index * 13) % 256, 255];
}

function makeRgba(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const [r, g, b, a] = rgbaAt(i);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return data;
}

class FakeCtx {
  globalCompositeOperation = 'source-over';
  drawImage = vi.fn();
  putImageData = vi.fn();
  private rgba: Uint8ClampedArray;
  constructor(
    private width: number,
    private height: number
  ) {
    this.rgba = makeRgba(width, height);
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    return { data: this.rgba.slice(0, w * h * 4), width: w, height: h };
  }
  createImageData(w: number, h: number) {
    return {
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    };
  }
}

class FakeCanvas {
  ctx: FakeCtx;
  constructor(
    public width: number,
    public height: number
  ) {
    this.ctx = new FakeCtx(width, height);
    canvases.push(this);
  }
  getContext() {
    return this.ctx;
  }
}

let canvases: FakeCanvas[] = [];
let sourceBitmap: {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
};
let cutoutBitmap: {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
};
let createImageBitmapMock: ReturnType<typeof vi.fn>;

function makeSession() {
  return {
    inputNames: ['input'],
    outputNames: ['output'],
    run: runMock,
  };
}

function enableCanvasStubs() {
  canvases = [];
  sourceBitmap = {
    width: SRC_WIDTH,
    height: SRC_HEIGHT,
    close: vi.fn(),
  };
  cutoutBitmap = {
    width: SRC_WIDTH,
    height: SRC_HEIGHT,
    close: vi.fn(),
  };
  let bitmapCalls = 0;
  createImageBitmapMock = vi.fn(async () => {
    bitmapCalls += 1;
    return bitmapCalls === 1 ? sourceBitmap : cutoutBitmap;
  });

  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    value: FakeCanvas,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'createImageBitmap', {
    value: createImageBitmapMock,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  resetSegmentationCacheForTests();
  createdTensors.length = 0;
  createMock.mockReset();
  runMock.mockReset();
  envStub.wasm.wasmPaths = '';
  runMock.mockImplementation(async () => ({
    output: { data: new Float32Array(INPUT_WIDTH * INPUT_HEIGHT).fill(0.5) },
  }));
  createMock.mockImplementation(async () => makeSession());
  enableCanvasStubs();
  process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'http://localhost:9000';
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
});

const makeFile = () => new File(['img'], 'a.jpg', { type: 'image/jpeg' });

describe('segmentToCutout (本地 MODNet photographic)', () => {
  it('使用动态输入尺寸:长边 512 内、32 对齐、不补边', async () => {
    await segmentToCutout(makeFile(), 'balanced', 'wasm');

    expect(createImageBitmapMock).toHaveBeenCalledTimes(2);
    expect(canvases[0]?.width).toBe(INPUT_WIDTH);
    expect(canvases[0]?.height).toBe(INPUT_HEIGHT);
    expect(createdTensors[0]?.dims).toEqual([1, 3, INPUT_HEIGHT, INPUT_WIDTH]);
  });

  it('把 canvas 的 RGBA 按 stride=4 正确剥成 RGB,再归一化到 [-1,1]', async () => {
    await segmentToCutout(makeFile(), 'balanced', 'wasm');

    const tensor = createdTensors[0];
    expect(tensor?.type).toBe('float32');
    const plane = INPUT_WIDTH * INPUT_HEIGHT;

    // 像素 0
    const [r0, g0, b0] = rgbaAt(0);
    expect(tensor!.data[0]).toBeCloseTo((r0 / 255 - 0.5) / 0.5, 6);
    expect(tensor!.data[plane]).toBeCloseTo((g0 / 255 - 0.5) / 0.5, 6);
    expect(tensor!.data[2 * plane]).toBeCloseTo((b0 / 255 - 0.5) / 0.5, 6);

    // 像素 1:若误用 stride=3,这里会读到像素 0 的 alpha 或 G 通道。
    const [r1, g1, b1] = rgbaAt(1);
    expect(tensor!.data[1]).toBeCloseTo((r1 / 255 - 0.5) / 0.5, 6);
    expect(tensor!.data[plane + 1]).toBeCloseTo((g1 / 255 - 0.5) / 0.5, 6);
    expect(tensor!.data[2 * plane + 1]).toBeCloseTo((b1 / 255 - 0.5) / 0.5, 6);
  });

  it('把蒙版缩放回原图并用 destination-in 合成,返回原尺寸 cutout', async () => {
    const result = await segmentToCutout(makeFile(), 'balanced', 'wasm');

    // 蒙版画布(第 2 个 OffscreenCanvas)拿到 0..1 蒙版 → alpha 0..255
    const matteCanvas = canvases[1];
    const putData = matteCanvas?.ctx.putImageData.mock.calls.at(-1)?.[0] as {
      data: Uint8ClampedArray;
    };
    expect(putData.data[0]).toBe(255);
    expect(putData.data[1]).toBe(255);
    expect(putData.data[2]).toBe(255);
    expect(putData.data[3]).toBe(222); // 128 经共享 alpha 收敛(72/144/gamma 0.55)

    // 输出画布(第 3 个)按原图尺寸,先画原图再 destination-in 蒙版
    const outCanvas = canvases[2];
    expect(outCanvas?.width).toBe(SRC_WIDTH);
    expect(outCanvas?.height).toBe(SRC_HEIGHT);
    expect(outCanvas?.ctx.drawImage).toHaveBeenCalledTimes(2);
    expect(outCanvas?.ctx.globalCompositeOperation).toBe('source-over');

    expect(result.bitmap).toBe(cutoutBitmap);
    // 源图交还给调用方复用(底色估计/人脸检测),由调用方负责 close,
    // 分割阶段不能提前关掉它。
    expect(result.source).toBe(sourceBitmap);
    expect(sourceBitmap.close).not.toHaveBeenCalled();
  });

  it('只返回 cutout,不再附带已无消费者的底色估计', async () => {
    const result = await segmentToCutout(makeFile(), 'balanced', 'wasm');

    // 底色估计已移到 composite 阶段(见 composite.test.ts):分割阶段只需
    // bitmap,不再从原图重复计算一份没人读的 sourceBackground。
    expect(result.bitmap).toBe(cutoutBitmap);
    expect(result).not.toHaveProperty('sourceBackground');
  });

  it('把 ort wasm 路径指向自托管 MinIO,并按目标 URL 建 session', async () => {
    await segmentToCutout(makeFile(), 'balanced', 'wasm');

    expect(envStub.wasm.wasmPaths).toBe(
      `http://localhost:9000/models/ort/${ORT_VERSION}/`
    );
    expect(createMock).toHaveBeenCalledWith(
      'http://localhost:9000/models/modnet/modnet_photographic.onnx',
      { executionProviders: ['wasm'] }
    );
  });

  it('下载进度回调 0 → 1', async () => {
    const onDownloadProgress = vi.fn();
    await segmentToCutout(makeFile(), 'balanced', 'wasm', {
      onDownloadProgress,
    });
    expect(onDownloadProgress.mock.calls.map(call => call[0])).toEqual([0, 1]);
  });

  it('同后端下 high 复用 balanced 的 session,不同后端分别建 session', async () => {
    await segmentToCutout(makeFile(), 'balanced', 'wasm');
    await segmentToCutout(makeFile(), 'balanced', 'wasm');
    expect(createMock).toHaveBeenCalledTimes(1);

    // photographic 单档:high 与 balanced 指向同一 URL、复用同一 session。
    await segmentToCutout(makeFile(), 'high', 'wasm');
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(tierFor(true, 'high')).toBe('balanced');

    // 后端不同不能共用 session。
    await segmentToCutout(makeFile(), 'high', 'webgpu');
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls.at(-1)?.[0]).toBe(
      'http://localhost:9000/models/modnet/modnet_photographic.onnx'
    );
    expect(createMock.mock.calls.at(-1)?.[1]).toEqual({
      executionProviders: ['webgpu'],
    });
  });

  it('session 加载失败不缓存 rejected promise,下一次仍可重试', async () => {
    createMock.mockRejectedValueOnce(new Error('network down'));

    await expect(
      segmentToCutout(makeFile(), 'balanced', 'wasm')
    ).rejects.toThrow('network down');
    expect(createMock).toHaveBeenCalledTimes(1);

    await expect(
      segmentToCutout(makeFile(), 'balanced', 'wasm')
    ).resolves.toMatchObject({ bitmap: cutoutBitmap });
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('过期会话在加载模型前直接抛 StaleSegmentationError', async () => {
    await expect(
      segmentToCutout(makeFile(), 'balanced', 'wasm', {
        isStale: () => true,
      })
    ).rejects.toBeInstanceOf(StaleSegmentationError);
    expect(createMock).not.toHaveBeenCalled();
    expect(createImageBitmapMock).not.toHaveBeenCalled();
  });

  it('推理完成后发现会话过期,丢弃结果', async () => {
    let calls = 0;
    // 加载前 false,加载后 false,推理后 true
    const isStale = () => {
      calls += 1;
      return calls > 2;
    };
    await expect(
      segmentToCutout(makeFile(), 'balanced', 'wasm', { isStale })
    ).rejects.toBeInstanceOf(StaleSegmentationError);
    // 结果被丢弃时源图没有交出去,必须在分割内部释放。
    expect(sourceBitmap.close).toHaveBeenCalled();
  });

  it('推理失败时释放已解码的源图', async () => {
    runMock.mockRejectedValueOnce(new Error('ort run failed'));

    await expect(
      segmentToCutout(makeFile(), 'balanced', 'wasm')
    ).rejects.toThrow('ort run failed');
    expect(sourceBitmap.close).toHaveBeenCalled();
  });

  it('high 档在任何后端都落到 balanced(photographic 单档)', async () => {
    await segmentToCutout(makeFile(), 'high', 'wasm');
    // 单档模型:无论请求 high 还是 balanced,都是同一份 photographic 权重。
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:9000/models/modnet/modnet_photographic.onnx'
    );
    expect(createMock.mock.calls[0]?.[1]).toEqual({
      executionProviders: ['wasm'],
    });
    expect(tierFor(false, 'high')).toBe('balanced');
    expect(tierFor(true, 'high')).toBe('balanced');
  });
});

describe('fitWithinLongEdge', () => {
  it('scales the long edge down to the limit and keeps the aspect ratio', () => {
    expect(fitWithinLongEdge(4000, 6000, 2048)).toEqual({
      width: 1365,
      height: 2048,
    });
    expect(fitWithinLongEdge(6000, 4000, 2048)).toEqual({
      width: 2048,
      height: 1365,
    });
  });

  it('never upscales an image already within the limit', () => {
    expect(fitWithinLongEdge(1000, 1500, 2048)).toEqual({
      width: 1000,
      height: 1500,
    });
    expect(fitWithinLongEdge(2048, 1000, 2048)).toEqual({
      width: 2048,
      height: 1000,
    });
  });

  it('keeps at least one pixel on the short edge', () => {
    expect(fitWithinLongEdge(10000, 3, 2048)).toEqual({
      width: 2048,
      height: 1,
    });
  });
});

describe('segmentToCutout source long-edge cap', () => {
  /**
   * createImageBitmap 桩:传入 Blob 时返回指定尺寸的「解码结果」;
   * 传入画布时返回与画布同尺寸的位图,用来跟踪缩放后的源图与 cutout。
   */
  function stubDecode(width: number, height: number) {
    const decoded = { width, height, close: vi.fn() };
    const fromCanvas: Array<{
      width: number;
      height: number;
      close: ReturnType<typeof vi.fn>;
    }> = [];
    const mock = vi.fn(async (source: unknown) => {
      if (source instanceof Blob) return decoded;
      const canvas = source as { width: number; height: number };
      const bitmap = {
        width: canvas.width,
        height: canvas.height,
        close: vi.fn(),
      };
      fromCanvas.push(bitmap);
      return bitmap;
    });
    Object.defineProperty(globalThis, 'createImageBitmap', {
      value: mock,
      configurable: true,
      writable: true,
    });
    // 蒙版尺寸跟随实际输入张量。
    runMock.mockImplementation(
      async (feeds: Record<string, { dims: number[] }>) => {
        const dims = feeds.input!.dims;
        return {
          output: { data: new Float32Array(dims[2]! * dims[3]!).fill(0.5) },
        };
      }
    );
    return { decoded, fromCanvas, mock };
  }

  it('downscales a 4000×6000 source to a 2048 long edge before any other work', async () => {
    const { decoded, fromCanvas, mock } = stubDecode(4000, 6000);

    const result = await segmentToCutout(makeFile(), 'balanced', 'wasm', {
      maxSourceEdge: 2048,
    });

    // 只解码一次;全分辨率位图缩放后立即释放。
    expect(mock.mock.calls.filter(([src]) => src instanceof Blob)).toHaveLength(
      1
    );
    expect(decoded.close).toHaveBeenCalled();
    // 所有画布(缩放、模型输入、蒙版、cutout)都不超过 2048 长边。
    for (const canvas of canvases) {
      expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(2048);
    }
    expect(canvases[0]).toMatchObject({ width: 1365, height: 2048 });
    expect(canvases.at(-1)).toMatchObject({ width: 1365, height: 2048 });
    // 交给调用方的源图与 cutout 同尺寸,且尚未释放。
    expect(result.source).toBe(fromCanvas[0]);
    expect(result.source).toMatchObject({ width: 1365, height: 2048 });
    expect(result.source.close).not.toHaveBeenCalled();
    expect(result.bitmap).toMatchObject({ width: 1365, height: 2048 });
  });

  it('does not upscale or re-encode a source already within the cap', async () => {
    const { decoded, mock } = stubDecode(1000, 1500);

    const result = await segmentToCutout(makeFile(), 'balanced', 'wasm', {
      maxSourceEdge: 2048,
    });

    // 不需要缩放:没有额外的缩放画布,源图就是解码结果本身。
    expect(result.source).toBe(decoded);
    expect(decoded.close).not.toHaveBeenCalled();
    expect(canvases).toHaveLength(3);
    expect(canvases.at(-1)).toMatchObject({ width: 1000, height: 1500 });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('keeps the original size when no cap is requested', async () => {
    // 通用抠图(/image/cutout)保持原尺寸输出,不受证件照上限影响。
    stubDecode(4000, 6000);

    const result = await segmentToCutout(makeFile(), 'balanced', 'wasm');

    expect(canvases.at(-1)).toMatchObject({ width: 4000, height: 6000 });
    expect(result.source).toMatchObject({ width: 4000, height: 6000 });
  });
});
