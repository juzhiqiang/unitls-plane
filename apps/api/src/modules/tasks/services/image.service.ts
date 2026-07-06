import { Injectable, OnModuleInit } from '@nestjs/common';
import sharp from 'sharp';

export interface CompressOptions {
  format?: 'jpeg' | 'webp' | 'avif' | 'png';
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  transform?: ImageTransformOptions;
}

export interface ConvertOptions {
  toFormat: 'jpeg' | 'png' | 'webp' | 'avif';
  quality?: number;
  lossless?: boolean;
  transform?: ImageTransformOptions;
}

export interface ImageTransformOptions {
  autoOrient?: boolean;
  rotate?: 0 | 90 | 180 | 270;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
}

export type ImageWatermarkPosition = 'center' | 'bottom-right' | 'tile';

export interface WatermarkOptions {
  text: string;
  position?: ImageWatermarkPosition;
  fontSize?: number;
  opacity?: number;
  color?: { r: number; g: number; b: number };
  rotation?: number;
  margin?: number;
  outputFormat?: 'jpeg' | 'png' | 'webp' | 'avif';
  quality?: number;
  transform?: ImageTransformOptions;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function applyImageTransform(
  pipeline: ReturnType<typeof sharp>,
  opts?: ImageTransformOptions
): ReturnType<typeof sharp> {
  if (!opts) return pipeline;

  let transformed = opts.autoOrient === false ? pipeline : pipeline.rotate();
  if (opts.rotate !== undefined && opts.rotate !== 0) {
    transformed = transformed.rotate(opts.rotate);
  }
  if (opts.flipHorizontal) {
    transformed = transformed.flop();
  }
  if (opts.flipVertical) {
    transformed = transformed.flip();
  }
  return transformed;
}

function buildWatermarkSvg(
  width: number,
  height: number,
  opts: Required<
    Pick<
      WatermarkOptions,
      | 'text'
      | 'position'
      | 'fontSize'
      | 'opacity'
      | 'color'
      | 'rotation'
      | 'margin'
    >
  >
): string {
  const text = escapeXml(opts.text);
  const fill = `rgb(${opts.color.r}, ${opts.color.g}, ${opts.color.b})`;
  const common = `font-family="Arial, Helvetica, sans-serif" font-size="${opts.fontSize}" font-weight="700" fill="${fill}" fill-opacity="${opts.opacity}"`;

  if (opts.position === 'tile') {
    const tileWidth = Math.max(180, opts.text.length * opts.fontSize * 0.7);
    const tileHeight = Math.max(120, opts.fontSize * 3.5);
    return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="watermark" width="${tileWidth}" height="${tileHeight}" patternUnits="userSpaceOnUse" patternTransform="rotate(${opts.rotation})">
      <text x="${tileWidth / 2}" y="${tileHeight / 2}" text-anchor="middle" dominant-baseline="middle" ${common}>${text}</text>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#watermark)" />
</svg>`;
  }

  const x = opts.position === 'bottom-right' ? width - opts.margin : width / 2;
  const y =
    opts.position === 'bottom-right' ? height - opts.margin : height / 2;
  const anchor = opts.position === 'bottom-right' ? 'end' : 'middle';
  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" transform="rotate(${opts.rotation} ${x} ${y})" ${common}>${text}</text>
</svg>`;
}

@Injectable()
export class ImageService implements OnModuleInit {
  onModuleInit() {
    sharp.cache(false);
  }
  async compress(input: Buffer, opts: CompressOptions): Promise<Buffer> {
    const buf = Buffer.from(input);
    let pipeline = applyImageTransform(
      sharp(buf, { failOn: 'truncated' }),
      opts.transform
    );

    if (opts.maxWidth || opts.maxHeight) {
      pipeline = pipeline.resize({
        width: opts.maxWidth,
        height: opts.maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    switch (opts.format ?? 'jpeg') {
      case 'jpeg':
        return pipeline
          .jpeg({ quality: opts.quality ?? 80, mozjpeg: true })
          .toBuffer();
      case 'webp':
        return pipeline.webp({ quality: opts.quality ?? 80 }).toBuffer();
      case 'avif':
        return pipeline.avif({ quality: opts.quality ?? 60 }).toBuffer();
      case 'png':
        return pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
      default:
        throw new Error(`Unsupported format: ${opts.format}`);
    }
  }

  async convert(input: Buffer, opts: ConvertOptions): Promise<Buffer> {
    const pipeline = applyImageTransform(
      sharp(input, { failOn: 'truncated' }),
      opts.transform
    );

    switch (opts.toFormat) {
      case 'jpeg':
        return pipeline
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .jpeg({ quality: opts.quality ?? 90, mozjpeg: true })
          .toBuffer();
      case 'png':
        return pipeline.png({ compressionLevel: 9 }).toBuffer();
      case 'webp':
        return pipeline
          .webp({
            quality: opts.quality ?? 90,
            lossless: opts.lossless ?? false,
          })
          .toBuffer();
      case 'avif':
        return pipeline
          .avif({ quality: opts.quality ?? 70, effort: 4 })
          .toBuffer();
      default:
        throw new Error(`Unsupported format: ${opts.toFormat}`);
    }
  }

  async watermark(input: Buffer, opts: WatermarkOptions): Promise<Buffer> {
    const text = opts.text?.trim();
    if (!text) {
      throw new Error('Watermark text is required');
    }

    const transformedInput = await applyImageTransform(
      sharp(input, { failOn: 'truncated' }),
      opts.transform
    ).toBuffer();

    const image = sharp(transformedInput, { failOn: 'truncated' });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('File is not a valid image');
    }

    const fontSize = clamp(opts.fontSize ?? 48, 8, 240);
    const opacity = clamp(opts.opacity ?? 0.3, 0.05, 1);
    const color = opts.color ?? { r: 128, g: 128, b: 128 };
    const position = opts.position ?? 'tile';
    const rotation = opts.rotation ?? (position === 'tile' ? -30 : 0);
    const margin = clamp(
      opts.margin ?? 32,
      0,
      Math.max(metadata.width, metadata.height)
    );
    const safeColor = {
      r: clamp(Math.round(color.r), 0, 255),
      g: clamp(Math.round(color.g), 0, 255),
      b: clamp(Math.round(color.b), 0, 255),
    };

    const svg = buildWatermarkSvg(metadata.width, metadata.height, {
      text,
      position,
      fontSize,
      opacity,
      color: safeColor,
      rotation,
      margin,
    });

    let pipeline = sharp(transformedInput, { failOn: 'truncated' }).composite([
      { input: Buffer.from(svg), blend: 'over' },
    ]);

    const outputFormat =
      opts.outputFormat ??
      (metadata.format as WatermarkOptions['outputFormat']) ??
      'jpeg';
    switch (outputFormat) {
      case 'png':
        return pipeline.png({ compressionLevel: 9 }).toBuffer();
      case 'webp':
        return pipeline.webp({ quality: opts.quality ?? 90 }).toBuffer();
      case 'avif':
        return pipeline
          .avif({ quality: opts.quality ?? 70, effort: 4 })
          .toBuffer();
      case 'jpeg':
      default:
        return pipeline
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .jpeg({ quality: opts.quality ?? 90, mozjpeg: true })
          .toBuffer();
    }
  }

  async getMetadata(input: Buffer) {
    return sharp(input).metadata();
  }
}
