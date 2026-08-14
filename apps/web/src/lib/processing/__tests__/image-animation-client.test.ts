import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildAnimationFrameLayout,
  DEFAULT_IMAGE_ANIMATION_LIMITS,
  findTransparentPaletteIndex,
  getCompressedGifFrameDelayMs,
  getCompressedGifWriterOptions,
  getAnimationFileFormat,
  getAnimationOutputName,
  getImageAnimationEntitlements,
  normalizeAnimationCreateOptions,
  normalizeAnimationCompressOptions,
  patchApngRepeatCount,
  readApngRepeatCount,
  resolveCompressedGifPlan,
  validateAnimationFrameBudget,
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

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const textEncoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    offset,
    value
  );
}

function buildChunk(type: string, data: number[]): Uint8Array {
  const typeBytes = textEncoder.encode(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(
    chunk,
    8 + data.length,
    crc32(chunk.subarray(4, 8 + data.length))
  );
  return chunk;
}

function buildMinimalApng(numPlays: number): Uint8Array {
  const actl = buildChunk('acTL', [0, 0, 0, 2, 0, 0, 0, numPlays]);
  const iend = buildChunk('IEND', []);
  const bytes = new Uint8Array(pngSignature.length + actl.length + iend.length);
  bytes.set(pngSignature, 0);
  bytes.set(actl, pngSignature.length);
  bytes.set(iend, pngSignature.length + actl.length);
  return bytes;
}

function readActlStoredCrc(bytes: Uint8Array): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  ).getUint32(pngSignature.length + 8 + 8);
}

function readActlComputedCrc(bytes: Uint8Array): number {
  const actlTypeAndDataStart = pngSignature.length + 4;
  const actlTypeAndDataEnd = actlTypeAndDataStart + 4 + 8;
  return crc32(bytes.subarray(actlTypeAndDataStart, actlTypeAndDataEnd));
}

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

  it('gives explicit pro preview accounts top-tier animation limits', () => {
    expect(
      getImageAnimationEntitlements({
        user: { id: 'preview', plan: 'pro_preview', role: 'user' },
      })
    ).toMatchObject({
      maxInputFiles: 300,
      maxFileSize: 150 * 1024 * 1024,
      maxFrames: 600,
      maxCanvasPixels: 160_000_000,
      maxTotalFramePixels: 400_000_000,
      maxOutputWidth: 4096,
    });
  });

  it('disables animation controls while account limits are loading', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(app)/image/animation/page.tsx'),
      'utf8'
    );

    expect(source).toContain(
      'const { data: session, isPending: sessionLoading } = authClient.useSession();'
    );
    expect(source).toContain(
      'const controlsDisabled = processing || sessionLoading;'
    );
    expect(source.match(/if \(sessionLoading\) return;/g)).toHaveLength(2);
    expect(source).toContain(
      'const canCompress = Boolean(gifFile) && !controlsDisabled;'
    );
  });

  it('builds stable output names for GIF and APNG', () => {
    expect(getAnimationOutputName('promo-loop', 'gif')).toBe('promo-loop.gif');
    expect(getAnimationOutputName('hero.apng', 'gif')).toBe('hero.gif');
    expect(getAnimationOutputName('', 'apng')).toBe('animated-image.apng');
  });

  it('recognizes APNG content even when browsers report image/png', async () => {
    const apng = new File(
      [buildMinimalApng(0).buffer as ArrayBuffer],
      'jrgjtj-bg.png',
      {
        type: 'image/png',
      }
    );

    await expect(getAnimationFileFormat(apng)).resolves.toBe('apng');
  });

  it('does not treat a static PNG as an APNG input', async () => {
    const png = new File([new Uint8Array(pngSignature).buffer], 'still.png', {
      type: 'image/png',
    });

    await expect(getAnimationFileFormat(png)).resolves.toBeUndefined();
  });

  it('normalizes create options into safe integer bounds', () => {
    expect(
      normalizeAnimationCreateOptions({
        ...baseOptions,
        width: 640.8,
        height: 0,
        frameDelayMs: 7,
        repeat: -3.6,
        quality: 99,
      })
    ).toMatchObject({
      width: 641,
      height: 1,
      frameDelayMs: 20,
      repeat: 0,
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

  it('does not choose a transparent GIF palette index for opaque frames', () => {
    expect(
      findTransparentPaletteIndex([
        [255, 0, 0, 255],
        [0, 255, 0, 255],
      ])
    ).toBeUndefined();

    expect(
      findTransparentPaletteIndex([
        [255, 0, 0, 255],
        [0, 255, 0, 12],
      ])
    ).toBe(1);
  });

  it('keeps transparency available when compressing GIFs', () => {
    expect(getCompressedGifWriterOptions(12)).toEqual({
      repeat: 0,
      quality: 12,
      transparent: true,
    });
  });

  it('keeps APNG total-frame-pixel limits browser safe', () => {
    expect(
      DEFAULT_IMAGE_ANIMATION_LIMITS.free.maxTotalFramePixels
    ).toBeLessThanOrEqual(48_000_000);
    expect(
      DEFAULT_IMAGE_ANIMATION_LIMITS.commercial.maxTotalFramePixels
    ).toBeLessThanOrEqual(160_000_000);
  });

  it('rejects APNG create options above the total frame pixel budget', () => {
    expect(() =>
      validateAnimationFrameBudget(61, 'apng', {
        ...DEFAULT_IMAGE_ANIMATION_LIMITS.free,
        maxCanvasPixels: 16_000_000,
        maxTotalFramePixels: 60 * 16_000_000,
      })
    ).toThrow('Animation has too many total frame pixels for the current plan');
  });

  it('rejects commercial APNG outputs above the total frame pixel budget', () => {
    expect(() =>
      validateAnimationFrameBudget(
        3,
        'apng',
        DEFAULT_IMAGE_ANIMATION_LIMITS.commercial,
        DEFAULT_IMAGE_ANIMATION_LIMITS.commercial.maxCanvasPixels
      )
    ).toThrow('Animation has too many total frame pixels for the current plan');
  });

  it('accumulates skipped GIF frame delays during compression', () => {
    expect(
      getCompressedGifFrameDelayMs(
        [{ delay: 4 }, { delay: 5 }, { delay: 6 }, { delay: 7 }, { delay: 2 }],
        0,
        3,
        8
      )
    ).toBe(150);
  });

  it('reads the APNG acTL repeat count from a byte array', () => {
    expect(readApngRepeatCount(buildMinimalApng(0))).toBe(0);
    expect(readApngRepeatCount(buildMinimalApng(3))).toBe(3);
  });

  it('patches APNG acTL repeat count and updates the chunk CRC', () => {
    const bytes = buildMinimalApng(0);
    const originalCrc = readActlStoredCrc(bytes);
    const patched = patchApngRepeatCount(bytes, 5);

    expect(patched).not.toBe(bytes);
    expect(readApngRepeatCount(patched)).toBe(5);
    expect(readActlStoredCrc(patched)).not.toBe(originalCrc);
    expect(readActlStoredCrc(patched)).toBe(readActlComputedCrc(patched));
  });

  it('keeps APNG repeat count infinite when repeat is zero', () => {
    const patched = patchApngRepeatCount(buildMinimalApng(4), 0);

    expect(readApngRepeatCount(patched)).toBe(0);
    expect(readActlStoredCrc(patched)).toBe(readActlComputedCrc(patched));
  });
});
