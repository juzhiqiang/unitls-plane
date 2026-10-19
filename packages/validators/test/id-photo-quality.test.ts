import { describe, expect, it } from 'bun:test';
import { inspectIdPhoto, type QualityReport } from '../src/id-photo-quality';
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
 *
 * 灰度限制在 100..163，均值约 131（远离曝光下限 35），同时保留足够方差，
 * 避免「满分」用例靠阈值边界勉强通过。哈希乘法必须用 `Math.imul`：普通
 * `*` 会因超过 2^53 丢失低位，让取值分布退化。
 */
function texturedImage(width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let h = (x * 374761393 + y * 668265263) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      const value = 100 + (h & 0x3f);
      const p = (y * width + x) * 3;
      out[p] = value;
      out[p + 1] = value;
      out[p + 2] = value;
    }
  }
  return out;
}

/** 把 RGB 缓冲区展开成 alpha 全 255 的 RGBA，模拟 canvas `ImageData.data`。 */
function toRgba(
  rgb: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    out[i * 4] = rgb[i * 3]!;
    out[i * 4 + 1] = rgb[i * 3 + 1]!;
    out[i * 4 + 2] = rgb[i * 3 + 2]!;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function item(
  report: QualityReport,
  name: QualityReport['items'][number]['name']
) {
  const found = report.items.find(i => i.name === name);
  if (!found) throw new Error(`item ${name} not found`);
  return found;
}

function numericValue(report: QualityReport, name: 'sharpness' | 'exposure') {
  return Number.parseFloat(item(report, name).value);
}

interface FaceOptions {
  faceWidthRatio: number;
  offsetRatio?: number;
  yRatio?: number;
  tilt?: number;
}

function faceAt(
  width: number,
  height: number,
  { faceWidthRatio, offsetRatio = 0, yRatio = 0.15, tilt = 0 }: FaceOptions
): FaceDetection {
  const size = width * faceWidthRatio;
  const x = (width - size) / 2 + offsetRatio * width;
  const y = height * yRatio;
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

function centeredFace(
  width: number,
  height: number,
  faceWidthRatio: number,
  tilt = 0
): FaceDetection {
  return faceAt(width, height, { faceWidthRatio, tilt });
}

function reportFor(face: FaceDetection | null, faceCount = 1): QualityReport {
  const width = 1000;
  const height = 1000;
  return inspectIdPhoto({
    rgb: solidImage(width, height, 128),
    width,
    height,
    face,
    faceCount,
  });
}

/**
 * 用围绕原点的对称两眼坐标构造精确的角度。
 *
 * `faceAt` 把眼睛放在 y≈300 的绝对坐标上，`(cy + dy) - (cy - dy)` 会发生
 * 抵消误差，让标称 5° 变成 5.000000000000013°，无法稳定落在 `<= 5` 边界内。
 * 这里坐标量级与差值同阶，`atan2` 能返回精确的 5。
 */
function withEyeTilt(face: FaceDetection, degrees: number): FaceDetection {
  const angle = (degrees * Math.PI) / 180;
  const radius = 100;
  const dx = radius * Math.cos(angle);
  const dy = radius * Math.sin(angle);
  return {
    ...face,
    landmarks: [
      [-dx, -dy],
      [dx, dy],
      [0, dy * 2],
      [-dx / 2, dy * 3],
      [dx / 2, dy * 3],
    ],
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

    // fixture 自身要留在安全区内，不能靠阈值边界勉强通过。
    const brightness = numericValue(report, 'exposure');
    const sharpness = numericValue(report, 'sharpness');
    expect(brightness).toBeGreaterThanOrEqual(100);
    expect(brightness).toBeLessThanOrEqual(160);
    expect(sharpness).toBeGreaterThanOrEqual(30);
  });

  it('produces the same sharpness and exposure for RGB and RGBA buffers', () => {
    const width = 295;
    const height = 413;
    const rgb = texturedImage(width, height);
    const rgba = toRgba(rgb, width, height);
    const face = centeredFace(width, height, 0.35);

    const rgbReport = inspectIdPhoto({
      rgb,
      width,
      height,
      face,
      faceCount: 1,
    });
    const rgbaReport = inspectIdPhoto({
      rgb: rgba,
      width,
      height,
      face,
      faceCount: 1,
    });

    for (const name of ['sharpness', 'exposure'] as const) {
      const fromRgb = numericValue(rgbReport, name);
      const fromRgba = numericValue(rgbaReport, name);
      expect(fromRgb).toBeGreaterThan(0);
      expect(Math.abs(fromRgb - fromRgba) / Math.max(1, fromRgb)).toBeLessThan(
        0.01
      );
    }
  });

  it('throws when the buffer length matches neither RGB nor RGBA', () => {
    expect(() =>
      inspectIdPhoto({
        rgb: new Uint8ClampedArray(100),
        width: 10,
        height: 10,
        face: null,
        faceCount: 0,
      })
    ).toThrow(RangeError);
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

    const faceCount = item(report, 'faceCount');
    expect(faceCount.passed).toBe(false);
    expect(report.passed).toBe(false);

    // 没有人脸时四项都无法判定，用 — 标记而不是伪造 0 值。
    for (const name of [
      'faceCentered',
      'faceRatio',
      'eyeTilt',
      'headroom',
    ] as const) {
      const missing = item(report, name);
      expect(missing.value).toBe('—');
      expect(missing.passed).toBe(false);
      expect(missing.hint).toBe('faceNotDetected');
    }
  });

  it('fails eyeTilt when fewer than two landmarks are available', () => {
    const face = centeredFace(1000, 1000, 0.35);
    for (const landmarks of [[], [face.landmarks[0]!]] as const) {
      const report = reportFor({ ...face, landmarks });
      const eyeTilt = item(report, 'eyeTilt');
      expect(eyeTilt.value).toBe('—');
      expect(eyeTilt.passed).toBe(false);
      expect(eyeTilt.hint).toBe('faceNotDetected');
    }
  });

  it('flags a face that is too small', () => {
    const report = reportFor(centeredFace(1000, 1000, 0.15));

    expect(item(report, 'faceRatio').passed).toBe(false);
  });

  it('flags an over-tilted eye line', () => {
    const report = reportFor(centeredFace(1000, 1000, 0.35, 12));

    expect(item(report, 'eyeTilt').passed).toBe(false);
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

    expect(item(report, 'exposure').passed).toBe(false);
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

    expect(item(report, 'matteEdge').passed).toBe(false);
  });

  it('omits the matte item and reports seven items when no alpha is supplied', () => {
    const report = inspectIdPhoto({
      rgb: solidImage(295, 413, 128),
      width: 295,
      height: 413,
      face: centeredFace(295, 413, 0.35),
      faceCount: 1,
    });

    expect(report.items.length).toBe(7);
    expect(report.items.find(i => i.name === 'matteEdge')).toBeUndefined();
  });

  it('reports eight items when an empty alpha buffer is supplied', () => {
    const width = 10;
    const height = 10;
    const report = inspectIdPhoto({
      rgb: solidImage(width, height, 128),
      width,
      height,
      face: null,
      faceCount: 1,
      alpha: new Uint8ClampedArray(0),
    });

    expect(report.items.length).toBe(8);
    const matte = item(report, 'matteEdge');
    expect(matte.value).toBe('—');
    expect(matte.passed).toBe(false);
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

    expect(item(report, 'matteEdge').passed).toBe(false);
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

    expect(item(report, 'matteEdge').passed).toBe(true);
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

    expect(item(report, 'matteEdge').passed).toBe(false);
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

    expect(item(report, 'sharpness').passed).toBe(true);
  });

  describe('threshold boundaries', () => {
    it.each([
      [0.26, true],
      [0.42, true],
      [0.255, false],
      [0.425, false],
    ])('faceRatio %f passes=%s', (ratio, expected) => {
      const report = reportFor(centeredFace(1000, 1000, ratio));

      expect(item(report, 'faceRatio').passed).toBe(expected);
    });

    it('treats exactly 0.12 center offset as failing (tolerance is exclusive)', () => {
      expect(
        item(
          reportFor(
            faceAt(1000, 1000, { faceWidthRatio: 0.35, offsetRatio: 0.12 })
          ),
          'faceCentered'
        ).passed
      ).toBe(false);
      expect(
        item(
          reportFor(
            faceAt(1000, 1000, { faceWidthRatio: 0.35, offsetRatio: 0.119 })
          ),
          'faceCentered'
        ).passed
      ).toBe(true);
    });

    it('flags an off-center face', () => {
      expect(
        item(
          reportFor(
            faceAt(1000, 1000, { faceWidthRatio: 0.35, offsetRatio: 0.2 })
          ),
          'faceCentered'
        ).passed
      ).toBe(false);
    });

    it('treats exactly 5 degrees of eye tilt as passing', () => {
      const face = centeredFace(1000, 1000, 0.35);
      expect(item(reportFor(withEyeTilt(face, 5)), 'eyeTilt').passed).toBe(
        true
      );
      expect(item(reportFor(withEyeTilt(face, 5.1)), 'eyeTilt').passed).toBe(
        false
      );
    });

    it('treats exactly 0.03 headroom as passing', () => {
      expect(
        item(
          reportFor(faceAt(1000, 1000, { faceWidthRatio: 0.35, yRatio: 0.03 })),
          'headroom'
        ).passed
      ).toBe(true);
      expect(
        item(
          reportFor(
            faceAt(1000, 1000, { faceWidthRatio: 0.35, yRatio: 0.029 })
          ),
          'headroom'
        ).passed
      ).toBe(false);
    });

    it('flags insufficient headroom', () => {
      expect(
        item(
          reportFor(faceAt(1000, 1000, { faceWidthRatio: 0.35, yRatio: 0.01 })),
          'headroom'
        ).passed
      ).toBe(false);
    });
  });

  it('locks the i18n hint keys for every item', () => {
    const width = 295;
    const height = 413;
    const alpha = new Uint8ClampedArray(width * height);
    alpha.fill(255);
    const report = inspectIdPhoto({
      rgb: solidImage(width, height, 128),
      width,
      height,
      face: centeredFace(width, height, 0.35),
      faceCount: 1,
      alpha,
    });

    expect(Object.fromEntries(report.items.map(i => [i.name, i.hint]))).toEqual(
      {
        faceCount: 'singleFrontalPortrait',
        faceCentered: 'adjustHorizontalPosition',
        faceRatio: 'faceRatioRange',
        eyeTilt: 'levelEyes',
        headroom: 'headroomTooSmall',
        sharpness: 'avoidBlurrySource',
        exposure: 'avoidUnderexposedOrBlown',
        matteEdge: 'checkHairAndShoulder',
      }
    );
  });
});
