import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';
import {
  createYunetInputTensor,
  decodeYunetRawOutputs,
  resolveYunetModelPath,
  type YunetRawOutputs,
} from '../../../../src/modules/tasks/services/face-detection.service';

// brief 里的用例写的是 POSIX 绝对路径；在 Windows 上 path.resolve('/app', ...)
// 会带上当前盘符。用 path.resolve 生成期望值既保持同样的断言，也能跨平台运行。
const inApp = (...segments: string[]) => path.resolve('/app', ...segments);

describe('resolveYunetModelPath', () => {
  it('prefers the configured env path', () => {
    const resolved = resolveYunetModelPath({
      configuredPath: '/custom/yunet.onnx',
      cwd: '/app',
      exists: () => false,
    });
    expect(resolved).toBe('/custom/yunet.onnx');
  });

  it('finds the vendored model next to the api package', () => {
    const expected = inApp('apps/api/models/face_detection_yunet_2023mar.onnx');
    const resolved = resolveYunetModelPath({
      cwd: '/app',
      exists: p => p === expected,
    });
    expect(resolved).toBe(expected);
  });

  it('falls back to the image-baked models dir', () => {
    const expected = inApp(
      'models/id-photo/face/yunet/face_detection_yunet_2023mar.onnx'
    );
    const resolved = resolveYunetModelPath({
      cwd: '/app',
      exists: p => p === expected,
    });
    expect(resolved).toBe(expected);
  });

  it('supports the legacy models/yunet mount', () => {
    const expected = inApp('models/yunet/face_detection_yunet_2023mar.onnx');
    const resolved = resolveYunetModelPath({
      cwd: '/app',
      exists: p => p === expected,
    });
    expect(resolved).toBe(expected);
  });
});

describe('createYunetInputTensor', () => {
  it('produces a CHW float32 tensor normalised to 0..1', () => {
    const size = 2;
    // 第 1 个像素为品红 (R=255, G=0, B=255)，这样 B 平面起点的断言才能
    // 同时区分通道偏移（brief 原数据首像素是纯红，B 平面首元素实际为 0）。
    const raw = Buffer.from([255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    const tensor = createYunetInputTensor(raw, size);

    expect(tensor.length).toBe(3 * size * size);
    // R 平面
    expect(tensor[0]).toBeCloseTo(1, 5);
    expect(tensor[1]).toBeCloseTo(0, 5);
    // G 平面起点 = size*size
    expect(tensor[4]).toBeCloseTo(0, 5);
    expect(tensor[5]).toBeCloseTo(1, 5);
    // B 平面起点 = 2*size*size
    expect(tensor[8]).toBeCloseTo(1, 5);
    expect(tensor[11]).toBeCloseTo(1, 5);
  });

  it('uses 0..1 normalisation, not -1..1', () => {
    const raw = Buffer.alloc(3 * 4, 127);
    const tensor = createYunetInputTensor(raw, 2);
    expect(tensor[0]).toBeCloseTo(127 / 255, 5);
  });
});

type RawCell = {
  row: number;
  col: number;
  score: number;
  bbox?: [number, number, number, number];
  kps?: number[];
};

/**
 * 构造官方 2023mar 模型的 12 输出布局：每个 stride 一组
 * cls/obj/bbox/kps。输入固定为 64x64，stride=8 时网格为 8x8。
 */
function makeRawOutputs(
  size: number,
  stride: number,
  cells: RawCell[]
): YunetRawOutputs {
  const grid = size / stride;
  const anchors = grid * grid;
  const cls = new Float32Array(anchors);
  const obj = new Float32Array(anchors);
  const bbox = new Float32Array(anchors * 4);
  const kps = new Float32Array(anchors * 10);

  for (const cell of cells) {
    const idx = cell.row * grid + cell.col;
    cls[idx] = cell.score;
    obj[idx] = cell.score;
    bbox.set(cell.bbox ?? [0.5, 0.5, 0, 0], idx * 4);
    kps.set(cell.kps ?? new Array(10).fill(0), idx * 10);
  }

  return {
    [`cls_${stride}`]: { data: cls, dims: [1, anchors] },
    [`obj_${stride}`]: { data: obj, dims: [1, anchors] },
    [`bbox_${stride}`]: { data: bbox, dims: [1, anchors, 4] },
    [`kps_${stride}`]: { data: kps, dims: [1, anchors, 10] },
  };
}

describe('decodeYunetRawOutputs', () => {
  it('decodes box and landmarks from the grid cell prior', () => {
    const faces = decodeYunetRawOutputs(
      makeRawOutputs(64, 8, [
        { row: 2, col: 3, score: 0.9, bbox: [0.5, 0.25, 0, 0] },
      ]),
      { inputWidth: 64, inputHeight: 64 }
    );

    expect(faces).toHaveLength(1);
    // cx = (3 + 0.5) * 8 = 28, cy = (2 + 0.25) * 8 = 18, w = h = exp(0) * 8
    expect(faces[0]?.box.x).toBeCloseTo(24, 5);
    expect(faces[0]?.box.y).toBeCloseTo(14, 5);
    expect(faces[0]?.box.width).toBeCloseTo(8, 5);
    expect(faces[0]?.box.height).toBeCloseTo(8, 5);
    // 关键点先加网格坐标再乘 stride
    expect(faces[0]?.landmarks[0]).toEqual([24, 16]);
  });

  it('combines cls and obj with a square root and drops low scores', () => {
    const faces = decodeYunetRawOutputs(
      makeRawOutputs(64, 8, [
        // sqrt(1 * 0.25) = 0.5 < 0.6
        { row: 1, col: 1, score: 0.5 },
        // sqrt(0.81 * 0.81) = 0.81
        { row: 5, col: 5, score: 0.81 },
      ]),
      { inputWidth: 64, inputHeight: 64 }
    );

    expect(faces).toHaveLength(1);
    expect(faces[0]?.score).toBeCloseTo(0.81, 5);
  });

  it('suppresses overlapping boxes with NMS', () => {
    const overlapping = { bbox: [0.5, 0.5, 1, 1] as RawCell['bbox'] };
    const faces = decodeYunetRawOutputs(
      makeRawOutputs(64, 8, [
        { row: 2, col: 2, score: 0.9, ...overlapping },
        { row: 2, col: 3, score: 0.7, ...overlapping },
      ]),
      { inputWidth: 64, inputHeight: 64 }
    );

    expect(faces).toHaveLength(1);
    expect(faces[0]?.score).toBeCloseTo(0.9, 5);
  });

  it('returns an empty list when the model outputs are missing', () => {
    expect(
      decodeYunetRawOutputs({}, { inputWidth: 64, inputHeight: 64 })
    ).toEqual([]);
  });
});
