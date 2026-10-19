import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {
  YUNET_INPUT_SIZE,
  parseYunetOutput,
  scaleDetectedFaces,
  type DetectedFace,
} from '@utils-plane/utils';

const YUNET_MODEL_NAME = 'face_detection_yunet_2023mar.onnx';
/** 官方 2023mar 模型的三个特征层 stride。 */
const YUNET_STRIDES = [8, 16, 32] as const;
const DEFAULT_SCORE_THRESHOLD = 0.6;
const DEFAULT_NMS_IOU_THRESHOLD = 0.3;

type ResolveYunetOptions = {
  configuredPath?: string;
  cwd?: string;
  exists?: (modelPath: string) => boolean;
};

export type YunetTensorOptions = {
  /** 乘到 0..255 原始像素上的系数，默认 1/255（归一化到 0..1）。 */
  valueScale?: number;
  /** 模型期望的通道顺序，默认 RGB。 */
  channelOrder?: 'rgb' | 'bgr';
};

export type YunetOutputTensor = {
  data: ArrayLike<number>;
  dims: readonly number[];
};

export type YunetRawOutputs = Record<string, YunetOutputTensor | undefined>;

type DecodeYunetOptions = {
  inputWidth: number;
  inputHeight: number;
  scoreThreshold?: number;
  iouThreshold?: number;
};

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/**
 * 解析 YuNet 权重路径。
 *
 * 候选顺序与 `resolvePortraitSegmentationModelPath` 保持一致，便于运维只记一套约定：
 * env 覆盖 → 仓库内 apps/api/models → 镜像内置 /app/models。
 */
export function resolveYunetModelPath({
  configuredPath = process.env.ID_PHOTO_FACE_MODEL,
  cwd = process.cwd(),
  exists = existsSync,
}: ResolveYunetOptions = {}): string {
  if (configuredPath) return configuredPath;

  const candidates = [
    path.resolve(cwd, `apps/api/models/${YUNET_MODEL_NAME}`),
    path.resolve(cwd, `models/${YUNET_MODEL_NAME}`),
    // 组合镜像把 docker/models/ 复制到 /app/models/id-photo/，YuNet 位于
    // face/yunet/ 子目录（见根 Dockerfile 与 sync-id-photo-models.ts）。
    path.resolve(cwd, `models/id-photo/face/yunet/${YUNET_MODEL_NAME}`),
    path.resolve(cwd, `models/yunet/${YUNET_MODEL_NAME}`),
  ];
  return candidates.find(candidate => exists(candidate)) ?? candidates[0]!;
}

/**
 * 构造 YuNet 输入张量：CHW、float32，默认归一化到 0..1。
 *
 * 旧版单输出导出（共享解析器假定的 `[N, 15]` 布局）用 0..1，MODNet 用 -1..1；
 * 两者写反模型不会报错，只会静默给出离谱的框 —— 所以这里单独成函数并有专门的
 * 测试守着。
 *
 * 官方 2023mar 权重是 OpenCV 导出的原始网络，实测必须直接喂 0..255 的 BGR
 * 输入（0..1 时 obj 恒为 0、一个框都出不来），由 `detect` 传入
 * `valueScale: 1, channelOrder: 'bgr'`。
 */
export function createYunetInputTensor(
  rawRgb: Buffer | Uint8ClampedArray,
  size: number,
  { valueScale = 1 / 255, channelOrder = 'rgb' }: YunetTensorOptions = {}
): Float32Array {
  const plane = size * size;
  const tensor = new Float32Array(3 * plane);
  const rOffset = channelOrder === 'bgr' ? 2 : 0;
  const bOffset = channelOrder === 'bgr' ? 0 : 2;

  for (let i = 0; i < plane; i += 1) {
    const p = i * 3;
    tensor[i] = (rawRgb[p + rOffset] ?? 0) * valueScale;
    tensor[plane + i] = (rawRgb[p + 1] ?? 0) * valueScale;
    tensor[2 * plane + i] = (rawRgb[p + bOffset] ?? 0) * valueScale;
  }
  return tensor;
}

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
 * 与 `parseYunetOutput` 的单输出 `[N, 15]` 布局不同，这里必须按 stride 生成
 * 网格先验并做 NMS，否则同一张脸会在多个 anchor 上重复返回。
 */
export function decodeYunetRawOutputs(
  outputs: YunetRawOutputs,
  {
    inputWidth,
    inputHeight,
    scoreThreshold = DEFAULT_SCORE_THRESHOLD,
    iouThreshold = DEFAULT_NMS_IOU_THRESHOLD,
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
      const width = Math.exp(bbox.data[index * 4 + 2] ?? 0) * stride;
      const height = Math.exp(bbox.data[index * 4 + 3] ?? 0) * stride;
      if (!(width > 0) || !(height > 0)) continue;

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

type SessionWithMetadata = {
  inputMetadata?: ReadonlyArray<{ shape?: readonly number[] }>;
};

/** 官方 2023mar 权重的输入固定为 640x640；旧版导出可能是 320。 */
function resolveYunetInputSize(session: ort.InferenceSession): number {
  const shape = (session as unknown as SessionWithMetadata).inputMetadata?.[0]
    ?.shape;
  const height = shape?.[2];
  const width = shape?.[3];
  if (typeof width === 'number' && width > 0) return width;
  if (typeof height === 'number' && height > 0) return height;
  return YUNET_INPUT_SIZE;
}

function usesRawYunetLayout(
  outputs: ort.InferenceSession['outputNames']
): boolean {
  return outputs.includes('bbox_8') && outputs.includes('kps_8');
}

@Injectable()
export class FaceDetectionService {
  private readonly logger = new Logger(FaceDetectionService.name);
  private sessionPromise?: Promise<ort.InferenceSession>;

  /**
   * 检测人脸，按 score 降序返回。
   *
   * 任何失败（模型缺失、推理异常）都返回空数组 —— 自动构图是增强，不是必需，
   * 没有检测结果时上层退回居中裁剪即可，不该让整张证件照失败。
   */
  async detect(input: Buffer): Promise<DetectedFace[]> {
    try {
      const oriented = await sharp(input).rotate().toBuffer();
      const meta = await sharp(oriented).metadata();
      if (!meta.width || !meta.height) return [];

      const session = await this.getSession();
      const inputName = session.inputNames[0];
      if (!inputName) return [];

      const inputSize = resolveYunetInputSize(session);
      const rawLayout = usesRawYunetLayout(session.outputNames);
      const { data } = await sharp(oriented)
        .resize(inputSize, inputSize, { fit: 'fill' })
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });

      // 官方 2023mar 是 OpenCV 原始网络：0..255、BGR；旧版单输出导出用 0..1 RGB。
      const tensor = rawLayout
        ? createYunetInputTensor(data, inputSize, {
            valueScale: 1,
            channelOrder: 'bgr',
          })
        : createYunetInputTensor(data, inputSize);

      const result = await session.run({
        [inputName]: new ort.Tensor('float32', tensor, [
          1,
          3,
          inputSize,
          inputSize,
        ]),
      });

      const faces = rawLayout
        ? decodeYunetRawOutputs(result as unknown as YunetRawOutputs, {
            inputWidth: inputSize,
            inputHeight: inputSize,
          })
        : this.decodeLegacyOutput(result, session);

      // fill 缩放：两轴独立比例，偏移为 0
      return scaleDetectedFaces(faces, {
        scaleX: meta.width / inputSize,
        scaleY: meta.height / inputSize,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`face detection unavailable: ${message}`);
      return [];
    }
  }

  private decodeLegacyOutput(
    result: ort.InferenceSession.ReturnType,
    session: ort.InferenceSession
  ): DetectedFace[] {
    const outputName = session.outputNames[0];
    if (!outputName) return [];
    const output = result[outputName];
    if (!output) return [];
    return parseYunetOutput(output.data as Float32Array, 15);
  }

  private getSession(): Promise<ort.InferenceSession> {
    if (!this.sessionPromise) {
      // 推理会话创建失败时不缓存 rejected promise，避免一次瞬时失败永久
      // 关闭人脸检测；下次 detect 会重新尝试加载模型。
      const sessionPromise = ort.InferenceSession.create(
        resolveYunetModelPath()
      );
      this.sessionPromise = sessionPromise;
      sessionPromise.catch(() => {
        if (this.sessionPromise === sessionPromise) {
          this.sessionPromise = undefined;
        }
      });
    }
    return this.sessionPromise;
  }
}
