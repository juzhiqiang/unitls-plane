import { describe, expect, it, vi } from 'bun:test';
import {
  bufferFromGeneratedImagePayload,
  normalizeOpenAiCompatibleImageEditUrl,
  normalizeOpenAiCompatibleImageGenerationUrl,
} from './openai-compatible-image';

describe('normalizeOpenAiCompatibleImageGenerationUrl', () => {
  it('appends /v1/images/generations to a bare base url', () => {
    expect(
      normalizeOpenAiCompatibleImageGenerationUrl('https://api.test')
    ).toBe('https://api.test/v1/images/generations');
  });

  it('does not duplicate an existing /v1 segment', () => {
    expect(
      normalizeOpenAiCompatibleImageGenerationUrl('https://api.test/v1')
    ).toBe('https://api.test/v1/images/generations');
  });

  it('keeps a base url that already points at the endpoint', () => {
    expect(
      normalizeOpenAiCompatibleImageGenerationUrl(
        'https://api.test/v1/images/generations'
      )
    ).toBe('https://api.test/v1/images/generations');
  });

  it('strips trailing slashes', () => {
    expect(
      normalizeOpenAiCompatibleImageGenerationUrl('https://api.test/v1///')
    ).toBe('https://api.test/v1/images/generations');
  });
});

describe('normalizeOpenAiCompatibleImageEditUrl', () => {
  it('still resolves the edits endpoint after extraction', () => {
    expect(normalizeOpenAiCompatibleImageEditUrl('https://api.test')).toBe(
      'https://api.test/v1/images/edits'
    );
  });
});

describe('bufferFromGeneratedImagePayload', () => {
  const fetchImpl = vi.fn();

  it.each(['b64_json', 'base64', 'image', 'image_base64'])(
    'decodes the %s field',
    async field => {
      const payload = { data: [{ [field]: 'aGVsbG8=' }] };
      const buffer = await bufferFromGeneratedImagePayload(
        payload,
        fetchImpl as unknown as typeof fetch
      );
      expect(buffer.toString('utf8')).toBe('hello');
    }
  );

  it('strips a data url prefix before decoding', async () => {
    const payload = { data: [{ b64_json: 'data:image/png;base64,aGVsbG8=' }] };
    const buffer = await bufferFromGeneratedImagePayload(
      payload,
      fetchImpl as unknown as typeof fetch
    );
    expect(buffer.toString('utf8')).toBe('hello');
  });

  it('downloads the image when only a url is returned', async () => {
    const download = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        new Uint8Array(Buffer.from('hello', 'utf8')).buffer,
    }));
    const buffer = await bufferFromGeneratedImagePayload(
      { data: [{ url: 'https://cdn.test/a.png' }] },
      download as unknown as typeof fetch
    );
    expect(download).toHaveBeenCalledWith('https://cdn.test/a.png');
    expect(buffer.toString('utf8')).toBe('hello');
  });

  it('throws when the payload carries no image', async () => {
    await expect(
      bufferFromGeneratedImagePayload(
        { data: [{}] },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow('missing generated image');
  });
});
