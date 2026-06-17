import { describe, expect, it, vi } from 'vitest';

describe('ImageCompare', () => {
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
