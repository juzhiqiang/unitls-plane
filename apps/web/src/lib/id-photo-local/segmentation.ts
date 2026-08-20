'use client';

/**
 * 本地人像分割(BRIA RMBG-1.4,经 @huggingface/transformers 的 background-removal pipeline)。
 *
 * 从 use-local-id-photo 里抽出来,让证件照与通用抠图共用同一份实现与同一份模型缓存 ——
 * pipeline 缓存放在模块作用域而不是组件 ref:模型是进程级的单例资源,用户在证件照页
 * 和抠图页之间来回切时不该重新拉 84MB。
 *
 * 许可提醒:RMBG-1.4 是 BRIA 自有许可,商用需向 BRIA 申请授权(见 model-registry)。
 */

import {
  ID_PHOTO_MODELS,
  modelsBaseUrl,
  ortWasmPath,
  RMBG_MODEL_ID,
  tierFor,
  type ModelTier,
} from './model-registry';

/** 本地执行后端;高精度档需要 WebGPU。 */
export type LocalEp = 'webgpu' | 'wasm';

type SegmentFn = (input: string | Blob) => Promise<unknown>;

let cached: { tier: ModelTier; seg: SegmentFn } | null = null;

/** 仅供测试:清掉模块级 pipeline 缓存。 */
export function resetSegmentationCacheForTests(): void {
  cached = null;
}

export interface SegmentationOptions {
  /** 下载阶段进度,0..1。推理阶段没有细粒度进度,不回调。 */
  onDownloadProgress?: (ratio: number) => void;
  /** 返回 true 时中止:用于丢弃过期会话的结果。 */
  isStale?: () => boolean;
}

/**
 * 探测 WebGPU 是否可用。
 *
 * 拿不到 adapter 与根本没有 navigator.gpu 一样,都按 wasm 处理 —— 高精度档(fp32,
 * 约 176MB)在 CPU 上会卡死甚至 OOM,必须锁掉。
 */
export async function detectLocalEp(): Promise<LocalEp> {
  const gpu =
    typeof navigator !== 'undefined'
      ? (
          navigator as unknown as {
            gpu?: { requestAdapter?: () => Promise<unknown> };
          }
        ).gpu
      : undefined;

  if (!gpu?.requestAdapter) return 'wasm';

  try {
    return (await gpu.requestAdapter()) ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}

/**
 * 跑一次分割,产出带 alpha 的抠图位图(与输入同尺寸)。
 *
 * 调用方负责 close() 返回的 ImageBitmap。
 */
export async function segmentToCutout(
  file: Blob,
  requestedTier: ModelTier,
  ep: LocalEp,
  options: SegmentationOptions = {}
): Promise<ImageBitmap> {
  const { onDownloadProgress, isStale } = options;

  // 懒加载 transformers.js:仅在用户真正点击处理时按需加载(代码分割,SSR 不评估该库)。
  const tf = await import('@huggingface/transformers');
  if (isStale?.()) throw new StaleSegmentationError();

  const webgpu = ep === 'webgpu';
  const effectiveTier = tierFor(webgpu, requestedTier);
  const meta = ID_PHOTO_MODELS[effectiveTier];
  if (!meta) throw new Error(`unknown model tier: ${effectiveTier}`);

  // 资产全部自托管在 MinIO:关掉本地路径探测,把 remoteHost 指向自有对象存储,
  // 并显式设置 ort wasm 目录(否则 transformers.js 会去 jsDelivr 取,离线镜像里拿不到)。
  tf.env.allowLocalModels = false;
  tf.env.remoteHost = modelsBaseUrl();
  tf.env.remotePathTemplate = '{model}/';
  const ortWasm = tf.env.backends?.onnx?.wasm;
  if (ortWasm) ortWasm.wasmPaths = ortWasmPath();

  let seg = cached?.tier === effectiveTier ? cached.seg : null;
  if (!seg) {
    seg = (await tf.pipeline('background-removal', RMBG_MODEL_ID, {
      dtype: meta.dtype,
      device: webgpu ? 'webgpu' : 'wasm',
      progress_callback: (p: {
        status?: string;
        progress?: number;
        file?: string;
      }) => {
        if (isStale?.()) return;
        if (p.status === 'progress' && typeof p.progress === 'number') {
          onDownloadProgress?.(Math.max(0, Math.min(1, p.progress / 100)));
        }
      },
    })) as unknown as SegmentFn;
    if (isStale?.()) throw new StaleSegmentationError();
    cached = { tier: effectiveTier, seg };
  }

  const out = await seg(file);
  if (isStale?.()) throw new StaleSegmentationError();

  // pipeline 返回 RawImage(或其数组),toCanvas() 给出带 alpha 的抠图
  const raw = (Array.isArray(out) ? out[0] : out) as {
    toCanvas?: () => HTMLCanvasElement | OffscreenCanvas;
  };
  if (!raw?.toCanvas) throw new Error('unexpected pipeline output');

  return createImageBitmap(raw.toCanvas() as unknown as CanvasImageSource);
}

/** 会话已过期(用户重置或换了输入),调用方应静默丢弃。 */
export class StaleSegmentationError extends Error {
  constructor() {
    super('segmentation session is stale');
    this.name = 'StaleSegmentationError';
  }
}

export function isStaleSegmentation(error: unknown): boolean {
  return error instanceof StaleSegmentationError;
}
