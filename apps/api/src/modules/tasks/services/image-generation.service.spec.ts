import { describe, expect, it, vi } from 'bun:test';
import { ErrorCodes } from '../../../common/errors/error-codes';
import {
  buildImageGenerationPrompt,
  ImageGenerationError,
  ImageGenerationService,
  OpenAiCompatibleImageGenerationProvider,
} from './image-generation.service';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const config = {
  mode: 'text_to_image' as const,
  prompt: '一只戴礼帽的柴犬',
  size: '1024x1024' as const,
  quality: 'high' as const,
  inputFileCount: 0,
};

describe('buildImageGenerationPrompt', () => {
  it('prepends the anime style template and keeps the original prompt', () => {
    const prompt = buildImageGenerationPrompt({ prompt: 'x', style: 'anime' });

    expect(prompt.startsWith('Anime illustration')).toBe(true);
    expect(prompt).toContain('x');
  });

  it('returns the prompt untouched when no style is selected', () => {
    expect(buildImageGenerationPrompt({ prompt: 'x' })).toBe('x');
  });
});

describe('OpenAiCompatibleImageGenerationProvider', () => {
  it('posts prompt, size and quality to the generations endpoint', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://api.test',
      apiKey: 'sk-test',
      model: 'gpt-image-1',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const buffer = await provider.generate(config);

    expect(buffer.toString('utf8')).toBe('hello');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.test/v1/images/generations');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-test'
    );
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'gpt-image-1',
      prompt: '一只戴礼帽的柴犬',
      size: '1024x1024',
      quality: 'high',
      n: 1,
    });
  });

  it('prefixes the prompt with the selected style template', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://api.test',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await provider.generate({ ...config, style: 'anime' });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.prompt.startsWith('一只戴礼帽的柴犬')).toBe(false);
    expect(body.prompt).toContain('Anime illustration');
    expect(body.prompt).toContain('一只戴礼帽的柴犬');
  });

  it('falls back to the default model when the env var is set but empty', async () => {
    const originalModel = process.env.AI_IMAGE_MODEL;
    const originalFormat = process.env.AI_IMAGE_RESPONSE_FORMAT;
    process.env.AI_IMAGE_MODEL = '';
    process.env.AI_IMAGE_RESPONSE_FORMAT = '';
    try {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
      );
      const provider = new OpenAiCompatibleImageGenerationProvider({
        baseUrl: 'https://api.test',
        fetch: fetchImpl as unknown as typeof fetch,
      });

      await provider.generate(config);

      const [, init] = fetchImpl.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('gpt-image-1');
      expect(body.response_format).toBe('b64_json');
    } finally {
      if (originalModel === undefined) delete process.env.AI_IMAGE_MODEL;
      else process.env.AI_IMAGE_MODEL = originalModel;
      if (originalFormat === undefined)
        delete process.env.AI_IMAGE_RESPONSE_FORMAT;
      else process.env.AI_IMAGE_RESPONSE_FORMAT = originalFormat;
    }
  });

  it('throws immediately when baseUrl is missing', () => {
    // 显式传 undefined 会落回构造默认值 process.env.AI_IMAGE_BASE_URL,
    // 所以必须先清掉环境变量,否则本机配了 key 时这条会假绿。
    const original = process.env.AI_IMAGE_BASE_URL;
    delete process.env.AI_IMAGE_BASE_URL;
    try {
      expect(() => new OpenAiCompatibleImageGenerationProvider({})).toThrow(
        'AI_IMAGE_BASE_URL is not configured'
      );
    } finally {
      if (original !== undefined) process.env.AI_IMAGE_BASE_URL = original;
    }
  });

  it('maps a content policy rejection to its own error code', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            message:
              'Your prompt "一只戴礼帽的柴犬" was rejected by our safety system',
            code: 'content_policy_violation',
          },
        },
        400
      )
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://api.test',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const error = (await provider
      .generate(config)
      .catch(caught => caught)) as ImageGenerationError;

    expect(error).toBeInstanceOf(ImageGenerationError);
    expect(error.code).toBe(ErrorCodes.AI_IMAGE_CONTENT_REJECTED);
    expect(error.message).not.toContain('一只戴礼帽的柴犬');
  });

  it('maps other upstream failures to a generic error without echoing the body', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: { message: 'prompt=一只戴礼帽的柴犬 upstream boom' } },
        500
      )
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://api.test',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const error = (await provider
      .generate(config)
      .catch(caught => caught)) as ImageGenerationError;

    expect(error.code).toBe(ErrorCodes.AI_IMAGE_GENERATION_FAILED);
    expect(error.message).not.toContain('一只戴礼帽的柴犬');
    expect(error.message).not.toContain('upstream boom');
  });

  it('maps an undecodable success payload to a generic sanitized error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{}] }));
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://api.test',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const error = (await provider
      .generate(config)
      .catch(caught => caught)) as ImageGenerationError;

    expect(error).toBeInstanceOf(ImageGenerationError);
    expect(error.code).toBe(ErrorCodes.AI_IMAGE_GENERATION_FAILED);
    expect(error.message).toBe('Image generation failed');
  });
});

describe('ImageGenerationService', () => {
  it('reports itself unconfigured and refuses to generate without a provider', async () => {
    const service = new ImageGenerationService({ externalProvider: null });

    expect(service.configured).toBe(false);
    const error = (await service
      .generate(config)
      .catch(caught => caught)) as ImageGenerationError;
    expect(error.code).toBe(ErrorCodes.AI_IMAGE_NOT_CONFIGURED);
  });

  it('delegates to the injected provider and reports PNG output', async () => {
    const generate = vi.fn(async () => Buffer.from('hello'));
    const service = new ImageGenerationService({
      externalProvider: { generate },
    });

    const result = await service.generate(config);

    expect(generate).toHaveBeenCalledWith(config);
    expect(result.mimeType).toBe('image/png');
    expect(result.extension).toBe('png');
    expect(result.buffer.toString('utf8')).toBe('hello');
  });
});
