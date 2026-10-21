import { describe, expect, it } from 'bun:test';
import {
  MODNET_LONG_EDGE,
  MODNET_MAX_INPUT_PIXELS,
  modnetInputSize,
} from '../src/id-photo-modnet-size';

describe('modnetInputSize', () => {
  it('exposes 512 as the default long edge', () => {
    expect(MODNET_LONG_EDGE).toBe(512);
  });

  it('exposes a 2 MP input budget', () => {
    expect(MODNET_MAX_INPUT_PIXELS).toBe(2_097_152);
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

  it('caps extreme aspect ratios at the 2 MP input budget', () => {
    const box = modnetInputSize({ width: 20000, height: 400 }, 512);
    expect(box.width * box.height).toBeLessThanOrEqual(2_097_152);
    expect(box.width % 32).toBe(0);
    expect(box.height % 32).toBe(0);
    // 保持横向比例：仍是一张 50:1 左右的宽图，没有被补成正方形。
    expect(box.width).toBeGreaterThan(box.height);
  });

  it('does not change normal ID photo sizes when applying the cap', () => {
    expect(modnetInputSize({ width: 1280, height: 1706 }, 512)).toEqual({
      width: 384,
      height: 512,
    });
    expect(modnetInputSize({ width: 1600, height: 900 }, 512)).toEqual({
      width: 512,
      height: 288,
    });
    expect(modnetInputSize({ width: 295, height: 413 }, 512)).toEqual({
      width: 352,
      height: 512,
    });
    expect(modnetInputSize({ width: 4000, height: 6000 }, 512)).toEqual({
      width: 320,
      height: 512,
    });
    for (const source of [
      { width: 1280, height: 1706 },
      { width: 1600, height: 900 },
      { width: 295, height: 413 },
      { width: 4000, height: 6000 },
    ]) {
      const box = modnetInputSize(source, 512);
      expect(box.width * box.height).toBeLessThanOrEqual(2_097_152);
    }
  });

  it('treats shortest edge 512 as still large and 513 as oversized', () => {
    // 短边恰好 512：判定不缩放，仅做 32 对齐。
    expect(modnetInputSize({ width: 512, height: 1024 }, 512)).toEqual({
      width: 512,
      height: 1024,
    });
    // 短边 513：按长边缩回 512。
    expect(modnetInputSize({ width: 1000, height: 513 }, 512)).toEqual({
      width: 512,
      height: 256,
    });
  });

  it('handles zero, negative and 1x1 inputs safely', () => {
    expect(modnetInputSize({ width: 0, height: 0 }, 512)).toEqual({
      width: 512,
      height: 512,
    });
    expect(modnetInputSize({ width: 0, height: 100 }, 512)).toEqual({
      width: 512,
      height: 512,
    });
    expect(modnetInputSize({ width: -10, height: 100 }, 512)).toEqual({
      width: 512,
      height: 512,
    });
    expect(modnetInputSize({ width: 1, height: 1 }, 512)).toEqual({
      width: 512,
      height: 512,
    });
  });

  it('aligns degenerate-input fallback sizes to 32 even for custom long edges', () => {
    expect(modnetInputSize({ width: 0, height: 0 }, 100)).toEqual({
      width: 96,
      height: 96,
    });
    expect(modnetInputSize({ width: 0, height: 0 }, 17)).toEqual({
      width: 32,
      height: 32,
    });
  });

  it('always returns multiples of 32 and never below 32', () => {
    for (const source of [
      { width: 1, height: 1 },
      { width: 333, height: 777 },
      { width: 4000, height: 17 },
      { width: 513, height: 513 },
      { width: 0, height: 0 },
      { width: -5, height: 900 },
      { width: 20000, height: 400 },
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
    ).toBeLessThan(0.05);
  });

  it('returns no padding fields', () => {
    const box = modnetInputSize({ width: 1280, height: 1706 }, 512);
    expect(Object.keys(box).sort()).toEqual(['height', 'width']);
  });
});
