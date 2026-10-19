import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveIdPhotoCropBox } from '@utils-plane/validators';

const mocks = vi.hoisted(() => ({
  decontaminate: vi.fn((rgba: Uint8ClampedArray) => rgba),
  writeDpi: vi.fn(async (blob: Blob, _dpi?: number) => blob),
}));

// composite.ts 只从 utils 取去污染函数，整模块替换可以避免加载无关实现。
vi.mock('@utils-plane/utils', () => ({
  decontaminateIdPhotoForeground: mocks.decontaminate,
}));
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

interface StubOptions {
  /** getImageData 返回的像素；默认浅灰不透明，保证底色估计有值。 */
  pixel?: { r: number; g: number; b: number; a: number };
}

/** jsdom 没有 OffscreenCanvas / ImageData，用最小桩替换并记录调用。 */
function stubOffscreenCanvas(options: StubOptions = {}) {
  const pixel = options.pixel ?? { r: 240, g: 240, b: 240, a: 255 };
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
      const self = this;
      this.ctx = {
        fillStyle: '',
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < w * h; i += 1) {
            data[i * 4] = pixel.r;
            data[i * 4 + 1] = pixel.g;
            data[i * 4 + 2] = pixel.b;
            data[i * 4 + 3] = pixel.a;
          }
          return { data, width: w, height: h };
        }),
        putImageData: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
      };
      contexts.push(this.ctx);
      void self;
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
  mocks.decontaminate.mockClear();
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
