import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_COMPRESS_OPTIONS } from '@/components/tools/image-compress-options';
import {
  getImageCompressionIndices,
  getImageCompressionMaxFileSize,
} from '../image-compress-utils';

describe('image compression page helpers', () => {
  it('uses the original image dimensions by default', () => {
    expect(DEFAULT_IMAGE_COMPRESS_OPTIONS.sizePreset).toBe('original');
  });

  it('includes completed files when compression is started again', () => {
    const original = new File(['original'], 'photo.jpg', {
      type: 'image/jpeg',
    });
    const result = new File(['compressed'], 'compressed-photo.jpg', {
      type: 'image/jpeg',
    });

    expect(
      getImageCompressionIndices([{ file: original, result, status: 'done' }])
    ).toEqual([0]);
  });

  it('uses the current account limit for local and server compression', () => {
    expect(getImageCompressionMaxFileSize(null)).toBe(10 * 1024 * 1024);
    expect(
      getImageCompressionMaxFileSize({
        user: { id: 'signed-in', plan: 'free', role: 'user' },
      })
    ).toBe(50 * 1024 * 1024);
    expect(
      getImageCompressionMaxFileSize({
        user: { id: 'preview', plan: 'pro_preview', role: 'user' },
      })
    ).toBe(250 * 1024 * 1024);
    expect(
      getImageCompressionMaxFileSize({
        user: { id: 'pro', plan: 'pro', role: 'user' },
      })
    ).toBe(100 * 1024 * 1024);
    expect(
      getImageCompressionMaxFileSize({
        user: { id: 'team', plan: 'team', role: 'user' },
      })
    ).toBe(150 * 1024 * 1024);
    expect(
      getImageCompressionMaxFileSize({
        user: { id: 'private', plan: 'private', role: 'user' },
      })
    ).toBe(250 * 1024 * 1024);
  });

  it('passes the dynamic account limit to the upload control', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(app)/image/compress/page.tsx'),
      'utf8'
    );

    expect(source).toContain('maxSize={maxFileSize}');
    expect(source).not.toContain('maxSize={50 * 1024 * 1024}');
    expect(source).toContain(
      'items.some(item => item.file.size > maxFileSize)'
    );
    expect(source).toContain("t('fileTooLargeForPlan'");
  });

  it('disables compression controls while account limits are loading', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(app)/image/compress/page.tsx'),
      'utf8'
    );

    expect(source).toContain(
      'const controlsDisabled = processing || sessionLoading;'
    );
    expect(source).toContain(
      'if (sessionLoading || items.length === 0) return;'
    );
    expect(source.match(/disabled=\{controlsDisabled\}/g)).toHaveLength(5);
  });
});
