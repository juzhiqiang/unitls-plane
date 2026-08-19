import {
  transformImage,
  type ImageTransformOptions,
} from './image-transform-client';
import { withDecodedImage } from './image-bitmap';

export type ImageWatermarkPosition = 'center' | 'bottom-right' | 'tile';
export type ImageWatermarkOutputType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp';

export interface ImageWatermarkColor {
  r: number;
  g: number;
  b: number;
}

export interface ImageWatermarkOptions {
  text: string;
  position: ImageWatermarkPosition;
  fontSize: number;
  opacity: number;
  color: ImageWatermarkColor;
  rotation: number;
  outputType: ImageWatermarkOutputType;
  quality: number;
  transform?: ImageTransformOptions;
}

const OUTPUT_EXTENSIONS: Record<ImageWatermarkOutputType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

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

  return withDecodedImage(preparedFile, img => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');

    ctx.drawImage(img.source, 0, 0);
    drawTextWatermark(ctx, canvas.width, canvas.height, options);

    return new Promise<File>((resolve, reject) => {
      canvas.toBlob(
        blob => {
          if (!blob) return reject(new Error('Watermark export failed'));
          resolve(
            new File(
              [blob],
              getWatermarkedImageName(file.name, options.outputType),
              { type: options.outputType }
            )
          );
        },
        options.outputType,
        clamp(options.quality / 100, 0.01, 1)
      );
    });
  });
}

function drawTextWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: ImageWatermarkOptions
) {
  const text = options.text.trim();
  if (!text) throw new Error('Watermark text is required');

  ctx.save();
  ctx.font = `700 ${options.fontSize}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = colorToCss(options.color, options.opacity);
  ctx.textBaseline = 'middle';

  if (options.position === 'tile') {
    drawTileWatermark(ctx, width, height, options);
  } else {
    const margin = Math.max(16, Math.min(width, height) * 0.06);
    const x = options.position === 'bottom-right' ? width - margin : width / 2;
    const y =
      options.position === 'bottom-right' ? height - margin : height / 2;
    ctx.textAlign = options.position === 'bottom-right' ? 'right' : 'center';
    ctx.translate(x, y);
    ctx.rotate((options.rotation * Math.PI) / 180);
    ctx.fillText(text, 0, 0);
  }

  ctx.restore();
}

function drawTileWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: ImageWatermarkOptions
) {
  const text = options.text.trim();
  const metrics = ctx.measureText(text);
  const tileWidth = Math.max(180, metrics.width * 1.8);
  const tileHeight = Math.max(120, options.fontSize * 4);
  const angle = (options.rotation * Math.PI) / 180;

  ctx.textAlign = 'center';
  for (let y = -tileHeight; y < height + tileHeight; y += tileHeight) {
    for (let x = -tileWidth; x < width + tileWidth; x += tileWidth) {
      ctx.save();
      ctx.translate(x + tileWidth / 2, y + tileHeight / 2);
      ctx.rotate(angle);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }
}
