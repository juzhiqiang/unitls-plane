interface BuildMarkdownPrintHtmlOptions {
  title: string;
  contentHtml: string;
}

interface PrintMarkdownPreviewOptions {
  title: string;
  sourceElement: Element | null;
  openWindow?: Window['open'];
  createPrintFrame?: () => HTMLIFrameElement;
  scheduleCleanup?: typeof window.setTimeout;
  cleanupDelay?: number;
  printDelay?: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizePrintHtml(contentHtml: string): string {
  const doc = document.implementation.createHTMLDocument('');
  doc.body.innerHTML = contentHtml;

  doc.body
    .querySelectorAll('script, iframe, object, embed')
    .forEach(node => node.remove());

  doc.body.querySelectorAll('*').forEach(node => {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (
        name.startsWith('on') ||
        name === 'srcdoc' ||
        ((name === 'href' || name === 'src') && value.startsWith('javascript:'))
      ) {
        node.removeAttribute(attr.name);
      }
    }
  });

  return doc.body.innerHTML;
}

export function buildMarkdownPrintHtml({
  title,
  contentHtml,
}: BuildMarkdownPrintHtmlOptions): string {
  const safeTitle = escapeHtml(title.trim() || 'document.pdf');
  const safeContent = sanitizePrintHtml(contentHtml);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    :root {
      color: #111827;
      background: #ffffff;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    body {
      margin: 0;
      background: #ffffff;
    }

    main {
      max-width: 760px;
      margin: 0 auto;
      padding: 40px 32px;
    }

    h1, h2, h3, h4 {
      break-after: avoid;
      color: #111827;
      line-height: 1.25;
    }

    p, li {
      line-height: 1.75;
      color: #1f2937;
    }

    pre, blockquote, table {
      break-inside: avoid;
    }

    pre {
      overflow: auto;
      padding: 12px;
      border: 1px solid #d1d5db;
      background: #f9fafb;
      font-size: 12px;
      line-height: 1.6;
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      border: 1px solid #d1d5db;
      padding: 8px;
      text-align: left;
    }

    img {
      max-width: 100%;
      height: auto;
    }

    @media print {
      @page {
        margin: 18mm;
      }

      main {
        max-width: none;
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <main>${safeContent}</main>
</body>
</html>`;
}

export function printMarkdownPreviewPdf({
  title,
  sourceElement,
  createPrintFrame = () => document.createElement('iframe'),
  scheduleCleanup = window.setTimeout.bind(window),
  cleanupDelay = 60000,
  printDelay = 80,
}: PrintMarkdownPreviewOptions): boolean {
  const contentElement = sourceElement?.querySelector('.markdown-body');
  if (!contentElement) return false;

  const html = buildMarkdownPrintHtml({
    title,
    contentHtml: contentElement.innerHTML,
  });

  const frame = createPrintFrame();
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.style.visibility = 'hidden';
  document.body.appendChild(frame);

  const frameDocument = frame.contentDocument;
  const frameWindow = frame.contentWindow;
  if (!frameDocument || !frameWindow) {
    frame.remove();
    return false;
  }

  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();

  frameWindow.setTimeout(() => {
    frameWindow.focus();
    frameWindow.print();
  }, printDelay);
  scheduleCleanup(() => frame.remove(), cleanupDelay);
  return true;
}
