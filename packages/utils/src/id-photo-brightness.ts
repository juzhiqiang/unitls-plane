/**
 * 证件照亮度自动校正的共用口径。
 *
 * 本地 canvas 路与服务端 sharp 路必须对同一张裁剪后的成片得到相同的均值：
 * - 统计范围是裁剪并缩放到成片尺寸后的像素，不是整幅源图；
 * - 只统计 alpha > 0 的前景像素，大片透明/未选区不参与，避免均值被拉向 0。
 *
 * 输入是交错 RGBA（与 canvas ImageData、服务端拼装后的缓冲区一致）。
 * 纯函数，不依赖 DOM / sharp。
 */
export function computeForegroundMeanBrightness(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): number {
  const pixels = width * height;
  if (!Number.isFinite(pixels) || pixels <= 0 || rgba.length < pixels * 4) {
    return 0;
  }

  let sum = 0;
  let count = 0;
  for (let i = 0; i < pixels; i += 1) {
    const p = i * 4;
    if ((rgba[p + 3] ?? 0) === 0) continue;
    sum += ((rgba[p] ?? 0) + (rgba[p + 1] ?? 0) + (rgba[p + 2] ?? 0)) / 3;
    count += 1;
  }
  return count ? sum / count : 0;
}
