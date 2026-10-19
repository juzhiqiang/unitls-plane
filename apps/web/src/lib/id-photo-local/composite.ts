import {
  estimateSourceBackgroundColors,
  resolveIdPhotoCropBox,
  type IdPhotoCrop,
} from '@utils-plane/validators';
import { decontaminateIdPhotoForeground } from '@utils-plane/utils';
import { writeDpi } from './dpi-metadata';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * 成片尺寸的像素快照，供质量检查使用。
 *
 * - `rgba` 是含底色的最终画布像素（清晰度/曝光按成片判定）；
 * - `alpha` 是同一几何下前景的 alpha 单通道（边缘半透明比例按成片判定）。
 *
 * 两者都必须取成片尺寸——用源图尺寸会让人脸比例与头顶留白按错误的分母计算。
 */
export interface CompositeOutputPixels {
  rgba: Uint8ClampedArray;
  alpha: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * 从 cutout 反推底色时，三通道都低于此值视为「背景已被 alpha 归零」，
 * 估计不可信，跳过反预乘。
 */
const UNTRUSTED_BACKGROUND_CHANNEL = 8;

export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`invalid background color: ${hex}`);
  const v = m[1]!;
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

/**
 * 把透明抠图叠到纯色背景上，按 crop 解算出的框裁剪并缩放到目标像素。
 *
 * 剪辑几何一律走 validators 的 resolveIdPhotoCropBox —— 服务端 sharp 路径用的是
 * 同一个函数，这样同一组 crop 参数在本地与服务端产出完全一致的构图。
 *
 * 边缘去污染走共享的 decontaminateIdPhotoForeground（反预乘 + 溢色替换）：
 * 抠图 alpha 再干净，边缘像素的 RGB 仍是「前景 × a + 原背景 × (1-a)」，
 * 不还原就会在新底色上留下原背景色的光晕。
 *
 * 底色必须来自**原图**：抠图经过 destination-in 后背景像素的 RGB 已归零，
 * 从 cutout 反推必然得到黑色。反预乘代入 bg=0 会退化成 `c' = c/a`，
 * 半透明边缘被整体放大（白底上就是白边），比不去污染更差。
 * 因此调用方应传入 `sourceBackground`；只有在缺失时才退回 cutout 估计，
 * 并对「三通道都 < 8」的不可信结果跳过整段去污染。
 *
 * 旋转必须作用在目标尺寸画布上、绕成片中心进行，方向与服务端 sharp
 * `.rotate(-rotation)` 保持一致：canvas 的正角同样是顺时针，因此这里也取负。
 *
 * @param cutout 抠图产出的透明 ImageBitmap（自带 alpha）
 * @param rotation 自动构图算出的旋转角（度，逆时针为正），0 表示不转
 * @param sourceBackground 从原图估出的底色；缺省时才从 cutout 估计
 * @param onOutput 可选：合成完成、编码前回调成片像素，供质量检查使用
 */
export async function compositeIdPhoto(
  cutout: ImageBitmap,
  backgroundColor: string,
  presetW: number,
  presetH: number,
  outputType: 'image/jpeg' | 'image/png',
  crop?: IdPhotoCrop,
  rotation = 0,
  sourceBackground?: Rgb,
  onOutput?: (pixels: CompositeOutputPixels) => void
): Promise<Blob> {
  const { r, g, b } = hexToRgb(backgroundColor);
  const box = resolveIdPhotoCropBox(
    cutout.width,
    cutout.height,
    presetW,
    presetH,
    crop
  );

  // 1) 先把抠图画到离屏 canvas，取回 RGBA 像素
  const srcCanvas = new OffscreenCanvas(cutout.width, cutout.height);
  const sctx = srcCanvas.getContext('2d');
  if (!sctx) throw new Error('2D canvas context unavailable');
  sctx.drawImage(cutout, 0, 0);
  const srcData = sctx.getImageData(0, 0, cutout.width, cutout.height);

  // 2) 底色：优先用调用方从原图估出的值。退回 cutout 估计时，透明背景
  //    已经是 (0,0,0)，估计结果必然取黑 —— 三通道都 < 8 视为不可信，
  //    整段跳过去污染（宁可不去污染，也不要制造白边）。
  let background: Rgb | null = sourceBackground ?? null;
  if (!background) {
    const pixelCount = cutout.width * cutout.height;
    const rgbTriples = new Uint8ClampedArray(pixelCount * 3);
    for (let i = 0; i < pixelCount; i += 1) {
      rgbTriples[i * 3] = srcData.data[i * 4] ?? 0;
      rgbTriples[i * 3 + 1] = srcData.data[i * 4 + 1] ?? 0;
      rgbTriples[i * 3 + 2] = srcData.data[i * 4 + 2] ?? 0;
    }
    const estimated = estimateSourceBackgroundColors(
      rgbTriples,
      cutout.width,
      cutout.height
    )[0] ?? { r: 255, g: 255, b: 255 };
    if (
      estimated.r < UNTRUSTED_BACKGROUND_CHANNEL &&
      estimated.g < UNTRUSTED_BACKGROUND_CHANNEL &&
      estimated.b < UNTRUSTED_BACKGROUND_CHANNEL
    ) {
      background = null;
    } else {
      background = estimated;
    }
  }

  // 3) 去污染后写回源 canvas（底色不可信时保持原像素不变）
  if (background) {
    const cleaned = decontaminateIdPhotoForeground(
      srcData.data,
      cutout.width,
      cutout.height,
      background
    );
    // 复制到显式 ArrayBuffer 支撑的视图：共享 utils 的返回类型是
    // Uint8ClampedArray<ArrayBufferLike>，而 ImageData 只接受 ArrayBuffer。
    const cleanedPixels = new Uint8ClampedArray(cleaned.length);
    cleanedPixels.set(cleaned);
    sctx.putImageData(
      new ImageData(cleanedPixels, cutout.width, cutout.height),
      0,
      0
    );
  }

  // 4) 合成：纯色底 + 裁剪框内的前景（可选旋转）
  const out = new OffscreenCanvas(presetW, presetH);
  const octx = out.getContext('2d');
  if (!octx) throw new Error('2D canvas context unavailable');
  octx.fillStyle = `rgb(${r},${g},${b})`;
  octx.fillRect(0, 0, presetW, presetH);

  if (rotation) {
    octx.translate(presetW / 2, presetH / 2);
    // 与 sharp.rotate(-rotation) 对齐：canvas 正角为顺时针。
    octx.rotate((-rotation * Math.PI) / 180);
    octx.translate(-presetW / 2, -presetH / 2);
  }

  octx.drawImage(
    srcCanvas,
    box.left,
    box.top,
    box.width,
    box.height,
    0,
    0,
    presetW,
    presetH
  );

  // 5) 质量检查需要成片尺寸的像素。rgba 直接取最终画布（含底色）；
  //    alpha 必须在「只画前景」的透明画布上取——最终画布已被底色铺满，
  //    其 alpha 恒为 255，用它算 matteEdge 会永远通过。
  if (onOutput) {
    const rgba = octx.getImageData(0, 0, presetW, presetH).data;
    const foreground = new OffscreenCanvas(presetW, presetH);
    const fgctx = foreground.getContext('2d');
    if (!fgctx) throw new Error('2D canvas context unavailable');
    if (rotation) {
      fgctx.translate(presetW / 2, presetH / 2);
      fgctx.rotate((-rotation * Math.PI) / 180);
      fgctx.translate(-presetW / 2, -presetH / 2);
    }
    fgctx.drawImage(
      srcCanvas,
      box.left,
      box.top,
      box.width,
      box.height,
      0,
      0,
      presetW,
      presetH
    );
    const fgData = fgctx.getImageData(0, 0, presetW, presetH).data;
    const alpha = new Uint8ClampedArray(presetW * presetH);
    for (let i = 0; i < alpha.length; i += 1) {
      alpha[i] = fgData[i * 4 + 3] ?? 0;
    }
    onOutput({ rgba, alpha, width: presetW, height: presetH });
  }

  const blob = await out.convertToBlob({
    type: outputType,
    quality: outputType === 'image/jpeg' ? 0.95 : undefined,
  });

  // 6) 写回 300dpi：canvas 不写密度，打印会按 72dpi 解释
  return writeDpi(blob, 300);
}
