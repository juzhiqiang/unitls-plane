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
/**
 * 输入像素数上限（2 MP）。
 *
 * 参考口径「长边 >= 512 且短边 <= 512 时保持原尺寸」没有长边上限，
 * 20000×400 这类极端长图会直接变成 20000×384，即约 768 万像素/通道：
 * float32 输入 tensor 约 92MB，MODNet 内部激活值可达数 GB。API worker
 * 并发为 2 且容器未限制内存，足以触发 OOM。2 MP 对全部证件照尺寸都没有
 * 实际影响（4000×6000、1280×1706 等经正常缩放后都远低于该值）。
 */
export const MODNET_MAX_INPUT_PIXELS = 2_097_152;
const ALIGN = 32;

function alignDown(value: number): number {
  return Math.max(ALIGN, value - (value % ALIGN));
}

export function modnetInputSize(
  source: { width: number; height: number },
  longEdge: number = MODNET_LONG_EDGE
): { width: number; height: number } {
  if (source.width <= 0 || source.height <= 0) {
    const edge = alignDown(Math.round(longEdge));
    return { width: edge, height: edge };
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

  width = alignDown(width);
  height = alignDown(height);

  // 极端长宽比保护：保持比例继续缩小到 2 MP 以内，仍然不补边。
  if (width * height > MODNET_MAX_INPUT_PIXELS) {
    const scale = Math.sqrt(MODNET_MAX_INPUT_PIXELS / (width * height));
    width = alignDown(Math.floor(width * scale));
    height = alignDown(Math.floor(height * scale));

    // 32 对齐的最小值可能让极窄/极扁输入在缩放后仍超限，再压一次长边。
    if (width * height > MODNET_MAX_INPUT_PIXELS) {
      if (width <= height) {
        height = alignDown(Math.floor(MODNET_MAX_INPUT_PIXELS / width));
      } else {
        width = alignDown(Math.floor(MODNET_MAX_INPUT_PIXELS / height));
      }
    }
  }

  return { width, height };
}
