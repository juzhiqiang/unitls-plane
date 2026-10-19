import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { envStub, createMock, runMock, createdTensors } = vi.hoisted(() => {
  const createdTensors: Array<{
    type: string;
    data: Float32Array;
    dims: number[];
  }> = [];
  return {
    envStub: { wasm: { wasmPaths: '' } },
    createMock: vi.fn(),
    runMock: vi.fn(),
    createdTensors,
  };
});

vi.mock('onnxruntime-web', () => ({
  env: envStub,
  InferenceSession: {
    create: (...args: unknown[]) => createMock(...args),
  },
  Tensor: class {
    type: string;
    data: Float32Array;
    dims: number[];
    constructor(type: string, data: Float32Array, dims: number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
      createdTensors.push(this);
    }
  },
}));

import {
  detectFaces,
  resetFaceDetectionCacheForTests,
} from '@/lib/id-photo-local/face-detection';
import {
  ORT_VERSION,
  YUNET_INPUT_SIZE,
} from '@/lib/id-photo-local/model-registry';

const SIZE = YUNET_INPUT_SIZE; // 640
const SRC_WIDTH = 1280;
const SRC_HEIGHT = 640;

function rgbaAt(index: number): [number, number, number, number] {
  // 每个通道都非零:像素 0 的断言才有鉴别力(若通道值全为 0,步长写错也读不到差异)。
  return [
    (index + 1) % 256,
    (index * 3 + 7) % 256,
    (index * 11 + 13) % 256,
    255,
  ];
}

function makeRgba(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const [r, g, b, a] = rgbaAt(i);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return data;
}

class FakeCtx {
  drawImage = vi.fn();
  constructor(
    private width: number,
    private height: number
  ) {}
  getImageData(_x: number, _y: number, w: number, h: number) {
    return {
      data: makeRgba(this.width, this.height).slice(0, w * h * 4),
      width: w,
      height: h,
    };
  }
}

class FakeCanvas {
  ctx: FakeCtx;
  constructor(
    public width: number,
    public height: number
  ) {
    this.ctx = new FakeCtx(width, height);
  }
  getContext() {
    return this.ctx;
  }
}

let sourceBitmap: {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
};

/** 官方 2023mar 12 输出布局里 stride=8 的一份有效检测结果。 */
function makeYunetOutputs() {
  const cols = SIZE / 8;
  const rows = SIZE / 8;
  const anchors = cols * rows;
  const cls = new Float32Array(anchors);
  const obj = new Float32Array(anchors);
  const bbox = new Float32Array(anchors * 4);
  const kps = new Float32Array(anchors * 10);

  const col = 40;
  const row = 40;
  const index = row * cols + col;
  cls[index] = 0.81;
  obj[index] = 0.81;
  bbox[index * 4] = 0.5; // offsetX
  bbox[index * 4 + 1] = 0.5; // offsetY
  bbox[index * 4 + 2] = Math.log(2); // exp → 宽 2*8 = 16
  bbox[index * 4 + 3] = Math.log(2);
  for (let k = 0; k < 5; k += 1) {
    kps[index * 10 + k * 2] = 0.5;
    kps[index * 10 + k * 2 + 1] = 0.5;
  }

  return {
    cls_8: { data: cls, dims: [1, anchors, 1] },
    obj_8: { data: obj, dims: [1, anchors, 1] },
    bbox_8: { data: bbox, dims: [1, anchors, 4] },
    kps_8: { data: kps, dims: [1, anchors, 10] },
  };
}

function makeSession(
  outputNames: string[] = ['cls_8', 'obj_8', 'bbox_8', 'kps_8']
) {
  return {
    inputNames: ['input'],
    outputNames,
    run: runMock,
  };
}

beforeEach(() => {
  resetFaceDetectionCacheForTests();
  createdTensors.length = 0;
  createMock.mockReset();
  runMock.mockReset();
  envStub.wasm.wasmPaths = '';
  runMock.mockResolvedValue(makeYunetOutputs());
  createMock.mockResolvedValue(makeSession());

  sourceBitmap = {
    width: SRC_WIDTH,
    height: SRC_HEIGHT,
    close: vi.fn(),
  };
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    value: FakeCanvas,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'createImageBitmap', {
    value: vi.fn(async () => sourceBitmap),
    configurable: true,
    writable: true,
  });

  process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'http://localhost:9000';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
  vi.restoreAllMocks();
});

const makeFile = () => new File(['img'], 'a.jpg', { type: 'image/jpeg' });

describe('detectFaces (本地 YuNet)', () => {
  it('以 640×640、0..255 BGR 构造输入,且 RGBA 按 stride=4 剥离', async () => {
    await detectFaces(makeFile());

    expect(createMock).toHaveBeenCalledWith(
      'http://localhost:9000/models/face/yunet/face_detection_yunet_2023mar.onnx'
    );
    expect(envStub.wasm.wasmPaths).toBe(
      `http://localhost:9000/models/ort/${ORT_VERSION}/`
    );
    const tensor = createdTensors[0];
    expect(tensor?.type).toBe('float32');
    expect(tensor?.dims).toEqual([1, 3, SIZE, SIZE]);

    const plane = SIZE * SIZE;
    const [r0, g0, b0] = rgbaAt(0);
    // 默认 BGR:平面 0 = B,平面 1 = G,平面 2 = R,值保持 0..255
    expect(tensor!.data[0]).toBe(b0);
    expect(tensor!.data[plane]).toBe(g0);
    expect(tensor!.data[2 * plane]).toBe(r0);

    // 像素 1:若忘了剥 alpha(按 stride=3 读取 RGBA),这里会读到错误通道。
    const [r1, g1, b1] = rgbaAt(1);
    expect(tensor!.data[1]).toBe(b1);
    expect(tensor!.data[plane + 1]).toBe(g1);
    expect(tensor!.data[2 * plane + 1]).toBe(r1);
  });

  it('解码 12 输出并把人脸框/关键点映射回源图尺寸', async () => {
    const faces = await detectFaces(makeFile());

    expect(faces).toHaveLength(1);
    const face = faces[0]!;
    // 模型输入 640×640 → 源图 1280×640:scaleX=2, scaleY=1
    expect(face.box.x).toBeCloseTo(632, 5);
    expect(face.box.y).toBeCloseTo(316, 5);
    expect(face.box.width).toBeCloseTo(32, 5);
    expect(face.box.height).toBeCloseTo(16, 5);
    expect(face.score).toBeCloseTo(0.81, 5);
    expect(face.landmarks[0]).toEqual([648, 324]);
    expect(sourceBitmap.close).toHaveBeenCalled();
  });

  it('模型加载失败返回空数组,且不缓存失败以便下次重试', async () => {
    createMock.mockRejectedValueOnce(new Error('network down'));

    await expect(detectFaces(makeFile())).resolves.toEqual([]);
    expect(createMock).toHaveBeenCalledTimes(1);

    const retried = await detectFaces(makeFile());
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(retried).toHaveLength(1);
  });

  it('输出布局不是 12 张量时拒绝结果并返回空数组', async () => {
    createMock.mockResolvedValue(makeSession(['output']));
    await expect(detectFaces(makeFile())).resolves.toEqual([]);
    // 布局校验必须在推理之前,不应白跑一次 session.run。
    expect(runMock).not.toHaveBeenCalled();
  });

  it('session 在多次调用间复用', async () => {
    await detectFaces(makeFile());
    await detectFaces(makeFile());
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledTimes(2);
  });
});
