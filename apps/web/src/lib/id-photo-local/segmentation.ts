'use client';

/**
 * 本地人像分割(MODNet photographic,onnxruntime-web)。
 *
 * 从 use-local-id-photo 里抽出来,让证件照与通用抠图共用同一份实现与同一份
 * 模型 session 缓存 —— session 放在模块作用域而不是组件 ref:模型是进程级的
 * 单例资源,用户在证件照页和抠图页之间来回切时不该重新拉 ~25MB 权重。
 *
 * 这里直接用裸 `onnxruntime-web` InfererenceSession,不再经 transformers.js 的
 * `background-removal` pipeline:YuNet 也没有对应的 pipeline 任务,统一运行时
 * 可以共用同一份 wasm 路径与加载逻辑。
 *
 * 输入尺寸走 `@utils-plane/utils` 的 `modnetInputSize`:长边 512、保持长宽比、
 * 32 对齐、**不补边**。补边会稳定复现衣服/人脸破洞,见
 * docs/id-photo-model-comparison.md。
 */

import { modnetInputSize, refinePortraitAlphaBytes } from '@utils-plane/utils';
import {
  ID_PHOTO_MODELS,
  modnetModelUrl,
  ortWasmPath,
  tierFor,
  type ModelTier,
} from './model-registry';

/** 本地执行后端;high 档需要 WebGPU。 */
export type LocalEp = 'webgpu' | 'wasm';

type OrtTensor = unknown;

type OrtSession = {
  inputNames: string[];
  outputNames: string[];
  run: (
    feeds: Record<string, OrtTensor>
  ) => Promise<Record<string, { data: Float32Array } | undefined>>;
};

type OrtLike = {
  env: { wasm: { wasmPaths: string } };
  InferenceSession: {
    create: (
      url: string,
      options?: { executionProviders?: string[] }
    ) => Promise<OrtSession>;
  };
  Tensor: new (
    type: 'float32',
    data: Float32Array,
    dims: number[]
  ) => OrtTensor;
};

let ortModule: OrtLike | null = null;
/** 已成功创建的 session,按「后端 + 档位」缓存。 */
const cachedSessions = new Map<string, OrtSession>();
/** 正在创建的 session:并发调用共享同一次加载。 */
const pendingSessions = new Map<string, Promise<OrtSession>>();

/** 仅供测试:清空模块级 session 缓存与 ort 模块缓存。 */
export function resetSegmentationCacheForTests(): void {
  cachedSessions.clear();
  pendingSessions.clear();
  ortModule = null;
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
 * 拿不到 adapter 与根本没有 navigator.gpu 一样,都按 wasm 处理。
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

async function getOrt(): Promise<OrtLike> {
  if (ortModule) return ortModule;
  // @ts-expect-error TS7016 -- onnxruntime-web 1.22.0-dev 的 exports 未声明 types,
  // 顶层 types.d.ts 在 moduleResolution=bundler 下不可达;运行时形状由 OrtLike 约束。
  const loaded = (await import('onnxruntime-web')) as unknown as OrtLike;
  // 先设置 wasm 路径再缓存模块:路径构造失败(缺 NEXT_PUBLIC_S3_PUBLIC_URL)
  // 时不应把半初始化的模块留在缓存里。
  loaded.env.wasm.wasmPaths = ortWasmPath();
  ortModule = loaded;
  return loaded;
}

async function getSession(
  key: string,
  url: string,
  executionProvider: 'webgpu' | 'wasm'
): Promise<OrtSession> {
  const cached = cachedSessions.get(key);
  if (cached) return cached;

  const pending = pendingSessions.get(key);
  if (pending) return pending;

  const created = (async () => {
    const ort = await getOrt();
    const session = await ort.InferenceSession.create(url, {
      executionProviders: [executionProvider],
    });
    cachedSessions.set(key, session);
    return session;
  })();

  pendingSessions.set(key, created);
  try {
    return await created;
  } finally {
    // 失败时清掉 pending,绝不缓存 rejected promise —— 否则一次网络抖动会让
    // 本次页面生命周期内永远拿不到重试机会。
    pendingSessions.delete(key);
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

  const effectiveTier = tierFor(ep === 'webgpu', requestedTier);
  const meta = ID_PHOTO_MODELS[effectiveTier];
  if (!meta) throw new Error(`unknown model tier: ${effectiveTier}`);

  if (isStale?.()) throw new StaleSegmentationError();

  const ort = await getOrt();

  const cacheKey = `${ep}:${effectiveTier}`;
  let session = cachedSessions.get(cacheKey);
  if (!session) {
    onDownloadProgress?.(0);
    session = await getSession(
      cacheKey,
      modnetModelUrl(),
      ep === 'webgpu' ? 'webgpu' : 'wasm'
    );
    if (isStale?.()) throw new StaleSegmentationError();
    onDownloadProgress?.(1);
  }

  const bitmap = await createImageBitmap(file);
  try {
    // 动态尺寸:长边 512、保持长宽比、32 对齐、不补边。
    const box = modnetInputSize({
      width: bitmap.width,
      height: bitmap.height,
    });
    const inputW = box.width;
    const inputH = box.height;

    const canvas = new OffscreenCanvas(inputW, inputH);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    ctx.drawImage(bitmap, 0, 0, inputW, inputH);
    const pixels = ctx.getImageData(0, 0, inputW, inputH).data;

    const plane = inputW * inputH;
    const tensor = new Float32Array(3 * plane);
    // canvas 给的是 RGBA(步长 4);tensor 是紧密的 CHW RGB。
    // 步长写错不会报错,只会让整张图错位。
    for (let i = 0; i < plane; i += 1) {
      for (let c = 0; c < 3; c += 1) {
        tensor[c * plane + i] = ((pixels[i * 4 + c] ?? 0) / 255 - 0.5) / 0.5;
      }
    }

    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    if (!inputName || !outputName) {
      throw new Error('MODNet session has no input/output');
    }

    const result = await session.run({
      [inputName]: new ort.Tensor('float32', tensor, [
        1,
        3,
        inputH,
        inputW,
      ]) as unknown as OrtTensor,
    });
    if (isStale?.()) throw new StaleSegmentationError();

    const matte = result[outputName]?.data;
    if (!matte) throw new Error('MODNet session returned no matte');

    // 蒙版缩放回原尺寸 → 作为 alpha 与原图合成(输入没有补边,直接用整张蒙版)
    const matteCanvas = new OffscreenCanvas(inputW, inputH);
    const mctx = matteCanvas.getContext('2d');
    if (!mctx) throw new Error('2D canvas context unavailable');
    const imageData = mctx.createImageData(inputW, inputH);
    // 与服务端 sharp 路径共用同一份 alpha 收敛:0..1 matte → 0..255 → 黑白点 + gamma。
    // 不收敛会让本地路残留背景/光晕,同一张图在两端出现明显不同的边缘。
    const rawAlpha = new Uint8Array(plane);
    for (let i = 0; i < plane; i += 1) {
      rawAlpha[i] = Math.max(
        0,
        Math.min(255, Math.round((matte[i] ?? 0) * 255))
      );
    }
    const alpha = refinePortraitAlphaBytes(rawAlpha);
    for (let i = 0; i < plane; i += 1) {
      imageData.data[i * 4] = 255;
      imageData.data[i * 4 + 1] = 255;
      imageData.data[i * 4 + 2] = 255;
      imageData.data[i * 4 + 3] = alpha[i] ?? 0;
    }
    mctx.putImageData(imageData, 0, 0);

    const out = new OffscreenCanvas(bitmap.width, bitmap.height);
    const octx = out.getContext('2d');
    if (!octx) throw new Error('2D canvas context unavailable');
    octx.drawImage(bitmap, 0, 0);
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(
      matteCanvas,
      0,
      0,
      inputW,
      inputH,
      0,
      0,
      bitmap.width,
      bitmap.height
    );
    octx.globalCompositeOperation = 'source-over';

    return await createImageBitmap(out);
  } finally {
    bitmap.close?.();
  }
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
