import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_COMPRESS_OPTIONS } from '@/components/tools/image-compress-options';
import { getImageCompressionIndices } from '../image-compress-utils';

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
});
