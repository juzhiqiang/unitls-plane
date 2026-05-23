import { Injectable, OnModuleInit } from '@nestjs/common';
import sharp from 'sharp';

export interface CompressOptions {
  format?: 'jpeg' | 'webp' | 'avif' | 'png';
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface ConvertOptions {
  toFormat: 'jpeg' | 'png' | 'webp' | 'avif';
  quality?: number;
  lossless?: boolean;
}

@Injectable()
export class ImageService implements OnModuleInit {
  onModuleInit() {
    sharp.cache(false);
  }
  async compress(input: Buffer, opts: CompressOptions): Promise<Buffer> {
    const buf = Buffer.from(input);
    let pipeline = sharp(buf, { failOn: 'truncated' });

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
    const pipeline = sharp(input, { failOn: 'truncated' });

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
          .webp({ quality: opts.quality ?? 90, lossless: opts.lossless ?? false })
          .toBuffer();
      case 'avif':
        return pipeline.avif({ quality: opts.quality ?? 70, effort: 4 }).toBuffer();
      default:
        throw new Error(`Unsupported format: ${opts.toFormat}`);
    }
  }

  async getMetadata(input: Buffer) {
    return sharp(input).metadata();
  }
}
