import { createReadStream } from 'node:fs';
import { readBoundedStream } from '../../../../common/resources/bounded-read';
import { currentResourceLimits } from '../../../../common/resources/task-resource-context';
import { TaskResourceLimitError } from '../../../../common/resources/resource-error';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { buildMarkdownDocumentHtml } from './markdown-document';
import { extractDocxPlainText } from './docx-text';
import { LibreOfficeConverter } from './libreoffice-converter';
import { MarkdownPdfNormalizer } from './markdown-pdf-normalizer';
import { DocumentFallbackRenderer } from './document-fallback-renderer';
import type { DocumentToPdfOptions } from './options.type';

/** 文档转换的重试、校验与回退编排；具体渲染和外部进程各自管理资源。 */
export class DocumentPdfConverter {
  constructor(
    readonly libreOffice = new LibreOfficeConverter(),
    readonly normalizer = new MarkdownPdfNormalizer(),
    readonly fallback = new DocumentFallbackRenderer()
  ) {}

  async convert(
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
            const outputPath = await this.libreOffice.convert(
              sourcePath,
              tempDir,
              filter
            );
            const output = await readBoundedStream(
              createReadStream(outputPath),
              currentResourceLimits().outputBytes
            );
            return await this.normalizer.normalize(output, markdown);
          } catch (error) {
            if (error instanceof TaskResourceLimitError) throw error;
            // Try the next LibreOffice filter before using the local fallback.
          }
        }

        return await this.fallback.renderMarkdown(markdown);
      }

      try {
        const outputPath = await this.libreOffice.convert(
          sourcePath,
          tempDir,
          'pdf:writer_pdf_Export'
        );
        return await readBoundedStream(
          createReadStream(outputPath),
          currentResourceLimits().outputBytes
        );
      } catch (error) {
        if (error instanceof TaskResourceLimitError) throw error;
        return await this.fallback.renderPlainText(
          extractDocxPlainText(input.buffer)
        );
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
