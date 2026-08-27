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
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
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

  throw new Error('OpenAI-compatible image response missing generated image');
}
