'use client';

/**
 * 本地人脸检测(YuNet 2023mar,onnxruntime-web)。
 *
 * 为什么不用 transformers.js:它不对外暴露裸 InferenceSession,而 YuNet 不是
 * 它支持的 pipeline 任务。这里直接用 onnxruntime-web,与分割共用同一份 wasm
 * 运行时路径(见 model-registry.ortWasmPath)。
 *
 * 解码、NMS、输入尺寸推导、坐标映射全部来自 packages/utils 的共享实现 ——
 * 服务端(onnxruntime-node)与本地路必须得出完全相同的人脸框,否则同一张图在
 * 两种处理模式下会被自动构图裁到不同位置。
 *
 * 检测失败一律返回空数组:自动构图是增强,失败时退回居中裁剪即可,不该让整张
 * 证件照失败。
 */

import {
  createYunetInputTensor,
  decodeYunetRawOutputs,
  scaleDetectedFaces,
  usesRawYunetLayout,
  type DetectedFace,
} from '@utils-plane/utils';
import { YUNET_INPUT_SIZE, ortWasmPath, yunetModelUrl } from './model-registry';

type OrtTensor = unknown;

type OrtLike = {
  env: { wasm: { wasmPaths: string } };
  InferenceSession: {
    create: (url: string) => Promise<{
      inputNames: string[];
      outputNames: string[];
      run: (
        feeds: Record<string, OrtTensor>
      ) => Promise<
        Record<
          string,
          { data: Float32Array; dims: readonly number[] } | undefined
        >
      >;
    }>;
  };
  Tensor: new (
    type: 'float32',
    data: Float32Array,
    dims: number[]
  ) => OrtTensor;
};

type CachedSession = Awaited<ReturnType<OrtLike['InferenceSession']['create']>>;

let ortModule: OrtLike | null = null;
let sessionPromise: Promise<CachedSession> | null = null;

async function getOrt(): Promise<OrtLike> {
  if (!ortModule) {
    // @ts-expect-error TS7016 -- onnxruntime-web 1.22.0-dev 的 exports 未声明 types,
    // 顶层 types.d.ts 在 moduleResolution=bundler 下不可达;运行时形状由 OrtLike 约束。
    const loaded = (await import('onnxruntime-web')) as unknown as OrtLike;
    loaded.env.wasm.wasmPaths = ortWasmPath();
    ortModule = loaded;
  }
  return ortModule;
}

async function getSession(): Promise<CachedSession> {
  if (!sessionPromise) {
    // 先把 promise 赋给模块缓存再 await:并发调用共享同一次加载。
    sessionPromise = (async () => {
      const ort = await getOrt();
      return ort.InferenceSession.create(yunetModelUrl());
    })().catch(err => {
      // 加载失败不能缓存 rejected promise,否则下一次调用永远拿不到重试机会。
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

/** 仅供测试。 */
export function resetFaceDetectionCacheForTests(): void {
  sessionPromise = null;
}

/**
 * @param input 原始文件,或调用方已解码的位图。传位图时直接复用、不再解码,
 *   也不 close(所有权仍在调用方);返回的坐标落在该位图的像素坐标系里。
 */
export async function detectFaces(
  input: Blob | ImageBitmap
): Promise<DetectedFace[]> {
  try {
    const ort = await getOrt();
    const session = await getSession();

    // 我们自托管的权重是官方 2023mar,固定 640。浏览器端的 session 不保证
    // 暴露 inputMetadata,因此以已知常量为准,不静默回落 320。
    const size = YUNET_INPUT_SIZE;

    const owned = input instanceof Blob;
    const bitmap = owned ? await createImageBitmap(input) : input;
    const srcWidth = bitmap.width;
    const srcHeight = bitmap.height;

    try {
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas context unavailable');
      ctx.drawImage(bitmap, 0, 0, size, size);
      const rgba = ctx.getImageData(0, 0, size, size).data;

      // canvas 给的是 RGBA;共享的张量构造假定紧密排列的 3 通道,
      // 这里先剥掉 A 通道,避免步长错位(步长错位不会报错,只会给出离谱的框)。
      const rgb = new Uint8ClampedArray(size * size * 3);
      for (let i = 0; i < size * size; i += 1) {
        rgb[i * 3] = rgba[i * 4] ?? 0;
        rgb[i * 3 + 1] = rgba[i * 4 + 1] ?? 0;
        rgb[i * 3 + 2] = rgba[i * 4 + 2] ?? 0;
      }

      // 默认参数就是生产参数:0..255 + BGR。
      const tensor = createYunetInputTensor(rgb, size);

      const inputName = session.inputNames[0];
      if (!inputName) throw new Error('YuNet session has no input');

      // 布局校验放在推理之前:布局不匹配时结果无法解码,没必要先白跑一次 session.run。
      if (!usesRawYunetLayout(session.outputNames)) {
        throw new Error(
          `unexpected YuNet output layout: ${session.outputNames.join(', ')}`
        );
      }

      const result = await session.run({
        [inputName]: new ort.Tensor('float32', tensor, [
          1,
          3,
          size,
          size,
        ]) as unknown as OrtTensor,
      });

      const faces = decodeYunetRawOutputs(result, {
        inputWidth: size,
        inputHeight: size,
      });

      // drawImage 是简单拉伸(不是等比补边),直接按两轴比例映射回源图。
      return scaleDetectedFaces(faces, {
        scaleX: srcWidth / size,
        scaleY: srcHeight / size,
      });
    } finally {
      if (owned) bitmap.close?.();
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[id-photo-local] face detection unavailable:', error);
    }
    return [];
  }
}
