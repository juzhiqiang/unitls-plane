/**
 * 图片处理 Worker 的消息协议。
 *
 * 所有载荷都是可结构化克隆的(Blob / 纯对象),不传函数与 ImageBitmap ——
 * Blob 本身就是跨线程廉价传递的引用,让 Worker 自己解码比在主线程解好再转移更省事,
 * 也避免了「谁负责 close」的归属问题。
 */

import type { EncodableImageType } from './image-encoding-support';
import type { ImageStitchLayout } from './image-stitch-client';
import type { RenderWatermarkOptions } from './image-watermark-client';

export type ImageWorkerJob =
  | {
      op: 'convert';
      blob: Blob;
      toType: EncodableImageType;
      quality: number;
    }
  | {
      op: 'watermark';
      blob: Blob;
      logo: Blob | null;
      options: RenderWatermarkOptions;
    }
  | {
      op: 'stitch';
      blobs: Blob[];
      layout: ImageStitchLayout;
      outputType: string;
      quality?: number;
    };

export interface ImageWorkerRequest {
  id: number;
  job: ImageWorkerJob;
}

export type ImageWorkerResponse =
  | { id: number; ok: true; blob: Blob }
  | { id: number; ok: false; error: string };
