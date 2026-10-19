import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  writeDpi: vi.fn(async (blob: Blob, _dpi?: number) => blob),
}));

// composite.ts 只从 utils 取去污染函数；保留其余真实导出，按需委托。
vi.mock('@utils-plane/utils', async importOriginal => {
  const actual = await importOriginal<typeof import('@utils-plane/utils')>();
  mocks.realDecontaminate = actual.decontaminateIdPhotoForeground;
  return {
    ...actual,
    decontaminateIdPhotoForeground: mocks.decontaminate,
  };
});
vi.mock('@/lib/id-photo-local/dpi-metadata', () => ({
  writeDpi: mocks.writeDpi,
}));

const { compositeIdPhoto, hexToRgb } =
  await import('@/lib/id-photo-local/composite');

const PRESET_W = 295;
const PRESET_H = 413;

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
}

/** jsdom 没有 OffscreenCanvas / ImageData，用最小桩替换并记录调用。 */
function stubOffscreenCanvas(options: StubOptions = {}) {
  const pixel = options.pixel ?? { r: 240, g: 240, b: 240, a: 255 };
  const pixelAt = options.pixelAt;
  const contexts: FakeContext[] = [];
  const blobs: { opts: unknown; canvas: unknown }[] = [];

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
      this.ctx = {
        fillStyle: '',
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < w * h; i += 1) {
            const px = pixelAt ? pixelAt(i % w, Math.floor(i / w), i) : pixel;
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
  mocks.writeDpi.mockClear();
  mocks.writeDpi.mockImplementation(async (blob: Blob) => blob);
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
  it('runs shared decontamination before compositing', async () => {
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
    expect(rgba).toHaveLength(100 * 140 * 4);
    expect(width).toBe(100);
    expect(height).toBe(140);
    // 桩像素是 240 灰，底色估计应落在附近（量化步长 16）
    expect(background.r).toBeGreaterThanOrEqual(224);
    expect(background.g).toBeGreaterThanOrEqual(224);
    expect(background.b).toBeGreaterThanOrEqual(224);

    // 去污染结果必须写回源 canvas
    expect(contexts[0]!.putImageData).toHaveBeenCalledTimes(1);
    // 源图先绘制到离屏 canvas 再取像素
    expect(contexts[0]!.drawImage).toHaveBeenCalledWith(cutout, 0, 0);
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

    const out = contexts[1]!;
    const expected = resolveIdPhotoCropBox(
      1000,
      1500,
      PRESET_W,
      PRESET_H,
      crop
    );
    expect(out.fillRect).toHaveBeenCalledWith(0, 0, PRESET_W, PRESET_H);
    expect(outputCalls(out, 9)[0]).toEqual([
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

    const [, left, top, width, height] = outputCalls(contexts[1]!, 9)[0]!;
    expect((left as number) + (width as number) / 2).toBeCloseTo(500, -1);
    expect((top as number) + (height as number) / 2).toBeCloseTo(750, -1);
  });

  it('encodes JPEG at quality 0.95 and writes 300 dpi', async () => {
    const { blobs } = stubOffscreenCanvas();
    const sentinel = new Blob(['tagged'], { type: 'image/jpeg' });
    mocks.writeDpi.mockResolvedValueOnce(sentinel);

    const result = await compositeIdPhoto(
      fakeCutout(100, 140),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/jpeg'
    );

    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.opts).toEqual({
      type: 'image/jpeg',
      quality: 0.95,
    });
    expect(mocks.writeDpi).toHaveBeenCalledTimes(1);
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

describe('compositeIdPhoto source background', () => {
  it('uses a caller-provided background instead of re-deriving it from the cutout', async () => {
    // 真实边缘像素 = 前景 128 × a + 白底 255 × (1-a)，a=128/255 → 存储值 191。
    // 传白底时反预乘应还原到 128；若拿黑底反推，c/a 会把 191 放大成 ~381，
    // 钳制后就是 255 的白边。
    const { contexts } = stubOffscreenCanvas({
      pixel: { r: 191, g: 191, b: 191, a: 128 },
    });

    await compositeIdPhoto(
      fakeCutout(100, 140),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/jpeg',
      undefined,
      0,
      { r: 255, g: 255, b: 255 }
    );

    expect(mocks.decontaminate).toHaveBeenCalledTimes(1);
    expect(mocks.decontaminate.mock.calls[0]![3]).toEqual({
      r: 255,
      g: 255,
      b: 255,
    });

    const written = contexts[0]!.putImageData.mock.calls[0]![0] as {
      data: Uint8ClampedArray;
    };
    // 还原到真实前景色 128，而不是白边 255；alpha 保持不变。
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
  function pixelAtCentre(
    width: number,
    height: number,
    foreground: StubPixel
  ): (x: number, y: number) => StubPixel {
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    return (x, y) =>
      x === cx && y === cy ? foreground : { r: 0, g: 0, b: 0, a: 0 };
  }

  function writtenPixels(ctx: FakeContext, width: number, height: number) {
    const call = ctx.putImageData.mock.calls.at(-1);
    expect(call).toBeDefined();
    return (call![0] as { data: Uint8ClampedArray }).data;
  }

  it('adds brightness to foreground pixels and leaves transparent pixels untouched', async () => {
    const width = 100;
    const height = 140;
    const { contexts } = stubOffscreenCanvas({
      pixelAt: pixelAtCentre(width, height, { r: 100, g: 100, b: 100, a: 255 }),
    });

    await compositeIdPhoto(
      fakeCutout(width, height),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/png',
      undefined,
      0,
      undefined,
      12
    );

    const data = writtenPixels(contexts[0]!, width, height);
    const centre = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    expect(Array.from(data.subarray(centre, centre + 4))).toEqual([
      112, 112, 112, 255,
    ]);
    // 透明像素完全不动(alpha=0 的 RGB 即便有残留值也不参与调色)。
    expect(Array.from(data.subarray(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it('clamps adjusted channels to 0..255', async () => {
    const width = 20;
    const height = 20;
    const { contexts } = stubOffscreenCanvas({
      pixelAt: (x, y) => {
        const cx = Math.floor(width / 2);
        const cy = Math.floor(height / 2);
        if (x === cx && y === cy) return { r: 250, g: 3, b: 128, a: 255 };
        return { r: 250, g: 3, b: 128, a: 0 };
      },
    });

    await compositeIdPhoto(
      fakeCutout(width, height),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/png',
      undefined,
      0,
      undefined,
      20
    );

    let data = writtenPixels(contexts[0]!, width, height);
    let centre = (10 * width + 10) * 4;
    expect(Array.from(data.subarray(centre, centre + 3))).toEqual([
      255, 23, 148,
    ]);

    const second = stubOffscreenCanvas({
      pixelAt: (x, y) => {
        const cx = Math.floor(width / 2);
        const cy = Math.floor(height / 2);
        if (x === cx && y === cy) return { r: 250, g: 3, b: 128, a: 255 };
        return { r: 250, g: 3, b: 128, a: 0 };
      },
    });
    await compositeIdPhoto(
      fakeCutout(width, height),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/png',
      undefined,
      0,
      undefined,
      -20
    );
    data = writtenPixels(second.contexts[0]!, width, height);
    centre = (10 * width + 10) * 4;
    expect(Array.from(data.subarray(centre, centre + 3))).toEqual([
      230, 0, 108,
    ]);
  });

  it('applies brightness after decontamination so recovered colours are shifted', async () => {
    mocks.decontaminate.mockImplementationOnce(rgba => rgba);
    const width = 10;
    const height = 10;
    const { contexts } = stubOffscreenCanvas({
      pixelAt: () => ({ r: 120, g: 120, b: 120, a: 255 }),
    });

    await compositeIdPhoto(
      fakeCutout(width, height),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/png',
      undefined,
      0,
      { r: 255, g: 255, b: 255 },
      8
    );

    const data = writtenPixels(contexts[0]!, width, height);
    expect(Array.from(data.subarray(0, 4))).toEqual([128, 128, 128, 255]);
  });
});
