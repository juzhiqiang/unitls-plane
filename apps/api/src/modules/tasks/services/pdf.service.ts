import { Injectable, BadRequestException } from '@nestjs/common';
import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib';
import TurndownService from 'turndown';

type MupdfModule = typeof import('mupdf');
const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<MupdfModule>;
let mupdfPromise: Promise<MupdfModule> | undefined;

function getMupdf(): Promise<MupdfModule> {
  mupdfPromise ??= nativeImport('mupdf');
  return mupdfPromise;
}

export interface SplitOptions {
  mode: 'ranges' | 'pages' | 'every';
  ranges?: [number, number][];
  pages?: number[];
  every?: number;
}

export interface ToTextOptions {
  format: 'markdown' | 'text';
  pages?: number[];
  pageBreak?: string;
}

export interface ImageToPdfOptions {
  pageSize?: 'original' | 'a4' | 'letter';
  fit?: 'fit' | 'fill' | 'stretch';
}

export interface RotateOptions {
  pages: number[];
  angle: 0 | 90 | 180 | 270;
}

export interface WatermarkOptions {
  text: string;
  fontSize?: number;
  opacity?: number;
  color?: { r: number; g: number; b: number };
  rotation?: number;
  position?: 'center' | 'diagonal';
}

export interface EncryptOptions {
  userPassword?: string;
  ownerPassword: string;
  permissions?: {
    print?: boolean;
    copy?: boolean;
    modify?: boolean;
    annotate?: boolean;
  };
}

export interface CompressPdfOptions {
  level: 'light' | 'medium' | 'heavy';
}

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
}

export interface RearrangeOptions {
  pageOrder: number[];
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

  // ─── PDF → Text/Markdown ───────────────────────────────────────────

  async toText(input: Buffer, opts: ToTextOptions): Promise<string> {
    const mupdf = await getMupdf();
    const doc = mupdf.Document.openDocument(input, 'application/pdf');
    const totalPages = doc.countPages();
    const pageIndices = opts.pages ?? Array.from({ length: totalPages }, (_, i) => i);
    const parts: string[] = [];

    for (const idx of pageIndices) {
      if (idx < 0 || idx >= totalPages) {
        throw new BadRequestException(`Invalid page index ${idx}, total pages: ${totalPages}`);
      }
      const page = doc.loadPage(idx);
      const stext = page.toStructuredText();
      if (opts.format === 'markdown') {
        const html = stext.asHTML(idx);
        const td = new TurndownService({ headingStyle: 'atx' });
        parts.push(td.turndown(html));
      } else {
        parts.push(stext.asText());
      }
    }

    const separator = opts.pageBreak ?? '\n\n---\n\n';
    return parts.join(separator);
  }

  // ─── Images → PDF ─────────────────────────────────────────────────

  async imagesToPdf(images: { buffer: Buffer; mimeType: string }[], opts: ImageToPdfOptions): Promise<Buffer> {
    const doc = await PDFDocument.create();

    const A4_WIDTH = 595.28;
    const A4_HEIGHT = 841.89;
    const LETTER_WIDTH = 612;
    const LETTER_HEIGHT = 792;

    for (const img of images) {
      const isJpeg = img.mimeType === 'image/jpeg' || img.mimeType === 'image/jpg';
      const embedded = isJpeg
        ? await doc.embedJpg(img.buffer)
        : await doc.embedPng(img.buffer);

      const imgWidth = embedded.width;
      const imgHeight = embedded.height;

      let pageWidth: number;
      let pageHeight: number;

      if (opts.pageSize === 'a4') {
        pageWidth = A4_WIDTH;
        pageHeight = A4_HEIGHT;
      } else if (opts.pageSize === 'letter') {
        pageWidth = LETTER_WIDTH;
        pageHeight = LETTER_HEIGHT;
      } else {
        pageWidth = imgWidth;
        pageHeight = imgHeight;
      }

      let drawWidth: number;
      let drawHeight: number;
      let x = 0;
      let y = 0;

      if (opts.fit === 'stretch' || opts.pageSize === 'original') {
        drawWidth = pageWidth;
        drawHeight = pageHeight;
      } else if (opts.fit === 'fill') {
        const scale = Math.max(pageWidth / imgWidth, pageHeight / imgHeight);
        drawWidth = imgWidth * scale;
        drawHeight = imgHeight * scale;
        x = (pageWidth - drawWidth) / 2;
        y = (pageHeight - drawHeight) / 2;
      } else {
        const scale = Math.min(pageWidth / imgWidth, pageHeight / imgHeight);
        drawWidth = imgWidth * scale;
        drawHeight = imgHeight * scale;
        x = (pageWidth - drawWidth) / 2;
        y = (pageHeight - drawHeight) / 2;
      }

      const page = doc.addPage([pageWidth, pageHeight]);
      page.drawImage(embedded, { x, y, width: drawWidth, height: drawHeight });
    }

    return Buffer.from(await doc.save());
  }

  // ─── Rotate Pages ─────────────────────────────────────────────────

  async rotate(input: Buffer, opts: RotateOptions): Promise<Buffer> {
    const doc = await PDFDocument.load(input);
    const totalPages = doc.getPageCount();

    for (const idx of opts.pages) {
      if (idx < 0 || idx >= totalPages) {
        throw new BadRequestException(`Invalid page index ${idx}, total pages: ${totalPages}`);
      }
      const page = doc.getPage(idx);
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + opts.angle) % 360));
    }

    return Buffer.from(await doc.save());
  }

  // ─── Watermark ────────────────────────────────────────────────────

  async watermark(input: Buffer, opts: WatermarkOptions): Promise<Buffer> {
    const doc = await PDFDocument.load(input);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontSize = opts.fontSize ?? 48;
    const opacity = opts.opacity ?? 0.3;
    const color = opts.color ?? { r: 0.5, g: 0.5, b: 0.5 };
    const rotation = opts.rotation ?? (opts.position === 'diagonal' ? 45 : 0);

    const pages = doc.getPages();
    for (const page of pages) {
      const { width, height } = page.getSize();

      if (opts.position === 'diagonal') {
        const textWidth = font.widthOfTextAtSize(opts.text, fontSize);
        const x = (width - textWidth) / 2;
        const y = height / 2;
        page.drawText(opts.text, {
          x,
          y,
          size: fontSize,
          font,
          color: rgb(color.r, color.g, color.b),
          opacity,
          rotate: degrees(rotation),
        });
      } else {
        const textWidth = font.widthOfTextAtSize(opts.text, fontSize);
        const x = (width - textWidth) / 2;
        const y = height / 2;
        page.drawText(opts.text, {
          x,
          y,
          size: fontSize,
          font,
          color: rgb(color.r, color.g, color.b),
          opacity,
          rotate: degrees(rotation),
        });
      }
    }

    return Buffer.from(await doc.save());
  }

  // ─── Encrypt ──────────────────────────────────────────────────────

  async encrypt(input: Buffer, opts: EncryptOptions): Promise<Buffer> {
    const mupdf = await getMupdf();
    const doc = mupdf.Document.openDocument(input, 'application/pdf') as import('mupdf').PDFDocument;

    const perms = opts.permissions ?? {};
    let permBits = 0;
    if (perms.print !== false) permBits |= 0b000000000100;
    if (perms.copy !== false) permBits |= 0b000000010000;
    if (perms.modify !== false) permBits |= 0b000000001000;
    if (perms.annotate !== false) permBits |= 0b000000100000;

    const result = (doc as any).saveToBuffer(
      'compress,incremental',
      {
        userPassword: opts.userPassword ?? '',
        ownerPassword: opts.ownerPassword,
        permissions: permBits,
      },
    );
    return Buffer.from(result.asUint8Array());
  }

  // ─── Compress ─────────────────────────────────────────────────────

  async compressPdf(input: Buffer, opts: CompressPdfOptions): Promise<Buffer> {
    const mupdf = await getMupdf();

    if (opts.level === 'light') {
      const doc = mupdf.Document.openDocument(input, 'application/pdf') as import('mupdf').PDFDocument;
      const result = doc.saveToBuffer('compress,garbage=4,linearize');
      return Buffer.from(result.asUint8Array());
    }

    const dpi = opts.level === 'medium' ? 150 : 100;
    const quality = opts.level === 'medium' ? 75 : 50;
    const scale = dpi / 72;

    const srcDoc = mupdf.Document.openDocument(input, 'application/pdf');
    const newDoc = await PDFDocument.create();

    for (let i = 0; i < srcDoc.countPages(); i++) {
      const page = srcDoc.loadPage(i);
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
      );

      const jpegData = pixmap.asJPEG(quality);
      const jpgImage = await newDoc.embedJpg(Buffer.from(jpegData));

      const bounds = page.getBounds();
      const pageWidth = bounds[2] - bounds[0];
      const pageHeight = bounds[3] - bounds[1];

      const newPage = newDoc.addPage([pageWidth, pageHeight]);
      newPage.drawImage(jpgImage, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });
    }

    return Buffer.from(await newDoc.save());
  }

  // ─── Metadata ─────────────────────────────────────────────────────

  async getMetadata(input: Buffer): Promise<PdfMetadata> {
    const doc = await PDFDocument.load(input);
    return {
      title: doc.getTitle() ?? undefined,
      author: doc.getAuthor() ?? undefined,
      subject: doc.getSubject() ?? undefined,
      keywords: doc.getKeywords()?.split(',').map(k => k.trim()).filter(Boolean),
      creator: doc.getCreator() ?? undefined,
      producer: doc.getProducer() ?? undefined,
    };
  }

  async editMetadata(input: Buffer, meta: PdfMetadata): Promise<Buffer> {
    const doc = await PDFDocument.load(input);

    if (meta.title !== undefined) doc.setTitle(meta.title);
    if (meta.author !== undefined) doc.setAuthor(meta.author);
    if (meta.subject !== undefined) doc.setSubject(meta.subject);
    if (meta.keywords !== undefined) doc.setKeywords(meta.keywords);
    if (meta.creator !== undefined) doc.setCreator(meta.creator);
    if (meta.producer !== undefined) doc.setProducer(meta.producer);

    return Buffer.from(await doc.save());
  }

  // ─── Rearrange / Delete Pages ─────────────────────────────────────

  async rearrange(input: Buffer, opts: RearrangeOptions): Promise<Buffer> {
    const src = await PDFDocument.load(input);
    const totalPages = src.getPageCount();

    for (const idx of opts.pageOrder) {
      if (idx < 0 || idx >= totalPages) {
        throw new BadRequestException(`Invalid page index ${idx}, total pages: ${totalPages}`);
      }
    }

    if (opts.pageOrder.length === 0) {
      throw new BadRequestException('Page order must not be empty');
    }

    const target = await PDFDocument.create();
    const copiedPages = await target.copyPages(src, opts.pageOrder);
    copiedPages.forEach((page) => target.addPage(page));

    return Buffer.from(await target.save());
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
