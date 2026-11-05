import { Injectable } from '@nestjs/common';
import type {
  SplitOptions,
  ToTextOptions,
  ImageToPdfOptions,
  RotateOptions,
  WatermarkOptions,
  EncryptOptions,
  CompressPdfOptions,
  PdfMetadata,
  RearrangeOptions,
  DocumentToPdfOptions,
} from './pdf/options.type';
import { PdfPageOperations } from './pdf/page-operations';
import { PdfContentOperations } from './pdf/content-operations';
import { PdfSecurityOperations } from './pdf/security-operations';
import { PdfTextExtractor } from './pdf/text-extractor';
import { DocumentPdfConverter } from './pdf/document-pdf-converter';

export type * from './pdf/options.type';
export { buildLibreOfficeArgs } from './pdf/libreoffice-converter';
export {
  buildMarkdownDocumentHtml,
  normalizeDocumentText,
} from './pdf/markdown-document';
export { extractDocxPlainText } from './pdf/docx-text';

/** 稳定的 Nest 注入与直接构造入口，按职责组合内部实现。 */
@Injectable()
export class PdfService {
  private readonly pages = new PdfPageOperations();
  private readonly content = new PdfContentOperations();
  private readonly security = new PdfSecurityOperations();
  private readonly text = new PdfTextExtractor();
  private readonly documents = new DocumentPdfConverter();

  async merge(inputs: Buffer[]): Promise<Buffer> {
    return this.pages.merge(inputs);
  }

  async split(input: Buffer, opts: SplitOptions): Promise<Buffer[]> {
    return this.pages.split(input, opts);
  }

  async getPageCount(input: Buffer): Promise<number> {
    return this.pages.getPageCount(input);
  }

  async rotate(input: Buffer, opts: RotateOptions): Promise<Buffer> {
    return this.pages.rotate(input, opts);
  }

  async rearrange(input: Buffer, opts: RearrangeOptions): Promise<Buffer> {
    return this.pages.rearrange(input, opts);
  }

  async imagesToPdf(
    images: { buffer: Buffer; mimeType: string }[],
    opts: ImageToPdfOptions
  ): Promise<Buffer> {
    return this.content.imagesToPdf(images, opts);
  }

  async watermark(input: Buffer, opts: WatermarkOptions): Promise<Buffer> {
    return this.content.watermark(input, opts);
  }

  async getMetadata(input: Buffer): Promise<PdfMetadata> {
    return this.content.getMetadata(input);
  }

  async editMetadata(input: Buffer, meta: PdfMetadata): Promise<Buffer> {
    return this.content.editMetadata(input, meta);
  }

  async encrypt(input: Buffer, opts: EncryptOptions): Promise<Buffer> {
    return this.security.encrypt(input, opts);
  }

  async compressPdf(input: Buffer, opts: CompressPdfOptions): Promise<Buffer> {
    return this.security.compressPdf(input, opts);
  }

  async toText(input: Buffer, opts: ToTextOptions): Promise<string> {
    return this.text.toText(input, opts);
  }

  async documentToPdf(
    input: { buffer: Buffer; filename: string; mimeType?: string },
    opts: DocumentToPdfOptions
  ): Promise<Buffer> {
    return this.documents.convert(input, opts);
  }
}
