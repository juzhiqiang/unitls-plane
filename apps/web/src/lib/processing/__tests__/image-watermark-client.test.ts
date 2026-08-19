import { describe, expect, it } from 'vitest';
import {
  clampLogoScale,
  colorToCss,
  DEFAULT_LOGO_SCALE,
  getWatermarkedImageName,
  outlineColorFor,
  resolveLogoSize,
} from '../image-watermark-client';

describe('image watermark helpers', () => {
  it('creates a stable watermarked output filename for jpeg output', () => {
    expect(getWatermarkedImageName('hero.photo.png', 'image/jpeg')).toBe(
      'watermarked-hero.photo.jpg'
    );
  });

  it('creates a stable output filename when the input has no extension', () => {
    expect(getWatermarkedImageName('brand', 'image/webp')).toBe(
      'watermarked-brand.webp'
    );
  });

  it('serializes rgb watermark colors for canvas drawing', () => {
    expect(colorToCss({ r: 24, g: 128, b: 255 }, 0.35)).toBe(
      'rgba(24, 128, 255, 0.35)'
    );
  });
});

describe('logo watermark helpers', () => {
  it('scales the logo by canvas width and keeps its aspect ratio', () => {
    // 200x100 的 Logo,画布 1000 宽,20% → 200x100
    expect(resolveLogoSize(200, 100, 1000, 0.2)).toEqual({
      width: 200,
      height: 100,
    });
    // 竖版 Logo 也要保持比例
    expect(resolveLogoSize(100, 300, 1000, 0.1)).toEqual({
      width: 100,
      height: 300,
    });
  });

  it('clamps the logo scale into a usable range', () => {
    expect(clampLogoScale(0)).toBeGreaterThan(0);
    expect(clampLogoScale(5)).toBe(1);
    expect(clampLogoScale(Number.NaN)).toBe(DEFAULT_LOGO_SCALE);
  });

  it('never produces a zero-sized logo', () => {
    const size = resolveLogoSize(1, 1, 10, 0.02);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });
});

describe('outlineColorFor', () => {
  it('gives light text a dark outline and dark text a light one', () => {
    // 白字压在浅色照片上是最常见的翻车场景,必须配深色描边。
    expect(outlineColorFor({ r: 255, g: 255, b: 255 }, 1)).toContain('rgba(0');
    expect(outlineColorFor({ r: 10, g: 10, b: 10 }, 1)).toContain('rgba(255');
  });

  it('keeps the outline slightly softer than the fill', () => {
    expect(outlineColorFor({ r: 0, g: 0, b: 0 }, 1)).toContain('0.85');
  });
});
