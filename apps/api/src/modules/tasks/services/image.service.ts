import { Injectable, OnModuleInit } from '@nestjs/common';
import sharp from 'sharp';

export interface CompressOptions {
  format?: 'jpeg' | 'webp' | 'avif' | 'png';
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
}

@Injectable()
export class ImageService implements OnModuleInit {
  onModuleInit() {
    sharp.cache(false);
    sharp.concurrency(1);
  }
  async compress(input: Buffer, opts: CompressOptions): Promise<Buffer> {
    let pipeline = sharp(input, { failOn: 'truncated' });

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

  async getMetadata(input: Buffer) {
    return sharp(input).metadata();
  }
}
