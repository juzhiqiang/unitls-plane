import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STRENGTH,
  getMosaicFileName,
  isUsableRegion,
  MAX_STRENGTH,
  MIN_REGION_PX,
  MIN_STRENGTH,
  resolveBlockSize,
  toPixelRegion,
} from '../geometry';

const W = 1000;
const H = 800;

describe('toPixelRegion', () => {
  it('converts a normalised region to source pixels', () => {
    expect(
      toPixelRegion({ x: 0.1, y: 0.25, width: 0.5, height: 0.5 }, W, H)
    ).toEqual({ x: 100, y: 200, width: 500, height: 400 });
  });

  it('keeps the region inside the image', () => {
    for (const region of [
      { x: -0.5, y: -0.5, width: 0.4, height: 0.4 },
      { x: 0.9, y: 0.9, width: 0.5, height: 0.5 },
      { x: 0, y: 0, width: 2, height: 2 },
    ]) {
      const pixel = toPixelRegion(region, W, H);
      expect(pixel.x).toBeGreaterThanOrEqual(0);
      expect(pixel.y).toBeGreaterThanOrEqual(0);
      expect(pixel.x + pixel.width).toBeLessThanOrEqual(W);
      expect(pixel.y + pixel.height).toBeLessThanOrEqual(H);
    }
  });

  it('never produces a zero-sized region', () => {
    const pixel = toPixelRegion({ x: 0.5, y: 0.5, width: 0, height: 0 }, W, H);
    expect(pixel.width).toBeGreaterThanOrEqual(1);
    expect(pixel.height).toBeGreaterThanOrEqual(1);
  });
});

describe('resolveBlockSize', () => {
  it('scales with the region rather than being a fixed pixel count', () => {
    // 同一强度下,大选区的色块应当更大 —— 固定像素会让小选区被一块糊死、
    // 大选区几乎看不出变化。
    const small = resolveBlockSize(
      { width: 100, height: 100 },
      DEFAULT_STRENGTH
    );
    const large = resolveBlockSize(
      { width: 800, height: 800 },
      DEFAULT_STRENGTH
    );
    expect(large).toBeGreaterThan(small);
  });

  it('grows with strength', () => {
    const weak = resolveBlockSize({ width: 400, height: 400 }, MIN_STRENGTH);
    const strong = resolveBlockSize({ width: 400, height: 400 }, MAX_STRENGTH);
    expect(strong).toBeGreaterThan(weak);
  });

  it('clamps out-of-range strength', () => {
    const region = { width: 400, height: 400 };
    expect(resolveBlockSize(region, -100)).toBe(
      resolveBlockSize(region, MIN_STRENGTH)
    );
    expect(resolveBlockSize(region, 9999)).toBe(
      resolveBlockSize(region, MAX_STRENGTH)
    );
  });

  it('always leaves at least a 2px block', () => {
    expect(
      resolveBlockSize({ width: 1, height: 1 }, MIN_STRENGTH)
    ).toBeGreaterThanOrEqual(2);
  });

  it('uses the short side so thin regions stay masked', () => {
    // 细长选区若按长边算,色块会大过选区高度,等于整条被抹平
    const thin = resolveBlockSize({ width: 900, height: 40 }, DEFAULT_STRENGTH);
    expect(thin).toBeLessThanOrEqual(40);
  });
});

describe('isUsableRegion', () => {
  it('rejects regions too small to be meaningful', () => {
    expect(
      isUsableRegion({ x: 0, y: 0, width: 0.001, height: 0.001 }, W, H)
    ).toBe(false);
  });

  it('accepts a region at the minimum size', () => {
    expect(
      isUsableRegion(
        { x: 0, y: 0, width: MIN_REGION_PX / W, height: MIN_REGION_PX / H },
        W,
        H
      )
    ).toBe(true);
  });
});

describe('getMosaicFileName', () => {
  it('prefixes the name and matches the output type', () => {
    expect(getMosaicFileName('id-card.jpg', 'image/png')).toBe(
      'masked-id-card.png'
    );
    expect(getMosaicFileName('a.b.png', 'image/jpeg')).toBe('masked-a.b.jpg');
    expect(getMosaicFileName('noext', 'image/webp')).toBe('masked-noext.webp');
  });
});
