const resourceBudget = {
  run: async (
    _task: unknown,
    _job: unknown,
    _token: unknown,
    operation: () => Promise<unknown>
  ) => operation(),
};
import { afterAll, expect, it, mock, vi } from 'bun:test';
import { UnrecoverableError } from 'bullmq';
import { ErrorCodes } from '../../../../src/common/errors/error-codes';

const getTaskOutputOwner = mock(async () => ({
  id: 'user-1',
  plan: 'signed_in',
  role: 'user',
}));

// mock.module 是进程级的,会泄漏到后续测试文件。先抓住真实实现,跑完再装回去,
// 否则 generated-image-marker.test.ts 会拿到这里的透传桩。
// 必须提前解引用:mock.module 会原地改写模块 namespace 对象。
const { markGeneratedImage: realMarkGeneratedImage } =
  await import('../../../../src/modules/tasks/services/generated-image-marker');

const markGeneratedImage = mock(async (buffer: Buffer) => buffer);

mock.module(
  '../../../../src/modules/tasks/processors/task-output-owner',
  () => ({ getTaskOutputOwner })
);
mock.module(
  '../../../../src/modules/tasks/services/generated-image-marker',
  () => ({
    markGeneratedImage,
  })
);

afterAll(() => {
  mock.module(
    '../../../../src/modules/tasks/services/generated-image-marker',
    () => ({
      markGeneratedImage: realMarkGeneratedImage,
    })
  );
});

const { AiImageProcessor, composeTryOnPrompt } =
  await import('../../../../src/modules/tasks/processors/ai-image.processor');
const { ImageGenerationError } =
  await import('../../../../src/modules/tasks/services/image-generation.service');

function createTasksService(overrides: Record<string, unknown> = {}) {
  return {
    getById: vi.fn().mockResolvedValue({
      id: 'task-1',
      type: 'image_generate',
      userId: 'user-1',
      inputFileIds: [],
      inputConfig: { mode: 'text_to_image', prompt: '一只柴犬' },
      ...overrides,
    }),
    markProcessing: vi.fn(),
    updateProgress: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    markRetrying: vi.fn(),
    // 粘性路由查询:默认"没有上次记录",触发随机首发。
    findLastImageGenerateProviderId: vi.fn().mockResolvedValue(null),
  };
}

/** 每个用例拿独立的 job:updateProgress 的调用不该跨用例累积。 */
function createJob(opts: { attemptsMade?: number; attempts?: number } = {}) {
  return {
    id: 'job-1',
    data: { taskId: 'task-1' },
    attemptsMade: opts.attemptsMade ?? 0,
    updateProgress: vi.fn(),
    opts: opts.attempts === undefined ? {} : { attempts: opts.attempts },
  } as never;
}

it('generates an image and stores it against the task owner', async () => {
  const filesService = {
    upload: vi.fn().mockResolvedValue({ id: 'output-1' }),
  };
  const tasksService = createTasksService();
  const imageGenerationService = {
    generate: vi.fn().mockResolvedValue({
      buffer: Buffer.from('png-bytes'),
      mimeType: 'image/png',
      extension: 'png',
      // GeneratedImage 永远带 model(service.generate 返回 provider.model ?? 默认)。
      // mock 不补它就会落到 processor 的 resolveAiImageModel() env 兜底,
      // 断言会被本机 AI_IMAGE_MODEL 污染 —— 这里补上,断言只验透传、不依赖 env。
      model: 'gpt-image-1',
      providerId: 'alpha',
    }),
  };

  const processor = new AiImageProcessor(
    filesService as never,
    tasksService as never,
    imageGenerationService as never,
    resourceBudget as never
  );

  await processor.process(createJob());

  expect(imageGenerationService.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: 'text_to_image',
      prompt: '一只柴犬',
      // schema 默认值是具体档位("auto" 仅 gpt-image-1 族网关认可)。
      size: '1024x1024',
      quality: 'high',
      inputFileCount: 0,
    }),
    undefined,
    // 无粘性记录时 routing 传 undefined,服务层走随机首发。
    undefined
  );
  expect(getTaskOutputOwner).toHaveBeenCalledWith('user-1');
  // 标记是本 processor 的安全承诺:产物必须先过 marker 再上传。
  expect(markGeneratedImage).toHaveBeenCalledWith(
    Buffer.from('png-bytes'),
    expect.objectContaining({ model: 'gpt-image-1', source: 'alpha' })
  );
  expect(filesService.upload).toHaveBeenCalledWith(
    Buffer.from('png-bytes'),
    expect.objectContaining({ mimeType: 'image/png' }),
    { id: 'user-1', plan: 'signed_in', role: 'user' }
  );
  // 实际出图的来源与模型作为服务端事实落库,供同会话粘性与产物追溯。
  expect(tasksService.markCompleted).toHaveBeenCalledWith(
    'task-1',
    'output-1',
    {
      providerId: 'alpha',
      model: 'gpt-image-1',
    }
  );
});

it('passes the sticky source of the session as the routing preference', async () => {
  const filesService = {
    upload: vi.fn().mockResolvedValue({ id: 'output-1' }),
  };
  const tasksService = createTasksService({
    sessionId: 'session-1',
    inputConfig: {
      mode: 'text_to_image',
      prompt: '同一会话的第二张',
      model: 'gpt-image-1',
    },
  });
  tasksService.findLastImageGenerateProviderId = vi
    .fn()
    .mockResolvedValue('kmage');
  const imageGenerationService = {
    generate: vi.fn().mockResolvedValue({
      buffer: Buffer.from('png-bytes'),
      mimeType: 'image/png',
      extension: 'png',
      model: 'gpt-image-1',
      providerId: 'kmage',
    }),
  };

  const processor = new AiImageProcessor(
    filesService as never,
    tasksService as never,
    imageGenerationService as never,
    resourceBudget as never
  );

  await processor.process(createJob());

  expect(tasksService.findLastImageGenerateProviderId).toHaveBeenCalledWith(
    'user-1',
    'session-1',
    'gpt-image-1'
  );
  expect(imageGenerationService.generate).toHaveBeenCalledWith(
    expect.objectContaining({ model: 'gpt-image-1' }),
    undefined,
    { preferredProviderId: 'kmage' }
  );
});

it('skips the sticky lookup for legacy tasks without a model', async () => {
  const filesService = {
    upload: vi.fn().mockResolvedValue({ id: 'output-1' }),
  };
  const tasksService = createTasksService({
    sessionId: 'session-1',
    // 历史任务只带 providerId,不查粘性,直接钉死来源。
    inputConfig: {
      mode: 'text_to_image',
      prompt: '旧客户端任务',
      providerId: 'kmage',
    },
  });
  const imageGenerationService = {
    generate: vi.fn().mockResolvedValue({
      buffer: Buffer.from('png-bytes'),
      mimeType: 'image/png',
      extension: 'png',
      model: 'gpt-image-2',
      providerId: 'kmage',
    }),
  };

  const processor = new AiImageProcessor(
    filesService as never,
    tasksService as never,
    imageGenerationService as never,
    resourceBudget as never
  );

  await processor.process(createJob());

  expect(tasksService.findLastImageGenerateProviderId).not.toHaveBeenCalled();
  expect(imageGenerationService.generate).toHaveBeenCalledWith(
    expect.objectContaining({ providerId: 'kmage' }),
    undefined,
    undefined
  );
});

it('marks the task failed with the provider error code and a fixed message', async () => {
  const tasksService = createTasksService();
  const imageGenerationService = {
    generate: vi
      .fn()
      .mockRejectedValue(
        new ImageGenerationError(
          ErrorCodes.AI_IMAGE_CONTENT_REJECTED,
          'The prompt was rejected by the provider content policy'
        )
      ),
  };

  const processor = new AiImageProcessor(
    { upload: vi.fn() } as never,
    tasksService as never,
    imageGenerationService as never,
    resourceBudget as never
  );

  await expect(processor.process(createJob())).rejects.toThrow();

  expect(tasksService.markFailed).toHaveBeenCalledWith(
    'task-1',
    ErrorCodes.AI_IMAGE_CONTENT_REJECTED,
    'The prompt was rejected by the provider content policy'
  );
});

it('sanitizes an unexpected error message before storing it', async () => {
  const tasksService = createTasksService();
  const imageGenerationService = {
    generate: vi
      .fn()
      .mockRejectedValue(new Error('boom with prompt 一只柴犬 inside')),
  };

  const processor = new AiImageProcessor(
    { upload: vi.fn() } as never,
    tasksService as never,
    imageGenerationService as never,
    resourceBudget as never
  );

  await expect(processor.process(createJob())).rejects.toThrow();

  const [, code, message] = tasksService.markFailed.mock.calls[0] as string[];
  expect(code).toBe(ErrorCodes.AI_IMAGE_GENERATION_FAILED);
  // 真实原因透出,但 prompt 回显被剥掉。
  expect(message).not.toContain('一只柴犬');
  expect(message).toContain('boom');
  expect(message).toContain('[redacted]');
});

it('sends the uploaded reference image for image_to_image', async () => {
  const filesService = {
    getById: vi.fn().mockResolvedValue({
      id: 'file-1',
      storageKey: 'user-1/file-1/source.png',
      filename: 'source.png',
    }),
    download: vi.fn().mockResolvedValue(Buffer.from('source-bytes')),
    upload: vi.fn().mockResolvedValue({ id: 'output-2' }),
  };
  const tasksService = createTasksService({
    inputConfig: { mode: 'image_to_image', prompt: '把背景换成海边' },
    inputFileIds: ['file-1'],
  });
  const imageGenerationService = {
    generate: vi.fn().mockResolvedValue({
      buffer: Buffer.from('edited-bytes'),
      mimeType: 'image/png',
      extension: 'png',
      model: 'gpt-image-1',
      providerId: 'alpha',
    }),
  };

  const processor = new AiImageProcessor(
    filesService as never,
    tasksService as never,
    imageGenerationService as never,
    resourceBudget as never
  );

  await processor.process(createJob());

  // 输入文件的归属校验必须带上 task.userId,否则等于允许跨账号引用别人的文件。
  expect(filesService.getById).toHaveBeenCalledWith('file-1', 'user-1');
  expect(filesService.download).toHaveBeenCalledWith(
    'user-1/file-1/source.png'
  );
  expect(imageGenerationService.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: 'image_to_image',
      prompt: '把背景换成海边',
      inputFileCount: 1,
    }),
    // 参考图现在以数组传递(多张 = 融合)。
    [Buffer.from('source-bytes')],
    undefined
  );
  expect(tasksService.markCompleted).toHaveBeenCalledWith(
    'task-1',
    'output-2',
    {
      providerId: 'alpha',
      model: 'gpt-image-1',
    }
  );
});

it('sends every reference image for multi-image fusion', async () => {
  const filesService = {
    getById: vi.fn().mockImplementation(async (id: string) => ({
      id,
      storageKey: `user-1/${id}/source.png`,
      filename: `${id}.png`,
    })),
    download: vi
      .fn()
      .mockImplementation(async (key: string) =>
        Buffer.from(`bytes-of-${key.split('/')[1]}`)
      ),
    upload: vi.fn().mockResolvedValue({ id: 'output-3' }),
  };
  const tasksService = createTasksService({
    inputConfig: { mode: 'image_to_image', prompt: '把三张图融合成一张' },
    inputFileIds: ['file-1', 'file-2', 'file-3'],
  });
  const imageGenerationService = {
    generate: vi.fn().mockResolvedValue({
      buffer: Buffer.from('fused-bytes'),
      mimeType: 'image/png',
      extension: 'png',
      model: 'gpt-image-1',
      providerId: 'alpha',
    }),
  };
  const processor = new AiImageProcessor(
    filesService as never,
    tasksService as never,
    imageGenerationService as never,
    resourceBudget as never
  );

  await processor.process(createJob());

  expect(imageGenerationService.generate).toHaveBeenCalledWith(
    expect.objectContaining({ mode: 'image_to_image', inputFileCount: 3 }),
    [
      Buffer.from('bytes-of-file-1'),
      Buffer.from('bytes-of-file-2'),
      Buffer.from('bytes-of-file-3'),
    ],
    undefined
  );
});

it('generates a product try-on with role-ordered owned and curated references', async () => {
  const uploadedImages = new Map([
    ['person-key', Buffer.from('person-image')],
    ['garment-key', Buffer.from('product-image')],
  ]);
  const filesService = {
    getById: vi.fn(async (id: string, userId: string) => ({
      id,
      userId,
      storageKey: id === 'person-file' ? 'person-key' : 'garment-key',
    })),
    download: vi.fn(async (key: string) => uploadedImages.get(key)),
    upload: vi.fn().mockResolvedValue({ id: 'output-1' }),
  };
  const tasksService = createTasksService({
    type: 'image_try_on',
    inputFileIds: ['person-file', 'garment-file'],
    inputConfig: {
      mode: 'product',
      references: [
        {
          role: 'style',
          source: 'library',
          assetId: '00000000-0000-4000-8000-000000000004',
        },
        { role: 'garment', source: 'upload', inputIndex: 1 },
        {
          role: 'pose',
          source: 'library',
          assetId: '00000000-0000-4000-8000-000000000003',
        },
        { role: 'person', source: 'upload', inputIndex: 0 },
      ],
      promptAddition: 'clean white studio background',
    },
  });
  const referenceSource = {
    getImageForGeneration: vi.fn(async (assetId: string, kind: string) => {
      if (
        assetId === '00000000-0000-4000-8000-000000000003' &&
        kind === 'pose'
      ) {
        return Buffer.from('pose-image');
      }
      if (
        assetId === '00000000-0000-4000-8000-000000000004' &&
        kind === 'garment'
      ) {
        return Buffer.from('style-image');
      }
      throw new Error('Unexpected curated reference');
    }),
  };
  const imageGenerationService = {
    generate: vi.fn().mockResolvedValue({
      buffer: Buffer.from('png-bytes'),
      mimeType: 'image/png',
      extension: 'png',
      model: 'gpt-image-1',
      providerId: 'alpha',
    }),
  };
  const processor = new AiImageProcessor(
    filesService as never,
    tasksService as never,
    imageGenerationService as never,
    resourceBudget as never,
    referenceSource as never
  );

  await processor.process(createJob());

  expect(filesService.getById).toHaveBeenNthCalledWith(
    1,
    'person-file',
    'user-1'
  );
  expect(filesService.getById).toHaveBeenNthCalledWith(
    2,
    'garment-file',
    'user-1'
  );
  expect(referenceSource.getImageForGeneration).toHaveBeenNthCalledWith(
    1,
    '00000000-0000-4000-8000-000000000003',
    'pose'
  );
  expect(referenceSource.getImageForGeneration).toHaveBeenNthCalledWith(
    2,
    '00000000-0000-4000-8000-000000000004',
    'garment'
  );
  expect(imageGenerationService.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: 'image_to_image',
      prompt: expect.stringContaining('clean white studio background'),
      inputFileCount: 4,
    }),
    [
      Buffer.from('person-image'),
      Buffer.from('product-image'),
      Buffer.from('pose-image'),
      Buffer.from('style-image'),
    ]
  );
  const prompt = imageGenerationService.generate.mock.calls[0]?.[0].prompt;
  expect(prompt).toContain('商品');
  expect(prompt).toContain('风格参考');
  expect(prompt).toContain('弱化');
});

it('does not call the image provider when a curated reference fails validation', async () => {
  const tasksService = createTasksService({
    type: 'image_try_on',
    inputFileIds: [],
    inputConfig: {
      mode: 'inspiration',
      references: [
        {
          role: 'person',
          source: 'library',
          assetId: '00000000-0000-4000-8000-000000000001',
        },
        {
          role: 'garment',
          source: 'library',
          assetId: '00000000-0000-4000-8000-000000000002',
        },
      ],
    },
  });
  const imageGenerationService = { generate: vi.fn() };
  const referenceSource = {
    getImageForGeneration: vi.fn(async (assetId: string) => {
      if (assetId.endsWith('0001')) return Buffer.from('person-image');
      throw new Error('Reference is disabled or has not passed license review');
    }),
  };
  const processor = new AiImageProcessor(
    { upload: vi.fn() } as never,
    tasksService as never,
    imageGenerationService as never,
    resourceBudget as never,
    referenceSource as never
  );

  await processor.process(createJob()).catch(() => undefined);

  expect(referenceSource.getImageForGeneration).toHaveBeenCalledTimes(2);
  expect(imageGenerationService.generate).not.toHaveBeenCalled();
  expect(tasksService.markFailed).toHaveBeenCalledWith(
    'task-1',
    ErrorCodes.AI_IMAGE_GENERATION_FAILED,
    expect.any(String)
  );
});

it('fails image_to_image without leaking why when the input file is missing', async () => {
  const tasksService = createTasksService({
    inputConfig: { mode: 'image_to_image', prompt: '把背景换成海边' },
    inputFileIds: [],
  });

  const processor = new AiImageProcessor(
    { upload: vi.fn() } as never,
    tasksService as never,
    { generate: vi.fn() } as never,
    resourceBudget as never
  );

  await expect(processor.process(createJob())).rejects.toThrow();
  const [, code] = tasksService.markFailed.mock.calls[0] as string[];
  expect(code).toBe(ErrorCodes.AI_IMAGE_GENERATION_FAILED);
});

it('rejects a mode this processor does not implement yet', async () => {
  const tasksService = createTasksService({
    inputConfig: { mode: 'inpaint', prompt: 'x' },
    inputFileIds: ['file-1', 'mask-1'],
  });

  const processor = new AiImageProcessor(
    { upload: vi.fn() } as never,
    tasksService as never,
    { generate: vi.fn() } as never,
    resourceBudget as never
  );

  await expect(processor.process(createJob())).rejects.toThrow();
  expect(tasksService.markFailed).toHaveBeenCalled();
});

it('leaves the task pending when a retry is still coming', async () => {
  const tasksService = createTasksService();
  const imageGenerationService = {
    generate: vi
      .fn()
      .mockRejectedValue(
        new ImageGenerationError(
          ErrorCodes.AI_IMAGE_GENERATION_FAILED,
          'Image generation failed',
          true
        )
      ),
  };

  const processor = new AiImageProcessor(
    { upload: vi.fn() } as never,
    tasksService as never,
    imageGenerationService as never,
    resourceBudget as never
  );

  // 网关 502 这类瞬时失败在第一次 attempt 上不能落库成 failed:前端把 failed 当终态,
  // 写下去就再也不会看到后面重试成功的那张图。
  await expect(
    processor.process(createJob({ attemptsMade: 0, attempts: 2 }))
  ).rejects.toThrow();

  expect(tasksService.markFailed).not.toHaveBeenCalled();
  expect(tasksService.markRetrying).toHaveBeenCalledWith('task-1');
});

it('records the failure once the retries are used up', async () => {
  const tasksService = createTasksService();
  const imageGenerationService = {
    generate: vi
      .fn()
      .mockRejectedValue(
        new ImageGenerationError(
          ErrorCodes.AI_IMAGE_GENERATION_FAILED,
          'Image generation failed',
          true
        )
      ),
  };

  const processor = new AiImageProcessor(
    { upload: vi.fn() } as never,
    tasksService as never,
    imageGenerationService as never,
    resourceBudget as never
  );

  await expect(
    processor.process(createJob({ attemptsMade: 1, attempts: 2 }))
  ).rejects.toThrow();

  expect(tasksService.markRetrying).not.toHaveBeenCalled();
  expect(tasksService.markFailed).toHaveBeenCalledWith(
    'task-1',
    ErrorCodes.AI_IMAGE_GENERATION_FAILED,
    'Image generation failed'
  );
});

it('stops retrying a deterministic rejection instead of paying for it again', async () => {
  const tasksService = createTasksService();
  const imageGenerationService = {
    generate: vi
      .fn()
      .mockRejectedValue(
        new ImageGenerationError(
          ErrorCodes.AI_IMAGE_CONTENT_REJECTED,
          'The prompt was rejected by the provider content policy'
        )
      ),
  };

  const processor = new AiImageProcessor(
    { upload: vi.fn() } as never,
    tasksService as never,
    imageGenerationService as never,
    resourceBudget as never
  );

  // 内容策略拒绝重来一次也一样:立刻落库,并用 UnrecoverableError 掐断剩下的 attempt。
  await expect(
    processor.process(createJob({ attemptsMade: 0, attempts: 3 }))
  ).rejects.toBeInstanceOf(UnrecoverableError);

  expect(tasksService.markRetrying).not.toHaveBeenCalled();
  expect(tasksService.markFailed).toHaveBeenCalledWith(
    'task-1',
    ErrorCodes.AI_IMAGE_CONTENT_REJECTED,
    'The prompt was rejected by the provider content policy'
  );
});

it('composes try-on prompt with exact dynamic reference numbering, anti-mannequin/line-art rules, and camera angle notes', () => {
  // 1) 省略 pose、直接选 person + garment + style 时，style 应准确标记为第 3 张（图3）而非第 4 张
  const promptWithoutPose = composeTryOnPrompt('product', [
    { role: 'person', source: 'upload', inputIndex: 0 },
    { role: 'garment', source: 'upload', inputIndex: 1 },
    {
      role: 'style',
      source: 'library',
      assetId: '00000000-0000-4000-8000-000000000004',
    },
  ]);
  expect(promptWithoutPose).toContain('请根据提供的 3 张参考图');
  expect(promptWithoutPose).toContain(
    '第 1 张是模特/人物参考，第 2 张是本次要展示的真实商品服装图，第 3 张是弱优先级的搭配风格参考'
  );
  expect(promptWithoutPose).toContain(
    '所有裸露皮肤（包括四肢及服装镂空处露出的皮肤）必须与脸部肤色统一'
  );
  expect(promptWithoutPose).toContain(
    '不要画出图2中的人台、假人模特、衣架或空白身体'
  );
  expect(promptWithoutPose).toContain(
    '图3仅用于弱化的搭配氛围与光影参考，不得覆盖或改动图2目标服装的具体设计'
  );
  expect(promptWithoutPose).toContain(
    '写实商业摄影级质感，85mm 人像镜头，自然柔和光影，真实肌肤纹理与织物细节，8k 高清画质'
  );
  expect(promptWithoutPose).toContain(
    '画面中没有任何文字、标志、画框外说明或水印'
  );

  // 2) inspiration 模式下注入人像特征、清洗内部编号后的图库服饰描述与姿势视角机位注释
  const promptWithPoseAndGarmentMeta = composeTryOnPrompt(
    'inspiration',
    [
      {
        role: 'person',
        source: 'library',
        assetId: '00000000-0000-4000-8000-000000000001',
      },
      {
        role: 'garment',
        source: 'library',
        assetId: '00000000-0000-4000-8000-000000000002',
      },
      {
        role: 'pose',
        source: 'library',
        assetId: '00000000-0000-4000-8000-000000000003',
      },
    ],
    undefined,
    {
      person: {
        titleZh: '男性 · 清爽短发（正面人像）',
        titleEn: 'Male · Clean short hair',
        descriptionZh: null,
        descriptionEn: null,
        tags: ['male', '男性'],
      },
      garment: {
        titleZh: '春日穿搭 SPR-0001',
        titleEn: 'Spring SPR-0001',
        descriptionZh: '象牙白、荷叶边、针织、牛仔半身裙',
        descriptionEn: 'ivory, frill, knit, denim mini skirt',
        tags: ['female', '女性', '象牙白', '针织'],
      },
      pose: {
        titleZh: 'S形站姿（仰视）',
        titleEn: 'S-curve standing (Low angle)',
        descriptionZh: '站姿 · 全身',
        descriptionEn: 'Standing · Full body',
        tags: ['low', 'female', '站姿'],
      },
    }
  );
  expect(promptWithPoseAndGarmentMeta).toContain(
    '• 人物：图1中的人物，保持其脸型、五官、骨相、发型（清爽短发）和发色一致'
  );
  expect(promptWithPoseAndGarmentMeta).toContain(
    '• 服装：让人物穿上图2中展示的整套服装和配饰（参考名称：春日穿搭 · 象牙白、荷叶边、针织、牛仔半身裙），每件单品的颜色、款式、图案、面料与配饰都以图2为准，名称仅作辅助说明'
  );
  expect(promptWithPoseAndGarmentMeta).not.toContain('SPR-0001');
  expect(promptWithPoseAndGarmentMeta).toContain(
    '• 姿势：按照图3中人体模型/线稿的动作和镜头角度摆姿势（S形站姿（仰视），视角：仰视（low angle, camera looking up））；图3只是动作示意'
  );
  expect(promptWithPoseAndGarmentMeta).toContain(
    '最终画面中的人物是真人，皮肤真实自然，穿着图2的服装'
  );
});
