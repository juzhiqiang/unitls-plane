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
 * 把透明抠图 cutout 叠到纯色背景上,按 preset 宽高比 contain 居中裁剪并缩放到目标像素。
 *
 * @imgly `removeBackground` 已产出含 alpha matte 的透明 RGBA 抠图,无需再用 mask 烤前景;
 * 此处只做"叠底 + 按证件照比例居中裁剪 + 缩放到 preset 像素"。
 *
 * @param cutout removeBackground 产出的透明 ImageBitmap(自带 alpha)
 * @param backgroundColor #rrggbb
 * @param presetW presetH 目标像素(如 295×413)
 */
export async function compositeIdPhoto(
  cutout: ImageBitmap,
  backgroundColor: string,
  presetW: number,
  presetH: number,
  outputType: 'image/jpeg' | 'image/png',
): Promise<Blob> {
  const { r, g, b } = hexToRgb(backgroundColor);
  const srcW = cutout.width;
  const srcH = cutout.height;
  // 裁剪区域(原图坐标,按 preset 宽高比 contain 居中)+ 缩放到 preset 像素
  const crop = cropToPresetBounds(srcW, srcH, presetW, presetH);
  const out = new OffscreenCanvas(presetW, presetH);
  const octx = out.getContext('2d')!;
  // 纯色背景
  octx.fillStyle = `rgb(${r},${g},${b})`;
  octx.fillRect(0, 0, presetW, presetH);
  // 透明抠图叠上(source-over:前景 × alpha + 背景 × (1-alpha))
  octx.drawImage(
    cutout,
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
