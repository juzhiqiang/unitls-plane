import { describe, expect, it, vi } from 'vitest';
import { resolveIdPhotoCropBox } from '@utils-plane/validators';
import { compositeIdPhoto, hexToRgb } from '../composite';

describe('composite', () => {
  it('hexToRgb parses #rrggbb to rgb triple', () => {
    expect(hexToRgb('#438edb')).toEqual({ r: 0x43, g: 0x8e, b: 0xdb });
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('hexToRgb throws on invalid hex', () => {
    expect(() => hexToRgb('red')).toThrow();
    expect(() => hexToRgb('#123')).toThrow();
  });
});

/** compositeIdPhoto 在 jsdom 下需要 OffscreenCanvas;记录 drawImage 入参用于断言。 */
function stubOffscreenCanvas() {
  const drawImage = vi.fn();
  class FakeCtx {
    fillStyle = '';
    drawImage = drawImage;
    fillRect(): void {}
  }
  class FakeCanvas {
    private ctx = new FakeCtx();
    constructor(
      public width: number,
      public height: number
    ) {}
    getContext(): FakeCtx {
      return this.ctx;
    }
    convertToBlob(): Promise<Blob> {
      return Promise.resolve(new Blob(['x']));
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  return drawImage;
}

function fakeCutout(width: number, height: number): ImageBitmap {
  return { width, height, close: () => {} } as unknown as ImageBitmap;
}

describe('compositeIdPhoto crop', () => {
  const PRESET_W = 295;
  const PRESET_H = 413;

  it('裁剪框与 validators 的共享几何完全一致', async () => {
    // 本地 canvas 路径与服务端 sharp 路径必须解出同一个框,否则同一组参数
    // 在两种处理模式下会产出不同构图。
    const drawImage = stubOffscreenCanvas();
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
    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      expected.left,
      expected.top,
      expected.width,
      expected.height,
      0,
      0,
      PRESET_W,
      PRESET_H
    );

    vi.unstubAllGlobals();
  });

  it('省略 crop 时保持居中裁剪(历史行为)', async () => {
    const drawImage = stubOffscreenCanvas();

    await compositeIdPhoto(
      fakeCutout(1000, 1500),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/jpeg'
    );

    const [, left, top, width, height] = drawImage.mock.calls[0]!;
    expect((left as number) + (width as number) / 2).toBeCloseTo(500, -1);
    expect((top as number) + (height as number) / 2).toBeCloseTo(750, -1);

    vi.unstubAllGlobals();
  });

  it('crop 改变构图', async () => {
    const drawImage = stubOffscreenCanvas();

    await compositeIdPhoto(
      fakeCutout(1000, 1500),
      '#ffffff',
      PRESET_W,
      PRESET_H,
      'image/jpeg',
      { x: 0.2, y: 0.5, scale: 2 }
    );

    const [, left, , width] = drawImage.mock.calls[0]!;
    // 中心推到左侧且放大两倍:框应明显偏左且比基准框窄。
    expect((left as number) + (width as number) / 2).toBeLessThan(500);
    expect(width as number).toBeLessThan(1000);

    vi.unstubAllGlobals();
  });
});
