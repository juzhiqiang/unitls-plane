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

export interface CropBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 计算从原图(srcW×srcH)按目标宽高比 contain 后的居中裁剪区域。
 * 返回原图坐标系下的裁剪框;最终再缩放到目标像素。
 */
export function cropToPresetBounds(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): CropBounds {
  const targetRatio = dstW / dstH;
  const srcRatio = srcW / srcH;
  let w: number, h: number;
  if (srcRatio > targetRatio) {
    h = srcH;
    w = h * targetRatio;
  } else {
    w = srcW;
    h = w / targetRatio;
  }
  return { x: (srcW - w) / 2, y: (srcH - h) / 2, width: w, height: h };
}

/**
 * 把原图前景(经 mask alpha 保留)叠到纯色背景上,按 preset 裁剪输出。
 * @param source 原图(已解码为 ImageBitmap)
 * @param maskAlpha 与原图同尺寸的单通道 alpha(0..1),长度 = srcW*srcH
 * @param backgroundColor #rrggbb
 * @param presetW presetH 目标像素(如 295×413)
 */
export async function compositeIdPhoto(
  source: ImageBitmap,
  maskAlpha: Float32Array,
  srcW: number,
  srcH: number,
  backgroundColor: string,
  presetW: number,
  presetH: number,
  outputType: 'image/jpeg' | 'image/png',
): Promise<Blob> {
  const { r, g, b } = hexToRgb(backgroundColor);
  // 1. 前景 × alpha:把 alpha 烤进一张与原图同尺寸的 RGBA canvas
  const fg = new OffscreenCanvas(srcW, srcH);
  const fctx = fg.getContext('2d')!;
  fctx.drawImage(source, 0, 0, srcW, srcH);
  const imageData = fctx.getImageData(0, 0, srcW, srcH);
  const data = imageData.data;
  for (let i = 0; i < srcW * srcH; i++) {
    const a = maskAlpha[i]!;
    data[i * 4 + 3] = Math.round(a * 255);
  }
  fctx.putImageData(imageData, 0, 0);

  // 2. 裁剪区域(原图坐标)+ 缩放到 preset 像素
  const crop = cropToPresetBounds(srcW, srcH, presetW, presetH);
  const out = new OffscreenCanvas(presetW, presetH);
  const octx = out.getContext('2d')!;
  // 纯色背景
  octx.fillStyle = `rgb(${r},${g},${b})`;
  octx.fillRect(0, 0, presetW, presetH);
  // 前景叠上(已带 alpha)
  octx.drawImage(
    fg,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    presetW,
    presetH,
  );

  const blob = await out.convertToBlob({
    type: outputType,
    quality: outputType === 'image/jpeg' ? 0.92 : undefined,
  });
  return blob;
}
