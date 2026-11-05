import { marked } from 'marked';
import {
  defaultTreeAdapter,
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes,
} from 'parse5';

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

export function extractMarkdownTextFragments(markdown: string): string[] {
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
  if (!allowsRelative) return false;
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
    return ALLOWED_DOCUMENT_URL_SCHEMES.has(scheme);
  }

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
