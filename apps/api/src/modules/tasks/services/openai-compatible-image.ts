export function normalizeOpenAiCompatibleImageEditUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/images/edits')) {
    return trimmed;
  }
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/images/edits`;
  }
  return `${trimmed}/v1/images/edits`;
}

export function normalizeOpenAiCompatibleImageGenerationUrl(
  baseUrl: string
): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/images/generations')) {
    return trimmed;
  }
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/images/generations`;
  }
  return `${trimmed}/v1/images/generations`;
}

/**
 * 图已经生成出来了,只是没取回来(网关抖动、CDN 502、签名 URL 还没生效)。
 *
 * 和「响应结构不认识」分开:后者重来一次必然一样,前者值得再试一次。
 */
export class GeneratedImageDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeneratedImageDownloadError';
  }
}

export async function bufferFromGeneratedImagePayload(
  payload: unknown,
  fetchImpl: typeof fetch
): Promise<Buffer> {
  const data = (payload as { data?: Array<Record<string, unknown>> }).data?.[0];
  const image =
    data?.b64_json ?? data?.base64 ?? data?.image ?? data?.image_base64;
  if (typeof image === 'string' && image.trim()) {
    return Buffer.from(image.replace(/^data:[^,]+,/, ''), 'base64');
  }

  const url = data?.url;
  if (typeof url === 'string' && url.trim()) {
    // 少数网关(如 kmage)声明了 responseFormat=url,却把 base64 字符串塞进
    // data[0].url 字段返回(裸 base64 或带 data: 前缀),而不是一个可下载的 URL。
    // 这种情况直接就地解码,不要再去 fetch 一个根本不是 URL 的值。
    if (/^data:[^,]+,/.test(url)) {
      return Buffer.from(url.replace(/^data:[^,]+,/, ''), 'base64');
    }
    // 裸 base64:不是 URL(无 https?:// 前缀),但能解出非空字节就按 base64 处理。
    // 用 try/catch 兜底:解不出就继续往下走 URL 下载/missing 分支,不在这里硬崩。
    if (!/^https?:\/\//i.test(url)) {
      try {
        const decoded = Buffer.from(url, 'base64');
        if (decoded.length > 0) return decoded;
      } catch {
        // 不是合法 base64,落到下面的 URL 下载尝试(会因非 URL 失败)或 missing。
      }
    }

    if (/^https?:\/\//i.test(url)) {
      let response: Response;
      try {
        response = await fetchImpl(url);
      } catch (error) {
        throw new GeneratedImageDownloadError(
          `Failed to download generated image: ${String(error instanceof Error ? error.message : error)}`
        );
      }
      if (!response.ok) {
        throw new GeneratedImageDownloadError(
          `Failed to download generated image: ${response.status}`
        );
      }
      return Buffer.from(await response.arrayBuffer());
    }
  }

  throw new Error('OpenAI-compatible image response missing generated image');
}
