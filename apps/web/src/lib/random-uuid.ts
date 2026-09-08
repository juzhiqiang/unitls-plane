/**
 * 格式正确的 UUID v4 生成器。
 *
 * crypto.randomUUID 只在安全上下文(HTTPS / localhost)暴露:IP + HTTP 的
 * 部署形态下它直接不存在,调用会抛 "randomUUID is not a function"。
 * getRandomValues 不受安全上下文限制,用它手拼 v4(置版本与变体位)兜底。
 * 生成结果必须带连字符:sessionId / clientGroupId 走 z.string().uuid() 校验。
 */
export function randomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) {
    // 连 getRandomValues 都没有(极老的运行时):时间戳+随机数兜底,格式仍是 uuid 形状。
    return `${Date.now().toString(16).padStart(8, '0')}-xxxx-4xxx-yxxx-xxxxxxxxxxxx`
      .replace(/[xy]/g, char => {
        const rand = (Math.random() * 16) | 0;
        return (char === 'x' ? rand : (rand & 0x3) | 0x8).toString(16);
      });
  }
  cryptoObj.getRandomValues(bytes);
  // RFC 4122 v4:第 7 字节高 4 位为版本(0100),第 9 字节高 2 位为变体(10)。
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
