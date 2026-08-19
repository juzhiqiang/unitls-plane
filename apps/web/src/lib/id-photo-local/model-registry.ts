/**
 * 证件照本地抠图模型清单(BRIA RMBG-1.4,经 @huggingface/transformers 运行)。
 *
 * 为什么不是 ISNet:实测在「黑帽子 + 暗背景」这类低对比样张上,ISNet 会把整顶帽子判成背景
 * (帽子 alpha 中位数 217 且 44% 低于 102),换底色后帽子染色甚至消失;RMBG-1.4 在同一张图上
 * 帽子 alpha p50=249、衣服 p05=255,半透明像素占比 16.13% → 0.63%,且 WebGPU 下推理
 * 从 9~12s 降到 0.6s。详见 docs/id-photo-models.md。
 *
 * 许可提醒:RMBG-1.4 是 BRIA 自有许可(HF 上标注 license: other),商用需向 BRIA 申请授权。
 * 同架构的 MIT 替代(BiRefNet)实测在浏览器 WebGPU 下 OOM(需一次分配 490MB),
 * Apache-2.0 的 MODNet 会在衣服上开洞,故未采用。
 *
 * 资产自托管在 MinIO `models` 桶(见 modelsBaseUrl),目录结构与 HF 仓库一致:
 *   models/rmbg/1.4/config.json
 *   models/rmbg/1.4/preprocessor_config.json
 *   models/rmbg/1.4/onnx/model_fp16.onnx   (均衡档)
 *   models/rmbg/1.4/onnx/model.onnx        (高精度档 fp32)
 */
export type ModelTier = 'balanced' | 'high';

/** 模型版本,资产按版本分目录托管;改版本需同步下载脚本与 MinIO。 */
export const RMBG_VERSION = '1.4';

/**
 * transformers.js 的 model id。与 MinIO 上 `models/` 下的相对路径一致
 * (配合 remotePathTemplate='{model}/' 拼出资产 URL)。
 */
export const RMBG_MODEL_ID = `rmbg/${RMBG_VERSION}`;

export interface ModelMeta {
  /** transformers.js dtype,决定取 onnx/model_fp16.onnx 还是 onnx/model.onnx。 */
  dtype: 'fp16' | 'fp32';
  /**
   * 是否必须有 WebGPU 才启用。
   * fp32(~176MB)在 CPU wasm 上过慢且易 OOM,高精度档锁 WebGPU;
   * fp16(~88MB)允许 CPU 兜底。
   */
  requiresWebGpu: boolean;
  /** 资产体积(文档/估算用,运行时不依赖)。 */
  sizeBytes: number;
}

export const ID_PHOTO_MODELS: Record<ModelTier, ModelMeta> = {
  // 均衡档:RMBG-1.4 fp16,默认。WebGPU 优先,CPU 兜底。
  balanced: {
    dtype: 'fp16',
    requiresWebGpu: false,
    sizeBytes: 88 * 1024 * 1024,
  },
  // 高精度档:RMBG-1.4 fp32,仅 WebGPU。
  high: {
    dtype: 'fp32',
    requiresWebGpu: true,
    sizeBytes: 176 * 1024 * 1024,
  },
};

/**
 * onnxruntime-web 版本,必须与 @huggingface/transformers 实际依赖的那份一致。
 *
 * 用作 wasm 资产的路径前缀:ort 的 JS glue 与 .wasm 是配对的,版本错配会让
 * wasm 缺少 JS 期望的导出(实测踩过两次:`webgpuInit is not a function`、
 * `_OrtGetInputOutputMetadata is not a function`)。而资产是按 immutable 长缓存发布的,
 * 若路径不带版本,升级后浏览器仍会命中旧 wasm —— 必须靠路径变化来破缓存。
 *
 * scripts/download-rmbg-assets.cjs 会校验本常量与解析到的 ort 版本是否一致,
 * 不一致直接失败并提示改这里(宁可构建期炸,也不要运行期错配)。
 */
export const ORT_VERSION = '1.22.0-dev.20250409-89f8206ba4';

function s3Base(): string {
  const base = process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
  if (!base) throw new Error('NEXT_PUBLIC_S3_PUBLIC_URL is not configured');
  return base;
}

/**
 * transformers.js 的 `env.remoteHost`:模型资产根目录(必须以 / 结尾)。
 * 配合 `env.remotePathTemplate = '{model}/'` 与 RMBG_MODEL_ID 拼出:
 * `${base}/models/rmbg/1.4/<file>`。桶 `models` 为匿名只读。
 */
export function modelsBaseUrl(): string {
  return `${s3Base()}/models/`;
}

/**
 * onnxruntime-web 的 wasm 运行时目录(必须以 / 结尾)。
 *
 * transformers.js 默认从 jsDelivr 取 ort wasm;离线镜像里没有公网,必须自托管,
 * 故显式指向 MinIO(见 scripts/download-rmbg-assets.cjs 会一并复制 ort 运行时)。
 * 路径带 ORT_VERSION:见该常量注释,用于在升级时破掉 immutable 缓存。
 */
export function ortWasmPath(): string {
  return `${s3Base()}/models/ort/${ORT_VERSION}/`;
}

/**
 * 给定 WebGPU 是否可用,决定实际使用哪一档。
 * 无 WebGPU 时锁均衡档(fp16),避免 fp32 在 CPU 上卡死/OOM。
 */
export function tierFor(
  webgpuAvailable: boolean,
  requested: ModelTier
): ModelTier {
  return webgpuAvailable ? requested : 'balanced';
}
