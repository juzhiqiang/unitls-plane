import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import {
  createModNetInputTensor,
  OpenAiCompatiblePortraitSegmentationProvider,
  normalizeModNetMatteValues,
  PortraitSegmentationService,
  refinePortraitAlphaBytes,
  resolvePortraitSegmentationModelPath,
} from './portrait-segmentation.service';

describe('resolvePortraitSegmentationModelPath', () => {
  it('prefers the repository-root model path when it exists', () => {
    const modelPath = resolvePortraitSegmentationModelPath({
      cwd: 'D:/project/unitls-plane',
      exists: path =>
        path.replaceAll('\\', '/') ===
        'D:/project/unitls-plane/apps/api/models/modnet.onnx',
    });

    expect(modelPath.replaceAll('\\', '/')).toBe(
      'D:/project/unitls-plane/apps/api/models/modnet.onnx'
    );
  });

  it('supports running the API from apps/api', () => {
    const modelPath = resolvePortraitSegmentationModelPath({
      cwd: 'D:/project/unitls-plane/apps/api',
      exists: path =>
        path.replaceAll('\\', '/') ===
        'D:/project/unitls-plane/apps/api/models/modnet.onnx',
    });

    expect(modelPath.replaceAll('\\', '/')).toBe(
      'D:/project/unitls-plane/apps/api/models/modnet.onnx'
    );
  });

  it('uses ID_PHOTO_SEGMENTATION_MODEL when configured', () => {
    expect(
      resolvePortraitSegmentationModelPath({
        configuredPath: 'D:/models/custom.onnx',
        cwd: 'D:/project/unitls-plane/apps/api',
        exists: () => false,
      })
    ).toBe('D:/models/custom.onnx');
  });
});

describe('createModNetInputTensor', () => {
  it('writes RGB pixels in CHW order with MODNet normalization', () => {
    const tensor = createModNetInputTensor(
      Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 128, 128, 128]),
      2
    );

    expect(tensor[0]).toBeCloseTo(1, 5);
    expect(tensor[1]).toBeCloseTo(-1, 5);
    expect(tensor[4]).toBeCloseTo(-1, 5);
    expect(tensor[5]).toBeCloseTo(1, 5);
    expect(tensor[8]).toBeCloseTo(-1, 5);
    expect(tensor[9]).toBeCloseTo(-1, 5);
  });

  it('keeps absolute brightness instead of stretching dim inputs', () => {
    const tensor = createModNetInputTensor(
      Buffer.from([128, 0, 0, 0, 64, 0, 0, 0, 0, 0, 0, 0]),
      2
    );

    expect(tensor[0]).toBeCloseTo(128 / 255 / 0.5 - 1, 5);
    expect(tensor[5]).toBeCloseTo(64 / 255 / 0.5 - 1, 5);
  });
});

describe('normalizeModNetMatteValues', () => {
  it('uses MODNet alpha values directly without per-image min max stretching', () => {
    expect([
      ...normalizeModNetMatteValues(new Float32Array([0.2, 0.4, 0.8])),
    ]).toEqual([51, 102, 204]);
  });

  it('clamps alpha values to the byte range', () => {
    expect([
      ...normalizeModNetMatteValues(new Float32Array([-1, 0.5, 2])),
    ]).toEqual([0, 128, 255]);
  });
});

describe('refinePortraitAlphaBytes', () => {
  it('removes faint background edges and lifts solid portrait regions', () => {
    const refined = refinePortraitAlphaBytes(
      Buffer.from([0, 48, 72, 96, 128, 144, 255])
    );

    expect(refined[0]).toBe(0);
    expect(refined[1]).toBe(0);
    expect(refined[2]).toBe(0);
    expect(refined[3]).toBeGreaterThan(120);
    expect(refined[4]).toBeGreaterThan(220);
    expect(refined[5]).toBe(255);
    expect(refined[6]).toBe(255);
  });
});

describe('PortraitSegmentationService.segment', () => {
  it('runs one full-image MODNet inference instead of amplifying rough masks with ROI re-inference', async () => {
    const input = await sharp({
      create: {
        width: 64,
        height: 96,
        channels: 3,
        background: '#eeeeee',
      },
    })
      .png()
      .toBuffer();
    let runCount = 0;
    const session = {
      inputNames: ['input'],
      outputNames: ['output'],
      run: async () => {
        runCount += 1;
        return {
          output: {
            data: new Float32Array(256 * 256).fill(1),
          },
        };
      },
    };
    const service = new PortraitSegmentationService() as any;
    service.getSession = async () => session;

    const result = await service.segment(input);

    expect(result.faceCount).toBe(1);
    expect(runCount).toBe(1);
  });

  it('uses OpenAI-compatible segmentation when ai mode is requested and falls back to local on failure', async () => {
    const input = await sharp({
      create: {
        width: 64,
        height: 96,
        channels: 3,
        background: '#eeeeee',
      },
    })
      .png()
      .toBuffer();
    let localRunCount = 0;
    const session = {
      inputNames: ['input'],
      outputNames: ['output'],
      run: async () => {
        localRunCount += 1;
        return {
          output: {
            data: new Float32Array(256 * 256).fill(1),
          },
        };
      },
    };
    const service = new PortraitSegmentationService({
      externalProvider: {
        segment: async () => {
          throw new Error('external unavailable');
        },
      },
    } as any) as any;
    service.getSession = async () => session;

    const result = await service.segment(input, { mode: 'ai' });

    expect(result.faceCount).toBe(1);
    expect(localRunCount).toBe(1);
  });
});

describe('OpenAiCompatiblePortraitSegmentationProvider', () => {
  // provider 通道与 images/edits 的 size/quality/background/response_format
  // 默认都读 process.env。从仓库根跑测试(release:verify 就是这样)会加载
  // .env.local,本机把 PROVIDER 配成 image_result 时下面第一条用例会假红。
  // 这里清空这几项,让用例只针对代码默认值与显式入参断言,用例后还原。
  const ENV_KEYS = [
    'ID_PHOTO_AI_SEGMENTATION_PROVIDER',
    'ID_PHOTO_AI_IMAGE_SIZE',
    'ID_PHOTO_AI_IMAGE_QUALITY',
    'ID_PHOTO_AI_IMAGE_BACKGROUND',
    'ID_PHOTO_AI_RESPONSE_FORMAT',
  ] as const;
  const savedEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const original = savedEnv.get(key);
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  });

  it('posts an OpenAI-compatible chat completion request and parses a base64 mask', async () => {
    const mask = await sharp(Buffer.from([0, 255, 255, 0]), {
      raw: { width: 2, height: 2, channels: 1 },
    })
      .png()
      .toBuffer();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = new OpenAiCompatiblePortraitSegmentationProvider({
      baseUrl: 'https://ai.example.com/v1',
      apiKey: 'secret',
      model: 'vision-segmentation',
      // 必须显式指定通道：不传会落回 process.env.ID_PHOTO_AI_SEGMENTATION_PROVIDER,
      // 本机 .env.local 配成 image_result 时 segment() 直接抛错,这条用例会假红。
      provider: 'chat_mask',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init as RequestInit });
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    mask: `data:image/png;base64,${mask.toString('base64')}`,
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
    });
    const input = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();

    const result = await provider.segment(input);

    expect(calls[0]?.url).toBe('https://ai.example.com/v1/chat/completions');
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.model).toBe('vision-segmentation');
    expect(body.messages[1].content[1].image_url.url).toStartWith(
      'data:image/png;base64,'
    );
    expect(result.faceCount).toBe(1);
    expect(result.mask.length).toBeGreaterThan(0);
  });

  it('posts an OpenAI-compatible image edit request with a reference image and parses the generated result image', async () => {
    const generated = await sharp({
      create: {
        width: 4,
        height: 6,
        channels: 3,
        background: '#438edb',
      },
    })
      .png()
      .toBuffer();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = new OpenAiCompatiblePortraitSegmentationProvider({
      baseUrl: 'https://ai.example.com',
      apiKey: 'secret',
      model: 'gpt-image-2',
      provider: 'image_result',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init as RequestInit });
        if (String(url) === 'https://cdn.example.com/result.png') {
          return new Response(generated, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          });
        }
        return new Response(
          JSON.stringify({
            data: [{ url: 'https://cdn.example.com/result.png' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
    });
    const input = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();

    const result = await provider.renderIdPhoto(input, {
      width: 295,
      height: 413,
      backgroundColor: '#438edb',
      outputType: 'image/jpeg',
    });

    expect(calls[0]?.url).toBe('https://ai.example.com/v1/images/edits');
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: 'Bearer secret',
    });
    expect(calls[0]?.init.headers).not.toHaveProperty('Content-Type');
    const body = calls[0]?.init.body as FormData;
    expect(body.get('model')).toBe('gpt-image-2');
    expect(String(body.get('prompt'))).toContain('#438edb');
    expect(body.get('quality')).toBe('high');
    expect(body.get('background')).toBe('opaque');
    expect(body.get('response_format')).toBe('url');
    expect(body.get('image')).toBeInstanceOf(Blob);
    expect(body.get('mask')).toBeNull();
    expect(calls[1]?.url).toBe('https://cdn.example.com/result.png');
    expect(result.length).toBeGreaterThan(0);
  });

  it('propagates image result provider failures instead of returning undefined', async () => {
    const provider = new OpenAiCompatiblePortraitSegmentationProvider({
      baseUrl: 'https://ai.example.com/v1',
      apiKey: 'secret',
      model: 'gpt-image-2-4k',
      provider: 'image_result',
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'upstream_error',
              message: 'upstream image generation failed',
            },
          }),
          { status: 502, headers: { 'content-type': 'application/json' } }
        ),
    });
    const service = new PortraitSegmentationService({
      externalProvider: provider,
    });
    const input = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();

    await expect(
      service.renderIdPhoto(input, {
        width: 295,
        height: 413,
        backgroundColor: '#438edb',
        outputType: 'image/jpeg',
      })
    ).rejects.toThrow('upstream image generation failed');
  });
});
