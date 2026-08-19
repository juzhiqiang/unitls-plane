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
  dstH: number
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
 * alpha 收敛曲线的默认阈值(归一化 0..1)。
 *
 * 取值依据(实测,黑帽子 + 暗背景样张):ISNet 在低对比场景会输出一大片"不确定"的
 * 中间 alpha —— 半透明像素占比达 16.13%,帽子实体部分 alpha 中位数只有 232 而非 255。
 * 这会同时造成两个可见缺陷:
 *   1. 底色透过帽子实体(9% 的红底叠在黑帽子上)→ 帽子整体染色;
 *   2. 边缘软过渡带保留着原图暗背景的颜色([124,104,90])→ 脖子/肩部一圈脏红雾。
 * 用 smoothstep(0.40, 0.75) 把中间 alpha 推向两端后,半透明占比降到 1.13%,
 * 两个缺陷都消失,且仍保留一条窄过渡带做抗锯齿(直接二值化会出锯齿)。
 */
const ALPHA_LO = 0.4;
const ALPHA_HI = 0.75;

/**
 * 收敛 alpha:把 [lo,hi] 之外的中间值推向全透明/全不透明,窄带内用 smoothstep 平滑。
 *
 * 只改 alpha 通道,不动 RGB —— 边缘的颜色污染靠"把该像素判为全透明"消除,
 * 而不是去猜真实前景色(真正的 decontaminate 需要 trimap,成本不匹配)。
 */
export function solidifyAlpha(
  data: Uint8ClampedArray,
  lo = ALPHA_LO,
  hi = ALPHA_HI
): void {
  const loByte = lo * 255;
  const span = (hi - lo) * 255;
  for (let i = 3; i < data.length; i += 4) {
    let t = (data[i]! - loByte) / span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    // smoothstep:3t²-2t³,两端一阶导为 0,过渡不突兀
    data[i] = Math.round(t * t * (3 - 2 * t) * 255);
  }
}

/**
 * 把透明抠图 cutout 叠到纯色背景上,按 preset 宽高比 contain 居中裁剪并缩放到目标像素。
 *
 * @imgly `removeBackground` 已产出含 alpha matte 的透明 RGBA 抠图,无需再用 mask 烤前景;
 * 但其 alpha 在低对比场景偏软(见 solidifyAlpha 注释),叠纯色底前需要先收敛,
 * 否则底色会透过主体、且边缘会带上原图背景色。
 *
 * 收敛在原始分辨率上做,再缩放到 preset —— 缩放本身会对 alpha 做双线性平均,
 * 顺带得到干净的抗锯齿边缘。
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
  outputType: 'image/jpeg' | 'image/png'
): Promise<Blob> {
  const { r, g, b } = hexToRgb(backgroundColor);
  const srcW = cutout.width;
  const srcH = cutout.height;

  // 先在原始分辨率上收敛 alpha,再参与裁剪缩放(缩放的双线性平均顺带做抗锯齿)。
  const refined = new OffscreenCanvas(srcW, srcH);
  const rctx = refined.getContext('2d')!;
  rctx.drawImage(cutout, 0, 0);
  const cut = rctx.getImageData(0, 0, srcW, srcH);
  solidifyAlpha(cut.data);
  rctx.putImageData(cut, 0, 0);

  // 裁剪区域(原图坐标,按 preset 宽高比 contain 居中)+ 缩放到 preset 像素
  const crop = cropToPresetBounds(srcW, srcH, presetW, presetH);
  const out = new OffscreenCanvas(presetW, presetH);
  const octx = out.getContext('2d')!;
  // 纯色背景
  octx.fillStyle = `rgb(${r},${g},${b})`;
  octx.fillRect(0, 0, presetW, presetH);
  // 透明抠图叠上(source-over:前景 × alpha + 背景 × (1-alpha))
  octx.drawImage(
    refined,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
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
