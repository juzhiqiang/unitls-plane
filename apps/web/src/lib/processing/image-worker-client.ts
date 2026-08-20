'use client';

/**
 * Worker 调度层。
 *
 * convert / watermark / stitch / animation 此前全部在主线程跑 canvas 与编码,
 * 大图或多帧时 UI 会整段冻住,进度条自己都动不了。
 *
 * 这里的取舍:
 * - 不做「Worker 版实现」,只做调度。真正的绘制走与主线程完全相同的函数(见
 *   canvas-surface),所以 Worker 挂掉时可以无缝回落,两条路的产出必然一致。
 * - 任何一步失败(不支持 OffscreenCanvas、Worker 构造失败、消息出错)都回落主线程,
 *   而不是把错误抛给用户 —— 搬进 Worker 是性能优化,不该变成新的失败来源。
 */

import { canRenderOffscreen } from './canvas-surface';
import type {
  ImageWorkerJob,
  ImageWorkerRequest,
  ImageWorkerResponse,
} from './image-worker-protocol';

interface Pending {
  resolve: (blob: Blob) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
/** 构造失败过一次就不再重试,避免每张图都付一次失败开销。 */
let workerUnavailable = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAllPending(message: string): void {
  pending.forEach(entry => entry.reject(new Error(message)));
  pending.clear();
}

function getWorker(): Worker | null {
  if (workerUnavailable) return null;
  if (worker) return worker;
  if (!canRenderOffscreen()) {
    workerUnavailable = true;
    return null;
  }

  try {
    worker = new Worker(new URL('./image.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    workerUnavailable = true;
    return null;
  }

  worker.addEventListener(
    'message',
    (event: MessageEvent<ImageWorkerResponse>) => {
      const response = event.data;
      const entry = pending.get(response.id);
      if (!entry) return;
      pending.delete(response.id);
      if (response.ok) entry.resolve(response.blob);
      else entry.reject(new Error(response.error));
    }
  );

  worker.addEventListener('error', () => {
    // Worker 整体崩了:让在途请求走各自的回落分支,并停用 Worker。
    failAllPending('Image worker crashed');
    worker?.terminate();
    worker = null;
    workerUnavailable = true;
  });

  return worker;
}

function postJob(instance: Worker, job: ImageWorkerJob): Promise<Blob> {
  const id = nextId++;
  const request: ImageWorkerRequest = { id, job };

  return new Promise<Blob>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      instance.postMessage(request);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * 在 Worker 里跑一个任务;不可用或失败时用 fallback 在主线程跑。
 *
 * fallback 必须与 Worker 侧调用同一份实现,否则回落路径会悄悄产出不同结果。
 */
export async function runInImageWorker(
  job: ImageWorkerJob,
  fallback: () => Promise<Blob>
): Promise<Blob> {
  const instance = getWorker();
  if (!instance) return fallback();

  try {
    return await postJob(instance, job);
  } catch {
    return fallback();
  }
}

/** 仅供测试:重置模块级状态。 */
export function resetImageWorkerForTests(): void {
  worker?.terminate();
  worker = null;
  workerUnavailable = false;
  nextId = 1;
  pending.clear();
}
