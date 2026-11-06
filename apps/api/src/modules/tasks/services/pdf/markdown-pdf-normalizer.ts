import {
  assertRasterPixels,
  assertPdfPages,
} from '../../../../common/resources/task-resource-context';
import { PDFDocument } from '@cantoo/pdf-lib';
import { getMupdf, type MupdfModule } from './mupdf-runtime';
import {
  normalizeDocumentText,
  extractMarkdownTextFragments,
} from './markdown-document';

export class MarkdownPdfNormalizer {
  async normalize(pdf: Buffer, markdown: string): Promise<Buffer> {
    const mupdf = await getMupdf();
    const document = mupdf.Document.openDocument(pdf, 'application/pdf');
    const pageTexts: string[] = [];
    let firstVisiblePage = -1;

    try {
      assertPdfPages(document.countPages());
      for (let index = 0; index < document.countPages(); index++) {
        const page = document.loadPage(index);
        try {
          const structuredText = page.toStructuredText();
          try {
            const text = normalizeDocumentText(structuredText.asText());
            pageTexts.push(text);

            if (
              firstVisiblePage === -1 &&
              this.hasRenderedPageContent(mupdf, page)
            ) {
              firstVisiblePage = index;
            }
          } finally {
            structuredText.destroy();
          }
        } finally {
          page.destroy();
        }
      }
    } finally {
      document.destroy();
    }

    if (firstVisiblePage === -1) {
      throw new Error('LibreOffice produced a blank Markdown PDF');
    }

    const outputText = normalizeDocumentText(
      pageTexts.slice(firstVisiblePage).join(' ')
    );
    for (const fragment of extractMarkdownTextFragments(markdown)) {
      if (!outputText.includes(fragment)) {
        throw new Error('LibreOffice Markdown PDF is missing source content');
      }
    }

    if (firstVisiblePage === 0) return pdf;

    const source = await PDFDocument.load(pdf);
    const normalized = await PDFDocument.create();
    const copiedPages = await normalized.copyPages(
      source,
      Array.from(
        { length: source.getPageCount() - firstVisiblePage },
        (_, index) => index + firstVisiblePage
      )
    );
    copiedPages.forEach(page => normalized.addPage(page));
    return Buffer.from(await normalized.save());
  }

  private hasRenderedPageContent(
    mupdf: MupdfModule,
    page: import('mupdf').Page
  ): boolean {
    assertRasterPixels(page.getBounds(), 1);
    const pixmap = page.toPixmap(
      [1, 0, 0, 1, 0, 0],
      mupdf.ColorSpace.DeviceGray,
      false,
      false
    );
    try {
      return pixmap.getPixels().some(value => value !== 255);
    } finally {
      pixmap.destroy();
    }
  }
}
