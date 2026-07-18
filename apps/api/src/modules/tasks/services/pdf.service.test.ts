import { describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import {
  buildLibreOfficeArgs,
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

async function createTextPdf(pages: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([595.28, 841.89]);
    if (text) page.drawText(text, { x: 56, y: 780, size: 12, font });
  }
  return Buffer.from(await doc.save());
}

async function createVisualThenTextPdf(
  visual:
    | 'image'
    | 'vector'
    | 'tiny-vector'
    | 'transparent-image'
    | 'white-image'
    | 'outside-image'
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const visualPage = doc.addPage([595.28, 841.89]);
  if (visual !== 'vector' && visual !== 'tiny-vector') {
    const transparent = visual === 'transparent-image';
    const white = visual === 'white-image';
    const png = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: transparent ? 4 : 3,
        background: transparent
          ? { r: 220, g: 38, b: 38, alpha: 0 }
          : white
            ? { r: 255, g: 255, b: 255 }
            : { r: 220, g: 38, b: 38 },
      },
    })
      .png()
      .toBuffer();
    const image = await doc.embedPng(png);
    visualPage.drawImage(image, {
      x: visual === 'outside-image' ? 700 : 56,
      y: visual === 'outside-image' ? 900 : 720,
      width: 80,
      height: 80,
    });
  } else {
    visualPage.drawRectangle({
      x: 56,
      y: 720,
      width: visual === 'tiny-vector' ? 0.1 : 80,
      height: visual === 'tiny-vector' ? 0.1 : 80,
      color: visual === 'tiny-vector' ? rgb(0, 0, 0) : rgb(0.86, 0.15, 0.15),
    });
  }

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const textPage = doc.addPage([595.28, 841.89]);
  textPage.drawText('Visible body', { x: 56, y: 780, size: 12, font });
  return Buffer.from(await doc.save());
}

async function convertMarkdownWithMockPdf(output: Buffer): Promise<Buffer> {
  const service = new PdfService();
  const originalConverter = (service as any).convertWithLibreOffice;
  (service as any).convertWithLibreOffice = async (
    sourcePath: string,
    outputDir: string
  ) => {
    const outputPath = join(
      outputDir,
      sourcePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '.pdf')
    );
    await writeFile(outputPath, output);
    return outputPath;
  };

  try {
    return await service.documentToPdf(
      {
        buffer: Buffer.from('# Visible body', 'utf8'),
        filename: 'server-export.md',
        mimeType: 'text/markdown',
      },
      { sourceFormat: 'markdown' }
    );
  } finally {
    (service as any).convertWithLibreOffice = originalConverter;
  }
}

function trackDestroy(
  prototype: { destroy(): void },
  onDestroy: () => void
): () => void {
  const original = prototype.destroy;
  prototype.destroy = function destroy() {
    onDestroy();
    original.call(this);
  };
  return () => {
    prototype.destroy = original;
  };
}

describe('buildMarkdownDocumentHtml', () => {
  it('renders markdown into a printable HTML document with document styling', () => {
    const html = buildMarkdownDocumentHtml('# Report\n\n- Ready\n- **PDF**');

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain('<main class="markdown-document">');
    expect(html).toContain('<h1>Report</h1>');
    expect(html).toContain('<li>Ready</li>');
    expect(html).toContain('<strong>PDF</strong>');
    expect(html).toContain('@page');
    expect(html).toContain('font-family');
  });

  it('builds isolated LibreOffice arguments with a file URL profile', () => {
    const profileDir = join('tmp', 'libreoffice-profile');
    const args = buildLibreOfficeArgs(
      join('tmp', 'source.html'),
      join('tmp', 'output'),
      profileDir,
      'pdf:writer_pdf_Export'
    );

    expect(args[0]).toBe(
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`
    );
    expect(args).toContain('--nodefault');
    expect(args).toContain('pdf:writer_pdf_Export');
  });

  it('does not keep executable script tags from markdown input', () => {
    const html = buildMarkdownDocumentHtml(
      '<script>alert("x")</script>\n\n# Safe'
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('<h1>Safe</h1>');
  });

  it('does not treat quotes inside unquoted attributes as quoted delimiters', () => {
    for (const [attribute, sanitizedAttribute] of [
      ["data=it's", `data="it's"`],
      ['data=a"b', 'data="a&quot;b"'],
    ] as const) {
      const html = buildMarkdownDocumentHtml(
        `<div ${attribute}><script>alert(1)</script><p>Visible</p></div>`
      );

      expect(html).not.toContain('<script>');
      expect(html).not.toContain('alert(1)');
      expect(html).toContain(sanitizedAttribute);
      expect(html).toContain('<p>Visible</p>');
    }
  });

  it('removes scripts after HTML5 comment closing variants', () => {
    for (const markdown of [
      '<!-- benign --!><script>alert(1)</script><p>Visible</p>',
      '<!--><script>alert(1)</script><p>Visible</p>',
    ]) {
      const html = buildMarkdownDocumentHtml(markdown);

      expect(html).not.toContain('<script>');
      expect(html).not.toContain('alert(1)');
      expect(html).toContain('<p>Visible</p>');
    }
  });

  it('removes base elements that can rewrite relative link destinations', () => {
    const html = buildMarkdownDocumentHtml(
      '<base href="/etc/secret/" />\n<a href="relative">Relative link</a>'
    );

    expect(html).not.toContain('<base');
    expect(html).not.toContain('/etc/secret');
    expect(html).toContain('<a href="relative">Relative link</a>');
  });

  it('removes foreign namespace content before serializing its resources', () => {
    const html = buildMarkdownDocumentHtml(
      '<svg><image href="/etc/passwd"></image><use href="../../secret.png"></use><script>alert(1)</script></svg>\n<p>Visible</p>'
    );

    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<image');
    expect(html).not.toContain('<use');
    expect(html).not.toContain('/etc/passwd');
    expect(html).not.toContain('../../secret.png');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('<p>Visible</p>');
  });

  it('removes an unsafe tag whose quoted attribute contains a closing delimiter', () => {
    const html = buildMarkdownDocumentHtml(
      '<meta title="hidden > metadata">\nVisible body'
    );

    expect(html).toContain('Visible body');
    expect(html).not.toContain('hidden');
    expect(html).not.toContain('metadata');
  });

  it('keeps unsafe elements and executable attributes out of document HTML', () => {
    const html = buildMarkdownDocumentHtml(
      [
        '<script title="unsafe > script-marker">script payload</script>',
        '<style title="unsafe > style-marker">style payload</style>',
        '<iframe title="unsafe > iframe-marker">iframe payload</iframe>',
        '<object title="unsafe > object-marker">object payload</object>',
        '<embed title="unsafe > embed-marker">',
        '<link title="unsafe > link-marker">',
        '<meta title="unsafe > meta-marker">',
        '<a href=" javascript:alert(1)" onclick="run(\'a > b\')">Visible link</a>',
        '<img src="javascript:alert(2)" onerror="run(\'c > d\')">',
      ].join('\n')
    );

    expect(html).toContain('Visible link');
    for (const unsafeText of [
      'script payload',
      'style payload',
      'iframe payload',
      'object payload',
      'embed-marker',
      'link-marker',
      'meta-marker',
      'onclick=',
      'onerror=',
      'javascript:',
    ]) {
      expect(html).not.toContain(unsafeText);
    }
  });

  it('sanitizes structured attributes while preserving safe navigation links', () => {
    const html = buildMarkdownDocumentHtml(
      [
        '<img src=x onerror=alert(1) alt="Unsafe image">',
        '<a href=javascript:alert(1)>Unsafe URL</a>',
        '<button formaction=javascript:alert(1)>Unsafe action</button>',
        '<a href=jav&#x61;script:alert(1)>Numeric entity URL</a>',
        '<a href=javascript&colon;alert(1)>Named entity URL</a>',
        '<a href="java&#10;script:alert(1)">C0 control URL</a>',
        '<a href="java&#x85;script:alert(1)">C1 control URL</a>',
        '<a href=vbscript:alert(1)>VBScript URL</a>',
        '<img src="http://127.0.0.1:9000/private.png" alt="Loopback image">',
        '<video poster="http://169.254.169.254/latest">Metadata poster</video>',
        '<div background="https://assets.example.com/background.png">Remote background</div>',
        '<object codebase="https://assets.example.com/">Remote codebase</object>',
        '<img src="http&amp;colon;//evil" alt="Double encoded resource">',
        '<img src=file:///etc/passwd alt="File URL">',
        '<svg><a xlink:href=javascript:alert(1)>SVG URL</a></svg>',
        '<img src=./local.png alt="Relative image">',
        '<img src="" alt="Empty image">',
        '<video poster=../local.mp4>Relative poster</video>',
        '<div background=/local.png>Relative background</div>',
        '<form action=https://example.com/submit><button formaction=https://example.com/submit>Submit</button></form>',
        '<svg><a xlink:href=https://example.com/image.svg>External SVG</a></svg>',
        '<div id="safe-block" style="background:url(https://tracker.example/pixel)">Styled text</div>',
        '<a href=./guide>Safe relative link</a>',
        '<a class="safe-link" href=https://example.com/docs title="Safe link">Safe HTTP link</a>',
        '<a href=mailto:support@example.com>Safe email link</a>',
        '<a href=tel:+86123456789>Safe telephone link</a>',
        '<img src="https://example.com/image.png?next=javascript:ignored" alt="Remote image" width=64>',
      ].join('\n')
    );

    for (const unsafeText of [
      'onerror=',
      'href=javascript:',
      'formaction=',
      'jav&#x61;script:',
      'javascript&colon;',
      'href="vbscript:',
      'src="file:',
      'xlink:href=',
      'src="./local.png"',
      'src=""',
      'poster=',
      'background=',
      'codebase=',
      'action=',
      'style=',
      'tracker.example',
      '127.0.0.1:9000',
      '169.254.169.254',
      'assets.example.com',
      'https://example.com/image.png',
    ]) {
      expect(html).not.toContain(unsafeText);
    }
    expect(html).toContain('Unsafe URL');
    expect(html).toContain('Unsafe action');
    expect(html).toContain('<a>C0 control URL</a>');
    expect(html).toContain('<a>C1 control URL</a>');
    expect(html).toContain('<img alt="Double encoded resource">');
    expect(html).not.toContain('http&amp;colon;//evil');
    expect(html).toContain('Styled text');
    expect(html).toContain('id="safe-block"');
    expect(html).toContain('class="safe-link"');
    expect(html).toContain('href="./guide"');
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('href="mailto:support@example.com"');
    expect(html).toContain('href="tel:+86123456789"');
    expect(html).toContain('title="Safe link"');
    expect(html).toContain('<img alt="Remote image" width="64">');
    expect(html).toContain('width="64"');
  });

  it('treats unsafe HTML elements as containers despite a self-closing slash', () => {
    const html = buildMarkdownDocumentHtml(
      '<script title="unsafe > marker"/>script payload</script>\n<div>Safe body</div>'
    );

    expect(html).not.toContain('script payload');
    expect(html).toContain('<div>Safe body</div>');
  });

  it('does not emit a malformed tag with an unterminated quoted attribute', () => {
    const html = buildMarkdownDocumentHtml(
      '<img src=x onerror="alert(1)>\nVisible body'
    );

    expect(html).not.toContain('<img src=x onerror=');
    expect(html).toContain('&lt;img src=x onerror="alert(1)&gt;');
    expect(html).toContain('Visible body');
  });

  it('preserves comparison text alongside normal tags and comments', () => {
    const html = buildMarkdownDocumentHtml(
      '<div>Alpha < Beta and Gamma > Omega; 2 < 3 > 1; value <= 4; score <3 <!-- note --></div>'
    );

    expect(html).toContain('<div>');
    expect(html).toContain('Alpha &lt; Beta and Gamma &gt; Omega');
    expect(html).toContain('2 &lt; 3 &gt; 1');
    expect(html).toContain('value &lt;= 4');
    expect(html).toContain('score &lt;3');
    expect(html).toContain('<!-- note -->');
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

  it('falls back when LibreOffice creates a blank Markdown PDF', async () => {
    const service = new PdfService();
    const originalConverter = (service as any).convertWithLibreOffice;
    (service as any).convertWithLibreOffice = async (
      sourcePath: string,
      outputDir: string
    ) => {
      const doc = await PDFDocument.create();
      doc.addPage([595.28, 841.89]);
      const outputPath = join(
        outputDir,
        sourcePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '.pdf')
      );
      await writeFile(outputPath, await doc.save());
      return outputPath;
    };

    try {
      const pdf = await service.documentToPdf(
        {
          buffer: Buffer.from('# Server Export\n\n- Content survives', 'utf8'),
          filename: 'server-export.md',
          mimeType: 'text/markdown',
        },
        { sourceFormat: 'markdown' }
      );

      const text = await service.toText(pdf, { format: 'text' });
      expect(text).toContain('Server Export');
      expect(text).toContain('Content survives');
    } finally {
      (service as any).convertWithLibreOffice = originalConverter;
    }
  });

  it('removes a blank leading page from a LibreOffice Markdown PDF', async () => {
    const service = new PdfService();
    const originalConverter = (service as any).convertWithLibreOffice;
    (service as any).convertWithLibreOffice = async (
      sourcePath: string,
      outputDir: string
    ) => {
      const outputPath = join(
        outputDir,
        sourcePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '.pdf')
      );
      await writeFile(
        outputPath,
        await createTextPdf(['', 'Expected title and body'])
      );
      return outputPath;
    };

    try {
      const pdf = await service.documentToPdf(
        {
          buffer: Buffer.from('# Expected title\n\nand body', 'utf8'),
          filename: 'server-export.md',
          mimeType: 'text/markdown',
        },
        { sourceFormat: 'markdown' }
      );

      const document = await PDFDocument.load(pdf);
      const text = await service.toText(pdf, { format: 'text' });
      expect(document.getPageCount()).toBe(1);
      expect(text).toContain('Expected title and body');
    } finally {
      (service as any).convertWithLibreOffice = originalConverter;
    }
  });

  it('keeps a leading image-only page in a Markdown PDF', async () => {
    const pdf = await convertMarkdownWithMockPdf(
      await createVisualThenTextPdf('image')
    );

    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
  });

  for (const visual of [
    'transparent-image',
    'white-image',
    'outside-image',
  ] as const) {
    it(`removes a leading ${visual} page from a Markdown PDF`, async () => {
      const pdf = await convertMarkdownWithMockPdf(
        await createVisualThenTextPdf(visual)
      );

      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    });
  }

  it('keeps a leading vector-only page in a Markdown PDF', async () => {
    const pdf = await convertMarkdownWithMockPdf(
      await createVisualThenTextPdf('vector')
    );

    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
  });

  it('keeps a leading page with a 0.1pt visible vector', async () => {
    const pdf = await convertMarkdownWithMockPdf(
      await createVisualThenTextPdf('tiny-vector')
    );

    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
  });

  it('destroys MuPDF handles after Markdown PDF inspection succeeds', async () => {
    const mupdf = await import('mupdf');
    const destroyed = { document: 0, page: 0, structuredText: 0, pixmap: 0 };
    const restore = [
      trackDestroy(mupdf.Document.prototype, () => destroyed.document++),
      trackDestroy(mupdf.Page.prototype, () => destroyed.page++),
      trackDestroy(
        mupdf.StructuredText.prototype,
        () => destroyed.structuredText++
      ),
      trackDestroy(mupdf.Pixmap.prototype, () => destroyed.pixmap++),
    ];

    try {
      const service = new PdfService();
      await (service as any).normalizeMarkdownPdfOutput(
        await createVisualThenTextPdf('image'),
        '# Visible body'
      );

      expect(destroyed.document).toBe(1);
      expect(destroyed.page).toBe(2);
      expect(destroyed.structuredText).toBe(2);
      expect(destroyed.pixmap).toBeGreaterThanOrEqual(1);
    } finally {
      restore.reverse().forEach(restoreDestroy => restoreDestroy());
    }
  });

  it('destroys MuPDF handles when raster page inspection throws', async () => {
    const mupdf = await import('mupdf');
    const destroyed = { document: 0, page: 0, structuredText: 0, pixmap: 0 };
    const restore = [
      trackDestroy(mupdf.Document.prototype, () => destroyed.document++),
      trackDestroy(mupdf.Page.prototype, () => destroyed.page++),
      trackDestroy(
        mupdf.StructuredText.prototype,
        () => destroyed.structuredText++
      ),
      trackDestroy(mupdf.Pixmap.prototype, () => destroyed.pixmap++),
    ];
    const originalGetPixels = mupdf.Pixmap.prototype.getPixels;
    mupdf.Pixmap.prototype.getPixels = () => {
      throw new Error('pixmap inspection failed');
    };

    try {
      const service = new PdfService();
      await expect(
        (service as any).normalizeMarkdownPdfOutput(
          await createTextPdf(['', 'Visible body']),
          '# Visible body'
        )
      ).rejects.toThrow('pixmap inspection failed');

      expect(destroyed.document).toBe(1);
      expect(destroyed.page).toBe(1);
      expect(destroyed.structuredText).toBe(1);
      expect(destroyed.pixmap).toBe(1);
    } finally {
      mupdf.Pixmap.prototype.getPixels = originalGetPixels;
      restore.reverse().forEach(restoreDestroy => restoreDestroy());
    }
  });

  it('destroys MuPDF handles after public text extraction', async () => {
    const mupdf = await import('mupdf');
    const destroyed = { document: 0, page: 0, structuredText: 0 };
    const restore = [
      trackDestroy(mupdf.Document.prototype, () => destroyed.document++),
      trackDestroy(mupdf.Page.prototype, () => destroyed.page++),
      trackDestroy(
        mupdf.StructuredText.prototype,
        () => destroyed.structuredText++
      ),
    ];

    try {
      await new PdfService().toText(await createTextPdf(['One', 'Two']), {
        format: 'text',
      });

      expect(destroyed.document).toBe(1);
      expect(destroyed.page).toBe(2);
      expect(destroyed.structuredText).toBe(2);
    } finally {
      restore.reverse().forEach(restoreDestroy => restoreDestroy());
    }
  });

  it('destroys the pixmap used to inspect a vector-only page', async () => {
    const mupdf = await import('mupdf');
    let destroyedPixmaps = 0;
    const restore = trackDestroy(
      mupdf.Pixmap.prototype,
      () => destroyedPixmaps++
    );

    try {
      const service = new PdfService();
      await (service as any).normalizeMarkdownPdfOutput(
        await createVisualThenTextPdf('vector'),
        '# Visible body'
      );

      expect(destroyedPixmaps).toBeGreaterThanOrEqual(1);
    } finally {
      restore();
    }
  });

  it('falls back when a LibreOffice Markdown PDF omits source content', async () => {
    const service = new PdfService();
    const originalConverter = (service as any).convertWithLibreOffice;
    (service as any).convertWithLibreOffice = async (
      sourcePath: string,
      outputDir: string
    ) => {
      const outputPath = join(
        outputDir,
        sourcePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '.pdf')
      );
      await writeFile(outputPath, await createTextPdf(['Only one fragment']));
      return outputPath;
    };

    try {
      const pdf = await service.documentToPdf(
        {
          buffer: Buffer.from(
            '# Required heading\n\nContent that must survive',
            'utf8'
          ),
          filename: 'server-export.md',
          mimeType: 'text/markdown',
        },
        { sourceFormat: 'markdown' }
      );

      const text = await service.toText(pdf, { format: 'text' });
      expect(text).toContain('Required heading');
      expect(text).toContain('Content that must survive');
    } finally {
      (service as any).convertWithLibreOffice = originalConverter;
    }
  });

  it('does not fall back solely for a one-character Markdown fragment', async () => {
    const service = new PdfService();
    const originalConverter = (service as any).convertWithLibreOffice;
    const originalFallback = (service as any).renderMarkdownFallbackPdf;
    (service as any).convertWithLibreOffice = async (
      sourcePath: string,
      outputDir: string
    ) => {
      const outputPath = join(
        outputDir,
        sourcePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '.pdf')
      );
      await writeFile(outputPath, await createTextPdf(['Other body']));
      return outputPath;
    };
    (service as any).renderMarkdownFallbackPdf = async () => {
      throw new Error('unexpected fallback');
    };

    try {
      const pdf = await service.documentToPdf(
        {
          buffer: Buffer.from('# 中\n\nOther body', 'utf8'),
          filename: 'server-export.md',
          mimeType: 'text/markdown',
        },
        { sourceFormat: 'markdown' }
      );

      const text = await service.toText(pdf, { format: 'text' });
      expect(text).toContain('Other body');
    } finally {
      (service as any).convertWithLibreOffice = originalConverter;
      (service as any).renderMarkdownFallbackPdf = originalFallback;
    }
  });

  it('falls back when a Markdown PDF omits visible noscript text', async () => {
    const service = new PdfService();
    const originalConverter = (service as any).convertWithLibreOffice;
    const originalFallback = (service as any).renderMarkdownFallbackPdf;
    const fallbackPdf = await createTextPdf([
      'Required fallback text Other body',
    ]);
    let fallbackCalls = 0;
    (service as any).convertWithLibreOffice = async (
      sourcePath: string,
      outputDir: string
    ) => {
      const outputPath = join(
        outputDir,
        sourcePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '.pdf')
      );
      await writeFile(outputPath, await createTextPdf(['Other body']));
      return outputPath;
    };
    (service as any).renderMarkdownFallbackPdf = async () => {
      fallbackCalls++;
      return fallbackPdf;
    };

    try {
      const pdf = await service.documentToPdf(
        {
          buffer: Buffer.from(
            '<noscript>Required fallback text</noscript><p>Other body</p>',
            'utf8'
          ),
          filename: 'server-export.md',
          mimeType: 'text/markdown',
        },
        { sourceFormat: 'markdown' }
      );

      expect(fallbackCalls).toBe(1);
      const text = await service.toText(pdf, { format: 'text' });
      expect(text).toContain('Required fallback text');
      expect(text).toContain('Other body');
    } finally {
      (service as any).convertWithLibreOffice = originalConverter;
      (service as any).renderMarkdownFallbackPdf = originalFallback;
    }
  });

  it('keeps literal code punctuation when validating Markdown PDF content', async () => {
    const service = new PdfService();
    const originalConverter = (service as any).convertWithLibreOffice;
    const originalFallback = (service as any).renderMarkdownFallbackPdf;
    (service as any).convertWithLibreOffice = async (
      sourcePath: string,
      outputDir: string
    ) => {
      const outputPath = join(
        outputDir,
        sourcePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '.pdf')
      );
      await writeFile(
        outputPath,
        await createTextPdf(['const result = left * right;'])
      );
      return outputPath;
    };
    (service as any).renderMarkdownFallbackPdf = async () => {
      throw new Error('unexpected fallback');
    };

    try {
      const pdf = await service.documentToPdf(
        {
          buffer: Buffer.from(
            '```ts\nconst result = left * right;\n```',
            'utf8'
          ),
          filename: 'server-export.md',
          mimeType: 'text/markdown',
        },
        { sourceFormat: 'markdown' }
      );

      const text = await service.toText(pdf, { format: 'text' });
      expect(text).toContain('const result = left * right;');
    } finally {
      (service as any).convertWithLibreOffice = originalConverter;
      (service as any).renderMarkdownFallbackPdf = originalFallback;
    }
  });

  it('ignores HTML attribute delimiters when validating visible Markdown text', async () => {
    const service = new PdfService();
    const originalConverter = (service as any).convertWithLibreOffice;
    const originalFallback = (service as any).renderMarkdownFallbackPdf;
    (service as any).convertWithLibreOffice = async (
      sourcePath: string,
      outputDir: string
    ) => {
      const outputPath = join(
        outputDir,
        sourcePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '.pdf')
      );
      await writeFile(outputPath, await createTextPdf(['Visible body']));
      return outputPath;
    };
    (service as any).renderMarkdownFallbackPdf = async () => {
      throw new Error('unexpected fallback');
    };

    try {
      const pdf = await service.documentToPdf(
        {
          buffer: Buffer.from(
            '<style title="a > b">.secret { color: red; }</style>\n' +
              '<meta title="hidden > metadata">\n' +
              '<div title="a > b">Visible body</div>',
            'utf8'
          ),
          filename: 'server-export.md',
          mimeType: 'text/markdown',
        },
        { sourceFormat: 'markdown' }
      );

      const text = await service.toText(pdf, { format: 'text' });
      expect(text).toContain('Visible body');
    } finally {
      (service as any).convertWithLibreOffice = originalConverter;
      (service as any).renderMarkdownFallbackPdf = originalFallback;
    }
  });

  it('falls back when a Markdown PDF omits visible comparison text', async () => {
    const service = new PdfService();
    const originalConverter = (service as any).convertWithLibreOffice;
    (service as any).convertWithLibreOffice = async (
      sourcePath: string,
      outputDir: string
    ) => {
      const outputPath = join(
        outputDir,
        sourcePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '.pdf')
      );
      await writeFile(outputPath, await createTextPdf(['Alpha Omega']));
      return outputPath;
    };

    try {
      const pdf = await service.documentToPdf(
        {
          buffer: Buffer.from(
            '<div>Alpha < Beta and Gamma > Omega</div>',
            'utf8'
          ),
          filename: 'server-export.md',
          mimeType: 'text/markdown',
        },
        { sourceFormat: 'markdown' }
      );

      const text = await service.toText(pdf, { format: 'text' });
      expect(text).toContain('Beta and Gamma');
    } finally {
      (service as any).convertWithLibreOffice = originalConverter;
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

describe('PdfService.compressPdf', () => {
  it('destroys the source document when creating a heavy output PDF fails', async () => {
    const input = await createTextPdf(['Compress me']);
    const mupdf = await import('mupdf');
    let destroyedDocuments = 0;
    const restoreDestroy = trackDestroy(
      mupdf.Document.prototype,
      () => destroyedDocuments++
    );
    const originalCreate = PDFDocument.create;
    PDFDocument.create = async () => {
      throw new Error('output PDF creation failed');
    };

    try {
      await expect(
        new PdfService().compressPdf(input, { level: 'heavy' })
      ).rejects.toThrow('output PDF creation failed');
      expect(destroyedDocuments).toBe(1);
    } finally {
      PDFDocument.create = originalCreate;
      restoreDestroy();
    }
  });
});
