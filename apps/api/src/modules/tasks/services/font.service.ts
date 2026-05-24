import { Injectable, BadRequestException } from '@nestjs/common';
import { Font } from 'fonteditor-core';
import wawoff2 from 'wawoff2';

export type FontFormat = 'ttf' | 'otf' | 'woff' | 'woff2';

export interface FontConvertOptions {
  toFormat: FontFormat;
  subsetText?: string;
}

export interface FontInfo {
  fontFamily: string;
  fontSubfamily: string;
  fullName: string;
  glyphCount: number;
  unitsPerEm: number;
}

@Injectable()
export class FontService {
  async convert(input: Buffer, opts: FontConvertOptions): Promise<Buffer> {
    const fromType = this.detectType(input);
    const toType = opts.toFormat;

    let workingBuffer = input;
    if (fromType === 'woff2') {
      const decompressed = await wawoff2.decompress(input);
      workingBuffer = Buffer.from(decompressed);
    }

    const readType = fromType === 'woff2' ? 'ttf' : fromType;
    const subset = opts.subsetText ? this.charsToCodes(opts.subsetText) : undefined;

    const font = Font.create(workingBuffer, {
      type: readType,
      hinting: true,
      subset,
    });

    if (toType === 'woff2') {
      const ttfBuffer = font.write({ type: 'ttf', toBuffer: true, hinting: true });
      const compressed = await wawoff2.compress(ttfBuffer);
      return Buffer.from(compressed);
    }

    return font.write({ type: toType, toBuffer: true, hinting: true });
  }

  async getFontInfo(input: Buffer): Promise<FontInfo> {
    const fromType = this.detectType(input);

    let workingBuffer = input;
    if (fromType === 'woff2') {
      const decompressed = await wawoff2.decompress(input);
      workingBuffer = Buffer.from(decompressed);
    }

    const font = Font.create(workingBuffer, {
      type: fromType === 'woff2' ? 'ttf' : fromType,
    });
    const data = font.get();

    return {
      fontFamily: data.name?.fontFamily ?? '',
      fontSubfamily: data.name?.fontSubFamily ?? '',
      fullName: data.name?.fullName ?? '',
      glyphCount: data.glyf?.length ?? 0,
      unitsPerEm: data.head?.unitsPerEm ?? 0,
    };
  }

  detectType(buffer: Buffer): FontFormat {
    const head = buffer.toString('hex', 0, 4);
    if (head === '00010000' || head === '74727565') return 'ttf';
    if (head === '4f54544f') return 'otf';
    if (head === '774f4646') return 'woff';
    if (head === '774f4632') return 'woff2';
    throw new BadRequestException({
      code: 'INVALID_FONT',
      message: 'Unsupported font format',
    });
  }

  private charsToCodes(text: string): number[] {
    return [...new Set([...text].map(c => c.codePointAt(0)!))];
  }
}
