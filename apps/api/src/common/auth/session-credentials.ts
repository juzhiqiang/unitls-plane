const SESSION_COOKIE_NAME =
  /^(?:__Secure-)?better-auth\.session_(?:token|data)(?:\.\d+)?$/;

type CredentialHeaders = {
  authorization?: unknown;
  cookie?: unknown;
};

function hasAuthorizationHeader(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function cookieValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

/**
 * 判断请求是否携带任何可能建立会话的凭据。
 *
 * 只认 Authorization 头和 Better-Auth 的会话 cookie；普通业务 cookie
 * 不能触发会话查询。分片 cookie（如 `.0`、`.1`）按完整名称匹配。
 */
export function hasSessionCredentials(headers: CredentialHeaders): boolean {
  if (hasAuthorizationHeader(headers.authorization)) return true;

  return cookieValues(headers.cookie).some(cookie =>
    cookie.split(';').some(part => {
      const separator = part.indexOf('=');
      const name = (separator === -1 ? part : part.slice(0, separator)).trim();
      return SESSION_COOKIE_NAME.test(name);
    })
  );
}
