/**
 * 画布抽象:同一份绘制代码既能跑在主线程,也能跑在 Worker 里。
 *
 * 把画布处理搬进 Worker 最容易犯的错,是给 Worker 另写一份绘制实现 —— 那样立刻
 * 就有了「主线程一套、Worker 一套」两份逻辑,两边迟早漂移(本仓库在裁剪、水印位置、
 * 格式映射上都吃过这个亏)。
 *
 * OffscreenCanvas 与 HTMLCanvasElement 的 2D 上下文 API 是一致的,差别只在:
 * - 创建方式:document.createElement('canvas') vs new OffscreenCanvas()
 * - 导出方式:canvas.toBlob(cb, type, quality) vs canvas.convertToBlob({type, quality})
 *
 * 把这两点包起来,上层绘制代码就完全不用关心自己在哪个线程。
 */

export interface CanvasSurface {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  toBlob(type: string, quality?: number): Promise<Blob>;
}

function hasOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas === 'function';
}

/** 当前环境是否具备把画布处理搬进 Worker 的条件。 */
export function canRenderOffscreen(): boolean {
  return typeof Worker === 'function' && hasOffscreenCanvas();
}

export function createSurface(width: number, height: number): CanvasSurface {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));

  if (typeof document === 'undefined') {
    if (!hasOffscreenCanvas()) {
      throw new Error('Canvas is not available');
    }

    const canvas = new OffscreenCanvas(safeWidth, safeHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');

    return {
      ctx,
      width: safeWidth,
      height: safeHeight,
      toBlob: (type, quality) =>
        canvas.convertToBlob({
          type,
          // convertToBlob 对 PNG 忽略 quality;传 undefined 更贴近 toBlob 的语义。
          ...(quality !== undefined && { quality }),
        }),
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = safeWidth;
  canvas.height = safeHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');

  return {
    ctx,
    width: safeWidth,
    height: safeHeight,
    toBlob: (type, quality) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          blob => {
            if (!blob) return reject(new Error('Canvas export failed'));
            resolve(blob);
          },
          type,
          quality
        );
      }),
  };
}
