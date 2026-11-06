import {
  assertTaskOutput,
  assertPdfPages,
} from '../../../../common/resources/task-resource-context';
import { BadRequestException } from '@nestjs/common';
import { PDFDocument, degrees } from '@cantoo/pdf-lib';
import type {
  SplitOptions,
  RotateOptions,
  RearrangeOptions,
} from './options.type';

export class PdfPageOperations {
  async merge(inputs: Buffer[]): Promise<Buffer> {
    const merged = await PDFDocument.create();

    for (const input of inputs) {
      const doc = await PDFDocument.load(input);
      const copiedPages = await merged.copyPages(doc, doc.getPageIndices());
      copiedPages.forEach(page => merged.addPage(page));
    }

    return Buffer.from(await merged.save());
  }

  async split(input: Buffer, opts: SplitOptions): Promise<Buffer[]> {
    const src = await PDFDocument.load(input);
    const totalPages = src.getPageCount();

    this.validateSplitOptions(opts, totalPages);

    const outputPages =
      opts.mode === 'ranges'
        ? opts.ranges!.reduce(
            (total, [start, end]) => total + end - start + 1,
            0
          )
        : opts.mode === 'pages'
          ? opts.pages!.length
          : totalPages;
    assertPdfPages(outputPages);
    const ranges = this.parseRanges(opts, totalPages);
    const outputs: Buffer[] = [];
    let totalOutputBytes = 0;

    for (const range of ranges) {
      const target = await PDFDocument.create();
      const pages = await target.copyPages(src, range);
      pages.forEach(p => target.addPage(p));
      const output = Buffer.from(await target.save());
      totalOutputBytes += output.length;
      assertTaskOutput(totalOutputBytes);
      outputs.push(output);
    }

    return outputs;
  }

  async getPageCount(input: Buffer): Promise<number> {
    const doc = await PDFDocument.load(input);
    return doc.getPageCount();
  }

  async rotate(input: Buffer, opts: RotateOptions): Promise<Buffer> {
    const doc = await PDFDocument.load(input);
    const totalPages = doc.getPageCount();

    for (const idx of opts.pages) {
      if (idx < 0 || idx >= totalPages) {
        throw new BadRequestException(
          `Invalid page index ${idx}, total pages: ${totalPages}`
        );
      }
      const page = doc.getPage(idx);
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + opts.angle) % 360));
    }

    return Buffer.from(await doc.save());
  }

  async rearrange(input: Buffer, opts: RearrangeOptions): Promise<Buffer> {
    const src = await PDFDocument.load(input);
    const totalPages = src.getPageCount();

    for (const idx of opts.pageOrder) {
      if (idx < 0 || idx >= totalPages) {
        throw new BadRequestException(
          `Invalid page index ${idx}, total pages: ${totalPages}`
        );
      }
    }

    if (opts.pageOrder.length === 0) {
      throw new BadRequestException('Page order must not be empty');
    }

    const target = await PDFDocument.create();
    assertPdfPages(opts.pageOrder.length);
    const copiedPages = await target.copyPages(src, opts.pageOrder);
    copiedPages.forEach(page => target.addPage(page));

    return Buffer.from(await target.save());
  }

  private validateSplitOptions(opts: SplitOptions, totalPages: number): void {
    switch (opts.mode) {
      case 'ranges': {
        if (!opts.ranges || opts.ranges.length === 0) {
          throw new BadRequestException(
            'ranges must be provided and non-empty'
          );
        }
        for (const range of opts.ranges) {
          const [start = NaN, end = NaN] =
            Array.isArray(range) && range.length === 2 ? range : [];
          if (!Number.isInteger(start) || !Number.isInteger(end)) {
            throw new BadRequestException(
              'ranges must be zero-based integer tuples'
            );
          }
          if (start < 0 || end >= totalPages || start > end) {
            throw new BadRequestException(
              `Invalid range [${start}, ${end}], total pages: ${totalPages}`
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
          if (!Number.isInteger(p) || p < 0 || p >= totalPages) {
            throw new BadRequestException(
              `Invalid page ${p}, total pages: ${totalPages}`
            );
          }
        }
        break;
      }
      case 'every': {
        const every = opts.every ?? 0;
        if (!Number.isInteger(every) || every <= 0) {
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
          Array.from({ length: end - start + 1 }, (_, i) => start + i)
        );
      case 'pages':
        return opts.pages!.map(p => [p]);
      case 'every': {
        const result: number[][] = [];
        for (let i = 0; i < total; i += opts.every!) {
          result.push(
            Array.from(
              { length: Math.min(opts.every!, total - i) },
              (_, j) => i + j
            )
          );
        }
        return result;
      }
    }
  }
}
