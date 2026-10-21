import { describe, expect, it } from 'bun:test';
import {
  INF,
  approximateDistanceTransform,
  decontaminateIdPhotoForeground,
} from '../src/id-photo-decontaminate';

const BG = { r: 67, g: 142, b: 219 };

function buildEdgeRow(
  edge: [number, number, number, number],
  foreground: [number, number, number, number]
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(3 * 4);
  rgba.set(foreground, 0);
  rgba.set(edge, 4);
  rgba.set(foreground, 8);
  return rgba;
}

function bruteForceDistance(fg: Uint8Array, width: number, height: number) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let best = Infinity;
      for (let j = 0; j < height; j += 1) {
        for (let i = 0; i < width; i += 1) {
          if (!fg[j * width + i]) continue;
          const d = Math.hypot(x - i, y - j);
          if (d < best) best = d;
        }
      }
      out[y * width + x] = best;
    }
  }
  return out;
}

describe('approximateDistanceTransform', () => {
  it('matches brute-force nearest-foreground distance on a tiny image', () => {
    const width = 8;
    const height = 8;
    const fg = new Uint8Array(width * height);
    fg[1 * width + 1] = 1;
    fg[5 * width + 6] = 1;

    const { distance } = approximateDistanceTransform(fg, width, height);
    const expected = bruteForceDistance(fg, width, height);

    for (let i = 0; i < distance.length; i += 1) {
      expect(Math.abs(distance[i]! - expected[i]!)).toBeLessThan(1.5);
    }
  });

  it('labels every pixel with a foreground index', () => {
    const width = 4;
    const height = 4;
    const fg = new Uint8Array(width * height);
    fg[0] = 1;

    const { label } = approximateDistanceTransform(fg, width, height);
    for (let i = 0; i < label.length; i += 1) {
      expect(label[i]).toBe(0);
    }
  });

  it('reports unreachable distance and label -1 when there is no foreground', () => {
    const width = 4;
    const height = 3;
    const fg = new Uint8Array(width * height);

    const { distance, label } = approximateDistanceTransform(fg, width, height);

    for (let i = 0; i < distance.length; i += 1) {
      // 哨兵必须是真正可比较的 Infinity，Float32Array 能原样保留它。
      expect(distance[i]).toBe(INF);
      expect(Number.isFinite(distance[i]!)).toBe(false);
      expect(label[i]).toBe(-1);
    }
  });
});

describe('decontaminateIdPhotoForeground', () => {
  it('recovers true foreground color from a 50% alpha blue-background pixel', () => {
    // 真实前景是纯白 (255,255,255)，叠在蓝底 (67,142,219) 上取 alpha=0.5
    const bg = { r: 67, g: 142, b: 219 };
    const alpha = 0.5;
    const observed = {
      r: Math.round(255 * alpha + bg.r * (1 - alpha)),
      g: Math.round(255 * alpha + bg.g * (1 - alpha)),
      b: Math.round(255 * alpha + bg.b * (1 - alpha)),
    };

    const width = 3;
    const height = 1;
    const rgba = new Uint8ClampedArray(width * height * 4);
    // 中心是半透明边缘像素，左右是完全不透明的白色前景
    for (const i of [0, 2]) {
      rgba[i * 4] = 255;
      rgba[i * 4 + 1] = 255;
      rgba[i * 4 + 2] = 255;
      rgba[i * 4 + 3] = 255;
    }
    rgba[1 * 4] = observed.r;
    rgba[1 * 4 + 1] = observed.g;
    rgba[1 * 4 + 2] = observed.b;
    rgba[1 * 4 + 3] = Math.round(alpha * 255);

    const out = decontaminateIdPhotoForeground(rgba, width, height, bg);

    // 反预乘后应显著远离底色，朝纯白靠拢
    expect(out[1 * 4]!).toBeGreaterThan(200);
    expect(out[1 * 4 + 1]!).toBeGreaterThan(200);
    expect(out[1 * 4 + 2]!).toBeGreaterThan(180);
  });

  it('leaves fully transparent and fully opaque pixels untouched in color', () => {
    const bg = { r: 0, g: 0, b: 0 };
    const rgba = new Uint8ClampedArray([10, 20, 30, 0, 200, 100, 50, 255]);
    const out = decontaminateIdPhotoForeground(rgba, 2, 1, bg);
    expect(Array.from(out.slice(0, 4))).toEqual([10, 20, 30, 0]);
    expect(Array.from(out.slice(4, 8))).toEqual([200, 100, 50, 255]);
  });

  it('suppresses alpha of a semi-transparent edge pixel whose color matches the background', () => {
    // 边缘像素 alpha=128 且 RGB 就等于背景色，可判定其 alpha 被底色撑起。
    const rgba = buildEdgeRow([BG.r, BG.g, BG.b, 128], [255, 255, 255, 255]);

    const out = decontaminateIdPhotoForeground(rgba, 3, 1, BG);

    expect(out[7]!).toBeLessThan(128);
  });

  it('keeps alpha of a semi-transparent edge pixel whose color is far from the background', () => {
    // alpha=128，但真实前景是纯红，与蓝色背景差异极大，alpha 应予保留。
    const rgba = buildEdgeRow([255, 0, 0, 128], [255, 255, 255, 255]);

    const out = decontaminateIdPhotoForeground(rgba, 3, 1, BG);

    expect(out[7]!).toBe(128);
  });

  it('replaces background-colored edge RGB with the nearest opaque foreground color', () => {
    // 边缘像素 RGB 就是原背景蓝，左右是完全不透明的前景红。
    const rgba = buildEdgeRow([BG.r, BG.g, BG.b, 128], [255, 0, 0, 255]);

    const out = decontaminateIdPhotoForeground(rgba, 3, 1, BG);

    // 处理后应明显向红色靠拢，而不再停留在背景蓝。
    expect(out[4]!).toBeGreaterThan(150);
    expect(out[6]!).toBeLessThan(100);
    expect(Array.from(out.slice(4, 7))).not.toEqual([BG.r, BG.g, BG.b]);
  });

  it('returns a new array and leaves the input untouched', () => {
    const rgba = buildEdgeRow([BG.r, BG.g, BG.b, 128], [255, 0, 0, 255]);
    const snapshot = Array.from(rgba);

    const out = decontaminateIdPhotoForeground(rgba, 3, 1, BG);

    expect(out).not.toBe(rgba);
    expect(Array.from(rgba)).toEqual(snapshot);
    expect(Array.from(out)).not.toEqual(snapshot);
  });
});
