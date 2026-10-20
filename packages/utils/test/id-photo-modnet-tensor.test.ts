import { describe, expect, it } from 'bun:test';
import {
  createModNetInputTensor,
  normalizeModNetMatteValues,
} from '../src/id-photo-modnet-tensor';

const norm = (value: number) => (value / 255 - 0.5) / 0.5;

/** 每个像素的 R/G/B 都不同,且三通道互不相等:平面或步长错位一定能被看出来。 */
function rgbAt(index: number): [number, number, number] {
  return [
    (index * 37 + 11) % 256,
    (index * 53 + 101) % 256,
    (index * 71 + 199) % 256,
  ];
}

function makeRgb(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    data.set(rgbAt(i), i * 3);
  }
  return data;
}

function makeRgba(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data.set([...rgbAt(i), 255], i * 4);
  }
  return data;
}

describe('createModNetInputTensor', () => {
  it('produces element-wise identical tensors for RGB and opaque RGBA input', () => {
    const width = 7;
    const height = 5;
    const fromRgb = createModNetInputTensor(
      makeRgb(width, height),
      width,
      height,
      3
    );
    const fromRgba = createModNetInputTensor(
      makeRgba(width, height),
      width,
      height,
      4
    );

    expect(fromRgb).toBeInstanceOf(Float32Array);
    expect(fromRgb.length).toBe(3 * width * height);
    expect(Array.from(fromRgba)).toEqual(Array.from(fromRgb));
  });

  it('writes CHW planes in R, G, B order', () => {
    // 像素 0 = (11, 101, 199):三平面首元素各自对应一个通道。
    const width = 3;
    const height = 2;
    const plane = width * height;
    for (const [pixels, channels] of [
      [makeRgb(width, height), 3],
      [makeRgba(width, height), 4],
    ] as const) {
      const tensor = createModNetInputTensor(pixels, width, height, channels);
      expect(tensor[0]).toBeCloseTo(norm(11), 6);
      expect(tensor[plane]).toBeCloseTo(norm(101), 6);
      expect(tensor[2 * plane]).toBeCloseTo(norm(199), 6);
      // 第二个像素同样按平面排布,而不是交错。
      const [r1, g1, b1] = rgbAt(1);
      expect(tensor[1]).toBeCloseTo(norm(r1), 6);
      expect(tensor[plane + 1]).toBeCloseTo(norm(g1), 6);
      expect(tensor[2 * plane + 1]).toBeCloseTo(norm(b1), 6);
    }
  });

  it('maps 0 and 255 to -1 and 1', () => {
    const tensor = createModNetInputTensor(
      new Uint8Array([0, 255, 0, 255, 0, 255]),
      2,
      1,
      3
    );
    expect(Array.from(tensor)).toEqual([-1, 1, 1, -1, -1, 1]);
  });

  it('defaults to 3 channels', () => {
    const rgb = makeRgb(4, 3);
    expect(Array.from(createModNetInputTensor(rgb, 4, 3))).toEqual(
      Array.from(createModNetInputTensor(rgb, 4, 3, 3))
    );
  });
});

describe('normalizeModNetMatteValues', () => {
  it('scales 0..1 matte values to rounded bytes', () => {
    expect(
      Array.from(normalizeModNetMatteValues(new Float32Array([0, 0.2, 0.5, 1])))
    ).toEqual([0, 51, 128, 255]);
  });

  it('clamps out-of-range values to the byte range', () => {
    expect(
      Array.from(
        normalizeModNetMatteValues(new Float32Array([-1, 2, -0.001, 1.001]))
      )
    ).toEqual([0, 255, 0, 255]);
  });

  it('returns a plain Uint8Array of the same length', () => {
    const bytes = normalizeModNetMatteValues([0.1, 0.9, 0.4]);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(3);
  });
});
