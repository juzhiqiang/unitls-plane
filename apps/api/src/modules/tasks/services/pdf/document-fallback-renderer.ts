import { PDFDocument, rgb, StandardFonts } from '@cantoo/pdf-lib';
import { marked } from 'marked';

export class DocumentFallbackRenderer {
  async renderMarkdown(markdown: string): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const regularFont = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    const pageSize = { width: 595.28, height: 841.89 };
    const margin = 56;
    const maxWidth = pageSize.width - margin * 2;
    let page = doc.addPage([pageSize.width, pageSize.height]);
    let y = pageSize.height - margin;

    const ensureSpace = (lineHeight: number) => {
      if (y - lineHeight < margin) {
        page = doc.addPage([pageSize.width, pageSize.height]);
        y = pageSize.height - margin;
      }
    };

    const drawWrapped = (
      text: string,
      options: {
        size: number;
        lineHeight: number;
        bold?: boolean;
        indent?: number;
      }
    ) => {
      const font = options.bold ? boldFont : regularFont;
      const indent = options.indent ?? 0;
      const lines = this.wrapPdfText(
        this.toWinAnsiText(text),
        font,
        options.size,
        maxWidth - indent
      );

      for (const line of lines.length > 0 ? lines : ['']) {
        ensureSpace(options.lineHeight);
        page.drawText(line, {
          x: margin + indent,
          y,
          size: options.size,
          font,
          color: rgb(0.08, 0.1, 0.15),
        });
        y -= options.lineHeight;
      }
    };

    const tokens = marked.lexer(markdown, { gfm: true, breaks: false });
    for (const token of tokens) {
      switch (token.type) {
        case 'heading':
          y -= token.depth === 1 ? 8 : 4;
          drawWrapped(token.text, {
            size: token.depth === 1 ? 22 : token.depth === 2 ? 16 : 13,
            lineHeight: token.depth === 1 ? 28 : 22,
            bold: true,
          });
          y -= 4;
          break;
        case 'list':
          for (const item of token.items) {
            drawWrapped(`- ${item.text.replace(/\s+/g, ' ')}`, {
              size: 11,
              lineHeight: 17,
              indent: 14,
            });
          }
          y -= 4;
          break;
        case 'code':
          drawWrapped(token.text, {
            size: 9,
            lineHeight: 14,
            indent: 14,
          });
          y -= 4;
          break;
        case 'space':
          y -= 8;
          break;
        default:
          if ('text' in token && typeof token.text === 'string') {
            drawWrapped(token.text.replace(/\s+/g, ' '), {
              size: 11,
              lineHeight: 17,
            });
            y -= 4;
          }
          break;
      }
    }

    return Buffer.from(await doc.save());
  }

  async renderPlainText(text: string): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const regularFont = await doc.embedFont(StandardFonts.Helvetica);
    const pageSize = { width: 595.28, height: 841.89 };
    const margin = 56;
    const maxWidth = pageSize.width - margin * 2;
    let page = doc.addPage([pageSize.width, pageSize.height]);
    let y = pageSize.height - margin;
    const lineHeight = 17;

    for (const paragraph of text.split(/\n+/).filter(Boolean)) {
      for (const line of this.wrapPdfText(
        this.toWinAnsiText(paragraph),
        regularFont,
        11,
        maxWidth
      )) {
        if (y - lineHeight < margin) {
          page = doc.addPage([pageSize.width, pageSize.height]);
          y = pageSize.height - margin;
        }
        page.drawText(line, {
          x: margin,
          y,
          size: 11,
          font: regularFont,
          color: rgb(0.08, 0.1, 0.15),
        });
        y -= lineHeight;
      }
      y -= 4;
    }

    return Buffer.from(await doc.save());
  }

  private wrapPdfText(
    text: string,
    font: Awaited<ReturnType<PDFDocument['embedFont']>>,
    size: number,
    maxWidth: number
  ): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      current = word;
    }

    if (current) lines.push(current);
    return lines;
  }

  private toWinAnsiText(text: string): string {
    // eslint-disable-next-line no-control-regex -- Intentionally replaces unsupported ASCII control characters before WinAnsi encoding.
    return text.replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '?');
  }
}
