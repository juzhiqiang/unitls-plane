import { describe, expect, it } from 'bun:test';
import {
  eyeTiltDegrees,
  idPhotoCropFromLayout,
  suggestIdPhotoLayout,
  type FaceDetection,
} from '../src/id-photo-layout';
import { resolveIdPhotoCropBox } from '../src/id-photo';

function faceAt(x: number, y: number, size: number, tilt = 0): FaceDetection {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const eyeY = cy + Math.tan((tilt * Math.PI) / 180) * (size * 0.2);
  return {
    box: { x, y, width: size, height: size },
    landmarks: [
      [cx - size * 0.2, eyeY],
      [cx + size * 0.2, eyeY],
      [cx, cy + size * 0.1],
      [cx - size * 0.1, cy + size * 0.25],
      [cx + size * 0.1, cy + size * 0.25],
    ],
    score: 0.95,
  };
}

describe('eyeTiltDegrees', () => {
  it('returns 0 for level eyes', () => {
    expect(
      Math.abs(
        eyeTiltDegrees([
          [0, 10],
          [20, 10],
        ])
      )
    ).toBeLessThan(0.001);
  });

  it('returns positive angle when right eye is lower', () => {
    expect(
      eyeTiltDegrees([
        [0, 0],
        [20, 5],
      ])
    ).toBeGreaterThan(13);
  });
});

describe('suggestIdPhotoLayout', () => {
  it('returns null without a face', () => {
    expect(
      suggestIdPhotoLayout(null, { width: 1000, height: 1400 }, 295 / 413)
    ).toBeNull();
  });

  it('zooms so the face occupies roughly 35% of the crop width', () => {
    const source = { width: 1200, height: 1600 };
    const face = faceAt(500, 400, 240);
    const layout = suggestIdPhotoLayout(face, source, 295 / 413);
    expect(layout).not.toBeNull();
    expect(layout!.faceRatio).toBeGreaterThan(0.28);
    expect(layout!.faceRatio).toBeLessThan(0.45);
  });

  it('keeps every output field inside the documented ranges', () => {
    const source = { width: 1200, height: 1600 };
    const layout = suggestIdPhotoLayout(
      faceAt(100, 100, 900, 8),
      source,
      295 / 413
    )!;
    expect(layout.zoom).toBeGreaterThanOrEqual(90);
    expect(layout.zoom).toBeLessThanOrEqual(145);
    expect(Math.abs(layout.offsetX)).toBeLessThanOrEqual(20);
    expect(Math.abs(layout.offsetY)).toBeLessThanOrEqual(20);
    expect(Math.abs(layout.rotation)).toBeLessThanOrEqual(5);
    expect(layout.headroom).toBeGreaterThanOrEqual(0);
  });

  it('prefers the segmentation crown over the face-box estimate', () => {
    const source = { width: 1200, height: 1600 };
    const face = faceAt(500, 400, 240);
    const withCrown = suggestIdPhotoLayout(face, source, 295 / 413, 200)!;
    const withoutCrown = suggestIdPhotoLayout(face, source, 295 / 413)!;
    expect(withCrown.headroom).toBeGreaterThan(withoutCrown.headroom);
  });

  it('ignores an implausible crown value', () => {
    const source = { width: 1200, height: 1600 };
    const face = faceAt(500, 400, 240);
    // 头顶落在人脸框下沿之后 —— 不可能，应被丢弃
    const bogus = suggestIdPhotoLayout(face, source, 295 / 413, 700)!;
    const none = suggestIdPhotoLayout(face, source, 295 / 413)!;
    expect(bogus.headroom).toBeCloseTo(none.headroom, 5);
  });

  it('keeps a non-negative headroom when a zoom-out crop still fits vertically', () => {
    // 竖长源图：zoom 90 时裁剪框比源图宽（横向放不下），但纵向仍有移动空间，
    // 不能像纵向也溢出的情况那样把 top 固定到底部，否则人脸会落到裁剪框上方。
    const source = { width: 500, height: 1600 };
    const layout = suggestIdPhotoLayout(
      faceAt(100, 200, 300),
      source,
      295 / 413
    )!;
    expect(layout.zoom).toBe(90);
    expect(layout.headroom).toBeGreaterThanOrEqual(0);
    expect(Math.abs(layout.offsetY)).toBeLessThanOrEqual(20);
  });

  it('does not rotate when the eye line is within 3 degrees', () => {
    const layout = suggestIdPhotoLayout(
      faceAt(500, 400, 240, 2),
      { width: 1200, height: 1600 },
      295 / 413
    )!;
    expect(layout.rotation).toBe(0);
  });
});

describe('idPhotoCropFromLayout', () => {
  it('produces a crop whose resolved box matches the layout zoom', () => {
    const source = { width: 1200, height: 1600 };
    const aspect = 295 / 413;
    const layout = suggestIdPhotoLayout(faceAt(500, 400, 240), source, aspect)!;
    const crop = idPhotoCropFromLayout(layout, source, aspect);

    expect(crop.scale).toBeGreaterThanOrEqual(1);
    expect(crop.scale).toBeLessThanOrEqual(3);
    expect(crop.x).toBeGreaterThan(0);
    expect(crop.x).toBeLessThan(1);
    expect(crop.y).toBeGreaterThan(0);
    expect(crop.y).toBeLessThan(1);

    const box = resolveIdPhotoCropBox(1200, 1600, 295, 413, crop);
    const baseWidth = Math.min(1200, 1600 * aspect);
    expect(Math.abs(box.width - baseWidth / crop.scale)).toBeLessThan(2);
  });

  it('falls back to the base box when the layout zooms out', () => {
    const source = { width: 500, height: 1600 };
    const aspect = 295 / 413;
    const layout = suggestIdPhotoLayout(faceAt(100, 200, 300), source, aspect)!;
    expect(layout.zoom).toBeLessThan(100);

    // IdPhotoCrop 的 scale 只允许 >= 1，zoom < 100 无法表达，实际只能出基准框。
    const crop = idPhotoCropFromLayout(layout, source, aspect);
    expect(crop.scale).toBe(1);
    expect(crop.x).toBeGreaterThan(0);
    expect(crop.x).toBeLessThan(1);
    expect(crop.y).toBeGreaterThan(0);
    expect(crop.y).toBeLessThan(1);

    const box = resolveIdPhotoCropBox(500, 1600, 295, 413, crop);
    expect(box.width).toBe(500);
    expect(box.height).toBe(700);
  });
});
