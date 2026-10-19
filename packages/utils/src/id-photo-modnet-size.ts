/**
 * MODNet 模型输入尺寸：长边 512、保持长宽比、宽高取 32 的倍数、**不补边**。
 *
 * 口径与参考实现 matting.py:portrait_alpha 一致：
 *   长边 < 512 或 短边 > 512 → 按长边缩放到 512；否则保持原尺寸；
 *   最后把宽高向下取整到 32 的倍数（MODNet 的下采样需要 32 对齐）。
 *
 * 为什么不能补边成正方形：实测证明同一份 photographic 权重在
 * 「512×512 + 补黑边」下会稳定产生衣服 2 个洞 + 人脸 1 个大洞（1524 px），
 * 而不补边时是 0 个洞（见 docs/id-photo-model-comparison.md）。
 * 补边引入的纯色区域会被模型当成前景断开处，后处理补不回来。
 *
 * 放在 packages/utils 而不是各端各写一份：服务端 onnxruntime-node 与
 * 浏览器 onnxruntime-web 必须看到完全相同的输入尺寸，否则两端出图不一致。
 */

export const MODNET_LONG_EDGE = 512;
const ALIGN = 32;

export function modnetInputSize(
  source: { width: number; height: number },
  longEdge: number = MODNET_LONG_EDGE
): { width: number; height: number } {
  if (source.width <= 0 || source.height <= 0) {
    return { width: longEdge, height: longEdge };
  }

  const longest = Math.max(source.width, source.height);
  const shortest = Math.min(source.width, source.height);

  let width = source.width;
  let height = source.height;
  if (longest < longEdge || shortest > longEdge) {
    const scale = longEdge / longest;
    width = Math.round(source.width * scale);
    height = Math.round(source.height * scale);
  }

  width = Math.max(ALIGN, width - (width % ALIGN));
  height = Math.max(ALIGN, height - (height % ALIGN));
  return { width, height };
}
