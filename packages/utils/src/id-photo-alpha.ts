/**
 * 证件照 alpha 收敛(服务端 sharp 路径与浏览器本地路共用)。
 *
 * MODNet photographic 输出的是前景概率 matte,边缘会残留低置信度的背景像素。
 * 这里用黑/白点把低置信度压成 0、高置信度抬到 255,中间段按 gamma 提升,
 * 让本地路与服务端对同一张图得到一致的边缘。
 *
 * 纯函数,不依赖 Node/Buffer 或 DOM,两端可以直接共用同一份实现。
 */

export const PORTRAIT_ALPHA_BLACK_POINT = 72;
export const PORTRAIT_ALPHA_WHITE_POINT = 144;
export const PORTRAIT_ALPHA_GAMMA = 0.55;

/**
 * @param alpha 0..255 的 alpha 字节
 * @returns 新的 Uint8Array;不修改入参
 */
export function refinePortraitAlphaBytes(
  alpha: Uint8Array | Uint8ClampedArray
): Uint8Array {
  const refined = new Uint8Array(alpha.length);
  const range = PORTRAIT_ALPHA_WHITE_POINT - PORTRAIT_ALPHA_BLACK_POINT;

  for (let i = 0; i < alpha.length; i += 1) {
    const value = alpha[i] ?? 0;
    if (value <= PORTRAIT_ALPHA_BLACK_POINT) {
      refined[i] = 0;
      continue;
    }
    if (value >= PORTRAIT_ALPHA_WHITE_POINT) {
      refined[i] = 255;
      continue;
    }

    const normalized = (value - PORTRAIT_ALPHA_BLACK_POINT) / range;
    refined[i] = Math.round(
      Math.max(0, Math.min(1, normalized ** PORTRAIT_ALPHA_GAMMA)) * 255
    );
  }

  return refined;
}
