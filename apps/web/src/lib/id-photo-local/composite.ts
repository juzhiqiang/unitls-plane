import {
  resolveIdPhotoCropBox,
  type IdPhotoCrop,
} from '@utils-plane/validators';

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
 * 把透明抠图 cutout 叠到纯色背景上,按 crop 解算出的框裁剪并缩放到目标像素。
 *
 * 裁剪几何一律走 validators 的 resolveIdPhotoCropBox —— 服务端 sharp 路径用的是
 * 同一个函数,这样同一组 crop 参数在本地与服务端产出完全一致的构图。
 *
 * RMBG-1.4 的 alpha 足够干净,无需再做 alpha 收敛,此处只做「叠底 + 裁剪 + 缩放」。
 *
 * @param cutout 抠图产出的透明 ImageBitmap(自带 alpha)
 * @param backgroundColor #rrggbb
 * @param presetW presetH 目标像素(如 295×413)
 * @param crop 归一化裁剪参数;省略即居中不放大
 */
export async function compositeIdPhoto(
  cutout: ImageBitmap,
  backgroundColor: string,
  presetW: number,
  presetH: number,
  outputType: 'image/jpeg' | 'image/png',
  crop?: IdPhotoCrop
): Promise<Blob> {
  const { r, g, b } = hexToRgb(backgroundColor);
  const box = resolveIdPhotoCropBox(
    cutout.width,
    cutout.height,
    presetW,
    presetH,
    crop
  );
  const out = new OffscreenCanvas(presetW, presetH);
  const octx = out.getContext('2d')!;
  // 纯色背景
  octx.fillStyle = `rgb(${r},${g},${b})`;
  octx.fillRect(0, 0, presetW, presetH);
  // 透明抠图叠上(source-over:前景 × alpha + 背景 × (1-alpha))
  octx.drawImage(
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

  const blob = await out.convertToBlob({
    type: outputType,
    quality: outputType === 'image/jpeg' ? 0.92 : undefined,
  });
  return blob;
}
