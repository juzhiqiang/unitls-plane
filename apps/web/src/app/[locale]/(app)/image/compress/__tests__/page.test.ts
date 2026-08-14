import { describe, expect, it } from 'vitest';
import { getImageCompressionIndices } from '../page';

describe('image compression page helpers', () => {
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
