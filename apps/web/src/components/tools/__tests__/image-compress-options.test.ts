import { describe, expect, it } from 'vitest';
import {
  COMPRESS_EXTENSIONS,
  COMPRESS_FORMATS,
  DEFAULT_IMAGE_COMPRESS_OPTIONS,
  MAX_TARGET_SIZE_KB,
  MIN_TARGET_SIZE_KB,
  clampTargetSizeKB,
  toCompressOptions,
  toServerCompressConfig,
  type ImageCompressOptionsState,
} from '../image-compress-options';

function state(
  patch: Partial<ImageCompressOptionsState> = {}
): ImageCompressOptionsState {
  return { ...DEFAULT_IMAGE_COMPRESS_OPTIONS, ...patch };
}

describe('toCompressOptions', () => {
  it('does not cap the output size in quality mode', () => {
    // 回归:曾经 image-client 用 `maxSizeMB ?? 1` 兜底,质量模式下也会被压到 1MB。
    expect(
      toCompressOptions(state({ mode: 'quality' })).maxSizeMB
    ).toBeUndefined();
  });

  it('passes the user quality through in quality mode', () => {
    expect(
      toCompressOptions(state({ mode: 'quality', quality: 100 })).quality
    ).toBe(1);
    expect(
      toCompressOptions(state({ mode: 'quality', quality: 35 })).quality
    ).toBe(0.35);
  });

  it('converts the target size to MB in target-size mode', () => {
    expect(
      toCompressOptions(state({ mode: 'targetSize', targetSizeKB: 512 }))
        .maxSizeMB
    ).toBe(512 / 1024);
  });

  it('ignores the quality slider in target-size mode', () => {
    const options = toCompressOptions(
      state({ mode: 'targetSize', targetSizeKB: 100, quality: 5 })
    );

    // 起点质量必须留出下探空间,否则库直接输出一张远小于目标的图。
    expect(options.quality).toBeGreaterThan(0.5);
  });

  it('clamps out-of-range target sizes', () => {
    expect(clampTargetSizeKB(0)).toBe(MIN_TARGET_SIZE_KB);
    expect(clampTargetSizeKB(-40)).toBe(MIN_TARGET_SIZE_KB);
    expect(clampTargetSizeKB(9_999_999)).toBe(MAX_TARGET_SIZE_KB);
    expect(clampTargetSizeKB(Number.NaN)).toBe(
      DEFAULT_IMAGE_COMPRESS_OPTIONS.targetSizeKB
    );
    expect(
      toCompressOptions(state({ mode: 'targetSize', targetSizeKB: 0 }))
        .maxSizeMB
    ).toBe(MIN_TARGET_SIZE_KB / 1024);
  });

  it('carries the resolved dimensions', () => {
    expect(toCompressOptions(state({ sizePreset: 'desktop' }))).toMatchObject({
      maxWidth: 1920,
      maxHeight: 1080,
    });
    expect(
      toCompressOptions(state({ sizePreset: 'original' })).maxWidth
    ).toBeUndefined();
  });
});

describe('toServerCompressConfig', () => {
  it('maps the output type without a silent fallback', () => {
    expect(
      toServerCompressConfig(state({ outputType: 'image/png' })).format
    ).toBe('png');
    expect(
      toServerCompressConfig(state({ outputType: 'image/webp' })).format
    ).toBe('webp');
    expect(
      toServerCompressConfig(state({ outputType: 'image/jpeg' })).format
    ).toBe('jpeg');
  });

  it('omits maxSizeKB in quality mode', () => {
    expect(
      toServerCompressConfig(state({ mode: 'quality' })).maxSizeKB
    ).toBeUndefined();
  });

  it('sends the clamped target size in target-size mode', () => {
    expect(
      toServerCompressConfig(state({ mode: 'targetSize', targetSizeKB: 200 }))
        .maxSizeKB
    ).toBe(200);
    expect(
      toServerCompressConfig(state({ mode: 'targetSize', targetSizeKB: 1 }))
        .maxSizeKB
    ).toBe(MIN_TARGET_SIZE_KB);
  });

  it('keeps local and server modes on the same target size', () => {
    const value = state({ mode: 'targetSize', targetSizeKB: 300 });
    const local = toCompressOptions(value);
    const server = toServerCompressConfig(value);

    expect((server.maxSizeKB as number) / 1024).toBe(local.maxSizeMB);
  });
});

describe('AVIF output', () => {
  it('offers avif as a compress output format', () => {
    expect(COMPRESS_FORMATS).toContain('image/avif');
  });

  it('maps avif to the server format name', () => {
    expect(
      toServerCompressConfig(state({ outputType: 'image/avif' })).format
    ).toBe('avif');
  });

  it('uses the avif extension', () => {
    expect(COMPRESS_EXTENSIONS['image/avif']).toBe('avif');
  });

  it('maps every supported format without falling back', () => {
    // 回归:convert 页曾用 `formatMap[fmt] ?? 'webp'`,选 AVIF 会静默变成 WebP。
    for (const fmt of COMPRESS_FORMATS) {
      expect(
        toServerCompressConfig(state({ outputType: fmt })).format
      ).toBeDefined();
      expect(COMPRESS_EXTENSIONS[fmt]).toBeTruthy();
    }
  });
});
