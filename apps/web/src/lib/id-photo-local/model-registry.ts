export type ModelTier = 'balanced' | 'high';

export interface ModelMeta {
  key: string;
  bucketPath: string;
  sizeBytes: number;
  quant: 'fp16' | 'q4f16';
}

export const ID_PHOTO_MODELS: Record<ModelTier, ModelMeta> = {
  balanced: {
    key: 'rmbg-1.4',
    bucketPath: 'models/rmbg-1.4-fp16.onnx',
    sizeBytes: 84 * 1024 * 1024,
    quant: 'fp16',
  },
  high: {
    key: 'rmbg-2.0',
    bucketPath: 'models/rmbg-2.0-q4f16.onnx',
    sizeBytes: 234 * 1024 * 1024,
    quant: 'q4f16',
  },
};

/**
 * 拼接模型在自有对象存储的公网 URL。桶 `models` 设为只读匿名下载。
 */
export function modelUrl(meta: ModelMeta): string {
  const base = process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
  if (!base) throw new Error('NEXT_PUBLIC_S3_PUBLIC_URL is not configured');
  return `${base}/${meta.bucketPath}`;
}

/**
 * 给定 WebGPU 是否可用,决定实际使用哪一档。
 * CPU 模式锁均衡档(RMBG-1.4),避免 234MB 高精度在 CPU 上卡死/OOM。
 */
export function tierFor(
  webgpuAvailable: boolean,
  requested: ModelTier
): ModelTier {
  return webgpuAvailable ? requested : 'balanced';
}
