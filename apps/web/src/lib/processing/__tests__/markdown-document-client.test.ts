import { describe, expect, it } from 'vitest';
import {
  createMarkdownSourceFile,
  deriveDocumentPdfFilename,
  isMarkdownDocumentFile,
  readMarkdownDocumentFile,
} from '../markdown-document-client';

describe('markdown document client helpers', () => {
  it('accepts markdown files even when the browser reports a generic mime type', () => {
    const file = new File(['# Title'], 'brief.MD', {
      type: 'application/octet-stream',
    });

    expect(isMarkdownDocumentFile(file)).toBe(true);
  });

  it('preserves imported markdown source without rendering or filtering it', async () => {
    const source = [
      '---',
      'title: Launch notes',
      '---',
      '',
      '# Heading',
      '',
      '<CustomComponent prop="kept" />',
      '',
      '```ts',
      'const value = "**markdown**";',
      '```',
    ].join('\n');
    const file = new File([`\uFEFF${source}`], 'notes.markdown', {
      type: '',
    });

    await expect(readMarkdownDocumentFile(file)).resolves.toBe(source);
  });

  it('derives stable PDF and uploaded markdown filenames', () => {
    expect(deriveDocumentPdfFilename('release-notes.markdown')).toBe(
      'release-notes.pdf'
    );

    const source = createMarkdownSourceFile(
      '# Ready',
      'release-notes.markdown'
    );
    expect(source.name).toBe('release-notes.markdown');
    expect(source.type).toBe('text/markdown');
  });
});
