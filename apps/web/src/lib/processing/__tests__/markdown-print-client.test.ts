import { describe, expect, it, vi } from 'vitest';
import {
  buildMarkdownPrintHtml,
  printMarkdownPreviewPdf,
} from '../markdown-print-client';

describe('markdown print client', () => {
  it('builds a printable PDF document from rendered markdown HTML', () => {
    const html = buildMarkdownPrintHtml({
      title: 'Report <Draft>',
      contentHtml: '<h1>Report</h1><script>alert(1)</script><p>Ready</p>',
    });

    expect(html).toContain('<title>Report &lt;Draft&gt;</title>');
    expect(html).toContain('<h1>Report</h1>');
    expect(html).toContain('<p>Ready</p>');
    expect(html).toContain('@media print');
    expect(html).not.toContain('window.print()');
    expect(html).not.toContain('<script>');
  });

  it('prints the current preview in the current page without opening a tab', () => {
    const source = document.createElement('div');
    source.innerHTML = '<div class="markdown-body"><h1>Local PDF</h1></div>';
    const openWindow = vi.fn();
    const scheduleCleanup = vi.fn((callback: () => void) => {
      callback();
      return 1;
    });
    const iframeDocument = document.implementation.createHTMLDocument('');
    const iframe = document.createElement('iframe');
    Object.defineProperty(iframe, 'contentDocument', {
      value: iframeDocument,
    });
    Object.defineProperty(iframe, 'contentWindow', {
      value: {
        focus: vi.fn(),
        print: vi.fn(),
        setTimeout: vi.fn((callback: () => void) => {
          callback();
          return 1;
        }),
      },
    });
    const createPrintFrame = vi.fn(() => iframe);

    const ok = printMarkdownPreviewPdf({
      title: 'local.pdf',
      sourceElement: source,
      openWindow,
      createPrintFrame,
      scheduleCleanup,
      cleanupDelay: 0,
      printDelay: 0,
    });

    expect(ok).toBe(true);
    expect(openWindow).not.toHaveBeenCalled();
    expect(createPrintFrame).toHaveBeenCalledOnce();
    expect(iframeDocument.documentElement.innerHTML).toContain('Local PDF');
    expect(iframe.contentWindow?.print).toHaveBeenCalledOnce();
    expect(scheduleCleanup).toHaveBeenCalledWith(expect.any(Function), 0);
    expect(iframe.isConnected).toBe(false);
  });

  it('returns false when the preview cannot be written to the print frame', () => {
    const source = document.createElement('div');
    source.innerHTML = '<div class="markdown-body"><h1>Blocked</h1></div>';
    const iframe = document.createElement('iframe');
    Object.defineProperty(iframe, 'contentDocument', {
      value: null,
    });

    const ok = printMarkdownPreviewPdf({
      title: 'blocked.pdf',
      sourceElement: source,
      createPrintFrame: vi.fn(() => iframe),
    });

    expect(ok).toBe(false);
    expect(iframe.isConnected).toBe(false);
  });
});
