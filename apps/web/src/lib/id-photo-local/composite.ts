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
 * 旋转必须作用在目标尺寸画布上、绕成片中心进行，方向与服务端 sharp
 * `.rotate(-rotation)` 保持一致：canvas 的正角同样是顺时针，因此这里也取负。
 *
 * @param cutout 抠图产出的透明 ImageBitmap（自带 alpha）
 * @param rotation 自动构图算出的旋转角（度，逆时针为正），0 表示不转
 */
export async function compositeIdPhoto(
  cutout: ImageBitmap,
  backgroundColor: string,
  presetW: number,
  presetH: number,
  outputType: 'image/jpeg' | 'image/png',
  crop?: IdPhotoCrop,
  rotation = 0
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

  // 2) 从 RGBA 里提取紧密的 3 通道 RGB 用于底色估计
  const pixelCount = cutout.width * cutout.height;
  const rgbTriples = new Uint8ClampedArray(pixelCount * 3);
  for (let i = 0; i < pixelCount; i += 1) {
    rgbTriples[i * 3] = srcData.data[i * 4] ?? 0;
    rgbTriples[i * 3 + 1] = srcData.data[i * 4 + 1] ?? 0;
    rgbTriples[i * 3 + 2] = srcData.data[i * 4 + 2] ?? 0;
  }
  const sourceBackground = estimateSourceBackgroundColors(
    rgbTriples,
    cutout.width,
    cutout.height
  )[0] ?? {
    r: 255,
    g: 255,
    b: 255,
  };

  // 3) 去污染后写回源 canvas
  const cleaned = decontaminateIdPhotoForeground(
    srcData.data,
    cutout.width,
    cutout.height,
    sourceBackground
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

  const blob = await out.convertToBlob({
    type: outputType,
    quality: outputType === 'image/jpeg' ? 0.95 : undefined,
  });

  // 5) 写回 300dpi：canvas 不写密度，打印会按 72dpi 解释
  return writeDpi(blob, 300);
}
