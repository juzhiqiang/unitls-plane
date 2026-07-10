import { describe, expect, it } from 'vitest';
import {
  buildAnimationFrameLayout,
  DEFAULT_IMAGE_ANIMATION_LIMITS,
  getAnimationOutputName,
  getImageAnimationEntitlements,
  normalizeAnimationCreateOptions,
  normalizeAnimationCompressOptions,
  resolveCompressedGifPlan,
  validateAnimationInputs,
  type AnimationCreateOptions,
} from '../image-animation-client';

const baseOptions: AnimationCreateOptions = {
  outputFormat: 'gif',
  width: 640,
  height: 360,
  fit: 'contain',
  background: '#ffffff',
  frameDelayMs: 160,
  repeat: 0,
  quality: 12,
  filename: 'promo-loop',
};

describe('image animation client helpers', () => {
  it('gives logged-in users commercial APNG and advanced compression flags', () => {
    expect(getImageAnimationEntitlements(null)).toMatchObject({
      isLoggedIn: false,
      isCommercial: false,
      canExportGif: true,
      canExportApng: false,
      canUseAdvancedCompression: false,
    });

    expect(getImageAnimationEntitlements({ user: { id: 'u1' } })).toMatchObject(
      {
        isLoggedIn: true,
        isCommercial: true,
        canExportGif: true,
        canExportApng: true,
        canUseAdvancedCompression: true,
      }
    );
  });

  it('builds stable output names for GIF and APNG', () => {
    expect(getAnimationOutputName('promo-loop', 'gif')).toBe('promo-loop.gif');
    expect(getAnimationOutputName('hero.apng', 'gif')).toBe('hero.gif');
    expect(getAnimationOutputName('', 'apng')).toBe('animated-image.apng');
  });

  it('normalizes create options into safe integer bounds', () => {
    expect(
      normalizeAnimationCreateOptions({
        ...baseOptions,
        width: 640.8,
        height: 0,
        frameDelayMs: 7,
        quality: 99,
      })
    ).toMatchObject({
      width: 641,
      height: 1,
      frameDelayMs: 20,
      quality: 30,
    });
  });

  it('normalizes compression options into safe values', () => {
    expect(
      normalizeAnimationCompressOptions({
        targetWidth: 800.4,
        targetFps: 99,
        quality: 0,
        filename: 'compressed',
      })
    ).toMatchObject({
      targetWidth: 800,
      targetFps: 30,
      quality: 1,
      filename: 'compressed',
    });
  });

  it('rejects free users above count and pixel limits', () => {
    const files = Array.from(
      { length: DEFAULT_IMAGE_ANIMATION_LIMITS.free.maxInputFiles + 1 },
      (_, index) => new File(['x'], `f-${index}.png`, { type: 'image/png' })
    );

    expect(() =>
      validateAnimationInputs(
        files,
        baseOptions,
        DEFAULT_IMAGE_ANIMATION_LIMITS.free
      )
    ).toThrow('Too many frames for the current plan');

    expect(() =>
      validateAnimationInputs(
        [
          new File(['x'], 'a.png', { type: 'image/png' }),
          new File(['x'], 'b.png', { type: 'image/png' }),
        ],
        { ...baseOptions, width: 10000, height: 10000 },
        DEFAULT_IMAGE_ANIMATION_LIMITS.free
      )
    ).toThrow('Canvas is too large for the current plan');
  });

  it('centers contained frames inside the target animation canvas', () => {
    expect(
      buildAnimationFrameLayout(
        { width: 1000, height: 500 },
        { ...baseOptions, width: 500, height: 500, fit: 'contain' }
      )
    ).toEqual({ x: 0, y: 125, width: 500, height: 250 });
  });

  it('crops cover frames to fill the target animation canvas', () => {
    expect(
      buildAnimationFrameLayout(
        { width: 1000, height: 500 },
        { ...baseOptions, width: 500, height: 500, fit: 'cover' }
      )
    ).toEqual({ x: -250, y: 0, width: 1000, height: 500 });
  });

  it('keeps compressed GIF dimensions proportional to the requested width', () => {
    expect(
      resolveCompressedGifPlan(
        { width: 800, height: 400, frameCount: 20 },
        { targetWidth: 400, targetFps: 12, quality: 10, filename: 'small' },
        DEFAULT_IMAGE_ANIMATION_LIMITS.free
      )
    ).toMatchObject({ width: 400, height: 200, targetFps: 12 });
  });
});
