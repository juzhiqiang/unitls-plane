import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_IMAGE_STITCH_LIMITS,
  buildImageStitchLayout,
  getImageStitchEntitlements,
  getStitchOutputName,
  stitchImages,
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

  it('rejects too many files before decoding images', async () => {
    let decodeAttempted = false;
    vi.stubGlobal(
      'Image',
      class {
        constructor() {
          decodeAttempted = true;
          throw new Error('Image decoding started');
        }
      }
    );

    try {
      const files = [
        new File(['first'], 'first.png', { type: 'image/png' }),
        new File(['second'], 'second.png', { type: 'image/png' }),
      ];

      await expect(
        stitchImages(
          files,
          {
            width: 500,
            gap: 0,
            background: '#ffffff',
            outputType: 'image/png',
            quality: 0.92,
            filename: 'too-many',
          },
          { maxFiles: 1, maxFileSize: 1024, maxCanvasPixels: 1_000_000 }
        )
      ).rejects.toThrow('Too many files for the current plan');
      expect(decodeAttempted).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects oversized files before decoding images', async () => {
    let decodeAttempted = false;
    vi.stubGlobal(
      'Image',
      class {
        constructor() {
          decodeAttempted = true;
          throw new Error('Image decoding started');
        }
      }
    );

    try {
      const files = [
        new File([new Uint8Array(2)], 'large.png', { type: 'image/png' }),
      ];

      await expect(
        stitchImages(
          files,
          {
            width: 500,
            gap: 0,
            background: '#ffffff',
            outputType: 'image/png',
            quality: 0.92,
            filename: 'too-large',
          },
          { maxFiles: 1, maxFileSize: 1, maxCanvasPixels: 1_000_000 }
        )
      ).rejects.toThrow('File is too large for the current plan');
      expect(decodeAttempted).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
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

  it('gives explicit pro preview accounts top-tier stitch limits', () => {
    expect(
      getImageStitchEntitlements({
        user: { id: 'preview', plan: 'pro_preview', role: 'user' },
      })
    ).toMatchObject({
      maxFiles: 200,
      maxFileSize: 150 * 1024 * 1024,
      maxCanvasPixels: 240_000_000,
    });
  });

  it('disables stitch controls while account limits are loading', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(app)/image/stitch/page.tsx'),
      'utf8'
    );

    expect(source).toContain(
      'const { data: session, isPending: sessionLoading } = authClient.useSession();'
    );
    expect(source).toContain(
      'const controlsDisabled = processing || sessionLoading;'
    );
    expect(source).toContain('if (sessionLoading) return;');
    expect(source).toContain(
      'const canGenerate = files.length >= 2 && !controlsDisabled;'
    );
  });
});
