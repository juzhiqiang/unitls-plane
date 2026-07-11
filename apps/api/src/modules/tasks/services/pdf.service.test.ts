import { describe, expect, it } from 'bun:test';
import {
  buildMarkdownDocumentHtml,
  extractDocxPlainText,
  PdfService,
} from './pdf.service';

function createStoredZip(entries: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const centralDirectoryParts: Buffer[] = [];
  let offset = 0;

  for (const [name, value] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const dataBuffer = Buffer.from(value, 'utf8');
    const localHeaderOffset = offset;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(0, 10);
    header.writeUInt32LE(0, 14);
    header.writeUInt32LE(dataBuffer.length, 18);
    header.writeUInt32LE(dataBuffer.length, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    header.writeUInt16LE(0, 28);
    parts.push(header, nameBuffer, dataBuffer);
    offset += header.length + nameBuffer.length + dataBuffer.length;

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt32LE(localHeaderOffset, 42);
    centralDirectoryParts.push(centralHeader, nameBuffer);
  }

  const centralDirectoryOffset = offset;
  const centralDirectory = Buffer.concat(centralDirectoryParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralDirectoryOffset, 16);
  parts.push(centralDirectory);
  parts.push(end);
  return Buffer.concat(parts);
}

function createMinimalDocx(text: string): Buffer {
  return createStoredZip({
    '[Content_Types].xml': '<Types />',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
        </w:body>
      </w:document>`,
  });
}

describe('buildMarkdownDocumentHtml', () => {
  it('renders markdown into a printable HTML document with document styling', () => {
    const html = buildMarkdownDocumentHtml('# Report\n\n- Ready\n- **PDF**');

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<h1>Report</h1>');
    expect(html).toContain('<li>Ready</li>');
    expect(html).toContain('<strong>PDF</strong>');
    expect(html).toContain('@page');
    expect(html).toContain('font-family');
  });

  it('does not keep executable script tags from markdown input', () => {
    const html = buildMarkdownDocumentHtml(
      '<script>alert("x")</script>\n\n# Safe'
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('<h1>Safe</h1>');
  });
});

describe('PdfService.documentToPdf', () => {
  it('converts Markdown to PDF without requiring LibreOffice', async () => {
    const previousLibreOfficeBin = process.env.LIBREOFFICE_BIN;
    process.env.LIBREOFFICE_BIN = 'definitely-missing-libreoffice';

    try {
      const service = new PdfService();
      const pdf = await service.documentToPdf(
        {
          buffer: Buffer.from('# Server Export\n\n- Ready', 'utf8'),
          filename: 'server-export.md',
          mimeType: 'text/markdown',
        },
        { sourceFormat: 'markdown' }
      );

      expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(500);
    } finally {
      if (previousLibreOfficeBin === undefined) {
        delete process.env.LIBREOFFICE_BIN;
      } else {
        process.env.LIBREOFFICE_BIN = previousLibreOfficeBin;
      }
    }
  });

  it('extracts text from a DOCX document body', () => {
    const docx = createMinimalDocx('Word Export Ready');

    expect(extractDocxPlainText(docx)).toContain('Word Export Ready');
  });

  it('converts Word DOCX to PDF without requiring LibreOffice', async () => {
    const previousLibreOfficeBin = process.env.LIBREOFFICE_BIN;
    process.env.LIBREOFFICE_BIN = 'definitely-missing-libreoffice';

    try {
      const service = new PdfService();
      const pdf = await service.documentToPdf(
        {
          buffer: createMinimalDocx('Word fallback export'),
          filename: 'server-export.docx',
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
        { sourceFormat: 'docx' }
      );

      expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(500);
    } finally {
      if (previousLibreOfficeBin === undefined) {
        delete process.env.LIBREOFFICE_BIN;
      } else {
        process.env.LIBREOFFICE_BIN = previousLibreOfficeBin;
      }
    }
  });
});
