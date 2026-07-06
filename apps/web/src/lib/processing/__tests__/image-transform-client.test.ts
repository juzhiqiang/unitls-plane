import { describe, expect, it } from 'vitest';
import {
  getTransformedSize,
  normalizeImageTransform,
  rotateClockwise,
} from '../image-transform-client';

describe('image transform helpers', () => {
  it('normalizes partial transform options with safe defaults', () => {
    expect(normalizeImageTransform({ rotate: 450 })).toEqual({
      autoOrient: true,
      rotate: 90,
      flipHorizontal: false,
      flipVertical: false,
    });
  });

  it('wraps clockwise rotation back to zero after four turns', () => {
    expect(rotateClockwise(270)).toBe(0);
  });

  it('swaps output dimensions for quarter-turn rotations', () => {
    expect(getTransformedSize(120, 80, { rotate: 90 })).toEqual({
      width: 80,
      height: 120,
    });
  });
});
