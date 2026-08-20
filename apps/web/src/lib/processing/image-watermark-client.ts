import {
  resolveWatermarkAnchor,
  resolveWatermarkMargin,
  type ImageWatermarkPosition,
} from '@utils-plane/validators';
import {
  transformImage,
  type ImageTransformOptions,
} from './image-transform-client';
import { decodeImage, withDecodedImage } from './image-bitmap';
import { createSurface } from './canvas-surface';
import { runInImageWorker } from './image-worker-client';

export type { ImageWatermarkPosition };

export type ImageWatermarkOutputType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp';

/** 文字水印,或图片(Logo)水印。 */
export type ImageWatermarkKind = 'text' | 'logo';

export interface ImageWatermarkColor {
  r: number;
  g: number;
  b: number;
}

export interface ImageWatermarkOptions {
  kind?: ImageWatermarkKind;
  text: string;
  /** kind === 'logo' 时必填。 */
  logo?: Blob | null;
  /** Logo 宽度占画面宽度的比例,0.02..1。 */
  logoScale?: number;
  position: ImageWatermarkPosition;
  fontSize: number;
  opacity: number;
  color: ImageWatermarkColor;
  rotation: number;
  /**
   * 给文字描一圈反色边。
   *
   * 半透明灰字压在浅色照片上几乎看不见,是水印最常见的翻车方式;描边能在任何底色上
   * 保持可读,又不至于像加阴影那样显脏。
   */
  outline?: boolean;
  outputType: ImageWatermarkOutputType;
  quality: number;
  transform?: ImageTransformOptions;
}

const OUTPUT_EXTENSIONS: Record<ImageWatermarkOutputType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MIN_LOGO_SCALE = 0.02;
const MAX_LOGO_SCALE = 1;
export const DEFAULT_LOGO_SCALE = 0.2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getWatermarkedImageName(
  filename: string,
  outputType: ImageWatermarkOutputType
): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `watermarked-${base}.${OUTPUT_EXTENSIONS[outputType]}`;
}

export function colorToCss(
  color: ImageWatermarkColor,
  opacity: number
): string {
  const r = clamp(Math.round(color.r), 0, 255);
  const g = clamp(Math.round(color.g), 0, 255);
  const b = clamp(Math.round(color.b), 0, 255);
  const a = clamp(opacity, 0, 1);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** 描边取正反色:亮字配深边,暗字配亮边,任何底图上都能读。 */
export function outlineColorFor(
  color: ImageWatermarkColor,
  opacity: number
): string {
  const luma = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
  const shade = luma > 140 ? 0 : 255;
  return `rgba(${shade}, ${shade}, ${shade}, ${clamp(opacity, 0, 1) * 0.85})`;
}

export function clampLogoScale(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_LOGO_SCALE;
  return clamp(value as number, MIN_LOGO_SCALE, MAX_LOGO_SCALE);
}

/** Logo 按目标宽度等比缩放后的绘制尺寸。 */
export function resolveLogoSize(
  logoWidth: number,
  logoHeight: number,
  canvasWidth: number,
  scale: number
): { width: number; height: number } {
  const width = Math.max(1, Math.round(canvasWidth * clampLogoScale(scale)));
  const height = Math.max(
    1,
    Math.round((logoHeight / Math.max(1, logoWidth)) * width)
  );
  return { width, height };
}

export async function watermarkImage(
  file: File,
  options: ImageWatermarkOptions
): Promise<File> {
  const preparedFile = await transformImage(
    file,
    options.transform ?? {},
    options.outputType,
    options.quality / 100
  );
  // transform 已经在上面落地,不必再随任务传进 Worker。
  const { transform: _transform, logo, ...rest } = options;
  const renderOptions: RenderWatermarkOptions = rest;

  const blob = await runInImageWorker(
    {
      op: 'watermark',
      blob: preparedFile,
      logo: logo ?? null,
      options: renderOptions,
    },
    () => renderWatermark(preparedFile, logo ?? null, renderOptions)
  );

  return new File(
    [blob],
    getWatermarkedImageName(file.name, options.outputType),
    { type: options.outputType }
  );
}

/** watermarkImage 去掉 transform 与 logo 之后的部分,可结构化克隆。 */
export type RenderWatermarkOptions = Omit<
  ImageWatermarkOptions,
  'transform' | 'logo'
>;

/**
 * 只做「解码 → 画水印 → 编码」,不碰 File/文件名。
 *
 * 与 renderConvert / renderStitchLayout 同一模式,供 Worker 与主线程共用同一份实现。
 *
 * 字体说明:字体栈固定为系统字体(Arial/Helvetica/sans-serif)。Worker 里没有
 * document.fonts,自定义 Web 字体加载不进来;用系统字体两边渲染结果一致。若将来要
 * 支持用户自选字体,必须先在 Worker 里 FontFace.load,否则回落路径与 Worker 路径会
 * 画出不同的字。
 */
export async function renderWatermark(
  source: Blob,
  logoSource: Blob | null,
  options: RenderWatermarkOptions
): Promise<Blob> {
  const kind = options.kind ?? 'text';
  // Logo 在进入 withDecodedImage 之前解好:回调里再 await 会让底图的释放时机变复杂。
  const logo =
    kind === 'logo' && logoSource ? await decodeImage(logoSource) : null;

  try {
    return await withDecodedImage(source, async img => {
      const surface = createSurface(img.width, img.height);
      const ctx = surface.ctx as CanvasRenderingContext2D;

      ctx.drawImage(img.source, 0, 0);

      if (kind === 'logo') {
        if (!logo) throw new Error('Watermark logo is required');
        drawLogoWatermark(ctx, surface.width, surface.height, logo, options);
      } else {
        drawTextWatermark(ctx, surface.width, surface.height, options);
      }

      return surface.toBlob(
        options.outputType,
        clamp(options.quality / 100, 0.01, 1)
      );
    });
  } finally {
    logo?.close();
  }
}

function applyTextStyle(
  ctx: CanvasRenderingContext2D,
  options: RenderWatermarkOptions
) {
  ctx.font = `700 ${options.fontSize}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = colorToCss(options.color, options.opacity);
  ctx.textBaseline = 'middle';
  if (options.outline) {
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = Math.max(1, options.fontSize / 12);
    ctx.strokeStyle = outlineColorFor(options.color, options.opacity);
  }
}

/** 先描边再填色,描边才不会盖住字面。 */
function paintText(
  ctx: CanvasRenderingContext2D,
  text: string,
  outline: boolean | undefined
) {
  if (outline) ctx.strokeText(text, 0, 0);
  ctx.fillText(text, 0, 0);
}

function canvasAlignOf(
  horizontal: 'start' | 'middle' | 'end'
): CanvasTextAlign {
  if (horizontal === 'start') return 'left';
  if (horizontal === 'end') return 'right';
  return 'center';
}

function canvasBaselineOf(
  vertical: 'top' | 'middle' | 'bottom'
): CanvasTextBaseline {
  if (vertical === 'top') return 'top';
  if (vertical === 'bottom') return 'bottom';
  return 'middle';
}

function drawTextWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: RenderWatermarkOptions
) {
  const text = options.text.trim();
  if (!text) throw new Error('Watermark text is required');

  ctx.save();
  applyTextStyle(ctx, options);

  if (options.position === 'tile') {
    drawTileWatermark(ctx, width, height, options);
  } else {
    const margin = resolveWatermarkMargin(width, height);
    const anchor = resolveWatermarkAnchor(
      options.position,
      width,
      height,
      margin
    );
    ctx.textAlign = canvasAlignOf(anchor.horizontal);
    ctx.textBaseline = canvasBaselineOf(anchor.vertical);
    ctx.translate(anchor.x, anchor.y);
    ctx.rotate((options.rotation * Math.PI) / 180);
    paintText(ctx, text, options.outline);
  }

  ctx.restore();
}

function drawTileWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: RenderWatermarkOptions
) {
  const text = options.text.trim();
  const metrics = ctx.measureText(text);
  const tileWidth = Math.max(180, metrics.width * 1.8);
  const tileHeight = Math.max(120, options.fontSize * 4);
  const angle = (options.rotation * Math.PI) / 180;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let y = -tileHeight; y < height + tileHeight; y += tileHeight) {
    for (let x = -tileWidth; x < width + tileWidth; x += tileWidth) {
      ctx.save();
      ctx.translate(x + tileWidth / 2, y + tileHeight / 2);
      ctx.rotate(angle);
      paintText(ctx, text, options.outline);
      ctx.restore();
    }
  }
}

function drawLogoWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  logo: { source: CanvasImageSource; width: number; height: number },
  options: RenderWatermarkOptions
) {
  const size = resolveLogoSize(
    logo.width,
    logo.height,
    width,
    options.logoScale ?? DEFAULT_LOGO_SCALE
  );

  ctx.save();
  ctx.globalAlpha = clamp(options.opacity, 0, 1);

  if (options.position === 'tile') {
    const tileWidth = size.width * 2;
    const tileHeight = size.height * 2;
    const angle = (options.rotation * Math.PI) / 180;
    for (let y = -tileHeight; y < height + tileHeight; y += tileHeight) {
      for (let x = -tileWidth; x < width + tileWidth; x += tileWidth) {
        ctx.save();
        ctx.translate(x + tileWidth / 2, y + tileHeight / 2);
        ctx.rotate(angle);
        ctx.drawImage(
          logo.source,
          -size.width / 2,
          -size.height / 2,
          size.width,
          size.height
        );
        ctx.restore();
      }
    }
  } else {
    const margin = resolveWatermarkMargin(width, height);
    const anchor = resolveWatermarkAnchor(
      options.position,
      width,
      height,
      margin
    );
    // 锚点是「贴边点」,把 Logo 的对应边角对齐过去。
    const left =
      anchor.horizontal === 'start'
        ? anchor.x
        : anchor.horizontal === 'end'
          ? anchor.x - size.width
          : anchor.x - size.width / 2;
    const top =
      anchor.vertical === 'top'
        ? anchor.y
        : anchor.vertical === 'bottom'
          ? anchor.y - size.height
          : anchor.y - size.height / 2;
    ctx.drawImage(logo.source, left, top, size.width, size.height);
  }

  ctx.restore();
}
