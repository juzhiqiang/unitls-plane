export type ContentDispositionType = 'inline' | 'attachment';

const FALLBACK_FILENAME = 'file';
const PATH_SEPARATORS = ['/', '\\'];

function baseName(filename: string): string {
  let base = filename;
  for (const separator of PATH_SEPARATORS) {
    base = base.split(separator).pop() ?? '';
  }
  return base;
}

/**
 * 生成 ASCII 回退文件名：去掉目录前缀，非可打印 ASCII 字符和引号替换为下划线。
 */
function toAsciiFallback(filename: string): string {
  const ascii = Array.from(baseName(filename))
    .map(char => {
      const code = char.codePointAt(0) ?? 0;
      if (code < 0x20 || code > 0x7e) return '_';
      if (char === '"' || PATH_SEPARATORS.includes(char)) return '_';
      return char;
    })
    .join('')
    .trim();

  return ascii.length > 0 && ascii !== '.' && ascii !== '..'
    ? ascii
    : FALLBACK_FILENAME;
}

/**
 * 按 RFC 6266 / RFC 5987 生成 Content-Disposition，同时给出 ASCII 回退名和
 * UTF-8 编码名，避免中文文件名在部分浏览器下丢失。
 */
export function buildContentDisposition(
  filename: string,
  type: ContentDispositionType = 'attachment'
): string {
  const trimmed = baseName(filename ?? '').trim();
  const safeName = trimmed.length > 0 ? trimmed : FALLBACK_FILENAME;
  const fallback = toAsciiFallback(safeName);
  const encoded = encodeURIComponent(safeName).replace(
    /['()*]/g,
    char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );

  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

const ATTACHMENT_QUERY_VALUES = new Set([
  '1',
  'true',
  'yes',
  'attachment',
  'download',
]);

/**
 * 解析 `?download=` 查询参数：命中真值时按附件下载，否则内联预览。
 */
export function resolveContentDispositionType(
  value: unknown
): ContentDispositionType {
  if (typeof value !== 'string') return 'inline';
  return ATTACHMENT_QUERY_VALUES.has(value.trim().toLowerCase())
    ? 'attachment'
    : 'inline';
}
