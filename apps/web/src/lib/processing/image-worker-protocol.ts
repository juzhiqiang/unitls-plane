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
import type {
  AnimationCompressOptions,
  AnimationCreateOptions,
  AnimationPlanLimits,
} from './image-animation-client';

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
    }
  | {
      op: 'animate';
      blobs: Blob[];
      /** 已在主线程 normalize + 校验过。 */
      options: AnimationCreateOptions;
    }
  | {
      op: 'animate-compress';
      blob: Blob;
      options: AnimationCompressOptions;
      /**
       * 压缩方案要先解码才能算(帧数、原始尺寸),拆到主线程就等于白解一遍,
       * 所以把额度一起传进来在 Worker 里算。客户端额度本就是建议性的,
       * 真正的强制在服务端。
       */
      limits: AnimationPlanLimits;
    };

export interface ImageWorkerRequest {
  id: number;
  job: ImageWorkerJob;
}

/**
 * 响应用 type 区分而不是布尔 ok:加进度消息后,「成功/失败」两态已经不够用了。
 * 动图编码几十帧要跑好几秒,没有进度的话进度条会长时间不动,用户以为卡死。
 */
export type ImageWorkerResponse =
  | { id: number; type: 'done'; blob: Blob }
  | { id: number; type: 'error'; error: string }
  | { id: number; type: 'progress'; value: number };
