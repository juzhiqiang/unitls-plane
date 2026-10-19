import { describe, expect, it } from 'bun:test';
import {
  createYunetInputTensor,
  decodeYunetRawOutputs,
  resolveYunetInputSize,
  scaleDetectedFaces,
  usesRawYunetLayout,
  type DetectedFace,
  type YunetRawOutputs,
} from '../src/id-photo-yunet';

describe('createYunetInputTensor', () => {
  it('defaults to 0..255 BGR (the official 2023mar preprocessing)', () => {
    const size = 2;
    // 两个像素：R/G/B = 10/20/30 与 1/2/3，便于区分通道顺序。
    const raw = Buffer.from([10, 20, 30, 1, 2, 3]);
    const tensor = createYunetInputTensor(raw, size);

    expect(tensor.length).toBe(3 * size * size);
    // B 平面：原始 B 通道
    expect(tensor[0]).toBe(30);
    expect(tensor[1]).toBe(3);
    // G 平面
    expect(tensor[4]).toBe(20);
    expect(tensor[5]).toBe(2);
    // R 平面
    expect(tensor[8]).toBe(10);
    expect(tensor[9]).toBe(1);
  });

  it('keeps 0..255 values unless valueScale says otherwise', () => {
    const tensor = createYunetInputTensor(Buffer.alloc(12, 127), 2);
    expect(tensor[0]).toBe(127);
  });

  it('applies the valueScale option', () => {
    const tensor = createYunetInputTensor(Buffer.alloc(12, 127), 2, {
      valueScale: 1 / 255,
    });
    expect(tensor[0]).toBeCloseTo(127 / 255, 5);
  });

  it('applies the channelOrder option', () => {
    const raw = Buffer.from([10, 20, 30, 1, 2, 3]);
    const tensor = createYunetInputTensor(raw, 2, { channelOrder: 'rgb' });
    expect(tensor[0]).toBe(10);
    expect(tensor[4]).toBe(20);
    expect(tensor[8]).toBe(30);
  });

  it('supports the legacy 0..1 RGB combination when explicitly requested', () => {
    const raw = Buffer.from([255, 128, 0, 0, 0, 0]);
    const tensor = createYunetInputTensor(raw, 2, {
      valueScale: 1 / 255,
      channelOrder: 'rgb',
    });
    expect(tensor[0]).toBeCloseTo(1, 5);
    expect(tensor[4]).toBeCloseTo(128 / 255, 5);
    expect(tensor[8]).toBeCloseTo(0, 5);
  });
});

describe('resolveYunetInputSize', () => {
  it('reads the official 640x640 input shape', () => {
    expect(
      resolveYunetInputSize({ inputMetadata: [{ shape: [1, 3, 640, 640] }] })
    ).toBe(640);
  });

  it('supports a 320x320 static shape', () => {
    expect(
      resolveYunetInputSize({ inputMetadata: [{ shape: [1, 3, 320, 320] }] })
    ).toBe(320);
  });

  it('falls back to 320 when the shape is missing', () => {
    expect(resolveYunetInputSize({})).toBe(320);
    expect(resolveYunetInputSize({ inputMetadata: [] })).toBe(320);
    expect(resolveYunetInputSize({ inputMetadata: [{ shape: [1, 3] }] })).toBe(
      320
    );
  });

  it('ignores non-positive dimensions and prefers width', () => {
    expect(
      resolveYunetInputSize({ inputMetadata: [{ shape: [1, 3, 0, 640] }] })
    ).toBe(640);
    expect(
      resolveYunetInputSize({ inputMetadata: [{ shape: [1, 3, 480, -1] }] })
    ).toBe(480);
    expect(
      resolveYunetInputSize({ inputMetadata: [{ shape: [1, 3, -1, 0] }] })
    ).toBe(320);
  });
});

describe('usesRawYunetLayout', () => {
  it('accepts the 12-output 2023mar layout', () => {
    const names = [8, 16, 32].flatMap(stride => [
      `cls_${stride}`,
      `obj_${stride}`,
      `bbox_${stride}`,
      `kps_${stride}`,
    ]);
    expect(usesRawYunetLayout(names)).toBe(true);
  });

  it('rejects the legacy single [N, 15] output', () => {
    expect(usesRawYunetLayout(['output0'])).toBe(false);
  });

  it('requires both bbox and kps outputs', () => {
    expect(usesRawYunetLayout(['bbox_8', 'cls_8', 'obj_8'])).toBe(false);
    expect(usesRawYunetLayout(['kps_8'])).toBe(false);
  });
});

type RawCell = {
  row: number;
  col: number;
  /** 同时设置 cls 与 obj；需要分别控制时用 cls/obj。 */
  score?: number;
  cls?: number;
  obj?: number;
  bbox?: [number, number, number, number];
  kps?: number[];
};

/**
 * 构造官方 2023mar 单个 stride 的 4 个输出张量。
 * 输入固定为 size×size，网格尺寸为 size/stride。
 */
function makeStrideOutputs(
  size: number,
  stride: number,
  cells: RawCell[]
): YunetRawOutputs {
  const grid = Math.floor(size / stride);
  const anchors = grid * grid;
  const cls = new Float32Array(anchors);
  const obj = new Float32Array(anchors);
  const bbox = new Float32Array(anchors * 4);
  const kps = new Float32Array(anchors * 10);

  for (const cell of cells) {
    const idx = cell.row * grid + cell.col;
    cls[idx] = cell.cls ?? cell.score ?? 0;
    obj[idx] = cell.obj ?? cell.score ?? 0;
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

function mergeOutputs(...parts: YunetRawOutputs[]): YunetRawOutputs {
  return Object.assign({}, ...parts);
}

describe('decodeYunetRawOutputs', () => {
  it('decodes box and landmarks from the grid cell prior', () => {
    const faces = decodeYunetRawOutputs(
      makeStrideOutputs(64, 8, [
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

  it('combines cls and obj with a square root', () => {
    const faces = decodeYunetRawOutputs(
      makeStrideOutputs(64, 8, [
        // sqrt(1 * 0.36) = 0.6，恰好等于默认阈值；若误用乘积会被丢弃。
        { row: 1, col: 1, cls: 1, obj: 0.36 },
        // sqrt(0.25 * 0.25) = 0.25 < 0.6
        { row: 5, col: 5, cls: 0.25, obj: 0.25 },
      ]),
      { inputWidth: 64, inputHeight: 64 }
    );

    expect(faces).toHaveLength(1);
    expect(faces[0]?.score).toBeCloseTo(0.6, 5);
  });

  it('drops anchors below the score threshold', () => {
    const faces = decodeYunetRawOutputs(
      makeStrideOutputs(64, 8, [
        { row: 1, col: 1, score: 0.59 },
        { row: 5, col: 5, score: 0.6 },
      ]),
      { inputWidth: 64, inputHeight: 64 }
    );

    expect(faces).toHaveLength(1);
    expect(faces[0]?.score).toBeCloseTo(0.6, 5);
  });

  it('suppresses overlapping boxes with NMS', () => {
    const overlapping = { bbox: [0.5, 0.5, 1, 1] as RawCell['bbox'] };
    const faces = decodeYunetRawOutputs(
      makeStrideOutputs(64, 8, [
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

  it('discards anchors whose exp() overflows', () => {
    const faces = decodeYunetRawOutputs(
      makeStrideOutputs(64, 8, [
        { row: 1, col: 1, score: 0.9, bbox: [0.5, 0.5, 1000, 0] },
      ]),
      { inputWidth: 64, inputHeight: 64 }
    );

    expect(faces).toEqual([]);
  });

  it('aggregates detections from all three strides', () => {
    const faces = decodeYunetRawOutputs(
      mergeOutputs(
        makeStrideOutputs(64, 8, [{ row: 0, col: 0, score: 0.7 }]),
        makeStrideOutputs(64, 16, [{ row: 0, col: 0, score: 0.8 }]),
        makeStrideOutputs(64, 32, [{ row: 0, col: 0, score: 0.9 }])
      ),
      { inputWidth: 64, inputHeight: 64 }
    );

    expect(faces).toHaveLength(3);
    expect(faces[0]?.score).toBeCloseTo(0.9, 5);
    expect(faces[1]?.score).toBeCloseTo(0.8, 5);
    expect(faces[2]?.score).toBeCloseTo(0.7, 5);
  });

  it('runs NMS across strides for the same face', () => {
    // 两个 stride 给出完全相同的 8×8 框（stride 16 的 exp 缩放为 0.5）。
    const faces = decodeYunetRawOutputs(
      mergeOutputs(
        makeStrideOutputs(64, 8, [
          { row: 2, col: 2, score: 0.7, bbox: [1, 0.5, 0, 0] },
        ]),
        makeStrideOutputs(64, 16, [
          {
            row: 1,
            col: 1,
            score: 0.9,
            bbox: [0.5, 0.25, Math.log(0.5), Math.log(0.5)],
          },
        ])
      ),
      { inputWidth: 64, inputHeight: 64 }
    );

    expect(faces).toHaveLength(1);
    expect(faces[0]?.score).toBeCloseTo(0.9, 5);
  });

  it('keeps decoding the strides whose tensors are present', () => {
    const faces = decodeYunetRawOutputs(
      mergeOutputs(
        makeStrideOutputs(64, 8, [{ row: 0, col: 0, score: 0.7 }]),
        makeStrideOutputs(64, 32, [{ row: 1, col: 1, score: 0.8 }])
      ),
      { inputWidth: 64, inputHeight: 64 }
    );

    expect(faces).toHaveLength(2);
  });
});

describe('scaleDetectedFaces', () => {
  const face: DetectedFace = {
    box: { x: 50, y: 70, width: 100, height: 120 },
    landmarks: [[80, 118]],
    score: 0.9,
  };

  it('subtracts the letterbox offset before scaling back to source space', () => {
    const [scaled] = scaleDetectedFaces([face], {
      scaleX: 2,
      scaleY: 4,
      offsetX: 10,
      offsetY: 20,
    });

    expect(scaled!.box).toEqual({ x: 80, y: 200, width: 200, height: 480 });
    // 关键点同样先减 offset 再乘比例
    expect(scaled!.landmarks[0]!).toEqual([(80 - 10) * 2, (118 - 20) * 4]);
  });

  it('defaults offsets to zero', () => {
    const [scaled] = scaleDetectedFaces([face], {
      scaleX: 0.5,
      scaleY: 0.5,
    });

    expect(scaled!.box).toEqual({ x: 25, y: 35, width: 50, height: 60 });
  });
});
