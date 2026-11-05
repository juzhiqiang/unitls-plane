import { BadRequestException } from '@nestjs/common';
import TurndownService from 'turndown';
import { getMupdf } from './mupdf-runtime';
import type { ToTextOptions } from './options.type';

export class PdfTextExtractor {
  async toText(input: Buffer, opts: ToTextOptions): Promise<string> {
    const mupdf = await getMupdf();
    const doc = mupdf.Document.openDocument(input, 'application/pdf');
    try {
      const totalPages = doc.countPages();
      const pageIndices =
        opts.pages ?? Array.from({ length: totalPages }, (_, i) => i);
      const parts: string[] = [];

      for (const idx of pageIndices) {
        if (idx < 0 || idx >= totalPages) {
          throw new BadRequestException(
            `Invalid page index ${idx}, total pages: ${totalPages}`
          );
        }
        const page = doc.loadPage(idx);
        try {
          const stext = page.toStructuredText();
          try {
            if (opts.format === 'markdown') {
              const html = stext.asHTML(idx);
              const td = new TurndownService({ headingStyle: 'atx' });
              parts.push(td.turndown(html));
            } else {
              parts.push(stext.asText());
            }
          } finally {
            stext.destroy();
          }
        } finally {
          page.destroy();
        }
      }

      const separator = opts.pageBreak ?? '\n\n---\n\n';
      return parts.join(separator);
    } finally {
      doc.destroy();
    }
  }
}
