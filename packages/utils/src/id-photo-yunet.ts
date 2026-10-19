/**
 * YuNet（face_detection_yunet_2023mar）推理的共享实现。
 *
 * 服务端（onnxruntime-node）与本地路（onnxruntime-web）使用同一份权重，
 * 因此张量构造、12 输出解码、NMS、输入尺寸探测和布局判定必须共用一份代码，
 * 否则两端会随时间漂移。
 *
 * 约束：本文件不得依赖 `sharp`、`node:*` 或 DOM API —— 它要能同时跑在
 * Node/Bun 和浏览器里。调用方负责把图片解码成 RGB(A) 的原始字节。
 */

export interface DetectedFace {
  box: { x: number; y: number; width: number; height: number };
  landmarks: Array<[number, number]>;
  score: number;
}

/** 官方 2023mar 模型的三个特征层 stride。 */
export const YUNET_STRIDES = [8, 16, 32] as const;

/**
 * 人脸置信度阈值。
 *
 * OpenCV `FaceDetectorYN` 默认是 0.9，这里取更宽松的 0.6：本检测只服务于
 * 证件照自动构图，漏检会退回居中裁剪（构图变差但仍可用），而 0.9 会漏掉
 * 侧脸、轻度遮挡和偏小的脸。重复框由 NMS（IoU 0.3）消除，误检风险主要由
 * 下游的构图/质量检查兜底。
 */
export const DEFAULT_YUNET_SCORE_THRESHOLD = 0.6;

/** 贪心 NMS 的 IoU 阈值，与 OpenCV 默认一致。 */
export const DEFAULT_YUNET_NMS_IOU_THRESHOLD = 0.3;

/**
 * 模型未声明静态输入 shape 时的兜底尺寸。
 *
 * 官方 2023mar 固定 640；旧版导出可能没有静态 shape。320 仅作为最后一档
 * 兜底，不要在业务代码里把它当作“默认模型尺寸”使用。
 */
const FALLBACK_INPUT_SIZE = 320;

export type YunetTensorOptions = {
  /**
   * 乘到 0..255 原始像素上的系数，默认 1（保持 0..255）。
   *
   * 旧版单输出导出（已不再支持）使用 1 / 255；官方 2023mar 必须用 1。
   */
  valueScale?: number;
  /**
   * 模型期望的通道顺序，默认 'bgr'。
   *
   * 官方 2023mar 是 OpenCV 导出的原始网络，0..255 BGR 才有效；传错顺序或
   * 归一化尺度不会报错，只会静默给出空结果或离谱的框。
   */
  channelOrder?: 'rgb' | 'bgr';
};

export type YunetOutputTensor = {
  data: ArrayLike<number>;
  dims: readonly number[];
};

export type YunetRawOutputs = Record<string, YunetOutputTensor | undefined>;

export type DecodeYunetOptions = {
  inputWidth: number;
  inputHeight: number;
  scoreThreshold?: number;
  iouThreshold?: number;
};

/**
 * 构造 YuNet 输入张量：CHW、float32。
 *
 * 默认值是官方 2023mar 权重的真实路径：0..255 + BGR。旧版单输出导出使用的
 * 0..1 + RGB 必须显式传参（`{ valueScale: 1 / 255, channelOrder: 'rgb' }`），
 * 不再作为默认值，避免生产路径和测试各走一套。
 *
 * `rawPixels` 假定为按 R、G、B、（A）排列的像素；模型期望 BGR 时，输出平面
 * 0 读取原始 B 通道（`p + 2`），平面 2 读取 R 通道（`p + 0`）。
 */
export function createYunetInputTensor(
  rawPixels: ArrayLike<number>,
  size: number,
  { valueScale = 1, channelOrder = 'bgr' }: YunetTensorOptions = {}
): Float32Array {
  const plane = size * size;
  const tensor = new Float32Array(3 * plane);
  // 目标平面 0/2 在原始 RGB 字节里的读取偏移：BGR 时平面 0 读 B、平面 2 读 R。
  const plane0Offset = channelOrder === 'bgr' ? 2 : 0;
  const plane2Offset = channelOrder === 'bgr' ? 0 : 2;

  for (let i = 0; i < plane; i += 1) {
    const p = i * 3;
    tensor[i] = (rawPixels[p + plane0Offset] ?? 0) * valueScale;
    tensor[plane + i] = (rawPixels[p + 1] ?? 0) * valueScale;
    tensor[2 * plane + i] = (rawPixels[p + plane2Offset] ?? 0) * valueScale;
  }
  return tensor;
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

function iou(a: DetectedFace['box'], b: DetectedFace['box']): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  if (intersection <= 0) return 0;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function greedyNms(faces: DetectedFace[], threshold: number): DetectedFace[] {
  const sorted = [...faces].sort((a, b) => b.score - a.score);
  const kept: DetectedFace[] = [];
  for (const face of sorted) {
    if (kept.every(other => iou(other.box, face.box) <= threshold)) {
      kept.push(face);
    }
  }
  return kept;
}

/**
 * 解析官方 2023mar 的 12 输出布局（cls/obj/bbox/kps × stride 8/16/32）。
 *
 * 必须按 stride 生成网格先验并做 NMS，否则同一张脸会在多个 anchor 上重复
 * 返回。输出按 score 降序。
 */
export function decodeYunetRawOutputs(
  outputs: YunetRawOutputs,
  {
    inputWidth,
    inputHeight,
    scoreThreshold = DEFAULT_YUNET_SCORE_THRESHOLD,
    iouThreshold = DEFAULT_YUNET_NMS_IOU_THRESHOLD,
  }: DecodeYunetOptions
): DetectedFace[] {
  if (!(inputWidth > 0) || !(inputHeight > 0)) return [];

  const faces: DetectedFace[] = [];

  for (const stride of YUNET_STRIDES) {
    const cls = outputs[`cls_${stride}`];
    const obj = outputs[`obj_${stride}`];
    const bbox = outputs[`bbox_${stride}`];
    const kps = outputs[`kps_${stride}`];
    if (!cls || !obj || !bbox || !kps) continue;

    const cols = Math.floor(inputWidth / stride);
    const rows = Math.floor(inputHeight / stride);
    if (cols <= 0 || rows <= 0) continue;

    const anchors = Math.min(
      cols * rows,
      cls.data.length,
      obj.data.length,
      Math.floor(bbox.data.length / 4),
      Math.floor(kps.data.length / 10)
    );

    for (let index = 0; index < anchors; index += 1) {
      const row = Math.floor(index / cols);
      const col = index % cols;

      const score = Math.sqrt(
        clamp01(cls.data[index] ?? 0) * clamp01(obj.data[index] ?? 0)
      );
      if (!(score >= scoreThreshold)) continue;

      const offsetX = bbox.data[index * 4] ?? 0;
      const offsetY = bbox.data[index * 4 + 1] ?? 0;
      const rawWidth = Math.exp(bbox.data[index * 4 + 2] ?? 0);
      const rawHeight = Math.exp(bbox.data[index * 4 + 3] ?? 0);
      // 异常权重/损坏输入可能让 exp 溢出成 Infinity；丢弃该 anchor 而不是
      // 返回一个 Infinity 框（后续坐标映射会把整张图变成 NaN）。
      if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight)) continue;

      const width = rawWidth * stride;
      const height = rawHeight * stride;
      if (!(width > 0) || !(height > 0)) continue;
      if (!Number.isFinite(width) || !Number.isFinite(height)) continue;

      const centerX = (col + offsetX) * stride;
      const centerY = (row + offsetY) * stride;

      const landmarks: Array<[number, number]> = [];
      for (let k = 0; k < 5; k += 1) {
        landmarks.push([
          ((kps.data[index * 10 + k * 2] ?? 0) + col) * stride,
          ((kps.data[index * 10 + k * 2 + 1] ?? 0) + row) * stride,
        ]);
      }

      faces.push({
        box: {
          x: centerX - width / 2,
          y: centerY - height / 2,
          width,
          height,
        },
        landmarks,
        score,
      });
    }
  }

  return greedyNms(faces, iouThreshold);
}

/** 仅暴露 onnxruntime session 中被输入尺寸探测用到的字段。 */
export type YunetSessionMetadata = {
  inputMetadata?: ReadonlyArray<{ shape?: readonly (number | string)[] }>;
};

/**
 * 从 session 的输入元数据解析模型输入边长。
 *
 * 官方 2023mar 是 640x640。shape 缺失或不是正数时回落到 320（仅为兼容
 * 没有静态 shape 的旧导出）。
 */
export function resolveYunetInputSize(session: YunetSessionMetadata): number {
  const shape = session.inputMetadata?.[0]?.shape;
  const height = shape?.[2];
  const width = shape?.[3];
  if (typeof width === 'number' && width > 0) return width;
  if (typeof height === 'number' && height > 0) return height;
  return FALLBACK_INPUT_SIZE;
}

/**
 * 判断模型输出是否为官方 2023mar 的 12 张量布局。
 *
 * 旧版单输出导出（`[N, 15]`）已无真实权重使用，服务端不再兼容；这里保留
 * 判定是为了在配置了不支持的模型时明确拒绝，而不是静默给出空检测结果。
 */
export function usesRawYunetLayout(outputNames: readonly string[]): boolean {
  return outputNames.includes('bbox_8') && outputNames.includes('kps_8');
}

/**
 * 把人脸框与关键点从模型输入分辨率映射回源图分辨率。
 *
 * 预处理若是等比缩放 + 居中补边，需要传 `letterbox` 的偏移与比例；
 * 简单拉伸则传 `scaleX/scaleY` 即可。
 */
export function scaleDetectedFaces(
  faces: DetectedFace[],
  scale: { scaleX: number; scaleY: number; offsetX?: number; offsetY?: number }
): DetectedFace[] {
  const { scaleX, scaleY, offsetX = 0, offsetY = 0 } = scale;
  return faces.map(face => ({
    box: {
      x: (face.box.x - offsetX) * scaleX,
      y: (face.box.y - offsetY) * scaleY,
      width: face.box.width * scaleX,
      height: face.box.height * scaleY,
    },
    landmarks: face.landmarks.map(
      ([lx, ly]) =>
        [(lx - offsetX) * scaleX, (ly - offsetY) * scaleY] as [number, number]
    ),
    score: face.score,
  }));
}
