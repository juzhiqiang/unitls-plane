/**
 * 生图失败原因脱敏器。
 *
 * 任务失败时,上游报错的真实原因要写进 `tasks.errorMessage` 并经公开的
 * GET /tasks/:id/status 外泄,而 provider 报错常回显用户 prompt、甚至带出密钥。
 * 这里负责把任意原始错误收敛成"可读、可外泄"的单行摘要:
 *
 * - 优先提取 JSON 报错体里的 message 字段,拿不到则用截断原文;
 * - HTML 报错体(网关 502 错误页)只取 `<title>`,取不到就返回空,绝不外发源码;
 * - 剥离调用方声明的敏感串(用户 prompt)与密钥形态(sk-xxx / Bearer xxx);
 * - URL 只保留 host,避免签名地址外泄;
 * - 折叠空白并截断,给不出内容时返回空串,由调用方回退固定文案。
 */

const MAX_MESSAGE_LENGTH = 160;
const REDACTED = '[redacted]';

/** JSON 报错体里可能承载人读信息的字段,按优先级取第一个非空字符串。 */
const MESSAGE_FIELDS = [
  'message',
  'msg',
  'error_msg',
  'errorMessage',
  'detail',
] as const;

function extractMessageField(parsed: unknown): string | undefined {
  if (typeof parsed === 'string' && parsed.trim()) return parsed;
  if (typeof parsed !== 'object' || parsed === null) return undefined;

  const record = parsed as Record<string, unknown>;
  // OpenAI 兼容格式是 { error: { message } },网关变体常拍平或换名,两层都找。
  const candidates: unknown[] = [record, record.error];
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    for (const field of MESSAGE_FIELDS) {
      const value = (candidate as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return undefined;
}

function toSingleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * HTML 报错体(网关 502/504 错误页)的提取:整页源码对用户毫无意义。
 *
 * 取 `<title>` 作为摘要(Cloudflare 是 "502: Bad gateway",状态码前缀去掉,
 * 外层消息里已经带了),没有 title 就返回 undefined,让调用方回退固定文案。
 */
function extractHtmlTitle(text: string): string | undefined {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(text);
  const title = match?.[1] && toSingleLine(decodeBasicEntities(match[1]));
  if (!title) return undefined;
  return (
    title.replace(/^HTTP\s*\d{3}:\s*/i, '').replace(/^\d{3}:\s*/, '') ||
    undefined
  );
}

function looksLikeHtml(text: string): boolean {
  const head = toSingleLine(text.slice(0, 200)).toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function truncate(text: string): string {
  if (text.length <= MAX_MESSAGE_LENGTH) return text;
  return `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}

export function sanitizeImageError(
  raw: unknown,
  secrets: string[] = []
): string {
  let text: string;
  if (raw instanceof Error) {
    text = raw.message;
  } else if (typeof raw === 'string') {
    text = raw;
  } else {
    try {
      text = JSON.stringify(raw) ?? String(raw);
    } catch {
      text = String(raw);
    }
  }

  // HTML 报错体只取 title;JSON 报错体优先取 message 字段;纯文本用原文兜底。
  const trimmed = text.trim();
  if (looksLikeHtml(trimmed)) {
    return truncate(toSingleLine(extractHtmlTitle(trimmed) ?? ''));
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const extracted = extractMessageField(JSON.parse(trimmed));
      if (extracted) text = extracted;
    } catch {
      // 不是合法 JSON,按原文继续脱敏。
    }
  }

  for (const secret of secrets) {
    if (!secret) continue;
    // 大小写不敏感地整体替换 prompt 回显;split/join 避免正则元字符转义问题。
    const lowered = text.toLowerCase();
    const loweredSecret = secret.toLowerCase();
    if (lowered.includes(loweredSecret)) {
      const parts: string[] = [];
      let cursor = 0;
      for (;;) {
        const index = lowered.indexOf(loweredSecret, cursor);
        if (index === -1) break;
        parts.push(text.slice(cursor, index), REDACTED);
        cursor = index + secret.length;
      }
      parts.push(text.slice(cursor));
      text = parts.join('');
    }
  }

  text = text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, REDACTED)
    .replace(/Bearer\s+\S+/gi, `Bearer ${REDACTED}`)
    .replace(/https?:\/\/([^/\s?#]+)[^\s]*/g, '$1');

  return truncate(toSingleLine(text));
}
