import { describe, expect, it } from 'bun:test';
import { computeForegroundMeanBrightness } from '../src/id-photo-brightness';

function rgba(pixels: Array<[number, number, number, number]>) {
  const out = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  });
  return out;
}

describe('computeForegroundMeanBrightness', () => {
  it('averages the RGB channels of foreground pixels', () => {
    const data = rgba([
      [30, 60, 90, 255],
      [120, 120, 120, 128],
    ]);

    expect(computeForegroundMeanBrightness(data, 2, 1)).toBeCloseTo(
      (60 + 120) / 2,
      6
    );
  });

  it('ignores fully transparent pixels so a large empty background cannot pull the mean down', () => {
    const data = rgba([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [200, 100, 60, 255],
      [0, 0, 0, 0],
    ]);

    // 只有 (200+100+60)/3 = 120 参与；若把 alpha=0 的 0 也算进去会得到 30。
    expect(computeForegroundMeanBrightness(data, 4, 1)).toBeCloseTo(120, 6);
  });

  it('counts any partially transparent pixel as foreground', () => {
    const data = rgba([
      [90, 90, 90, 1],
      [0, 0, 0, 0],
    ]);

    expect(computeForegroundMeanBrightness(data, 2, 1)).toBeCloseTo(90, 6);
  });

  it('returns 0 when there is no foreground', () => {
    const data = rgba([
      [255, 255, 255, 0],
      [10, 20, 30, 0],
    ]);

    expect(computeForegroundMeanBrightness(data, 2, 1)).toBe(0);
  });

  it('returns 0 for invalid dimensions', () => {
    const data = rgba([[10, 10, 10, 255]]);

    expect(computeForegroundMeanBrightness(data, 0, 1)).toBe(0);
    expect(computeForegroundMeanBrightness(data, Number.NaN, 1)).toBe(0);
  });

  it('is deterministic for identical cropped foreground input, so both ends agree', () => {
    // 两端在裁剪后的 295×413 成片上调用同一个函数；相同输入必须给出逐位相同的均值。
    const width = 295;
    const height = 413;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      const a = i % 3 === 0 ? 0 : 255;
      data[i * 4] = (i * 7) % 256;
      data[i * 4 + 1] = (i * 11) % 256;
      data[i * 4 + 2] = (i * 13) % 256;
      data[i * 4 + 3] = a;
    }

    expect(computeForegroundMeanBrightness(data, width, height)).toBe(
      computeForegroundMeanBrightness(data.slice(), width, height)
    );
  });
});
