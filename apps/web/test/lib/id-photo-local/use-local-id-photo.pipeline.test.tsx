import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  idPhotoCropFromLayout,
  idPhotoPresetSpecs,
  type IdPhotoCrop,
} from '@utils-plane/validators';

/**
 * 本地证件照管线的内存上限端到端用例。
 *
 * 与 use-local-id-photo.test.tsx 不同,这里不 mock 分割与合成:真实的
 * segmentToCutout + compositeIdPhoto 跑在画布桩上,记录管线中出现过的每一块
 * 画布与每一次 getImageData 的尺寸。只替换 onnxruntime-web(推理)与
 * detectFaces(YuNet 推理本身另有用例覆盖),人脸按传入位图的尺寸生成。
 */

const { tensors, detectFacesMock, compositeSpy, actualComposite } = vi.hoisted(
  () => ({
    tensors: [] as Array<{ dims: number[] }>,
    detectFacesMock: vi.fn(),
    compositeSpy: vi.fn(),
    actualComposite: {} as { impl?: (...args: unknown[]) => unknown },
  })
);

vi.mock('onnxruntime-web', () => ({
  env: { wasm: { wasmPaths: '' } },
  InferenceSession: {
    create: async () => ({
      inputNames: ['input'],
      outputNames: ['output'],
      run: async (feeds: Record<string, { dims: number[] }>) => {
        const dims = feeds.input!.dims;
        return {
          output: { data: new Float32Array(dims[2]! * dims[3]!).fill(1) },
        };
      },
    }),
  },
  Tensor: class {
    constructor(
      public type: string,
      public data: Float32Array,
      public dims: number[]
    ) {
      tensors.push(this);
    }
  },
}));

vi.mock('@/lib/id-photo-local/face-detection', () => ({
  detectFaces: (...args: unknown[]) => detectFacesMock(...args),
}));

vi.mock('@/lib/id-photo-local/composite', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/lib/id-photo-local/composite')>();
  actualComposite.impl = actual.compositeIdPhoto as unknown as (
    ...args: unknown[]
  ) => unknown;
  return {
    ...actual,
    compositeIdPhoto: (...args: unknown[]) => compositeSpy(...args),
  };
});

import { fitWithinLongEdge } from '@/lib/id-photo-local/segmentation';
import {
  ID_PHOTO_LOCAL_MAX_SOURCE_EDGE,
  useLocalIdPhoto,
} from '@/lib/id-photo-local/use-local-id-photo';

interface FakeBitmap {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
}

let canvasSizes: Array<{ width: number; height: number }> = [];
let imageDataSizes: Array<{ width: number; height: number }> = [];
let bitmaps: FakeBitmap[] = [];
let decodeCalls = 0;

class FakeCtx {
  fillStyle = '';
  globalCompositeOperation = 'source-over';
  imageSmoothingQuality = 'low';
  drawImage(): void {}
  fillRect(): void {}
  putImageData(): void {}
  translate(): void {}
  rotate(): void {}
  createImageData(width: number, height: number) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }
  getImageData(_x: number, _y: number, width: number, height: number) {
    imageDataSizes.push({ width, height });
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128;
      data[i + 1] = 128;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
    return { width, height, data };
  }
}

class FakeCanvas {
  private ctx = new FakeCtx();
  constructor(
    public width: number,
    public height: number
  ) {
    canvasSizes.push({ width, height });
  }
  getContext(): FakeCtx {
    return this.ctx;
  }
  convertToBlob(): Promise<Blob> {
    return Promise.resolve(new Blob(['x'], { type: 'image/png' }));
  }
}

function stubPlatform(sourceWidth: number, sourceHeight: number) {
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    value: FakeCanvas,
    configurable: true,
    writable: true,
  });
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
  Object.defineProperty(globalThis, 'createImageBitmap', {
    value: vi.fn(async (source: unknown) => {
      let bitmap: FakeBitmap;
      if (source instanceof Blob) {
        decodeCalls += 1;
        bitmap = { width: sourceWidth, height: sourceHeight, close: vi.fn() };
      } else {
        const canvas = source as { width: number; height: number };
        bitmap = { width: canvas.width, height: canvas.height, close: vi.fn() };
      }
      bitmaps.push(bitmap);
      return bitmap;
    }),
    configurable: true,
    writable: true,
  });
}

/** 按传入位图的坐标系放一张居中偏上的正脸。 */
function faceFor(bitmap: { width: number; height: number }) {
  const size = bitmap.width * 0.3;
  const x = (bitmap.width - size) / 2;
  const y = bitmap.height * 0.25;
  const cy = y + size * 0.45;
  return {
    box: { x, y, width: size, height: size },
    landmarks: [
      [x + size * 0.3, cy],
      [x + size * 0.7, cy],
      [x + size * 0.5, cy + size * 0.15],
      [x + size * 0.35, cy + size * 0.3],
      [x + size * 0.65, cy + size * 0.3],
    ] as Array<[number, number]>,
    score: 0.95,
  };
}

const opts = {
  preset: 'two_inch' as const,
  backgroundColor: '#ffffff',
  outputType: 'image/png' as const,
  autoFrame: true,
};
const spec = idPhotoPresetSpecs[opts.preset];
const aspect = spec.widthPx / spec.heightPx;

async function runPipeline(width: number, height: number) {
  stubPlatform(width, height);
  const { result } = renderHook(() => useLocalIdPhoto());
  await act(async () => {
    await result.current.process(
      new File(['img'], 'big.jpg', { type: 'image/jpeg' }),
      'balanced',
      opts
    );
  });
  return result;
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'http://localhost:9000';
  canvasSizes = [];
  imageDataSizes = [];
  bitmaps = [];
  decodeCalls = 0;
  tensors.length = 0;
  detectFacesMock.mockReset();
  detectFacesMock.mockImplementation(async (bitmap: FakeBitmap) => [
    faceFor(bitmap),
  ]);
  compositeSpy.mockReset();
  compositeSpy.mockImplementation((...args: unknown[]) =>
    actualComposite.impl!(...args)
  );
  delete (navigator as unknown as { gpu?: unknown }).gpu;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
});

describe('local ID photo pipeline memory cap', () => {
  it('keeps every canvas and getImageData within a 2048 long edge for a 4000×6000 source', async () => {
    const result = await runPipeline(4000, 6000);

    expect(result.current.status).toBe('done');
    expect(canvasSizes.length).toBeGreaterThan(0);
    for (const size of [...canvasSizes, ...imageDataSizes]) {
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(
        ID_PHOTO_LOCAL_MAX_SOURCE_EDGE
      );
    }
    // 自动构图读的 cutout 像素就是缩放后的整幅尺寸。
    expect(imageDataSizes).toContainEqual({ width: 1365, height: 2048 });
    // 原图只解码一次。
    expect(decodeCalls).toBe(1);
    // 解码出的全分辨率位图与管线持有的每一张位图都已释放。
    for (const bitmap of bitmaps) {
      expect(bitmap.close).toHaveBeenCalled();
    }
  });

  it('runs face detection, layout and background estimation on the same downscaled source', async () => {
    await runPipeline(4000, 6000);

    const detected = detectFacesMock.mock.calls[0]![0] as FakeBitmap;
    expect(detected).toMatchObject({ width: 1365, height: 2048 });
    // 合成拿到的源图与人脸检测是同一张缩放后的位图(底色估计不再解码原图)。
    expect(compositeSpy.mock.calls[0]![7]).toBe(detected);
    expect(compositeSpy.mock.calls[0]![0]).toMatchObject({
      width: 1365,
      height: 2048,
    });
  });

  it('matches the crop the page derives from the full-size natural dimensions', async () => {
    const result = await runPipeline(4000, 6000);

    // 页面用 <img> 的 naturalWidth/Height(全尺寸)回填裁剪框,hook 用缩放后的
    // 尺寸算 crop。两者宽高比相同,归一化结果只差取整误差(不超过缩放后的 1 像素)。
    const layout = result.current.autoLayout;
    expect(layout).not.toBeNull();
    const hookCrop = compositeSpy.mock.calls[0]![5] as IdPhotoCrop;
    const pageCrop = idPhotoCropFromLayout(
      layout!,
      { width: 4000, height: 6000 },
      aspect
    );
    const onePixel = 1 / ID_PHOTO_LOCAL_MAX_SOURCE_EDGE;
    expect(Math.abs(hookCrop.x - pageCrop.x)).toBeLessThanOrEqual(onePixel);
    expect(Math.abs(hookCrop.y - pageCrop.y)).toBeLessThanOrEqual(onePixel);
    expect(hookCrop.scale).toBe(pageCrop.scale);
  });

  it('does not upscale a 1000×1500 source', async () => {
    const result = await runPipeline(1000, 1500);

    expect(result.current.status).toBe('done');
    expect(decodeCalls).toBe(1);
    // 没有缩放画布;最大的画布就是原尺寸的 cutout。
    const largest = Math.max(
      ...canvasSizes.map(size => Math.max(size.width, size.height))
    );
    expect(largest).toBe(1500);
    expect(canvasSizes).toContainEqual({ width: 1000, height: 1500 });
    expect(detectFacesMock.mock.calls[0]![0]).toMatchObject({
      width: 1000,
      height: 1500,
    });
  });
});

describe('page vs hook crop consistency', () => {
  it('stays within one downscaled pixel across source shapes, presets and layouts', () => {
    const onePixel = 1 / ID_PHOTO_LOCAL_MAX_SOURCE_EDGE;
    const sources = [
      [4000, 6000],
      [6000, 4000],
      [3024, 4032],
      [4032, 3024],
      [5000, 5000],
      [2049, 3000],
      [8000, 1000],
      [1000, 1500],
    ] as const;
    for (const [width, height] of sources) {
      const scaled = fitWithinLongEdge(
        width,
        height,
        ID_PHOTO_LOCAL_MAX_SOURCE_EDGE
      );
      for (const preset of Object.values(idPhotoPresetSpecs)) {
        const presetAspect = preset.widthPx / preset.heightPx;
        for (const zoom of [100, 128, 145]) {
          for (const offset of [-20, 0, 13]) {
            const layout = {
              zoom,
              offsetX: offset,
              offsetY: -offset,
              rotation: 0,
              faceRatio: 0.35,
              faceTopMargin: 0.1,
            };
            const page = idPhotoCropFromLayout(
              layout,
              { width, height },
              presetAspect
            );
            const hook = idPhotoCropFromLayout(layout, scaled, presetAspect);
            expect(Math.abs(hook.x - page.x)).toBeLessThanOrEqual(onePixel);
            expect(Math.abs(hook.y - page.y)).toBeLessThanOrEqual(onePixel);
            expect(hook.scale).toBe(page.scale);
          }
        }
      }
    }
  });
});
