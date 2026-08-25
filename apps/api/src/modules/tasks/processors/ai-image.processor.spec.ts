import { afterAll, expect, it, mock, vi } from 'bun:test';
import { ErrorCodes } from '../../../common/errors/error-codes';

const getTaskOutputOwner = mock(async () => ({
  id: 'user-1',
  plan: 'signed_in',
  role: 'user',
}));

// mock.module 是进程级的,会泄漏到后续测试文件。先抓住真实实现,跑完再装回去,
// 否则 generated-image-marker.test.ts 会拿到这里的透传桩。
// 必须提前解引用:mock.module 会原地改写模块 namespace 对象。
const { markGeneratedImage: realMarkGeneratedImage } =
  await import('../services/generated-image-marker');

const markGeneratedImage = mock(async (buffer: Buffer) => buffer);

mock.module('./task-output-owner', () => ({ getTaskOutputOwner }));
mock.module('../services/generated-image-marker', () => ({
  markGeneratedImage,
}));

afterAll(() => {
  mock.module('../services/generated-image-marker', () => ({
    markGeneratedImage: realMarkGeneratedImage,
  }));
});

const { AiImageProcessor } = await import('./ai-image.processor');
const { ImageGenerationError } =
  await import('../services/image-generation.service');

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
  };
}

/** 每个用例拿独立的 job:updateProgress 的调用不该跨用例累积。 */
function createJob() {
  return {
    id: 'job-1',
    data: { taskId: 'task-1' },
    attemptsMade: 0,
    updateProgress: vi.fn(),
    opts: {},
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
    }),
  };

  const processor = new AiImageProcessor(
    filesService as never,
    tasksService as never,
    imageGenerationService as never
  );

  await processor.process(createJob());

  expect(imageGenerationService.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: 'text_to_image',
      prompt: '一只柴犬',
      size: '1024x1024',
      quality: 'high',
      inputFileCount: 0,
    }),
    undefined
  );
  expect(getTaskOutputOwner).toHaveBeenCalledWith('user-1');
  // 标记是本 processor 的安全承诺:产物必须先过 marker 再上传。
  expect(markGeneratedImage).toHaveBeenCalledWith(
    Buffer.from('png-bytes'),
    expect.objectContaining({ model: 'gpt-image-1' })
  );
  expect(filesService.upload).toHaveBeenCalledWith(
    Buffer.from('png-bytes'),
    expect.objectContaining({ mimeType: 'image/png' }),
    { id: 'user-1', plan: 'signed_in', role: 'user' }
  );
  expect(tasksService.markCompleted).toHaveBeenCalledWith('task-1', 'output-1');
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
    imageGenerationService as never
  );

  await expect(processor.process(createJob())).rejects.toThrow();

  expect(tasksService.markFailed).toHaveBeenCalledWith(
    'task-1',
    ErrorCodes.AI_IMAGE_CONTENT_REJECTED,
    'The prompt was rejected by the provider content policy'
  );
});

it('does not leak an unexpected error message into the task record', async () => {
  const tasksService = createTasksService();
  const imageGenerationService = {
    generate: vi
      .fn()
      .mockRejectedValue(new Error('boom with prompt 一只柴犬 inside')),
  };

  const processor = new AiImageProcessor(
    { upload: vi.fn() } as never,
    tasksService as never,
    imageGenerationService as never
  );

  await expect(processor.process(createJob())).rejects.toThrow();

  const [, code, message] = tasksService.markFailed.mock.calls[0] as string[];
  expect(code).toBe(ErrorCodes.AI_IMAGE_GENERATION_FAILED);
  expect(message).not.toContain('一只柴犬');
  expect(message).not.toContain('boom');
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
    }),
  };

  const processor = new AiImageProcessor(
    filesService as never,
    tasksService as never,
    imageGenerationService as never
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
    Buffer.from('source-bytes')
  );
  expect(tasksService.markCompleted).toHaveBeenCalledWith('task-1', 'output-2');
});

it('fails image_to_image without leaking why when the input file is missing', async () => {
  const tasksService = createTasksService({
    inputConfig: { mode: 'image_to_image', prompt: '把背景换成海边' },
    inputFileIds: [],
  });

  const processor = new AiImageProcessor(
    { upload: vi.fn() } as never,
    tasksService as never,
    { generate: vi.fn() } as never
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
    { generate: vi.fn() } as never
  );

  await expect(processor.process(createJob())).rejects.toThrow();
  expect(tasksService.markFailed).toHaveBeenCalled();
});
