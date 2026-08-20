/// <reference lib="webworker" />

/**
 * 图片处理 Worker。
 *
 * 这里只做「收消息 → 调用与主线程完全相同的实现 → 回消息」,不含任何绘制逻辑。
 * 绘制走 canvas-surface 抽象,在 Worker 里落到 OffscreenCanvas,在主线程落到
 * HTMLCanvasElement —— 同一份代码,不会出现两边行为漂移。
 */

import {
  renderAnimation,
  renderCompressedAnimation,
} from './image-animation-client';
import { renderConvert } from './image-convert-client';
import { renderStitchLayout } from './image-stitch-client';
import { renderWatermark } from './image-watermark-client';
import type {
  ImageWorkerRequest,
  ImageWorkerResponse,
} from './image-worker-protocol';

async function run(
  request: ImageWorkerRequest,
  onProgress: (value: number) => void
): Promise<Blob> {
  const { job } = request;

  switch (job.op) {
    case 'animate':
      return renderAnimation(job.blobs, job.options, onProgress);
    case 'animate-compress':
      return renderCompressedAnimation(
        job.blob,
        job.options,
        job.limits,
        onProgress
      );
    case 'convert':
      return renderConvert(job.blob, job.toType, job.quality);
    case 'watermark':
      return renderWatermark(job.blob, job.logo, job.options);
    case 'stitch':
      return renderStitchLayout(
        job.blobs,
        job.layout,
        job.outputType,
        job.quality
      );
    default: {
      const never: never = job;
      throw new Error(`Unsupported job: ${JSON.stringify(never)}`);
    }
  }
}

self.addEventListener('message', (event: MessageEvent<ImageWorkerRequest>) => {
  const request = event.data;
  const post = (response: ImageWorkerResponse) =>
    (self as unknown as Worker).postMessage(response);

  // 进度节流:动图逐帧上报,几十帧的话消息本身也是开销;只在变化超过 1% 时发。
  let lastSent = -1;
  const onProgress = (value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    if (clamped - lastSent < 0.01 && clamped < 1) return;
    lastSent = clamped;
    post({ id: request.id, type: 'progress', value: clamped });
  };

  run(request, onProgress)
    .then(blob => post({ id: request.id, type: 'done', blob }))
    .catch((error: unknown) =>
      post({
        id: request.id,
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
});
