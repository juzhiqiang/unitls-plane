import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decode as decodeJpeg } from 'jpeg-js';
import { resolveIdPhotoCropBox } from '@utils-plane/validators';

type Decontaminate = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  background: { r: number; g: number; b: number },
  options?: { alphaFloor?: number; spillStrength?: number }
) => Uint8ClampedArray;

const mocks = vi.hoisted(() => ({
  decontaminate: vi.fn<Decontaminate>(),
  // 由 mock 工厂在模块加载时填充真实实现，测试默认委托给它，
  // 这样「反预乘是否生效」能按真实算法断言，而不只是看调用次数。
  realDecontaminate: null as Decontaminate | null,
  estimate: vi.fn(),
  realEstimate: null as
    | ((rgb: Uint8ClampedArray, width: number, height: number) => unknown)
    | null,
  meanBrightness: vi.fn(),
  realMeanBrightness: null as
    | ((rgba: Uint8ClampedArray, width: number, height: number) => number)
    | null,
  writeDpi: vi.fn(async (blob: Blob, _dpi?: number) => blob),
  // jpeg-js 编码器：包装真实实现，既保留可解码的真实 JPEG，又能断言 quality。
  jpegEncode: vi.fn(),
  realJpegEncode: null as
    | ((
        img: { data: unknown; width: number; height: number },
        quality?: number
      ) => unknown)
    | null,
}));

vi.mock('jpeg-js', async importOriginal => {
  const actual = await importOriginal<typeof import('jpeg-js')>();
  mocks.realJpegEncode =
    actual.encode as unknown as typeof mocks.realJpegEncode;
  const mocked = {
    ...actual,
    encode: mocks.jpegEncode,
  };
  return mocked;
});

// composite.ts 只从 utils 取去污染与亮度均值；保留其余真实导出，按需委托。
vi.mock('@utils-plane/utils', async importOriginal => {
  const actual = await importOriginal<typeof import('@utils-plane/utils')>();
  mocks.realDecontaminate = actual.decontaminateIdPhotoForeground;
  mocks.realMeanBrightness = actual.computeForegroundMeanBrightness;
  return {
    ...actual,
    decontaminateIdPhotoForeground: mocks.decontaminate,
    computeForegroundMeanBrightness: mocks.meanBrightness,
  };
});
vi.mock('@utils-plane/validators', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@utils-plane/validators')>();
  mocks.realEstimate = actual.estimateSourceBackgroundColors as (
    rgb: Uint8ClampedArray,
    width: number,
    height: number
  ) => unknown;
  return {
    ...actual,
    estimateSourceBackgroundColors: mocks.estimate,
  };
});
vi.mock('@/lib/id-photo-local/dpi-metadata', () => ({
  writeDpi: mocks.writeDpi,
}));

const { compositeIdPhoto, hexToRgb } =
  await import('@/lib/id-photo-local/composite');

const PRESET_W = 295;
const PRESET_H = 413;

interface SofComponent {
  id: number;
  /** 低 4 位水平采样因子，高 4 位垂直采样因子；0x11 表示无下采样。 */
  sampling: number;
}

/**
 * 从 JPEG 字节里解析 SOF0（baseline，标记 0xFFC0）。
 *
 * canvas 的编码器/封装库不暴露采样参数，只能回到码流本身：SOF0 分量表的
 * 采样因子是唯一权威来源。4:4:4 要求三个分量都为 0x11。
 */
function parseSof0(bytes: Uint8Array): {
  width: number;
  height: number;
  components: SofComponent[];
} {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('not a JPEG');
  }
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos += 1;
      continue;
    }
    const marker = bytes[pos + 1]!;
    // 0xFF 填充字节
    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    // 无长度字段的独立标记
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    // 扫描开始/图像结束之后不会再有 SOF0
    if (marker === 0xda || marker === 0xd9) break;

    const length = (bytes[pos + 2]! << 8) | bytes[pos + 3]!;
    if (marker === 0xc0) {
      const height = (bytes[pos + 5]! << 8) | bytes[pos + 6]!;
      const width = (bytes[pos + 7]! << 8) | bytes[pos + 8]!;
      const count = bytes[pos + 9]!;
      const components: SofComponent[] = [];
      for (let i = 0; i < count; i += 1) {
        const base = pos + 10 + i * 3;
        components.push({ id: bytes[base]!, sampling: bytes[base + 1]! });
      }
      return { width, height, components };
    }
    pos += 2 + length;
  }
  throw new Error('SOF0 segment not found');
}

interface FakeContext {
  fillStyle: string;
  drawImage: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  rotate: ReturnType<typeof vi.fn>;
}

interface StubPixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface StubOptions {
  /** getImageData 返回的像素；默认浅灰不透明，保证底色估计有值。 */
  pixel?: StubPixel;
  /** 按像素定制颜色；优先级高于 pixel。index = y * width + x。 */
  pixelAt?: (x: number, y: number, index: number) => StubPixel;
  /**
   * 按画布创建顺序定制像素（0 = 前景裁剪画布，1 = 原图取样画布）。
   * 用于验证底色确实来自原图而不是已裁好的 cutout。
   */
  canvasPixelAt?: (
    canvasIndex: number,
    x: number,
    y: number,
    index: number
  ) => StubPixel;
}

/** jsdom 没有 OffscreenCanvas / ImageData，用最小桩替换并记录调用。 */
function stubOffscreenCanvas(options: StubOptions = {}) {
  const pixel = options.pixel ?? { r: 240, g: 240, b: 240, a: 255 };
  const pixelAt = options.pixelAt;
  const canvasPixelAt = options.canvasPixelAt;
  const contexts: FakeContext[] = [];
  const blobs: { opts: unknown; canvas: unknown }[] = [];
  let created = 0;

  // @ts-expect-error test stub
  globalThis.ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };

  class FakeCanvas {
    private ctx: FakeContext;
    constructor(
      public width: number,
      public height: number
    ) {
      const canvasIndex = created;
      created += 1;
      this.ctx = {
        fillStyle: '',
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < w * h; i += 1) {
            const px = canvasPixelAt
              ? canvasPixelAt(canvasIndex, i % w, Math.floor(i / w), i)
              : pixelAt
                ? pixelAt(i % w, Math.floor(i / w), i)
                : pixel;
            data[i * 4] = px.r;
            data[i * 4 + 1] = px.g;
            data[i * 4 + 2] = px.b;
            data[i * 4 + 3] = px.a;
          }
          return { data, width: w, height: h };
        }),
        putImageData: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
      };
      contexts.push(this.ctx);
    }
    getContext(): FakeContext {
      return this.ctx;
    }
    convertToBlob(opts: { type: string; quality?: number }): Promise<Blob> {
      blobs.push({ opts, canvas: this });
      return Promise.resolve(new Blob(['x'], { type: opts.type }));
    }
  }

  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  return { contexts, blobs };
}

function fakeCutout(width: number, height: number): ImageBitmap {
  return { width, height, close: () => {} } as unknown as ImageBitmap;
}

function outputCalls(ctx: FakeContext, arity: number) {
  return ctx.drawImage.mock.calls.filter(call => call.length === arity);
}

beforeEach(() => {
  mocks.decontaminate.mockReset();
  mocks.decontaminate.mockImplementation(
    (rgba, width, height, background, options) => {
      // 真实实现由 mock 工厂注入；没有时原样返回（仅断言调用参数的用例不关心结果）。
      return mocks.realDecontaminate
        ? mocks.realDecontaminate(rgba, width, height, background, options)
        : rgba;
    }
  );
  mocks.estimate.mockReset();
  mocks.estimate.mockImplementation(
    (rgb: Uint8ClampedArray, width: number, height: number) =>
      mocks.realEstimate!(rgb, width, height)
  );
  mocks.meanBrightness.mockReset();
  mocks.meanBrightness.mockImplementation(
    (rgba: Uint8ClampedArray, width: number, height: number) =>
      mocks.realMeanBrightness
        ? mocks.realMeanBrightness(rgba, width, height)
        : 0
  );
  mocks.writeDpi.mockClear();
  mocks.writeDpi.mockImplementation(async (blob: Blob) => blob);
  mocks.jpegEncode.mockReset();
  mocks.jpegEncode.mockImplementation(
    (img: { data: unknown; width: number; height: number }, quality?: number) =>
      mocks.realJpegEncode!(img, quality)
  );
});

describe('hexToRgb', () => {
  it('parses #rrggbb to an rgb triple', () => {
    expect(hexToRgb('#438edb')).toEqual({ r: 0x43, g: 0x8e, b: 0xdb });
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('throws on invalid hex', () => {
    expect(() => hexToRgb('red')).toThrow();
    expect(() => hexToRgb('#123')).toThrow();
  });
});

describe('compositeIdPhoto pipeline', () => {
  it('decontaminates the cropped output at the preset size', async () => {
    const { contexts } = stubOffscreenCanvas();
    const cutout = fakeCutout(100, 140);

    await compositeIdPhoto(cutout, '#438edb', PRESET_W, PRESET_H, 'image/jpeg');

    expect(mocks.decontaminate).toHaveBeenCalledTimes(1);
    const [rgba, width, height, background] = mocks.decontaminate.mock
      .calls[0] as unknown as [
      Uint8ClampedArray,
      number,
      number,
      { r: number; g: number; b: number },
    ];
    expect(rgba).toBeInstanceOf(Uint8ClampedArray);
    // 去污染必须发生在裁剪并缩放到成片尺寸之后，而不是源图尺寸。
    expect(rgba).toHaveLength(PRESET_W * PRESET_H * 4);
    expect(width).toBe(PRESET_W);
    expect(height).toBe(PRESET_H);
    // 桩像素是 240 灰，底色估计应落在附近（量化步长 16）
    expect(background.r).toBeGreaterThanOrEqual(224);
    expect(background.g).toBeGreaterThanOrEqual(224);
    expect(background.b).toBeGreaterThanOrEqual(224);

    // 去污染结果必须写回前景画布
    expect(contexts[0]!.putImageData).toHaveBeenCalledTimes(1);
    // 抠图先按 crop 框绘制到成片尺寸的前景画布
    expect(outputCalls(contexts[0]!, 9)).toHaveLength(1);
  });

  it('draws the crop box onto the preset-sized canvas', async () => {
    const { contexts } = stubOffscreenCanvas();
    const crop = { x: 0.35, y: 0.4, scale: 1.6 };

    await compositeIdPhoto(
      fakeCutout(1000, 1500),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/jpeg',
      crop
    );

    const expected = resolveIdPhotoCropBox(
      1000,
      1500,
      PRESET_W,
      PRESET_H,
      crop
    );
    // 前景画布先按裁剪框把 cutout 缩放成成片尺寸。
    expect(outputCalls(contexts[0]!, 9)[0]).toEqual([
      expect.anything(),
      expected.left,
      expected.top,
      expected.width,
      expected.height,
      0,
      0,
      PRESET_W,
      PRESET_H,
    ]);
    // 成品画布只是把已裁好的前景按 1:1 叠上去。
    expect(contexts[1]!.fillRect).toHaveBeenCalledWith(
      0,
      0,
      PRESET_W,
      PRESET_H
    );
    const overlay = outputCalls(contexts[1]!, 5)[0]!;
    // 第一个参数是成片尺寸的前景画布，不再重复传入 crop 框。
    expect(overlay[0]).toMatchObject({
      width: PRESET_W,
      height: PRESET_H,
    });
    expect(overlay.slice(1)).toEqual([0, 0, PRESET_W, PRESET_H]);
  });

  it('uses the shared crop geometry when crop is omitted', async () => {
    const { contexts } = stubOffscreenCanvas();

    await compositeIdPhoto(
      fakeCutout(1000, 1500),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/jpeg'
    );

    const [, left, top, width, height] = outputCalls(contexts[0]!, 9)[0]!;
    expect((left as number) + (width as number) / 2).toBeCloseTo(500, -1);
    expect((top as number) + (height as number) / 2).toBeCloseTo(750, -1);
  });

  it('encodes JPEG at quality 95 and writes 300 dpi', async () => {
    const { blobs, contexts } = stubOffscreenCanvas();
    const sentinel = new Blob(['tagged'], { type: 'image/jpeg' });
    mocks.writeDpi.mockResolvedValueOnce(sentinel);

    const result = await compositeIdPhoto(
      fakeCutout(100, 140),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/jpeg'
    );

    // JPEG 必须由 jpeg-js 编码：canvas 无法指定色度采样。
    expect(blobs).toHaveLength(0);
    expect(contexts[1]!.getImageData).toHaveBeenCalledWith(
      0,
      0,
      PRESET_W,
      PRESET_H
    );
    expect(mocks.jpegEncode).toHaveBeenCalledTimes(1);
    expect(mocks.jpegEncode.mock.calls[0]![1]).toBe(95);
    expect(mocks.writeDpi).toHaveBeenCalledTimes(1);
    const encoded = mocks.writeDpi.mock.calls[0]![0] as Blob;
    expect(encoded.type).toBe('image/jpeg');
    expect(mocks.writeDpi.mock.calls[0]![1]).toBe(300);
    expect(result).toBe(sentinel);
  });

  it('does not pass quality for PNG', async () => {
    const { blobs } = stubOffscreenCanvas();

    await compositeIdPhoto(
      fakeCutout(100, 140),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/png'
    );

    expect(blobs[0]!.opts).toEqual({ type: 'image/png' });
    expect(mocks.writeDpi.mock.calls[0]![1]).toBe(300);
  });
});

describe('compositeIdPhoto JPEG chroma sampling', () => {
  it('encodes with 4:4:4 chroma sampling (all three components 0x11)', async () => {
    stubOffscreenCanvas();

    const blob = await compositeIdPhoto(
      fakeCutout(100, 140),
      '#438edb',
      PRESET_W,
      PRESET_H,
      'image/jpeg'
    );

    const sof = parseSof0(new Uint8Array(await blob.arrayBuffer()));
    expect(sof.components).toHaveLength(3);
    expect(sof.components.map(component => component.sampling)).toEqual([
      0x11, 0x11, 0x11,
    ]);
  });

  it('writes a JPEG whose decoded size equals the preset size', async () => {
    stubOffscreenCanvas();

    const blob = await compositeIdPhoto(
      fakeCutout(100, 140),
      '#438edb',
      PRESET_W,
      PRESET_H,
      'image/jpeg'
    );

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const decoded = decodeJpeg(bytes, { useTArray: true });
    expect(decoded.width).toBe(PRESET_W);
    expect(decoded.height).toBe(PRESET_H);

    // SOF0 与解码结果必须一致，避免只依赖解码器的宽松解析。
    const sof = parseSof0(bytes);
    expect(sof.width).toBe(PRESET_W);
    expect(sof.height).toBe(PRESET_H);
  });

  it('passes quality 95 and the output-canvas pixels to the encoder', async () => {
    const { contexts } = stubOffscreenCanvas({
      pixel: { r: 12, g: 200, b: 90, a: 255 },
    });

    await compositeIdPhoto(
      fakeCutout(100, 140),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/jpeg'
    );

    expect(mocks.jpegEncode).toHaveBeenCalledTimes(1);
    const [image, quality] = mocks.jpegEncode.mock.calls[0] as [
      { data: Uint8ClampedArray; width: number; height: number },
      number,
    ];
    expect(quality).toBe(95);
    expect(image.width).toBe(PRESET_W);
    expect(image.height).toBe(PRESET_H);
    expect(image.data).toHaveLength(PRESET_W * PRESET_H * 4);
    // 编码输入必须来自最终成品画布（含底色），不是前景画布。
    expect(contexts[1]!.getImageData).toHaveBeenCalledWith(
      0,
      0,
      PRESET_W,
      PRESET_H
    );
    expect(Array.from(image.data.subarray(0, 4))).toEqual([12, 200, 90, 255]);
  });
});

describe('compositeIdPhoto source background', () => {
  it('estimates the background from the original source at the preset size, not from the cutout', async () => {
    // 画布 0 = 前景 cutout（边缘存储值 191、alpha 128）；
    // 画布 1 = 原图（纯白底）。若从 cutout 估底色会得到 191，
    // 反预乘后仍是 191；只有用原图的 255 才能还原出真实前景 128。
    const { contexts } = stubOffscreenCanvas({
      canvasPixelAt: canvasIndex => {
        if (canvasIndex === 0) return { r: 191, g: 191, b: 191, a: 128 };
        if (canvasIndex === 1) return { r: 255, g: 255, b: 255, a: 255 };
        return { r: 0, g: 0, b: 0, a: 0 };
      },
    });
    const source = fakeCutout(100, 140);
    const box = resolveIdPhotoCropBox(100, 140, PRESET_W, PRESET_H, {
      x: 0.5,
      y: 0.5,
      scale: 1,
    });

    await compositeIdPhoto(
      fakeCutout(100, 140),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/jpeg',
      { x: 0.5, y: 0.5, scale: 1 },
      0,
      source
    );

    // 底色聚类与原图取样都必须发生在成片尺寸上，语义与服务端一致。
    expect(mocks.estimate).toHaveBeenCalledTimes(1);
    expect(mocks.estimate.mock.calls[0]![1]).toBe(PRESET_W);
    expect(mocks.estimate.mock.calls[0]![2]).toBe(PRESET_H);
    expect(mocks.decontaminate).toHaveBeenCalledTimes(1);
    expect(mocks.decontaminate.mock.calls[0]![3]).toEqual({
      r: 255,
      g: 255,
      b: 255,
    });

    // 原图按同一个裁剪框缩放到成片尺寸后再取样。
    expect(outputCalls(contexts[1]!, 9)[0]).toEqual([
      source,
      box.left,
      box.top,
      box.width,
      box.height,
      0,
      0,
      PRESET_W,
      PRESET_H,
    ]);

    const written = contexts[0]!.putImageData.mock.calls[0]![0] as {
      data: Uint8ClampedArray;
    };
    // 还原到真实前景色 128，而不是 cutout 反推的 191；alpha 保持不变。
    expect(Array.from(written.data.subarray(0, 4))).toEqual([
      128, 128, 128, 128,
    ]);
  });

  it('skips decontamination when the cutout-derived background is untrustworthy', async () => {
    // destination-in 之后的背景像素是 (0,0,0,0)，采样到的上边缘与左右边缘全黑。
    // 中心放一个半透明边缘像素：守卫生效时它必须保持原样，不被 c/a 放大成白边。
    const { contexts } = stubOffscreenCanvas({
      pixelAt: (x, y) =>
        x === 50 && y === 70
          ? { r: 191, g: 191, b: 191, a: 128 }
          : { r: 0, g: 0, b: 0, a: 0 },
    });

    await compositeIdPhoto(
      fakeCutout(100, 140),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/jpeg'
    );

    // 估计结果三通道都为 0 → 不可信 → 整段跳过，源 canvas 像素保持不变。
    expect(mocks.decontaminate).not.toHaveBeenCalled();
    expect(contexts[0]!.putImageData).not.toHaveBeenCalled();
  });

  it('still decontaminates when the estimated background is plausible', async () => {
    // 回归：正常（非黑）底色估计仍要走反预乘 —— 默认 240 灰会触发去污染。
    stubOffscreenCanvas();

    await compositeIdPhoto(
      fakeCutout(100, 140),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/jpeg'
    );

    expect(mocks.decontaminate).toHaveBeenCalledTimes(1);
    const background = mocks.decontaminate.mock.calls[0]![3] as {
      r: number;
      g: number;
      b: number;
    };
    expect(background.r).toBeGreaterThanOrEqual(224);
    expect(background.g).toBeGreaterThanOrEqual(224);
    expect(background.b).toBeGreaterThanOrEqual(224);
  });
});

describe('compositeIdPhoto rotation', () => {
  it('does not rotate when rotation is omitted or zero', async () => {
    const { contexts } = stubOffscreenCanvas();

    await compositeIdPhoto(
      fakeCutout(100, 140),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/jpeg'
    );
    await compositeIdPhoto(
      fakeCutout(100, 140),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/jpeg',
      undefined,
      0
    );

    expect(contexts[1]!.rotate).not.toHaveBeenCalled();
    expect(contexts[1]!.translate).not.toHaveBeenCalled();
  });

  it('rotates around the output centre with the server-side sign', async () => {
    const { contexts } = stubOffscreenCanvas();

    await compositeIdPhoto(
      fakeCutout(100, 140),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/jpeg',
      undefined,
      45
    );

    const out = contexts[1]!;
    // 服务端是 sharp.rotate(-rotation)；canvas 正角为顺时针，同样取负。
    expect(out.rotate).toHaveBeenCalledTimes(1);
    expect(out.rotate.mock.calls[0]![0]).toBeCloseTo((-45 * Math.PI) / 180, 12);
    expect(out.translate.mock.calls[0]).toEqual([PRESET_W / 2, PRESET_H / 2]);
    expect(out.translate.mock.calls[1]).toEqual([-PRESET_W / 2, -PRESET_H / 2]);
  });

  it('keeps the sign for negative rotation', async () => {
    const { contexts } = stubOffscreenCanvas();

    await compositeIdPhoto(
      fakeCutout(100, 140),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/jpeg',
      undefined,
      -30
    );

    expect(contexts[1]!.rotate.mock.calls[0]![0]).toBeCloseTo(
      (30 * Math.PI) / 180,
      12
    );
  });
});

describe('compositeIdPhoto brightness', () => {
  const CENTRE_X = Math.floor(PRESET_W / 2);
  const CENTRE_Y = Math.floor(PRESET_H / 2);
  const CENTRE_INDEX = (CENTRE_Y * PRESET_W + CENTRE_X) * 4;

  function pixelAtCentre(
    foreground: StubPixel
  ): (x: number, y: number) => StubPixel {
    return (x, y) =>
      x === CENTRE_X && y === CENTRE_Y
        ? foreground
        : { r: 0, g: 0, b: 0, a: 0 };
  }

  function writtenPixels(ctx: FakeContext) {
    const call = ctx.putImageData.mock.calls.at(-1);
    expect(call).toBeDefined();
    return (call![0] as { data: Uint8ClampedArray }).data;
  }

  it('adds brightness to foreground pixels and leaves transparent pixels untouched', async () => {
    const { contexts } = stubOffscreenCanvas({
      pixelAt: pixelAtCentre({ r: 100, g: 100, b: 100, a: 255 }),
    });

    await compositeIdPhoto(
      fakeCutout(100, 140),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/png',
      undefined,
      0,
      null,
      12
    );

    const data = writtenPixels(contexts[0]!);
    expect(Array.from(data.subarray(CENTRE_INDEX, CENTRE_INDEX + 4))).toEqual([
      112, 112, 112, 255,
    ]);
    // 透明像素完全不动(alpha=0 的 RGB 即便有残留值也不参与调色)。
    expect(Array.from(data.subarray(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it('clamps adjusted channels to 0..255', async () => {
    const { contexts } = stubOffscreenCanvas({
      pixelAt: pixelAtCentre({ r: 250, g: 3, b: 128, a: 255 }),
    });

    await compositeIdPhoto(
      fakeCutout(20, 20),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/png',
      undefined,
      0,
      null,
      20
    );

    let data = writtenPixels(contexts[0]!);
    expect(Array.from(data.subarray(CENTRE_INDEX, CENTRE_INDEX + 3))).toEqual([
      255, 23, 148,
    ]);

    const second = stubOffscreenCanvas({
      pixelAt: pixelAtCentre({ r: 250, g: 3, b: 128, a: 255 }),
    });
    await compositeIdPhoto(
      fakeCutout(20, 20),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/png',
      undefined,
      0,
      null,
      -20
    );
    data = writtenPixels(second.contexts[0]!);
    expect(Array.from(data.subarray(CENTRE_INDEX, CENTRE_INDEX + 3))).toEqual([
      230, 0, 108,
    ]);
  });

  it('applies brightness after decontamination so recovered colours are shifted', async () => {
    // mock 返回固定灰度 200,与输入无关：这样最终值只可能是
    // 「去污染输出 200 + 亮度 8 = 208」；若亮度被错误地放在去污染之前,
    // 偏移会被恒定的 mock 输出吞掉,最终仍是 200。
    mocks.decontaminate.mockImplementationOnce(rgba => {
      const out = new Uint8ClampedArray(rgba.length);
      for (let i = 0; i < rgba.length; i += 4) {
        out[i] = 200;
        out[i + 1] = 200;
        out[i + 2] = 200;
        out[i + 3] = rgba[i + 3] ?? 0;
      }
      return out;
    });
    const { contexts } = stubOffscreenCanvas({
      pixelAt: () => ({ r: 120, g: 120, b: 120, a: 255 }),
    });

    await compositeIdPhoto(
      fakeCutout(10, 10),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/png',
      undefined,
      0,
      null,
      8
    );

    // 去污染入参必须是未调色的原值(120),不能是 120 + 8。
    const input = mocks.decontaminate.mock.calls[0]![0] as Uint8ClampedArray;
    expect(Array.from(input.subarray(0, 4))).toEqual([120, 120, 120, 255]);
    // 去污染同样作用在成片尺寸上。
    expect(mocks.decontaminate.mock.calls[0]![1]).toBe(PRESET_W);
    expect(mocks.decontaminate.mock.calls[0]![2]).toBe(PRESET_H);

    const data = writtenPixels(contexts[0]!);
    expect(Array.from(data.subarray(0, 4))).toEqual([208, 208, 208, 255]);
  });

  it('computes auto brightness from the cropped foreground at the preset size', async () => {
    const { contexts } = stubOffscreenCanvas({
      pixelAt: pixelAtCentre({ r: 40, g: 40, b: 40, a: 255 }),
    });

    await compositeIdPhoto(
      fakeCutout(100, 140),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/png',
      undefined,
      0,
      null,
      'auto'
    );

    // 与服务端共用的均值函数必须拿到裁剪后的成片像素，而不是整幅源图。
    expect(mocks.meanBrightness).toHaveBeenCalledTimes(1);
    const [rgba, width, height] = mocks.meanBrightness.mock.calls[0] as [
      Uint8ClampedArray,
      number,
      number,
    ];
    expect(rgba).toHaveLength(PRESET_W * PRESET_H * 4);
    expect(width).toBe(PRESET_W);
    expect(height).toBe(PRESET_H);

    // 40 灰 → 建议 +18，与服务端同一算法。
    const data = writtenPixels(contexts[0]!);
    expect(Array.from(data.subarray(CENTRE_INDEX, CENTRE_INDEX + 4))).toEqual([
      58, 58, 58, 255,
    ]);
  });

  it('keeps RGB of fully transparent pixels even when it is non-zero', async () => {
    const { contexts } = stubOffscreenCanvas({
      pixelAt: (x, y) =>
        x === 5 && y === 5
          ? { r: 100, g: 100, b: 100, a: 255 }
          : { r: 50, g: 60, b: 70, a: 0 },
    });

    await compositeIdPhoto(
      fakeCutout(10, 10),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/png',
      undefined,
      0,
      null,
      12
    );

    const data = writtenPixels(contexts[0]!);
    // (0,0) 是透明像素：亮度只作用于 alpha > 0,残留 RGB 必须原样保留。
    expect(Array.from(data.subarray(0, 4))).toEqual([50, 60, 70, 0]);
    // 前景像素照常加偏移。
    const centre = (5 * PRESET_W + 5) * 4;
    expect(Array.from(data.subarray(centre, centre + 4))).toEqual([
      112, 112, 112, 255,
    ]);
  });
});
