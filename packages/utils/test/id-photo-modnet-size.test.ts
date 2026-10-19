import { describe, expect, it } from 'bun:test';
import { MODNET_LONG_EDGE, modnetInputSize } from '../src/id-photo-modnet-size';

describe('modnetInputSize', () => {
  it('exposes 512 as the default long edge', () => {
    expect(MODNET_LONG_EDGE).toBe(512);
  });

  it('scales a tall image so the long edge is 512', () => {
    expect(modnetInputSize({ width: 1280, height: 1706 }, 512)).toEqual({
      width: 384,
      height: 512,
    });
  });

  it('scales a landscape image so the long edge is 512', () => {
    expect(modnetInputSize({ width: 1600, height: 900 }, 512)).toEqual({
      width: 512,
      height: 288,
    });
  });

  it('upscales an image smaller than the long edge', () => {
    expect(modnetInputSize({ width: 300, height: 400 }, 512)).toEqual({
      width: 384,
      height: 512,
    });
  });

  it('keeps an already-large image at its own size', () => {
    // 长边已 >= 512 且短边 <= 512：不缩放，只做 32 对齐
    expect(modnetInputSize({ width: 1000, height: 300 }, 512)).toEqual({
      width: 992,
      height: 288,
    });
  });

  it('always returns multiples of 32 and never below 32', () => {
    for (const source of [
      { width: 1, height: 1 },
      { width: 333, height: 777 },
      { width: 4000, height: 17 },
      { width: 513, height: 513 },
    ]) {
      const box = modnetInputSize(source, 512);
      expect(box.width % 32).toBe(0);
      expect(box.height % 32).toBe(0);
      expect(box.width).toBeGreaterThanOrEqual(32);
      expect(box.height).toBeGreaterThanOrEqual(32);
    }
  });

  it('preserves the aspect ratio within 32px rounding', () => {
    const source = { width: 1280, height: 1706 };
    const box = modnetInputSize(source, 512);
    expect(
      Math.abs(box.width / box.height - source.width / source.height)
    ).toBeLessThan(0.08);
  });

  it('returns no padding fields', () => {
    const box = modnetInputSize({ width: 1280, height: 1706 }, 512);
    expect(Object.keys(box).sort()).toEqual(['height', 'width']);
  });
});
