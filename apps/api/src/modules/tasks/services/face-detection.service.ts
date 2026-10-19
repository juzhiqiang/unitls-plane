import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {
  createYunetInputTensor,
  decodeYunetRawOutputs,
  resolveYunetInputSize,
  scaleDetectedFaces,
  usesRawYunetLayout,
  type DetectedFace,
  type YunetRawOutputs,
  type YunetSessionMetadata,
} from '@utils-plane/utils';

const YUNET_MODEL_NAME = 'face_detection_yunet_2023mar.onnx';

type ResolveYunetOptions = {
  configuredPath?: string;
  cwd?: string;
  exists?: (modelPath: string) => boolean;
};

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

      // 只支持官方 2023mar 的 12 输出布局；旧版单输出 [N,15] 已无真实权重。
      if (!usesRawYunetLayout(session.outputNames)) {
        this.logger.warn(
          'face detection unavailable: unsupported YuNet output layout'
        );
        return [];
      }

      const inputSize = resolveYunetInputSize(
        session as unknown as YunetSessionMetadata
      );
      const { data } = await sharp(oriented)
        .resize(inputSize, inputSize, { fit: 'fill' })
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });

      // 默认即官方 2023mar 的 0..255 BGR；预处理细节由共享模块负责。
      const tensor = createYunetInputTensor(data, inputSize);

      const result = await session.run({
        [inputName]: new ort.Tensor('float32', tensor, [
          1,
          3,
          inputSize,
          inputSize,
        ]),
      });

      const faces = decodeYunetRawOutputs(
        result as unknown as YunetRawOutputs,
        { inputWidth: inputSize, inputHeight: inputSize }
      );

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
