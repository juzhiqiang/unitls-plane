import { PDFDocument, degrees, rgb, StandardFonts } from '@cantoo/pdf-lib';
import type {
  ImageToPdfOptions,
  WatermarkOptions,
  PdfMetadata,
} from './options.type';

export class PdfContentOperations {
  async imagesToPdf(
    images: { buffer: Buffer; mimeType: string }[],
    opts: ImageToPdfOptions
  ): Promise<Buffer> {
    const doc = await PDFDocument.create();

    const A4_WIDTH = 595.28;
    const A4_HEIGHT = 841.89;
    const LETTER_WIDTH = 612;
    const LETTER_HEIGHT = 792;

    for (const img of images) {
      const isJpeg =
        img.mimeType === 'image/jpeg' || img.mimeType === 'image/jpg';
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

  async getMetadata(input: Buffer): Promise<PdfMetadata> {
    const doc = await PDFDocument.load(input);
    return {
      title: doc.getTitle() ?? undefined,
      author: doc.getAuthor() ?? undefined,
      subject: doc.getSubject() ?? undefined,
      keywords: doc
        .getKeywords()
        ?.split(',')
        .map(k => k.trim())
        .filter(Boolean),
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
}
