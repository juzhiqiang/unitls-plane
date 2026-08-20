import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compositeCutout,
  cutoutSelectionIsValid,
  getCutoutFileName,
  supportsTransparency,
} from '../composite';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('supportsTransparency', () => {
  it('only PNG and WebP keep an alpha channel', () => {
    expect(supportsTransparency('image/png')).toBe(true);
    expect(supportsTransparency('image/webp')).toBe(true);
    expect(supportsTransparency('image/jpeg')).toBe(false);
  });
});

describe('cutoutSelectionIsValid', () => {
  it('rejects transparent output on a format without alpha', () => {
    // canvas 会把 alpha 压成黑色,用户拿到黑底图却不知道为什么 —— 必须拦下。
    expect(cutoutSelectionIsValid({ kind: 'transparent' }, 'image/jpeg')).toBe(
      false
    );
  });

  it('accepts transparent output on PNG and WebP', () => {
    expect(cutoutSelectionIsValid({ kind: 'transparent' }, 'image/png')).toBe(
      true
    );
    expect(cutoutSelectionIsValid({ kind: 'transparent' }, 'image/webp')).toBe(
      true
    );
  });

  it('accepts a solid colour on any format', () => {
    for (const type of ['image/png', 'image/webp', 'image/jpeg'] as const) {
      expect(
        cutoutSelectionIsValid({ kind: 'color', color: '#ffffff' }, type)
      ).toBe(true);
    }
  });
});

describe('getCutoutFileName', () => {
  it('prefixes the name and matches the output extension', () => {
    expect(getCutoutFileName('portrait.jpg', 'image/png')).toBe(
      'cutout-portrait.png'
    );
    expect(getCutoutFileName('a.b.webp', 'image/jpeg')).toBe('cutout-a.b.jpg');
    expect(getCutoutFileName('noext', 'image/webp')).toBe('cutout-noext.webp');
  });
});

/** 记录绘制调用的画布桩。 */
function stubCanvas() {
  const calls = { fillRect: 0, drawImage: 0, fillStyle: '' };
  const ctx = {
    set fillStyle(value: string) {
      calls.fillStyle = value;
    },
    get fillStyle() {
      return calls.fillStyle;
    },
    fillRect: () => {
      calls.fillRect += 1;
    },
    drawImage: () => {
      calls.drawImage += 1;
    },
  };
  vi.spyOn(document, 'createElement').mockReturnValue({
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['out'])),
  } as unknown as HTMLElement);
  return calls;
}

const cutout = { width: 20, height: 10 } as unknown as ImageBitmap;

describe('compositeCutout', () => {
  it('does not paint a background when transparent', async () => {
    const calls = stubCanvas();

    await compositeCutout(cutout, {
      background: { kind: 'transparent' },
      outputType: 'image/png',
    });

    // 透明背景就是「不填」,填了白色就永远拿不回透明。
    expect(calls.fillRect).toBe(0);
    expect(calls.drawImage).toBe(1);
  });

  it('paints the chosen colour before drawing the cutout', async () => {
    const calls = stubCanvas();

    await compositeCutout(cutout, {
      background: { kind: 'color', color: '#438edb' },
      outputType: 'image/jpeg',
    });

    expect(calls.fillRect).toBe(1);
    expect(calls.fillStyle).toBe('#438edb');
    expect(calls.drawImage).toBe(1);
  });
});
