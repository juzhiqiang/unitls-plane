import { describe, expect, it } from 'bun:test';
import { estimateSourceBackgroundColors } from '../src/id-photo-background';

function makeImage(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number]
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 3;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
    }
  }
  return out;
}

describe('estimateSourceBackgroundColors', () => {
  it('returns the dominant solid background color', () => {
    const rgb = makeImage(200, 260, (x, y) =>
      y < 60 ? [67, 142, 219] : [200, 170, 150]
    );
    const colors = estimateSourceBackgroundColors(rgb, 200, 260);
    expect(colors.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(colors[0]!.r - 67)).toBeLessThan(20);
    expect(Math.abs(colors[0]!.g - 142)).toBeLessThan(20);
    expect(Math.abs(colors[0]!.b - 219)).toBeLessThan(20);
  });

  it('returns at most four candidates', () => {
    const rgb = makeImage(200, 260, (x, y) => [
      (x * 7) % 256,
      (y * 11) % 256,
      ((x + y) * 5) % 256,
    ]);
    const colors = estimateSourceBackgroundColors(rgb, 200, 260);
    expect(colors.length).toBeLessThanOrEqual(4);
    expect(colors.length).toBeGreaterThanOrEqual(1);
  });

  it('handles a tiny image without throwing', () => {
    const rgb = makeImage(2, 2, () => [10, 20, 30]);
    const colors = estimateSourceBackgroundColors(rgb, 2, 2);
    expect(colors.length).toBeGreaterThanOrEqual(1);
  });
});
