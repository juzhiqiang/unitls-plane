import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_STITCH_LIMITS,
  buildImageStitchLayout,
  getImageStitchEntitlements,
  getStitchOutputName,
  validateImageStitchLayout,
  type ImageStitchSource,
} from '../image-stitch-client';

const sources: ImageStitchSource[] = [
  { width: 1000, height: 500 },
  { width: 500, height: 1000 },
];

describe('image stitch client helpers', () => {
  it('scales every image to the target width and sums vertical height with gaps', () => {
    const layout = buildImageStitchLayout(sources, {
      width: 500,
      gap: 10,
      background: '#ffffff',
      outputType: 'image/png',
      quality: 0.92,
      filename: 'details',
    });

    expect(layout.width).toBe(500);
    expect(layout.height).toBe(1260);
    expect(layout.items).toEqual([
      { sourceIndex: 0, x: 0, y: 0, width: 500, height: 250 },
      { sourceIndex: 1, x: 0, y: 260, width: 500, height: 1000 },
    ]);
  });

  it('uses a white background when exporting transparent settings to jpeg', () => {
    const layout = buildImageStitchLayout(sources, {
      width: 500,
      gap: 0,
      background: 'transparent',
      outputType: 'image/jpeg',
      quality: 0.86,
      filename: 'details',
    });

    expect(layout.background).toBe('#ffffff');
  });

  it('builds stable output names from the requested format', () => {
    expect(getStitchOutputName('launch-page', 'image/jpeg')).toBe(
      'launch-page.jpg'
    );
    expect(getStitchOutputName('', 'image/webp')).toBe(
      'stitched-long-image.webp'
    );
  });

  it('rejects layouts above the current entitlement pixel limit', () => {
    const layout = buildImageStitchLayout([{ width: 1, height: 1 }], {
      width: 20000,
      gap: 0,
      background: '#ffffff',
      outputType: 'image/png',
      quality: 0.92,
      filename: 'too-large',
    });

    expect(() =>
      validateImageStitchLayout(layout, {
        ...DEFAULT_IMAGE_STITCH_LIMITS.free,
        maxCanvasPixels: 1000,
      })
    ).toThrow('Canvas is too large for the current plan');
  });

  it('gives logged-in users commercial feature flags and higher limits', () => {
    expect(getImageStitchEntitlements(null)).toMatchObject({
      isLoggedIn: false,
      canBatchExport: false,
      canUseBrandFooter: false,
    });

    expect(getImageStitchEntitlements({ user: { id: 'u1' } })).toMatchObject({
      isLoggedIn: true,
      canBatchExport: true,
      canUseBrandFooter: true,
    });
  });
});
