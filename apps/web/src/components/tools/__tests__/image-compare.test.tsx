import { describe, expect, it, vi } from 'vitest';

describe('ImageCompare', () => {
  it('sizes the comparison frame from the original image ratio', async () => {
    const { getImageCompareFrameStyle } = await import('../image-compare');

    expect(getImageCompareFrameStyle(4 / 3)).toMatchObject({
      aspectRatio: 4 / 3,
      width: '100%',
      maxWidth: '640px',
    });
  });

  it('does not evaluate the browser-only compare slider during module import', async () => {
    vi.resetModules();
    vi.doMock('react-compare-slider', () => {
      throw new TypeError('CSS.registerProperty is not a function');
    });

    await expect(import('../image-compare')).resolves.toHaveProperty(
      'ImageCompare'
    );

    vi.doUnmock('react-compare-slider');
  });
});
