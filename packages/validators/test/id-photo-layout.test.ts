import { describe, expect, it } from 'bun:test';
import {
  eyeTiltDegrees,
  idPhotoCropFromLayout,
  suggestBrightnessAdjustment,
  suggestIdPhotoLayout,
  type FaceDetection,
  type IdPhotoLayout,
} from '../src/id-photo-layout';
import { resolveIdPhotoCropBox } from '../src/id-photo';

const SOURCE = { width: 1200, height: 1600 };
const ASPECT = 295 / 413;

function faceAt(x: number, y: number, size: number, tilt = 0): FaceDetection {
  const cx = x + size / 2;
  const cy = y + size / 2;
  // 左眼抬高、右眼压低。两眼横向距离 0.4 * size、纵向差 2 * eyeRise，
  // 因此 atan2 得到恰好等于 tilt 的角度。
  const eyeRise = Math.tan((tilt * Math.PI) / 180) * (size * 0.2);
  return {
    box: { x, y, width: size, height: size },
    landmarks: [
      [cx - size * 0.2, cy - eyeRise],
      [cx + size * 0.2, cy + eyeRise],
      [cx, cy + size * 0.1],
      [cx - size * 0.1, cy + size * 0.25],
      [cx + size * 0.1, cy + size * 0.25],
    ],
    score: 0.95,
  };
}

function centerOf(box: {
  left: number;
  top: number;
  width: number;
  height: number;
}): { x: number; y: number } {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

const VALID_LAYOUT: IdPhotoLayout = {
  zoom: 120,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  faceRatio: 0.35,
  faceTopMargin: 0.1,
};

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
    expect(suggestIdPhotoLayout(null, SOURCE, ASPECT)).toBeNull();
  });

  it('returns null for non-finite or non-positive source dimensions', () => {
    const face = faceAt(500, 400, 240);
    expect(
      suggestIdPhotoLayout(face, { width: 0, height: 1600 }, ASPECT)
    ).toBeNull();
    expect(
      suggestIdPhotoLayout(face, { width: 1200, height: -1 }, ASPECT)
    ).toBeNull();
    expect(
      suggestIdPhotoLayout(face, { width: Number.NaN, height: 1600 }, ASPECT)
    ).toBeNull();
    expect(
      suggestIdPhotoLayout(
        face,
        { width: 1200, height: Number.POSITIVE_INFINITY },
        ASPECT
      )
    ).toBeNull();
  });

  it('returns null for a face box with non-finite or non-positive dimensions', () => {
    const nanFace = faceAt(500, 400, 240);
    nanFace.box.width = Number.NaN;
    expect(suggestIdPhotoLayout(nanFace, SOURCE, ASPECT)).toBeNull();

    const infiniteFace = faceAt(500, 400, 240);
    infiniteFace.box.height = Number.POSITIVE_INFINITY;
    expect(suggestIdPhotoLayout(infiniteFace, SOURCE, ASPECT)).toBeNull();

    const nanPosition = faceAt(500, 400, 240);
    nanPosition.box.x = Number.NaN;
    expect(suggestIdPhotoLayout(nanPosition, SOURCE, ASPECT)).toBeNull();
  });

  it('zooms so the face occupies roughly 35% of the crop width', () => {
    const face = faceAt(500, 400, 240);
    const layout = suggestIdPhotoLayout(face, SOURCE, ASPECT);
    expect(layout).not.toBeNull();
    expect(layout!.faceRatio).toBeGreaterThan(0.28);
    expect(layout!.faceRatio).toBeLessThan(0.45);
  });

  it('derives zoom from the 35% target without hitting the clamp', () => {
    // faceWidth=360 时原始 zoom≈111，落在 (100, 145) 内，能真正验证 35% 公式；
    // faceWidth=240 的旧用例会被 MAX_ZOOM 截到 145，即使把目标比例改成 40% 也过。
    const layout = suggestIdPhotoLayout(faceAt(500, 400, 360), SOURCE, ASPECT)!;
    expect(layout.zoom).toBeGreaterThan(100);
    expect(layout.zoom).toBeLessThan(145);
    // 先断言紧贴 35% 目标：把 DESIRED_FACE_RATIO 改成 0.4 时这里会以约 0.05
    // 的差距失败，不依赖 [0.30, 0.40] 边界上的舍入运气。
    expect(layout.faceRatio).toBeCloseTo(0.35, 2);
    expect(layout.faceRatio).toBeGreaterThanOrEqual(0.3);
    expect(layout.faceRatio).toBeLessThanOrEqual(0.4);
  });

  it('keeps every output field inside the documented ranges', () => {
    const layout = suggestIdPhotoLayout(
      faceAt(100, 100, 900, 8),
      SOURCE,
      ASPECT
    )!;
    expect(layout.zoom).toBeGreaterThanOrEqual(100);
    expect(layout.zoom).toBeLessThanOrEqual(145);
    expect(Math.abs(layout.offsetX)).toBeLessThanOrEqual(20);
    expect(Math.abs(layout.offsetY)).toBeLessThanOrEqual(20);
    expect(Math.abs(layout.rotation)).toBeLessThanOrEqual(5);
    expect(layout.faceTopMargin).toBeGreaterThanOrEqual(0);
  });

  it('prefers the segmentation crown over the face-box estimate', () => {
    const face = faceAt(500, 400, 240);
    const withCrown = suggestIdPhotoLayout(face, SOURCE, ASPECT, 200)!;
    const withoutCrown = suggestIdPhotoLayout(face, SOURCE, ASPECT)!;
    expect(withCrown.faceTopMargin).toBeGreaterThan(withoutCrown.faceTopMargin);
  });

  it('ignores an implausible crown value', () => {
    const face = faceAt(500, 400, 240);
    // 头顶落在人脸框下沿之后 —— 不可能，应被丢弃
    const bogus = suggestIdPhotoLayout(face, SOURCE, ASPECT, 700)!;
    const none = suggestIdPhotoLayout(face, SOURCE, ASPECT)!;
    expect(bogus.faceTopMargin).toBeCloseTo(none.faceTopMargin, 5);
  });

  it('ignores a negative crown value instead of clamping it to 0', () => {
    const face = faceAt(500, 400, 240);
    const negative = suggestIdPhotoLayout(face, SOURCE, ASPECT, -50)!;
    const none = suggestIdPhotoLayout(face, SOURCE, ASPECT)!;
    expect(negative.faceTopMargin).toBeCloseTo(none.faceTopMargin, 5);
  });

  it('applies the clamped gain when the right eye is 10 degrees lower', () => {
    const layout = suggestIdPhotoLayout(
      faceAt(500, 400, 240, 10),
      SOURCE,
      ASPECT
    )!;
    expect(layout.rotation).toBeGreaterThan(0);
    expect(layout.rotation).toBe(5);
  });

  it('applies the clamped gain in the opposite direction when the right eye is 10 degrees higher', () => {
    const layout = suggestIdPhotoLayout(
      faceAt(500, 400, 240, -10),
      SOURCE,
      ASPECT
    )!;
    expect(layout.rotation).toBeLessThan(0);
    expect(layout.rotation).toBe(-5);
  });

  it('does not rotate when the eye line is within 3 degrees', () => {
    const layout = suggestIdPhotoLayout(
      faceAt(500, 400, 240, 2),
      SOURCE,
      ASPECT
    )!;
    expect(layout.rotation).toBe(0);
  });
});

describe('idPhotoCropFromLayout', () => {
  it('produces a crop whose resolved box matches the layout box', () => {
    const layout = suggestIdPhotoLayout(faceAt(500, 400, 240), SOURCE, ASPECT)!;
    const crop = idPhotoCropFromLayout(layout, SOURCE, ASPECT);

    expect(crop.scale).toBeGreaterThanOrEqual(1);
    expect(crop.scale).toBeLessThanOrEqual(3);
    expect(crop.x).toBeGreaterThan(0);
    expect(crop.x).toBeLessThan(1);
    expect(crop.y).toBeGreaterThan(0);
    expect(crop.y).toBeLessThan(1);

    const box = resolveIdPhotoCropBox(1200, 1600, 295, 413, crop);
    const baseWidth = Math.min(1200, 1600 * ASPECT);
    expect(Math.abs(box.width - baseWidth / crop.scale)).toBeLessThan(2);

    // offset 取整到 1%，最多让中心偏移源图尺寸的 0.5%；这里再留 0.1% 给
    // resolveIdPhotoCropBox 的像素取整。
    const expectedCenterX = 1200 / 2 + (layout.offsetX / 100) * 1200;
    const expectedCenterY = 1600 / 2 + (layout.offsetY / 100) * 1600;
    const center = centerOf(box);
    expect(Math.abs(center.x - expectedCenterX)).toBeLessThanOrEqual(
      1200 * 0.006
    );
    expect(Math.abs(center.y - expectedCenterY)).toBeLessThanOrEqual(
      1600 * 0.006
    );
  });

  it('keeps the saturated offset within the source bounds', () => {
    // 源图 1200x1600、目标宽高比 0.5：zoom=140 时裁剪框宽约 571，贴左放置后
    // 框中心最多到 285（offset≈-26%），suggestIdPhotoLayout 会把 offset 夹到 -20。
    // 参考实现同样 clip，属于规格内预期：换算后的框中心跟随被夹取的 -20%，
    // 而不是人脸原始中心；框仍然完整落在源图内，不会越界。
    const source = { width: 1200, height: 1600 };
    const aspect = 0.5;
    const layout = suggestIdPhotoLayout(faceAt(0, 400, 200), source, aspect)!;
    expect(layout.offsetX).toBe(-20);

    const crop = idPhotoCropFromLayout(layout, source, aspect);
    const box = resolveIdPhotoCropBox(1200, 1600, 1, 2, crop);
    const expectedCenterX = source.width / 2 - 0.2 * source.width;
    const center = centerOf(box);

    expect(Math.abs(center.x - expectedCenterX)).toBeLessThanOrEqual(
      source.width * 0.006
    );
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.left + box.width).toBeLessThanOrEqual(source.width);
  });

  it('rejects non-positive or non-finite source dimensions', () => {
    expect(() =>
      idPhotoCropFromLayout(VALID_LAYOUT, { width: 0, height: 1600 }, ASPECT)
    ).toThrow(RangeError);
    expect(() =>
      idPhotoCropFromLayout(VALID_LAYOUT, { width: 1200, height: -1 }, ASPECT)
    ).toThrow(RangeError);
    expect(() =>
      idPhotoCropFromLayout(
        VALID_LAYOUT,
        { width: Number.NaN, height: 1600 },
        ASPECT
      )
    ).toThrow(RangeError);
    expect(() =>
      idPhotoCropFromLayout(
        VALID_LAYOUT,
        { width: 1200, height: Number.POSITIVE_INFINITY },
        ASPECT
      )
    ).toThrow(RangeError);
  });

  it('rejects an invalid target aspect', () => {
    expect(() => idPhotoCropFromLayout(VALID_LAYOUT, SOURCE, 0)).toThrow(
      RangeError
    );
    expect(() =>
      idPhotoCropFromLayout(VALID_LAYOUT, SOURCE, Number.NaN)
    ).toThrow(RangeError);
  });

  it('clamps an externally supplied zoom below 100 to the base box', () => {
    // suggestIdPhotoLayout 不会产出 zoom<100；但外部构造的 layout 仍需落到
    // IdPhotoCrop 的 scale >= 1 契约内，而不是产生 NaN 或越界值。
    const crop = idPhotoCropFromLayout(
      { ...VALID_LAYOUT, zoom: 80 },
      SOURCE,
      ASPECT
    );
    expect(crop.scale).toBe(1);
    expect(crop.x).toBeGreaterThan(0);
    expect(crop.x).toBeLessThan(1);
    expect(crop.y).toBeGreaterThan(0);
    expect(crop.y).toBeLessThan(1);
  });
});

describe('suggestBrightnessAdjustment', () => {
  it('returns exact integer offsets at the threshold boundaries', () => {
    // 阈值本身就是「不调整」的一侧:<75 才提亮,>205 才压暗。
    expect(suggestBrightnessAdjustment(0)).toBe(18);
    expect(suggestBrightnessAdjustment(74)).toBe(6);
    expect(suggestBrightnessAdjustment(75)).toBe(0);
    expect(suggestBrightnessAdjustment(128)).toBe(0);
    expect(suggestBrightnessAdjustment(205)).toBe(0);
    expect(suggestBrightnessAdjustment(206)).toBe(-5);
    expect(suggestBrightnessAdjustment(255)).toBe(-12);
  });

  it('caps the correction for extremely dark and blown-out photos', () => {
    expect(suggestBrightnessAdjustment(0)).toBeLessThanOrEqual(18);
    expect(suggestBrightnessAdjustment(255)).toBeGreaterThanOrEqual(-12);
  });

  it('never returns a fractional value', () => {
    for (const mean of [0, 10, 50, 74, 75, 128, 205, 206, 210, 255]) {
      expect(Number.isInteger(suggestBrightnessAdjustment(mean))).toBe(true);
    }
  });

  it('returns 0 for non-finite input', () => {
    expect(suggestBrightnessAdjustment(Number.NaN)).toBe(0);
    expect(suggestBrightnessAdjustment(Number.POSITIVE_INFINITY)).toBe(0);
    expect(suggestBrightnessAdjustment(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});
