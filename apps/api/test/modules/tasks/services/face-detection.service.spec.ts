import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import * as path from 'node:path';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import type { YunetRawOutputs } from '@utils-plane/utils';
import {
  FaceDetectionService,
  resolveYunetModelPath,
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

type FakeSession = {
  inputNames: string[];
  outputNames: string[];
  inputMetadata?: ReadonlyArray<{ shape?: readonly (number | string)[] }>;
  run: (feeds: Record<string, ort.Tensor>) => Promise<YunetRawOutputs>;
};

/** 官方 12 输出中 stride=8 的一组；其余 stride 缺失时解码器会跳过。 */
function makeRawOutputs(inputSize: number): YunetRawOutputs {
  const stride = 8;
  const grid = inputSize / stride;
  const anchors = grid * grid;
  const row = Math.floor(grid / 2);
  const col = Math.floor(grid / 2);
  const index = row * grid + col;

  const cls = new Float32Array(anchors);
  const obj = new Float32Array(anchors);
  const bbox = new Float32Array(anchors * 4);
  const kps = new Float32Array(anchors * 10);
  cls[index] = 0.81;
  obj[index] = 0.81;
  bbox.set([0.5, 0.5, 0, 0], index * 4);

  return {
    cls_8: { data: cls, dims: [1, anchors] },
    obj_8: { data: obj, dims: [1, anchors] },
    bbox_8: { data: bbox, dims: [1, anchors, 4] },
    kps_8: { data: kps, dims: [1, anchors, 10] },
  };
}

function makeSession(inputSize?: number): FakeSession {
  return {
    inputNames: ['input'],
    outputNames: ['cls_8', 'obj_8', 'bbox_8', 'kps_8'],
    ...(inputSize === undefined
      ? {}
      : { inputMetadata: [{ shape: [1, 3, inputSize, inputSize] }] }),
    run: async () => makeRawOutputs(inputSize ?? 320),
  };
}

let restoreOrt: (() => void) | undefined;

afterEach(() => {
  restoreOrt?.();
  restoreOrt = undefined;
});

function mockSession(session: FakeSession) {
  const spy = spyOn(ort.InferenceSession, 'create').mockResolvedValue(
    session as unknown as ort.InferenceSession
  );
  restoreOrt = () => spy.mockRestore();
  return spy;
}

async function makeImage(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
}

describe('FaceDetectionService.detect', () => {
  it('runs the official 640 model, feeds 0..255 BGR and maps boxes back', async () => {
    let fed: ort.Tensor | undefined;
    const session = makeSession(640);
    session.run = async feeds => {
      fed = feeds.input;
      return makeRawOutputs(640);
    };
    mockSession(session);

    const service = new FaceDetectionService();
    const faces = await service.detect(await makeImage(100, 50));

    expect(faces).toHaveLength(1);
    expect(faces[0]?.score).toBeCloseTo(0.81, 5);

    // stride 8、网格中心 anchor (40,40)、bbox 偏移 (0.5,0.5) → 输入空间
    // 中心 (324,324)、边长 8；fill 缩放到 100×50 后为：
    // x=320*100/640=50, y=320*50/640=25, w=8*100/640=1.25, h=8*50/640=0.625。
    expect(faces[0]?.box.x).toBeCloseTo(50, 5);
    expect(faces[0]?.box.y).toBeCloseTo(25, 5);
    expect(faces[0]?.box.width).toBeCloseTo(1.25, 5);
    expect(faces[0]?.box.height).toBeCloseTo(0.625, 5);
    // 关键点 (0,0) + 网格坐标 (40,40) → 输入空间 (320,320)，再映射回源图。
    expect(faces[0]?.landmarks[0]?.[0]).toBeCloseTo(50, 5);
    expect(faces[0]?.landmarks[0]?.[1]).toBeCloseTo(25, 5);

    expect(fed).toBeDefined();
    expect(fed!.dims).toEqual([1, 3, 640, 640]);
    const data = fed!.data as Float32Array;
    const plane = 640 * 640;
    // 默认预处理是官方权重的 0..255 BGR：纯红图 → B=0, G=0, R=255。
    expect(data[0]).toBe(0);
    expect(data[plane]).toBe(0);
    expect(data[2 * plane]).toBe(255);
  });

  it('falls back to 320 when the session exposes no input shape', async () => {
    let fed: ort.Tensor | undefined;
    const session = makeSession();
    session.run = async feeds => {
      fed = feeds.input;
      return makeRawOutputs(320);
    };
    mockSession(session);

    const service = new FaceDetectionService();
    const faces = await service.detect(await makeImage(100, 50));

    expect(fed?.dims).toEqual([1, 3, 320, 320]);
    expect(faces).toHaveLength(1);
    expect(faces[0]?.box.x).toBeCloseTo(50, 5);
    expect(faces[0]?.box.y).toBeCloseTo(25, 5);
  });

  it('rejects unsupported legacy output layouts without running inference', async () => {
    let ran = false;
    const session: FakeSession = {
      inputNames: ['input'],
      outputNames: ['output0'],
      inputMetadata: [{ shape: [1, 3, 320, 320] }],
      run: async () => {
        ran = true;
        return {};
      },
    };
    mockSession(session);

    const service = new FaceDetectionService();
    const faces = await service.detect(await makeImage(10, 10));

    expect(faces).toEqual([]);
    expect(ran).toBe(false);
  });

  it('returns an empty list when the session exposes no input name', async () => {
    let ran = false;
    const session: FakeSession = {
      inputNames: [],
      outputNames: ['cls_8', 'obj_8', 'bbox_8', 'kps_8'],
      inputMetadata: [{ shape: [1, 3, 320, 320] }],
      run: async () => {
        ran = true;
        return {};
      },
    };
    mockSession(session);

    const service = new FaceDetectionService();
    const faces = await service.detect(await makeImage(10, 10));

    expect(faces).toEqual([]);
    expect(ran).toBe(false);
  });

  it('returns an empty list when the image cannot be decoded', async () => {
    const create = mockSession(makeSession(640));
    const service = new FaceDetectionService();

    const faces = await service.detect(Buffer.from('not an image'));

    expect(faces).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it('returns an empty list when the model cannot be loaded', async () => {
    const spy = spyOn(ort.InferenceSession, 'create').mockRejectedValue(
      new Error('model missing')
    );
    restoreOrt = () => spy.mockRestore();
    const service = new FaceDetectionService();
    const image = await makeImage(10, 10);

    expect(await service.detect(image)).toEqual([]);
    // 失败的 promise 不应被缓存：第二次调用会重新尝试加载。
    expect(await service.detect(image)).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
