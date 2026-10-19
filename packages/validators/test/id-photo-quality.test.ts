import { describe, expect, it } from 'bun:test';
import { inspectIdPhoto } from '../src/id-photo-quality';
import type { FaceDetection } from '../src/id-photo-layout';

function solidImage(
  width: number,
  height: number,
  gray: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 3);
  out.fill(gray);
  return out;
}

/**
 * 确定性纹理图。纯色图的 Laplacian 方差恒为 0，不可能代表「清晰的好照片」，
 * 因此需要一个有真实高频细节的输入。
 *
 * 不能使用逐像素棋盘：降采样 step=2 且图像宽度为偶数时，采样点会全部落在
 * 同一种颜色上，Laplacian 方差退化为 0。这里用逐像素哈希保证降采样后仍有
 * 高频变化。
 */
function texturedImage(width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let h = (x * 374761393 + y * 668265263) >>> 0;
      h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
      const value = h & 0xff;
      const p = (y * width + x) * 3;
      out[p] = value;
      out[p + 1] = value;
      out[p + 2] = value;
    }
  }
  return out;
}

function centeredFace(
  width: number,
  height: number,
  faceWidthRatio: number,
  tilt = 0
): FaceDetection {
  const size = width * faceWidthRatio;
  const x = (width - size) / 2;
  const y = height * 0.15;
  const cy = y + size / 2;
  const dx = size * 0.2;
  const dy = Math.tan((tilt * Math.PI) / 180) * dx;
  return {
    box: { x, y, width: size, height: size },
    landmarks: [
      [width / 2 - dx, cy - dy],
      [width / 2 + dx, cy + dy],
      [width / 2, cy + size * 0.1],
      [width / 2 - dx * 0.5, cy + size * 0.3],
      [width / 2 + dx * 0.5, cy + size * 0.3],
    ],
    score: 0.9,
  };
}

describe('inspectIdPhoto', () => {
  it('reports eight items and full score for a well-formed photo', () => {
    const width = 295;
    const height = 413;
    const alpha = new Uint8ClampedArray(width * height);
    alpha.fill(255);
    const report = inspectIdPhoto({
      rgb: texturedImage(width, height),
      width,
      height,
      face: centeredFace(width, height, 0.35),
      faceCount: 1,
      alpha,
    });

    expect(report.items.length).toBe(8);
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
  });

  it('fails the face-count item when no face is found', () => {
    const width = 295;
    const height = 413;
    const report = inspectIdPhoto({
      rgb: solidImage(width, height, 128),
      width,
      height,
      face: null,
      faceCount: 0,
    });

    const item = report.items.find(i => i.name === 'faceCount')!;
    expect(item.passed).toBe(false);
    expect(report.passed).toBe(false);
  });

  it('flags a face that is too small', () => {
    const width = 295;
    const height = 413;
    const report = inspectIdPhoto({
      rgb: solidImage(width, height, 128),
      width,
      height,
      face: centeredFace(width, height, 0.15),
      faceCount: 1,
    });

    expect(report.items.find(i => i.name === 'faceRatio')!.passed).toBe(false);
  });

  it('flags an over-tilted eye line', () => {
    const width = 295;
    const height = 413;
    const report = inspectIdPhoto({
      rgb: solidImage(width, height, 128),
      width,
      height,
      face: centeredFace(width, height, 0.35, 12),
      faceCount: 1,
    });

    expect(report.items.find(i => i.name === 'eyeTilt')!.passed).toBe(false);
  });

  it('flags a severely underexposed photo', () => {
    const width = 295;
    const height = 413;
    const report = inspectIdPhoto({
      rgb: solidImage(width, height, 5),
      width,
      height,
      face: centeredFace(width, height, 0.35),
      faceCount: 1,
    });

    expect(report.items.find(i => i.name === 'exposure')!.passed).toBe(false);
  });

  it('flags a matte with too many translucent pixels', () => {
    const width = 10;
    const height = 10;
    const alpha = new Uint8ClampedArray(width * height);
    alpha.fill(128);
    const report = inspectIdPhoto({
      rgb: solidImage(width, height, 128),
      width,
      height,
      face: null,
      faceCount: 1,
      alpha,
    });

    expect(report.items.find(i => i.name === 'matteEdge')!.passed).toBe(false);
  });

  it('omits the matte item when no alpha is supplied', () => {
    const report = inspectIdPhoto({
      rgb: solidImage(295, 413, 128),
      width: 295,
      height: 413,
      face: centeredFace(295, 413, 0.35),
      faceCount: 1,
    });

    expect(report.items.find(i => i.name === 'matteEdge')).toBeUndefined();
  });

  it('flags a fully transparent matte instead of treating it as clean', () => {
    const width = 10;
    const height = 10;
    const alpha = new Uint8ClampedArray(width * height);
    const report = inspectIdPhoto({
      rgb: solidImage(width, height, 128),
      width,
      height,
      face: null,
      faceCount: 1,
      alpha,
    });

    expect(report.items.find(i => i.name === 'matteEdge')!.passed).toBe(false);
  });

  it('reads the alpha channel from interleaved RGBA input', () => {
    const width = 10;
    const height = 10;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      rgba[i * 4] = 128;
      rgba[i * 4 + 1] = 128;
      rgba[i * 4 + 2] = 128;
      rgba[i * 4 + 3] = 255;
    }
    const report = inspectIdPhoto({
      rgb: solidImage(width, height, 128),
      width,
      height,
      face: null,
      faceCount: 1,
      alpha: rgba,
    });

    expect(report.items.find(i => i.name === 'matteEdge')!.passed).toBe(true);
  });

  it('handles alpha buffers whose length does not match the image size', () => {
    const width = 10;
    const height = 10;
    const alpha = new Uint8ClampedArray(50);
    alpha.fill(128);
    const report = inspectIdPhoto({
      rgb: solidImage(width, height, 128),
      width,
      height,
      face: null,
      faceCount: 1,
      alpha,
    });

    expect(report.items.find(i => i.name === 'matteEdge')!.passed).toBe(false);
  });

  it('keeps Laplacian sampling in bounds for large non-square images', () => {
    const width = 900;
    const height = 700;
    const report = inspectIdPhoto({
      rgb: texturedImage(width, height),
      width,
      height,
      face: centeredFace(width, height, 0.35),
      faceCount: 1,
    });

    expect(report.items.find(i => i.name === 'sharpness')!.passed).toBe(true);
  });
});
