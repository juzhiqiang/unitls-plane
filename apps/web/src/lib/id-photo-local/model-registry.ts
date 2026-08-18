/**
 * 证件照本地抠图模型清单(@imgly/background-removal,ISNet)。
 *
 * 资产托管在自有 MinIO `models` 桶下 `imgly/<version>/dist/`:
 * `resources.json` 清单 + 若干按 SHA256 命名的分块(运行时分块 wasm + ISNet 模型)。
 * 库运行时从 publicPath 拉 resources.json 再拼分块,详见 docs/id-photo-models.md。
 */
export type ModelTier = 'balanced' | 'high';

/** @imgly 库版本,必须与 apps/web/package.json 的依赖一致(资产按版本分目录托管)。 */
export const IMGLY_VERSION = '1.7.0';

export interface ModelMeta {
  /** @imgly 模型资源键(对应 resources.json 里 /models/<name>)。 */
  model: 'isnet_fp16' | 'isnet';
  /**
   * 是否必须有 WebGPU 才启用。
   * isnet(168MB)在 CPU wasm 上过慢且易 OOM,高精度档锁 WebGPU;
   * isnet_fp16(84MB)允许 CPU 兜底。
   */
  requiresWebGpu: boolean;
  /** 资产体积(文档/估算用,运行时不依赖)。 */
  sizeBytes: number;
}

export const ID_PHOTO_MODELS: Record<ModelTier, ModelMeta> = {
  // 均衡档:ISNet fp16,默认。WebGPU 优先,CPU 兜底。
  balanced: {
    model: 'isnet_fp16',
    requiresWebGpu: false,
    sizeBytes: 84 * 1024 * 1024,
  },
  // 高精度档:ISNet fp32,仅 WebGPU。
  high: {
    model: 'isnet',
    requiresWebGpu: true,
    sizeBytes: 168 * 1024 * 1024,
  },
};

/**
 * @imgly 资产在自有对象存储的 publicPath。
 * 库会从此处拉 resources.json + 分块 wasm/模型;桶 `models` 只读匿名下载。
 */
export function imglyPublicPath(): string {
  const base = process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
  if (!base) throw new Error('NEXT_PUBLIC_S3_PUBLIC_URL is not configured');
  return `${base}/models/imgly/${IMGLY_VERSION}/dist/`;
}

/**
 * 给定 WebGPU 是否可用,决定实际使用哪一档。
 * 无 WebGPU 时锁均衡档(isnet_fp16),避免 isnet 在 CPU 上卡死/OOM。
 */
export function tierFor(
  webgpuAvailable: boolean,
  requested: ModelTier,
): ModelTier {
  return webgpuAvailable ? requested : 'balanced';
}
