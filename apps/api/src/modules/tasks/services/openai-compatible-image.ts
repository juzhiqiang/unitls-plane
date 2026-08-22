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
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Failed to download generated image: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error('OpenAI-compatible image response missing generated image');
}
