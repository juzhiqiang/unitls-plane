import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { inflateRawSync } from 'node:zlib';
import { Injectable, BadRequestException } from '@nestjs/common';
import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib';
import { marked } from 'marked';
import {
  defaultTreeAdapter,
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes,
} from 'parse5';
import TurndownService from 'turndown';

const execFileAsync = promisify(execFile);

type MupdfModule = typeof import('mupdf');
const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
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

export interface DocumentToPdfOptions {
  sourceFormat: 'markdown' | 'docx';
  outputFilename?: string;
}

const MARKDOWN_HTML_STYLE = `
  @page { size: A4; margin: 22mm 18mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: #111827;
    font-family: "Noto Sans", "Noto Sans CJK SC", "Microsoft YaHei", Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.65;
  }
  h1, h2, h3, h4 {
    color: #0f172a;
    line-height: 1.25;
    margin: 1.4em 0 0.5em;
    page-break-after: avoid;
  }
  h1 { font-size: 26pt; border-bottom: 1px solid #d1d5db; padding-bottom: 0.25em; }
  h2 { font-size: 18pt; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.2em; }
  h3 { font-size: 14pt; }
  p, ul, ol, blockquote, table, pre { margin: 0.75em 0; }
  a { color: #0f766e; text-decoration: none; }
  code {
    font-family: "JetBrains Mono", Consolas, monospace;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 3px;
    padding: 0.1em 0.25em;
  }
  pre {
    background: #111827;
    color: #f9fafb;
    border-radius: 6px;
    padding: 12px;
    overflow-wrap: break-word;
    white-space: pre-wrap;
  }
  pre code { background: transparent; border: 0; color: inherit; padding: 0; }
  blockquote { border-left: 3px solid #14b8a6; padding-left: 12px; color: #4b5563; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #d1d5db; padding: 6px 8px; vertical-align: top; }
  th { background: #f3f4f6; text-align: left; }
  img { max-width: 100%; height: auto; }
`;

function stripUnsafeHtml(html: string): string {
  return sanitizeHtml(html);
}

function parseMarkdown(markdown: string): string {
  marked.setOptions({
    async: false,
    breaks: false,
    gfm: true,
  });

  return marked.parse(markdown) as string;
}

export function normalizeDocumentText(value: string): string {
  const decoded = value.replace(
    /&(?:amp|lt|gt|quot|apos|nbsp|#(\d+)|#x([\da-f]+));/gi,
    (entity, decimal, hexadecimal) => {
      switch (entity.toLowerCase()) {
        case '&amp;':
          return '&';
        case '&lt;':
          return '<';
        case '&gt;':
          return '>';
        case '&quot;':
          return '"';
        case '&apos;':
          return "'";
        case '&nbsp;':
          return ' ';
        default: {
          const codePoint = decimal
            ? Number.parseInt(decimal, 10)
            : Number.parseInt(hexadecimal, 16);
          return Number.isFinite(codePoint)
            ? String.fromCodePoint(codePoint)
            : entity;
        }
      }
    }
  );

  return decoded.replace(/\s+/g, ' ').trim();
}

function extractMarkdownTextFragments(markdown: string): string[] {
  const html = parseMarkdown(markdown);
  return extractVisibleHtmlText(html)
    .split(/\n+/)
    .map(normalizeDocumentText)
    .filter(fragment => fragment.length >= 2);
}

const UNSAFE_HTML_ELEMENTS = new Set([
  'embed',
  'iframe',
  'link',
  'base',
  'meta',
  'object',
  'script',
  'style',
  'template',
]);

const HIDDEN_HTML_ELEMENTS = new Set([
  ...UNSAFE_HTML_ELEMENTS,
  'head',
  'title',
]);

const HTML_PARSER_OPTIONS = { scriptingEnabled: false } as const;
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

function sanitizeHtml(html: string): string {
  const fragment = parseSanitizedHtml(html);
  return serialize(fragment, HTML_PARSER_OPTIONS);
}

function parseSanitizedHtml(
  html: string
): DefaultTreeAdapterTypes.DocumentFragment {
  const fragment = parseFragment(html, HTML_PARSER_OPTIONS);
  sanitizeHtmlTree(fragment);
  return fragment;
}

function sanitizeHtmlTree(parent: DefaultTreeAdapterTypes.ParentNode): void {
  for (const child of [...parent.childNodes]) {
    if (!defaultTreeAdapter.isElementNode(child)) continue;

    const tagName = child.tagName.toLowerCase();
    if (
      child.namespaceURI !== HTML_NAMESPACE ||
      UNSAFE_HTML_ELEMENTS.has(tagName)
    ) {
      defaultTreeAdapter.detachNode(child);
      continue;
    }

    child.attrs = child.attrs.filter(isAllowedHtmlAttribute);
    sanitizeHtmlTree(child);
  }
}

const URL_HTML_ATTRIBUTES = new Set([
  'background',
  'cite',
  'codebase',
  'href',
  'longdesc',
  'poster',
  'src',
  'usemap',
]);

const RESOURCE_URL_HTML_ATTRIBUTES = new Set([
  'background',
  'codebase',
  'poster',
  'src',
]);

const DROPPED_HTML_ATTRIBUTES = new Set([
  'ping',
  'action',
  'formaction',
  'srcdoc',
  'srcset',
  'style',
  'xlink:href',
]);

const ALLOWED_DOCUMENT_URL_SCHEMES = new Set([
  'http',
  'https',
  'mailto',
  'tel',
]);

function isAllowedHtmlAttribute(
  attribute: DefaultTreeAdapterTypes.Element['attrs'][number]
): boolean {
  if (attribute.namespace || attribute.prefix) return false;

  const name = attribute.name.toLowerCase();
  if (
    name.startsWith('on') ||
    DROPPED_HTML_ATTRIBUTES.has(name) ||
    !/^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(attribute.name)
  ) {
    return false;
  }
  if (!URL_HTML_ATTRIBUTES.has(name)) return true;
  return isAllowedDocumentUrl(name, attribute.value);
}

function isAllowedDocumentUrl(attributeName: string, value: string): boolean {
  const normalized = stripUrlControlCharacters(value.trim());
  const allowsRelative = !RESOURCE_URL_HTML_ATTRIBUTES.has(attributeName);
  if (normalized === '') return allowsRelative;
  if (
    allowsRelative &&
    (normalized.startsWith('#') ||
      normalized.startsWith('/') ||
      normalized.startsWith('./') ||
      normalized.startsWith('../') ||
      normalized.startsWith('?'))
  ) {
    return true;
  }

  const boundary = normalized.search(/[/?#]/);
  const colon = normalized.indexOf(':');
  if (colon !== -1 && (boundary === -1 || colon < boundary)) {
    const scheme = normalized.slice(0, colon).toLowerCase();
    if (RESOURCE_URL_HTML_ATTRIBUTES.has(attributeName)) {
      return scheme === 'http' || scheme === 'https';
    }
    return ALLOWED_DOCUMENT_URL_SCHEMES.has(scheme);
  }

  if (!allowsRelative) return false;
  const prefix = normalized.slice(
    0,
    boundary === -1 ? normalized.length : boundary
  );
  return !prefix.includes('&');
}

function stripUrlControlCharacters(value: string): string {
  let result = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      continue;
    }
    result += character;
  }
  return result;
}

function extractVisibleHtmlText(html: string): string {
  return collectVisibleHtmlText(parseSanitizedHtml(html));
}

function collectVisibleHtmlText(
  parent: DefaultTreeAdapterTypes.ParentNode
): string {
  let result = '';

  for (const child of parent.childNodes) {
    if (defaultTreeAdapter.isTextNode(child)) {
      result += child.value;
      continue;
    }
    if (!defaultTreeAdapter.isElementNode(child)) continue;
    if (HIDDEN_HTML_ELEMENTS.has(child.tagName.toLowerCase())) continue;

    result += `\n${collectVisibleHtmlText(child)}\n`;
  }

  return result;
}

export function buildLibreOfficeArgs(
  sourcePath: string,
  outputDir: string,
  profileDir: string,
  filter: 'pdf:writer_pdf_Export' | 'pdf'
): string[] {
  return [
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    '--headless',
    '--invisible',
    '--nodefault',
    '--nolockcheck',
    '--nologo',
    '--nofirststartwizard',
    '--convert-to',
    filter,
    '--outdir',
    outputDir,
    sourcePath,
  ];
}

export function buildMarkdownDocumentHtml(markdown: string): string {
  const body = stripUnsafeHtml(parseMarkdown(markdown));

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>${MARKDOWN_HTML_STYLE}</style>
</head>
<body>
<main class="markdown-document">
${body}
</main>
</body>
</html>`;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function readZipEntry(input: Buffer, targetName: string): Buffer | null {
  const endSignature = 0x06054b50;
  let endOffset = -1;
  for (let i = input.length - 22; i >= 0; i--) {
    if (input.readUInt32LE(i) === endSignature) {
      endOffset = i;
      break;
    }
  }

  if (endOffset === -1) return null;

  const centralDirectoryOffset = input.readUInt32LE(endOffset + 16);
  let offset = centralDirectoryOffset;
  while (offset + 46 <= input.length) {
    if (input.readUInt32LE(offset) !== 0x02014b50) break;

    const compressionMethod = input.readUInt16LE(offset + 10);
    const compressedSize = input.readUInt32LE(offset + 20);
    const filenameLength = input.readUInt16LE(offset + 28);
    const extraLength = input.readUInt16LE(offset + 30);
    const commentLength = input.readUInt16LE(offset + 32);
    const localHeaderOffset = input.readUInt32LE(offset + 42);
    const filename = input
      .subarray(offset + 46, offset + 46 + filenameLength)
      .toString('utf8');

    if (filename === targetName) {
      if (
        localHeaderOffset + 30 > input.length ||
        input.readUInt32LE(localHeaderOffset) !== 0x04034b50
      ) {
        return null;
      }
      const localFilenameLength = input.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = input.readUInt16LE(localHeaderOffset + 28);
      const dataStart =
        localHeaderOffset + 30 + localFilenameLength + localExtraLength;
      const compressed = input.subarray(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) return compressed;
      if (compressionMethod === 8) return inflateRawSync(compressed);
      throw new BadRequestException(
        `Unsupported DOCX compression method: ${compressionMethod}`
      );
    }

    offset += 46 + filenameLength + extraLength + commentLength;
  }

  return null;
}

export function extractDocxPlainText(input: Buffer): string {
  const documentXml = readZipEntry(input, 'word/document.xml');
  if (!documentXml) {
    throw new BadRequestException('DOCX document body not found');
  }

  const xml = documentXml.toString('utf8');
  return (
    xml
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:br\b[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|[\t\n]/g)
      ?.map(part => {
        if (part === '\t' || part === '\n') return part;
        const match = part.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/);
        return match ? decodeXmlText(match[1]!) : '';
      })
      .join('')
      .replace(/\n{3,}/g, '\n\n')
      .trim() ?? ''
  );
}

@Injectable()
export class PdfService {
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

    const ranges = this.parseRanges(opts, totalPages);
    const outputs: Buffer[] = [];

    for (const range of ranges) {
      const target = await PDFDocument.create();
      const pages = await target.copyPages(src, range);
      pages.forEach(p => target.addPage(p));
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

  // ─── Images → PDF ─────────────────────────────────────────────────

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

  async documentToPdf(
    input: { buffer: Buffer; filename: string; mimeType?: string },
    opts: DocumentToPdfOptions
  ): Promise<Buffer> {
    const sourceExt = opts.sourceFormat === 'markdown' ? '.html' : '.docx';
    const tempDir = await mkdtemp(join(tmpdir(), 'utils-plane-doc-pdf-'));
    const sourcePath = join(
      tempDir,
      `${basename(input.filename, extname(input.filename))}${sourceExt}`
    );

    try {
      if (opts.sourceFormat === 'markdown') {
        const markdown = input.buffer.toString('utf8');
        await writeFile(
          sourcePath,
          buildMarkdownDocumentHtml(markdown),
          'utf8'
        );
      } else {
        await writeFile(sourcePath, input.buffer);
      }

      if (opts.sourceFormat === 'markdown') {
        const markdown = input.buffer.toString('utf8');
        for (const filter of ['pdf:writer_pdf_Export', 'pdf'] as const) {
          try {
            const outputPath = await this.convertWithLibreOffice(
              sourcePath,
              tempDir,
              filter
            );
            const output = await readFile(outputPath);
            return await this.normalizeMarkdownPdfOutput(output, markdown);
          } catch {
            // Try the next LibreOffice filter before using the local fallback.
          }
        }

        return await this.renderMarkdownFallbackPdf(markdown);
      }

      try {
        const outputPath = await this.convertWithLibreOffice(
          sourcePath,
          tempDir,
          'pdf:writer_pdf_Export'
        );
        return await readFile(outputPath);
      } catch {
        return await this.renderPlainTextFallbackPdf(
          extractDocxPlainText(input.buffer)
        );
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async normalizeMarkdownPdfOutput(
    pdf: Buffer,
    markdown: string
  ): Promise<Buffer> {
    const mupdf = await getMupdf();
    const document = mupdf.Document.openDocument(pdf, 'application/pdf');
    const pageTexts: string[] = [];
    let firstVisiblePage = -1;

    try {
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

  private async renderMarkdownFallbackPdf(markdown: string): Promise<Buffer> {
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

  private async renderPlainTextFallbackPdf(text: string): Promise<Buffer> {
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

  // ─── Rotate Pages ─────────────────────────────────────────────────

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
    const doc = mupdf.Document.openDocument(
      input,
      'application/pdf'
    ) as import('mupdf').PDFDocument;
    try {
      const perms = opts.permissions ?? {};
      let permBits = 0;
      if (perms.print !== false) permBits |= 0b000000000100;
      if (perms.copy !== false) permBits |= 0b000000010000;
      if (perms.modify !== false) permBits |= 0b000000001000;
      if (perms.annotate !== false) permBits |= 0b000000100000;

      const result = (doc as any).saveToBuffer('compress,incremental', {
        userPassword: opts.userPassword ?? '',
        ownerPassword: opts.ownerPassword,
        permissions: permBits,
      }) as import('mupdf').Buffer;
      try {
        return Buffer.from(result.asUint8Array());
      } finally {
        result.destroy();
      }
    } finally {
      doc.destroy();
    }
  }

  // ─── Compress ─────────────────────────────────────────────────────

  async compressPdf(input: Buffer, opts: CompressPdfOptions): Promise<Buffer> {
    const mupdf = await getMupdf();

    if (opts.level === 'light') {
      const doc = mupdf.Document.openDocument(
        input,
        'application/pdf'
      ) as import('mupdf').PDFDocument;
      try {
        const result = doc.saveToBuffer('compress,garbage=4,linearize');
        try {
          return Buffer.from(result.asUint8Array());
        } finally {
          result.destroy();
        }
      } finally {
        doc.destroy();
      }
    }

    const dpi = opts.level === 'medium' ? 150 : 100;
    const quality = opts.level === 'medium' ? 75 : 50;
    const scale = dpi / 72;

    const srcDoc = mupdf.Document.openDocument(input, 'application/pdf');
    try {
      const newDoc = await PDFDocument.create();
      for (let i = 0; i < srcDoc.countPages(); i++) {
        const page = srcDoc.loadPage(i);
        try {
          const pixmap = page.toPixmap(
            mupdf.Matrix.scale(scale, scale),
            mupdf.ColorSpace.DeviceRGB
          );
          try {
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
          } finally {
            pixmap.destroy();
          }
        } finally {
          page.destroy();
        }
      }

      return Buffer.from(await newDoc.save());
    } finally {
      srcDoc.destroy();
    }
  }

  // ─── Metadata ─────────────────────────────────────────────────────

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

  // ─── Rearrange / Delete Pages ─────────────────────────────────────

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
        for (const [start, end] of opts.ranges) {
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
          if (p < 0 || p >= totalPages) {
            throw new BadRequestException(
              `Invalid page ${p}, total pages: ${totalPages}`
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

  private async convertWithLibreOffice(
    sourcePath: string,
    tempDir: string,
    filter: 'pdf:writer_pdf_Export' | 'pdf'
  ): Promise<string> {
    const outputDir = await mkdtemp(join(tempDir, 'libreoffice-output-'));
    const profileDir = await mkdtemp(join(tempDir, 'libreoffice-profile-'));
    const outputPath = join(
      outputDir,
      `${basename(sourcePath, extname(sourcePath))}.pdf`
    );
    const commands = process.env.LIBREOFFICE_BIN
      ? [process.env.LIBREOFFICE_BIN]
      : ['soffice', 'libreoffice'];

    for (const command of commands) {
      try {
        await rm(outputPath, { force: true });
        await execFileAsync(
          command,
          buildLibreOfficeArgs(sourcePath, outputDir, profileDir, filter),
          { timeout: 120_000, windowsHide: true }
        );

        await readFile(outputPath);
        return outputPath;
      } catch {
        // Continue with the next available LibreOffice executable.
      }
    }

    throw new BadRequestException(
      'LibreOffice is required for Markdown/Word to PDF conversion'
    );
  }
}
