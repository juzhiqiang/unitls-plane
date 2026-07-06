import { describe, expect, it } from 'vitest';
import { colorToCss, getWatermarkedImageName } from '../image-watermark-client';

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
