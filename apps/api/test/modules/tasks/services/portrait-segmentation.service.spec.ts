import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as path from 'node:path';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import {
  MODNET_LONG_EDGE,
  modnetInputSize as sharedModnetInputSize,
} from '@utils-plane/utils';
import {
  createModNetInputTensor,
  MODNET_INPUT_SIZE,
  modnetInputSize,
  OpenAiCompatiblePortraitSegmentationProvider,
  normalizeModNetMatteValues,
  PortraitSegmentationService,
  refinePortraitAlphaBytes,
  resolvePortraitSegmentationModelPath,
} from '../../../../src/modules/tasks/services/portrait-segmentation.service';

describe('resolvePortraitSegmentationModelPath', () => {
  // Windows 上 path.resolve('/app', ...) 会带当前盘符，用 path.resolve 生成
  // 期望值可以同时覆盖容器与 Windows 本地开发。
  const inApp = (...segments: string[]) => path.resolve('/app', ...segments);
  const normalize = (modelPath: string) => modelPath.replaceAll('\\', '/');

  it('prefers the photographic model over the generic model', () => {
    const modelPath = resolvePortraitSegmentationModelPath({
      cwd: 'D:/project/unitls-plane',
      exists: path => {
        const normalized = path.replaceAll('\\', '/');
        return (
          normalized ===
            'D:/project/unitls-plane/apps/api/models/modnet_photographic.onnx' ||
          normalized === 'D:/project/unitls-plane/apps/api/models/modnet.onnx'
        );
      },
    });

    expect(modelPath.replaceAll('\\', '/')).toBe(
      'D:/project/unitls-plane/apps/api/models/modnet_photographic.onnx'
    );
  });

  it('finds the photographic model in the image-baked container layout', () => {
    // Dockerfile: COPY docker/models/ ./models/id-photo/，容器内 cwd=/app。
    const expected = inApp('models/id-photo/modnet/modnet_photographic.onnx');
    const modelPath = resolvePortraitSegmentationModelPath({
      cwd: '/app',
      exists: candidate => candidate === expected,
    });

    expect(modelPath).toBe(expected);
    expect(normalize(modelPath)).toEndWith(
      'models/id-photo/modnet/modnet_photographic.onnx'
    );
  });

  it('finds the photographic model in the repository docker assets', () => {
    // 仓库本地开发：权重在 docker/models/modnet/，不在 apps/api/models/。
    const expected = path.resolve(
      'D:/project/unitls-plane',
      'docker/models/modnet/modnet_photographic.onnx'
    );
    const modelPath = resolvePortraitSegmentationModelPath({
      cwd: 'D:/project/unitls-plane',
      exists: candidate => candidate === expected,
    });

    expect(normalize(modelPath)).toBe(
      'D:/project/unitls-plane/docker/models/modnet/modnet_photographic.onnx'
    );
  });

  it('falls back to the app-local generic model when no photographic model exists', () => {
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

describe('MODNET_INPUT_SIZE', () => {
  it('matches the shared long edge and re-exports the shared size helper', () => {
    expect(MODNET_INPUT_SIZE).toBe(MODNET_LONG_EDGE);
    expect(modnetInputSize).toBe(sharedModnetInputSize);
  });
});

describe('createModNetInputTensor', () => {
  it('writes RGB pixels in CHW order with MODNet normalization', () => {
    const tensor = createModNetInputTensor(
      Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 128, 128, 128]),
      2,
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
      2,
      2
    );

    expect(tensor[0]).toBeCloseTo(128 / 255 / 0.5 - 1, 5);
    expect(tensor[5]).toBeCloseTo(64 / 255 / 0.5 - 1, 5);
  });

  it('uses width and height independently for non-square inputs', () => {
    // 宽 2、高 1：R 平面值 [255, 0]，G 平面值 [0, 255]，B 平面值 [0, 0]。
    const tensor = createModNetInputTensor(
      Buffer.from([255, 0, 0, 0, 255, 0]),
      2,
      1
    );

    expect(tensor.length).toBe(6);
    expect(tensor[0]).toBeCloseTo(1, 5);
    expect(tensor[1]).toBeCloseTo(-1, 5);
    expect(tensor[2]).toBeCloseTo(-1, 5);
    expect(tensor[3]).toBeCloseTo(1, 5);
    expect(tensor[4]).toBeCloseTo(-1, 5);
    expect(tensor[5]).toBeCloseTo(-1, 5);
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
  it('runs one full-image MODNet inference at the dynamic long-edge size without padding', async () => {
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
    const box = modnetInputSize({ width: 64, height: 96 }, MODNET_INPUT_SIZE);
    let runCount = 0;
    let observedDims: number[] | undefined;
    const session = {
      inputNames: ['input'],
      outputNames: ['output'],
      run: async (feeds: Record<string, { dims: number[] }>) => {
        runCount += 1;
        observedDims = feeds.input?.dims;
        return {
          output: {
            data: new Float32Array(box.width * box.height).fill(1),
          },
        };
      },
    };
    const service = new PortraitSegmentationService() as any;
    service.getSession = async () => session;

    const result = await service.segment(input);

    expect(result.faceCount).toBe(1);
    expect(runCount).toBe(1);
    // 长边缩放到 512、保持比例、宽高 32 对齐、不补边。
    expect(observedDims).toEqual([1, 3, box.height, box.width]);
    expect(box).toEqual({ width: 320, height: 512 });
    // 蒙版直接缩回原图尺寸，没有 letterbox 裁剪偏移。
    const maskMetadata = await sharp(result.mask).metadata();
    expect(maskMetadata.width).toBe(64);
    expect(maskMetadata.height).toBe(96);
    expect(result.bounds).toEqual({
      x: 0,
      y: 0,
      width: 64,
      height: 96,
    });
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
    const box = modnetInputSize({ width: 64, height: 96 }, MODNET_INPUT_SIZE);
    let localRunCount = 0;
    const session = {
      inputNames: ['input'],
      outputNames: ['output'],
      run: async () => {
        localRunCount += 1;
        return {
          output: {
            data: new Float32Array(box.width * box.height).fill(1),
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

describe('PortraitSegmentationService.getSession', () => {
  const MODEL_ENV = 'ID_PHOTO_SEGMENTATION_MODEL';
  let savedModelEnv: string | undefined;
  let restoreCreate: (() => void) | undefined;

  beforeEach(() => {
    savedModelEnv = process.env[MODEL_ENV];
    // 固定成 photographic 路径，确保它与 generic 回落路径不同，才能触发回落。
    process.env[MODEL_ENV] = '/models/modnet_photographic.onnx';
  });

  afterEach(() => {
    restoreCreate?.();
    restoreCreate = undefined;
    if (savedModelEnv === undefined) {
      delete process.env[MODEL_ENV];
    } else {
      process.env[MODEL_ENV] = savedModelEnv;
    }
  });

  function mockModelCreate() {
    const create = spyOn(ort.InferenceSession, 'create');
    restoreCreate = () => create.mockRestore();
    return create;
  }

  it('falls back to generic modnet when the photographic model fails to load', async () => {
    const session = {
      inputNames: ['input'],
    } as unknown as ort.InferenceSession;
    const create = mockModelCreate()
      .mockRejectedValueOnce(new Error('photographic unavailable'))
      .mockResolvedValueOnce(session);
    const service = new PortraitSegmentationService() as any;

    await expect(service.getSession()).resolves.toBe(session);

    expect(create).toHaveBeenCalledTimes(2);
    const firstPath = String(create.mock.calls[0]?.[0]);
    const genericPath = String(create.mock.calls[1]?.[0]);
    expect(firstPath).toContain('modnet_photographic.onnx');
    expect(genericPath).toEndWith('modnet.onnx');
    expect(genericPath).not.toContain('modnet_photographic');
  });

  it('throws instead of retrying forever when the generic model also fails', async () => {
    const create = mockModelCreate()
      .mockRejectedValueOnce(new Error('photographic unavailable'))
      .mockRejectedValueOnce(new Error('generic unavailable'));
    const service = new PortraitSegmentationService() as any;

    await expect(service.getSession()).rejects.toThrow('generic unavailable');

    // photographic + generic 各一次；不会在两者之间死循环。
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('clears the cached promise after a failure so the next call can retry', async () => {
    const session = {
      inputNames: ['input'],
    } as unknown as ort.InferenceSession;
    const create = mockModelCreate()
      .mockRejectedValueOnce(new Error('photographic unavailable'))
      .mockRejectedValueOnce(new Error('generic unavailable'))
      .mockResolvedValueOnce(session);
    const service = new PortraitSegmentationService() as any;

    await expect(service.getSession()).rejects.toThrow('generic unavailable');
    expect(service.sessionPromise).toBeUndefined();

    await expect(service.getSession()).resolves.toBe(session);
    expect(create).toHaveBeenCalledTimes(3);
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
