import { describe, expect, it, vi } from 'bun:test';
import sharp from 'sharp';
import { ErrorCodes } from '../../../common/errors/error-codes';
import {
  buildImageGenerationPrompt,
  ImageGenerationError,
  ImageGenerationService,
  OpenAiCompatibleImageGenerationProvider,
} from './image-generation.service';

/** 参考图必须是能被 sharp 解码的真实图片:provider 会先转 PNG 再上传。 */
async function referencePng(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: '#336699' },
  })
    .png()
    .toBuffer();
}

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

  it('drops the body fields the provider cannot accept', async () => {
    // wan 一类网关对请求体做严格校验:多一个不认识的字段就整个 400
    // (「请求包含未知字段」)。omitBodyFields 让这类来源不必改代码。
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      id: 'wan',
      baseUrl: 'https://wan.test',
      model: 'wan2.2-t2i',
      omitBodyFields: ['quality', 'response_format'],
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await provider.generate(config);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'wan2.2-t2i',
      prompt: '一只戴礼帽的柴犬',
      size: '1024x1024',
      n: 1,
    });
    expect(body).not.toHaveProperty('quality');
    expect(body).not.toHaveProperty('response_format');
  });

  it('keeps the reference images field when other body fields are omitted', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      id: 'wan',
      baseUrl: 'https://wan.test',
      editTransport: 'generations_ref',
      omitBodyFields: ['quality', 'response_format', 'n'],
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await provider.generate(
      { ...config, mode: 'image_to_image', inputFileCount: 1 },
      await referencePng()
    );

    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.reference_images).toHaveLength(1);
    expect(body).not.toHaveProperty('n');
    expect(body).not.toHaveProperty('quality');
  });

  it('drops the omitted fields from the multipart edit form too', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://api.test',
      omitBodyFields: ['response_format'],
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await provider.generate(
      { ...config, mode: 'image_to_image', inputFileCount: 1 },
      await referencePng()
    );

    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const form = init.body as FormData;
    expect(form.get('size')).toBe('1024x1024');
    expect(form.get('quality')).toBe('high');
    expect(form.has('response_format')).toBe(false);
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

  it('maps a thrown fetch (timeout/network) to a generic error without leaking it', async () => {
    // 挂死上游(连上 TLS、收了 body 却永不回响应)会让 fetch 一直挂到 keepalive。
    // 超时走 AbortSignal.timeout 抛 AbortError,这里直接模拟 fetch reject。
    const fetchImpl = vi.fn(async () => {
      throw new globalThis.DOMException(
        'The user aborted a request',
        'AbortError'
      );
    });
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
    expect(error.message).not.toContain('aborted');
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

  const editConfig = {
    ...config,
    mode: 'image_to_image' as const,
    prompt: '把背景换成海边',
    inputFileCount: 1,
  };

  it('posts the reference image as multipart form data to the edits endpoint', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://api.test',
      apiKey: 'sk-test',
      model: 'gpt-image-1',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const buffer = await provider.generate(editConfig, await referencePng());

    expect(buffer.toString('utf8')).toBe('hello');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/images/edits');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    // multipart 的 boundary 由 FormData 自己生成,手写 Content-Type 会让上游解析失败。
    expect(headers).not.toHaveProperty('Content-Type');
    const form = init.body as FormData;
    expect(form.get('model')).toBe('gpt-image-1');
    expect(String(form.get('prompt'))).toContain('把背景换成海边');
    expect(form.get('size')).toBe('1024x1024');
    expect(form.get('quality')).toBe('high');
    expect(form.get('n')).toBe('1');
    const image = form.get('image') as Blob;
    expect(image).toBeInstanceOf(Blob);
    // 上传的是 sharp 转出来的 PNG,不是原始字节。
    expect(image.type).toBe('image/png');
  });

  it('maps an undecodable reference image to a generic sanitized error', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://api.test',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const error = (await provider
      .generate(editConfig, Buffer.from('not-an-image'))
      .catch(caught => caught)) as Error;

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(error.message).not.toContain('把背景换成海边');
  });

  it('refuses image_to_image without a reference image and stays generic', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://api.test',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const error = (await provider
      .generate(editConfig)
      .catch(caught => caught)) as ImageGenerationError;

    expect(error).toBeInstanceOf(ImageGenerationError);
    expect(error.code).toBe(ErrorCodes.AI_IMAGE_GENERATION_FAILED);
    expect(error.message).toBe('Image generation failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('ignores a reference image for text_to_image and still posts JSON', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://api.test',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await provider.generate(config, Buffer.from('source-bytes'));

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/images/generations');
    expect(typeof init.body).toBe('string');
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

    expect(generate).toHaveBeenCalledWith(config, undefined);
    expect(result.mimeType).toBe('image/png');
    expect(result.extension).toBe('png');
    expect(result.buffer.toString('utf8')).toBe('hello');
  });

  it('passes the reference image through to the provider', async () => {
    const generate = vi.fn(async () => Buffer.from('hello'));
    const service = new ImageGenerationService({
      externalProvider: { generate },
    });

    await service.generate(
      { ...config, mode: 'image_to_image', inputFileCount: 1 },
      Buffer.from('source-bytes')
    );

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'image_to_image' }),
      Buffer.from('source-bytes')
    );
  });
});

describe('OpenAiCompatibleImageGenerationProvider (generations_ref transport)', () => {
  const editConfig = {
    ...config,
    mode: 'image_to_image' as const,
    prompt: '把背景换成雪山',
    inputFileCount: 1,
  };

  /** kmage 一类网关没有 /v1/images/edits:图生图也打 generations,参考图进 JSON 数组。 */
  it('posts the reference image as a data URL inside the generations body', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      id: 'kmage',
      baseUrl: 'https://image.dddd.zone',
      apiKey: 'kmage_key',
      model: 'gpt-image-2',
      editTransport: 'generations_ref',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const buffer = await provider.generate(editConfig, await referencePng());

    expect(buffer.toString('utf8')).toBe('hello');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://image.dddd.zone/v1/images/generations');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer kmage_key'
    );
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'gpt-image-2',
      size: '1024x1024',
      quality: 'high',
      n: 1,
    });
    expect(body.prompt).toContain('把背景换成雪山');
    expect(body.reference_images).toHaveLength(1);
    // 参考图统一转 PNG 再编码,原图元数据(含 GPS)不会外发。
    expect(body.reference_images[0]).toStartWith('data:image/png;base64,');
  });

  it('sends bare base64 when the provider asks for it', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://image.dddd.zone',
      editTransport: 'generations_ref',
      refImageEncoding: 'base64',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await provider.generate(editConfig, await referencePng());

    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.reference_images[0]).not.toContain('data:');
    expect(body.reference_images[0]).toStartWith('iVBOR');
  });

  it('honours a custom reference images field name', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://image.dddd.zone',
      editTransport: 'generations_ref',
      refImagesField: 'image_urls',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await provider.generate(editConfig, await referencePng());

    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.image_urls).toHaveLength(1);
    expect(body).not.toHaveProperty('reference_images');
  });

  it('still refuses image_to_image without a reference image', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://image.dddd.zone',
      editTransport: 'generations_ref',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const error = (await provider
      .generate(editConfig)
      .catch(caught => caught)) as ImageGenerationError;

    expect(error.code).toBe(ErrorCodes.AI_IMAGE_GENERATION_FAILED);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps text_to_image on the plain generations body', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://image.dddd.zone',
      editTransport: 'generations_ref',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await provider.generate(config);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string)).not.toHaveProperty(
      'reference_images'
    );
  });
});

describe('ImageGenerationService (multi provider registry)', () => {
  function stub(
    id: string,
    capabilities: Array<'generate' | 'edit'> = ['generate', 'edit'],
    model = 'gpt-image-1'
  ) {
    return {
      generate: vi.fn(async () => Buffer.from(id)),
      descriptor: { id, label: `${id} label`, capabilities },
      model,
    };
  }

  it('routes to the provider named by providerId', async () => {
    const first = stub('alpha');
    const second = stub('kmage', ['generate', 'edit'], 'gpt-image-2');
    const service = new ImageGenerationService({
      providers: [first, second],
    });

    const result = await service.generate({ ...config, providerId: 'kmage' });

    expect(second.generate).toHaveBeenCalled();
    expect(first.generate).not.toHaveBeenCalled();
    expect(result.providerId).toBe('kmage');
    // EXIF 写的是实际出图来源的模型,不是第一个来源的。
    expect(result.model).toBe('gpt-image-2');
  });

  it('matches providerId case-insensitively', async () => {
    const provider = stub('kmage');
    const service = new ImageGenerationService({ providers: [provider] });

    await service.generate({ ...config, providerId: 'KMage' });

    expect(provider.generate).toHaveBeenCalled();
  });

  it('falls back to the first configured provider when none is requested', async () => {
    const first = stub('alpha');
    const second = stub('beta');
    const service = new ImageGenerationService({
      providers: [first, second],
    });

    const result = await service.generate(config);

    expect(first.generate).toHaveBeenCalled();
    expect(second.generate).not.toHaveBeenCalled();
    expect(result.providerId).toBe('alpha');
  });

  it('fails instead of silently switching when the provider is unknown', async () => {
    const provider = stub('alpha');
    const service = new ImageGenerationService({ providers: [provider] });

    const error = (await service
      .generate({ ...config, providerId: 'ghost' })
      .catch(caught => caught)) as ImageGenerationError;

    expect(error.code).toBe(ErrorCodes.AI_IMAGE_PROVIDER_UNAVAILABLE);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('rejects image_to_image on a generate-only provider', async () => {
    const provider = stub('textonly', ['generate']);
    const service = new ImageGenerationService({ providers: [provider] });

    const error = (await service
      .generate({
        ...config,
        mode: 'image_to_image',
        inputFileCount: 1,
        providerId: 'textonly',
      })
      .catch(caught => caught)) as ImageGenerationError;

    expect(error.code).toBe(ErrorCodes.AI_IMAGE_PROVIDER_UNAVAILABLE);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('lists providers in configuration order and leaks no credentials', () => {
    const service = new ImageGenerationService({
      providers: [stub('alpha'), stub('kmage', ['generate'])],
    });

    const listed = service.listProviders();

    expect(listed).toEqual([
      { id: 'alpha', label: 'alpha label', capabilities: ['generate', 'edit'] },
      { id: 'kmage', label: 'kmage label', capabilities: ['generate'] },
    ]);
    // baseUrl / apiKey 属于服务端配置,出现在这里就是外泄。
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toContain('baseUrl');
    expect(serialized).not.toContain('apiKey');
  });

  it('reports unconfigured when the injected provider list is empty', async () => {
    const service = new ImageGenerationService({ providers: [] });

    expect(service.configured).toBe(false);
    const error = (await service
      .generate(config)
      .catch(caught => caught)) as ImageGenerationError;
    expect(error.code).toBe(ErrorCodes.AI_IMAGE_NOT_CONFIGURED);
  });
});
