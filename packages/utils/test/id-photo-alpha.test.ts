import { describe, expect, it } from 'bun:test';
import {
  PORTRAIT_ALPHA_BLACK_POINT,
  PORTRAIT_ALPHA_GAMMA,
  PORTRAIT_ALPHA_WHITE_POINT,
  refinePortraitAlphaBytes,
} from '../src/id-photo-alpha';

describe('refinePortraitAlphaBytes', () => {
  it('exposes the shared black/white points and gamma', () => {
    expect(PORTRAIT_ALPHA_BLACK_POINT).toBe(72);
    expect(PORTRAIT_ALPHA_WHITE_POINT).toBe(144);
    expect(PORTRAIT_ALPHA_GAMMA).toBe(0.55);
  });

  it('maps values at or below the black point to 0', () => {
    const refined = refinePortraitAlphaBytes(
      new Uint8Array([0, 1, 48, 71, PORTRAIT_ALPHA_BLACK_POINT])
    );

    expect([...refined]).toEqual([0, 0, 0, 0, 0]);
  });

  it('maps values at or above the white point to 255', () => {
    const refined = refinePortraitAlphaBytes(
      new Uint8Array([
        PORTRAIT_ALPHA_WHITE_POINT,
        PORTRAIT_ALPHA_WHITE_POINT + 1,
        200,
        255,
      ])
    );

    expect([...refined]).toEqual([255, 255, 255, 255]);
  });

  it('applies the gamma curve between the black and white points', () => {
    const refined = refinePortraitAlphaBytes(
      new Uint8Array([73, 96, 108, 120, 128, 143])
    );

    // normalized = (value - 72) / 72; output = round(normalized ** 0.55 * 255)
    expect([...refined]).toEqual([24, 139, 174, 204, 222, 253]);
  });

  it('accepts Uint8ClampedArray without mutating the input', () => {
    const input = new Uint8ClampedArray([72, 108, 144]);
    const refined = refinePortraitAlphaBytes(input);

    expect([...refined]).toEqual([0, 174, 255]);
    expect([...input]).toEqual([72, 108, 144]);
  });

  it('returns an empty array for empty input', () => {
    const refined = refinePortraitAlphaBytes(new Uint8Array(0));

    expect(refined).toBeInstanceOf(Uint8Array);
    expect(refined.length).toBe(0);
  });
});
