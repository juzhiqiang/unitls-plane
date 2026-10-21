/**
 * 从分割蒙版的 alpha 取真实头顶(第一条「像头顶边缘」的前景行)。
 *
 * YuNet 人脸框上沿在发际线附近,不是头顶;`suggestIdPhotoLayout` 在有真实头顶
 * 时会据此上移裁剪框。本地路直接扫 cutout 的 RGBA,服务端扫 sharp 解出的单通道
 * 蒙版 —— 两端共用这一份扫描,门槛才不会悄悄分叉。
 *
 * 不能「单个像素命中就返回」:抠图顶部常有零星半透明噪点,哪怕只有一两个像素,
 * 也足以把裁剪框整体上移导致构图失真。因此每行要求前景像素数不少于
 * `max(3, 2% * width)`。alpha 阈值 96(严格大于)用于跳过边缘的半透明像素。
 *
 * 纯函数,不依赖 Node/Buffer 或 DOM。
 */

export const CROWN_ALPHA_THRESHOLD = 96;
export const CROWN_MIN_FOREGROUND_PIXELS = 3;
export const CROWN_MIN_FOREGROUND_RATIO = 0.02;

/**
 * @param alpha 蒙版像素;`channels=1` 时每像素 1 字节(就是 alpha),
 *   `channels=4` 时为交错 RGBA,只读第 4 通道
 * @param channels 每像素字节数,决定步长
 * @returns 首个合格行的 y;没有任何合格行时为 undefined
 */
export function findCrownY(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  channels: 1 | 4
): number | undefined {
  const alphaOffset = channels - 1;
  const minForeground = Math.max(
    CROWN_MIN_FOREGROUND_PIXELS,
    width * CROWN_MIN_FOREGROUND_RATIO
  );
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width * channels;
    let foreground = 0;
    for (let x = 0; x < width; x += 1) {
      const value = alpha[rowStart + x * channels + alphaOffset] ?? 0;
      if (value > CROWN_ALPHA_THRESHOLD) foreground += 1;
    }
    if (foreground >= minForeground) return y;
  }
  return undefined;
}
