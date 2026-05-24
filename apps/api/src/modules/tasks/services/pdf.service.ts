import { Injectable, BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';

export interface SplitOptions {
  mode: 'ranges' | 'pages' | 'every';
  ranges?: [number, number][];
  pages?: number[];
  every?: number;
}

@Injectable()
export class PdfService {
  async merge(inputs: Buffer[]): Promise<Buffer> {
    const merged = await PDFDocument.create();

    for (const input of inputs) {
      const doc = await PDFDocument.load(input);
      const copiedPages = await merged.copyPages(doc, doc.getPageIndices());
      copiedPages.forEach((page) => merged.addPage(page));
    }

    return Buffer.from(await merged.save());
  }

  async split(input: Buffer, opts: SplitOptions): Promise<Buffer[]> {
    const src = await PDFDocument.load(input);
    const totalPages = src.getPageCount();

    this.validateSplitOptions(opts, totalPages);

    const ranges = this.parseRanges(opts, totalPages);
    const outputs: Buffer[] = [];

    for (const range of ranges) {
      const target = await PDFDocument.create();
      const pages = await target.copyPages(src, range);
      pages.forEach((p) => target.addPage(p));
      outputs.push(Buffer.from(await target.save()));
    }

    return outputs;
  }

  async getPageCount(input: Buffer): Promise<number> {
    const doc = await PDFDocument.load(input);
    return doc.getPageCount();
  }

  private validateSplitOptions(opts: SplitOptions, totalPages: number): void {
    switch (opts.mode) {
      case 'ranges': {
        if (!opts.ranges || opts.ranges.length === 0) {
          throw new BadRequestException('ranges must be provided and non-empty');
        }
        for (const [start, end] of opts.ranges) {
          if (start < 0 || end >= totalPages || start > end) {
            throw new BadRequestException(
              `Invalid range [${start}, ${end}], total pages: ${totalPages}`,
            );
          }
        }
        break;
      }
      case 'pages': {
        if (!opts.pages || opts.pages.length === 0) {
          throw new BadRequestException('pages must be provided and non-empty');
        }
        for (const p of opts.pages) {
          if (p < 0 || p >= totalPages) {
            throw new BadRequestException(
              `Invalid page ${p}, total pages: ${totalPages}`,
            );
          }
        }
        break;
      }
      case 'every': {
        if (!opts.every || opts.every <= 0) {
          throw new BadRequestException('every must be greater than 0');
        }
        break;
      }
    }
  }

  private parseRanges(opts: SplitOptions, total: number): number[][] {
    switch (opts.mode) {
      case 'ranges':
        return opts.ranges!.map(([start, end]) =>
          Array.from({ length: end - start + 1 }, (_, i) => start + i),
        );
      case 'pages':
        return opts.pages!.map((p) => [p]);
      case 'every': {
        const result: number[][] = [];
        for (let i = 0; i < total; i += opts.every!) {
          result.push(
            Array.from(
              { length: Math.min(opts.every!, total - i) },
              (_, j) => i + j,
            ),
          );
        }
        return result;
      }
    }
  }
}
