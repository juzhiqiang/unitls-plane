import {
  estimateSourceBackgroundColors,
  resolveIdPhotoCropBox,
  suggestBrightnessAdjustment,
  type IdPhotoCrop,
} from '@utils-plane/validators';
import {
  computeForegroundMeanBrightness,
  decontaminateIdPhotoForeground,
} from '@utils-plane/utils';
import { encode as encodeJpeg } from 'jpeg-js';
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
 * 亮度校正参数：
 * - 数字：直接使用该加法偏移；
 * - `'auto'`：在裁剪后的成片尺寸上、只对 alpha > 0 的前景求均值，再交给共享的
 *   `suggestBrightnessAdjustment`。与服务端同一口径。
 */
export type IdPhotoBrightness = number | 'auto';

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

function rgbPlane(rgba: Uint8ClampedArray, width: number, height: number) {
  const pixelCount = width * height;
  const rgb = new Uint8ClampedArray(pixelCount * 3);
  for (let i = 0; i < pixelCount; i += 1) {
    rgb[i * 3] = rgba[i * 4] ?? 0;
    rgb[i * 3 + 1] = rgba[i * 4 + 1] ?? 0;
    rgb[i * 3 + 2] = rgba[i * 4 + 2] ?? 0;
  }
  return rgb;
}

/**
 * 把透明抠图叠到纯色背景上，按 crop 解算出的框裁剪并缩放到目标像素。
 *
 * 剪辑几何一律走 validators 的 resolveIdPhotoCropBox —— 服务端 sharp 路径用的是
 * 同一个函数，这样同一组 crop 参数在本地与服务端产出完全一致的构图。
 *
 * 去污染与底色估计都必须在**裁剪后的成片尺寸**上做，与服务端一致：
 * 1. 先把 cutout 按 crop 框缩放到 `presetW × presetH`；
 * 2. 从原图（`source`）按同一个裁剪框取同尺寸像素，估计底色；
 * 3. 在成片尺寸的 RGBA 上做去污染；
 * 4. 最后才叠到新底色上。
 *
 * 距离带的 3.5px 阈值是像素单位：在源图尺寸上去污染会让发丝/肩线的光晕抑制
 * 范围随图片分辨率变化，两端结果明显不同。底色也不能从 overlay 之后的新画布
 * 估计（那时底色已经被换成用户选择的新颜色）。
 *
 * `source` 必须是未抠图的原图：cutout 的透明背景经 destination-in 后 RGB 已归零，
 * 从它反推底色只能得到黑色。缺失时退回 cutout 估计，并对「三通道都 < 8」
 * 的不可信结果跳过整段去污染（宁可不去污染，也不要制造白边）。
 *
 * 旋转必须作用在目标尺寸画布上、绕成片中心进行，方向与服务端 sharp
 * `.rotate(-rotation)` 保持一致：canvas 的正角同样是顺时针，因此这里也取负。
 *
 * @param cutout 抠图产出的透明 ImageBitmap（自带 alpha）
 * @param rotation 自动构图算出的旋转角（度，逆时针为正），0 表示不转
 * @param source 原图；用于在成片尺寸上估计底色。调用方负责 close
 * @param brightness 亮度校正；`'auto'` 时按裁剪后的前景均值计算
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
  source?: ImageBitmap | null,
  brightness: IdPhotoBrightness = 0,
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

  // 1) 按 crop 框把抠图缩放到成片尺寸。此时背景仍是 cutout 的透明像素
  //    （RGB 可能已被归零），但 alpha 与前景像素已与成片一一对应。
  const fgCanvas = new OffscreenCanvas(presetW, presetH);
  const fgCtx = fgCanvas.getContext('2d');
  if (!fgCtx) throw new Error('2D canvas context unavailable');
  fgCtx.drawImage(
    cutout,
    box.left,
    box.top,
    box.width,
    box.height,
    0,
    0,
    presetW,
    presetH
  );
  const fgData = fgCtx.getImageData(0, 0, presetW, presetH);

  // 2) 底色：从原图同一裁剪框、同一成片尺寸取样，语义与服务端完全一致。
  let background: Rgb | null = null;
  if (source) {
    const sourceCanvas = new OffscreenCanvas(presetW, presetH);
    const sourceCtx = sourceCanvas.getContext('2d');
    if (!sourceCtx) throw new Error('2D canvas context unavailable');
    sourceCtx.drawImage(
      source,
      box.left,
      box.top,
      box.width,
      box.height,
      0,
      0,
      presetW,
      presetH
    );
    const sourceData = sourceCtx.getImageData(0, 0, presetW, presetH).data;
    const estimated = estimateSourceBackgroundColors(
      rgbPlane(sourceData, presetW, presetH),
      presetW,
      presetH
    )[0];
    // 原图给出的黑色底是可信的（真实黑底），不做「不可信」拦截。
    background = estimated ?? null;
  } else {
    const estimated = estimateSourceBackgroundColors(
      rgbPlane(fgData.data, presetW, presetH),
      presetW,
      presetH
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

  // 3) 亮度均值与去污染都在成片尺寸的未调色前景上做。
  //    均值必须在去污染/调色之前取，与服务端的输入一致。
  const brightnessOffset =
    brightness === 'auto'
      ? suggestBrightnessAdjustment(
          computeForegroundMeanBrightness(fgData.data, presetW, presetH)
        )
      : brightness;

  let workingPixels: Uint8ClampedArray<ArrayBuffer> | null = null;
  if (background) {
    const cleaned = decontaminateIdPhotoForeground(
      fgData.data,
      presetW,
      presetH,
      background
    );
    // 复制到显式 ArrayBuffer 支撑的视图：共享 utils 的返回类型是
    // Uint8ClampedArray<ArrayBufferLike>，而 ImageData 只接受 ArrayBuffer。
    workingPixels = new Uint8ClampedArray(cleaned.length);
    workingPixels.set(cleaned);
  }

  // 4) 亮度自动校正：加法偏移，只作用于前景（alpha > 0）像素；透明区
  //    保持原样。放在去污染之后，避免「反预乘还原出的真实前景色」被当成
  //    带底色的边缘值再放大。底色不可信、跳过去污染时也要独立生效。
  if (brightnessOffset !== 0) {
    const target = workingPixels ?? new Uint8ClampedArray(fgData.data);
    for (let i = 0; i < target.length; i += 4) {
      if ((target[i + 3] ?? 0) === 0) continue;
      target[i] = Math.max(
        0,
        Math.min(255, (target[i] ?? 0) + brightnessOffset)
      );
      target[i + 1] = Math.max(
        0,
        Math.min(255, (target[i + 1] ?? 0) + brightnessOffset)
      );
      target[i + 2] = Math.max(
        0,
        Math.min(255, (target[i + 2] ?? 0) + brightnessOffset)
      );
    }
    workingPixels = target;
  }

  if (workingPixels) {
    fgCtx.putImageData(new ImageData(workingPixels, presetW, presetH), 0, 0);
  }

  // 5) 合成：纯色底 + 成片尺寸的前景（可选旋转）
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

  octx.drawImage(fgCanvas, 0, 0, presetW, presetH);

  // 6) 质量检查需要成片尺寸的像素。rgba 直接取最终画布（含底色）；
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
    fgctx.drawImage(fgCanvas, 0, 0, presetW, presetH);
    const fgData = fgctx.getImageData(0, 0, presetW, presetH).data;
    const alpha = new Uint8ClampedArray(presetW * presetH);
    for (let i = 0; i < alpha.length; i += 1) {
      alpha[i] = fgData[i * 4 + 3] ?? 0;
    }
    onOutput({ rgba, alpha, width: presetW, height: presetH });
  }

  // 7) 编码。
  //
  // JPEG 不能交给 canvas：`convertToBlob` 不暴露色度采样，Chrome/Skia 默认
  // 4:2:0 —— 纯色证件照底色会在色度通道上被下采样，边缘出现色噪。服务端
  // sharp 固定 `chromaSubsampling: '4:4:4'`，本地必须对齐；jpeg-js 对每个
  // 分量都写 0x11 采样因子，天然 4:4:4。
  //
  // PNG 不需要这层控制，继续走 canvas 编码。
  const blob =
    outputType === 'image/jpeg'
      ? encodeJpegBlob(
          octx.getImageData(0, 0, presetW, presetH),
          presetW,
          presetH
        )
      : await out.convertToBlob({ type: outputType });

  // 8) 写回 300dpi：canvas 不写密度，打印会按 72dpi 解释
  return writeDpi(blob, 300);
}

/**
 * 用 jpeg-js 把 RGBA 像素编码成 JPEG。
 *
 * jpeg-js 在 CJS/Node 环境返回 Buffer（Uint8Array 子类）；这里只按
 * Uint8Array 读取并复制到独立缓冲区，不调用 `Buffer.from`。浏览器端由
 * Next 的客户端 polyfill 满足 jpeg-js 内部的 Buffer 引用。
 *
 * 质量参数是 0–100 的整数，95 与服务端 sharp 配置一致。
 */
function encodeJpegBlob(
  image: { data: Uint8ClampedArray },
  width: number,
  height: number
): Blob {
  const encoded = encodeJpeg({ data: image.data, width, height }, 95);
  const bytes = encoded.data as unknown as Uint8Array;
  const payload = new Uint8Array(bytes.length);
  payload.set(bytes);
  return new Blob([payload], { type: 'image/jpeg' });
}
