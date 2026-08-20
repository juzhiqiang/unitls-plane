/// <reference lib="webworker" />

/**
 * 图片处理 Worker。
 *
 * 这里只做「收消息 → 调用与主线程完全相同的实现 → 回消息」,不含任何绘制逻辑。
 * 绘制走 canvas-surface 抽象,在 Worker 里落到 OffscreenCanvas,在主线程落到
 * HTMLCanvasElement —— 同一份代码,不会出现两边行为漂移。
 */

import { renderConvert } from './image-convert-client';
import { renderStitchLayout } from './image-stitch-client';
import type {
  ImageWorkerRequest,
  ImageWorkerResponse,
} from './image-worker-protocol';

async function run(request: ImageWorkerRequest): Promise<Blob> {
  const { job } = request;

  switch (job.op) {
    case 'convert':
      return renderConvert(job.blob, job.toType, job.quality);
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

  run(request)
    .then(blob => {
      const response: ImageWorkerResponse = { id: request.id, ok: true, blob };
      (self as unknown as Worker).postMessage(response);
    })
    .catch((error: unknown) => {
      const response: ImageWorkerResponse = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      (self as unknown as Worker).postMessage(response);
    });
});
