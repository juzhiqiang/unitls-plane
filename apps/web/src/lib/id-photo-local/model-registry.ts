/**
 * 证件照本地模型的资产清单与 URL 构造。
 *
 * 主分割从 RMBG-1.4 换成 MODNet photographic(证件照专用,Apache-2.0),
 * 体积从 ~84MB 降到 ~25MB,CPU wasm 也能跑;人脸检测用 OpenCV Zoo 的
 * YuNet 2023mar(MIT)。两者都由本地 `onnxruntime-web` session 直接加载
 * (不再经 transformers.js pipeline)。
 *
 * 资产自托管在 MinIO `models` 桶(见 ortWasmPath / *ModelUrl):
 *   models/modnet/modnet_photographic.onnx
 *   models/face/yunet/face_detection_yunet_2023mar.onnx
 *   models/ort/<ORT_VERSION>/ort-wasm-simd-threaded{,.jsep}.{wasm,mjs}
 */
export type ModelTier = 'balanced' | 'high';

/** 主分割模型:MODNet photographic(证件照专用,Apache-2.0)。 */
export const MODNET_MODEL_FILE = 'modnet_photographic.onnx';
/** 人脸检测:YuNet 2023mar(MIT)。 */
export const YUNET_MODEL_FILE = 'face_detection_yunet_2023mar.onnx';

/**
 * 本地人脸检测输入尺寸。
 *
 * 官方 2023mar 权重固定 640×640;这个常量必须与自托管权重一致 —— 写错不会
 * 报错,只会静默检测不到人脸。浏览器端 session 不保证暴露 inputMetadata,
 * 故以已知常量为准,不静默回落 320。
 */
export const YUNET_INPUT_SIZE = 640;

export interface ModelMeta {
  /** 资产精度;photographic 只有 fp32 一份权重,保留字段用于档位元数据。 */
  dtype: 'fp16' | 'fp32';
  /**
   * 是否必须有 WebGPU 才启用。
   * photographic 25MB 在 CPU wasm 上可接受,故 balanced 不再锁 WebGPU;
   * high 档保留为「photographic 实测破洞 → 用户手动切 RMBG-1.4 fp32」的退路。
   */
  requiresWebGpu: boolean;
  /** 资产体积(文档/估算用,运行时不依赖)。 */
  sizeBytes: number;
}

/**
 * 档位。
 *
 * 换 photographic 后主分割统一使用同一份 ~25MB 权重;`high` 档保留给
 * 「photographic 实测破洞 → 用户手动切 RMBG-1.4 fp32」这条退路
 * (见 docs/id-photo-model-comparison.md)。
 */
export const ID_PHOTO_MODELS: Record<ModelTier, ModelMeta> = {
  balanced: {
    dtype: 'fp32',
    requiresWebGpu: false,
    sizeBytes: 25 * 1024 * 1024,
  },
  high: {
    dtype: 'fp32',
    requiresWebGpu: true,
    sizeBytes: 176 * 1024 * 1024,
  },
};

/**
 * onnxruntime-web 版本。
 *
 * 用作 wasm 资产的路径前缀:ort 的 JS glue 与 .wasm 是配对的,版本错配会让
 * wasm 缺少 JS 期望的导出(实测踩过两次:`webgpuInit is not a function`、
 * `_OrtGetInputOutputMetadata is not a function`)。而资产是按 immutable 长缓存发布的,
 * 若路径不带版本,升级后浏览器仍会命中旧 wasm —— 必须靠路径变化来破缓存。
 *
 * 该值必须与 apps/web 依赖的 `onnxruntime-web` 版本严格一致;
 * scripts/download-rmbg-assets.cjs 会解析依赖并校验。
 */
export const ORT_VERSION = '1.22.0-dev.20250409-89f8206ba4';

function s3Base(): string {
  const base = process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
  if (!base) throw new Error('NEXT_PUBLIC_S3_PUBLIC_URL is not configured');
  return base;
}

/** MODNet photographic 权重地址。 */
export function modnetModelUrl(): string {
  return `${s3Base()}/models/modnet/${MODNET_MODEL_FILE}`;
}

/** YuNet 2023mar 权重地址。 */
export function yunetModelUrl(): string {
  return `${s3Base()}/models/face/yunet/${YUNET_MODEL_FILE}`;
}

/**
 * onnxruntime-web 的 wasm 运行时目录(必须以 / 结尾)。
 *
 * 离线镜像里没有公网,必须自托管,故显式指向 MinIO。路径带 ORT_VERSION:
 * 见该常量注释,用于在升级时破掉 immutable 缓存。
 */
export function ortWasmPath(): string {
  return `${s3Base()}/models/ort/${ORT_VERSION}/`;
}

/**
 * 给定 WebGPU 是否可用,决定实际使用哪一档。
 * 无 WebGPU 时锁均衡档,避免 high 档在 CPU 上卡死/OOM。
 */
export function tierFor(
  webgpuAvailable: boolean,
  requested: ModelTier
): ModelTier {
  return webgpuAvailable ? requested : 'balanced';
}
