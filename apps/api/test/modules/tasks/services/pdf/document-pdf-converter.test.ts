import { describe, expect, it } from 'bun:test';
import { access, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { DocumentPdfConverter } from '../../../../../src/modules/tasks/services/pdf/document-pdf-converter';
import { LibreOfficeConverter } from '../../../../../src/modules/tasks/services/pdf/libreoffice-converter';
import { MarkdownPdfNormalizer } from '../../../../../src/modules/tasks/services/pdf/markdown-pdf-normalizer';
import { DocumentFallbackRenderer } from '../../../../../src/modules/tasks/services/pdf/document-fallback-renderer';
import { PdfService } from '../../../../../src/modules/tasks/services/pdf.service';

async function textPdf(text: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText(text, { x: 50, y: 700, font });
  return Buffer.from(await doc.save());
}

const input = { buffer: Buffer.from('# Visible body'), filename: 'report.md' };

describe('DocumentPdfConverter', () => {
  it('tries the generic filter after writer failure and removes temporary files', async () => {
    const libreOffice = new LibreOfficeConverter();
    const filters: string[] = [];
    let sourcePath = '';
    libreOffice.convert = async (source, outputDir, filter) => {
      sourcePath = source;
      filters.push(filter);
      if (filter === 'pdf:writer_pdf_Export')
        throw new Error('writer unavailable');
      const output = join(outputDir, 'converted.pdf');
      await writeFile(output, await textPdf('Visible body'));
      return output;
    };
    const converter = new DocumentPdfConverter(libreOffice);

    const result = await converter.convert(input, { sourceFormat: 'markdown' });

    expect(filters).toEqual(['pdf:writer_pdf_Export', 'pdf']);
    expect(await new PdfService().toText(result, { format: 'text' })).toContain(
      'Visible body'
    );
    await expect(access(dirname(sourcePath))).rejects.toThrow();
  });

  it('renders the source after both filters fail and removes temporary files', async () => {
    const libreOffice = new LibreOfficeConverter();
    const filters: string[] = [];
    let sourcePath = '';
    libreOffice.convert = async (source, _outputDir, filter) => {
      sourcePath = source;
      filters.push(filter);
      throw new Error('converter unavailable');
    };
    const converter = new DocumentPdfConverter(libreOffice);

    const result = await converter.convert(input, { sourceFormat: 'markdown' });

    expect(filters).toEqual(['pdf:writer_pdf_Export', 'pdf']);
    expect(await new PdfService().toText(result, { format: 'text' })).toContain(
      'Visible body'
    );
    await expect(access(dirname(sourcePath))).rejects.toThrow();
  });

  it('propagates fallback errors while removing temporary files', async () => {
    const libreOffice = new LibreOfficeConverter();
    const fallback = new DocumentFallbackRenderer();
    let sourcePath = '';
    libreOffice.convert = async source => {
      sourcePath = source;
      throw new Error('converter unavailable');
    };
    fallback.renderMarkdown = async () => {
      throw new Error('fallback failed');
    };
    const converter = new DocumentPdfConverter(
      libreOffice,
      new MarkdownPdfNormalizer(),
      fallback
    );

    await expect(
      converter.convert(input, { sourceFormat: 'markdown' })
    ).rejects.toThrow('fallback failed');
    await expect(access(dirname(sourcePath))).rejects.toThrow();
  });
});
