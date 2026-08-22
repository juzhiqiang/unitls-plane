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

mock.module('./task-output-owner', () => ({ getTaskOutputOwner }));
mock.module('../services/generated-image-marker', () => ({
  markGeneratedImage: mock(async (buffer: Buffer) => buffer),
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

const job = {
  id: 'job-1',
  data: { taskId: 'task-1' },
  attemptsMade: 0,
  updateProgress: vi.fn(),
  opts: {},
} as never;

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
    }),
  };

  const processor = new AiImageProcessor(
    filesService as never,
    tasksService as never,
    imageGenerationService as never
  );

  await processor.process(job);

  expect(imageGenerationService.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: 'text_to_image',
      prompt: '一只柴犬',
      size: '1024x1024',
      quality: 'high',
      inputFileCount: 0,
    })
  );
  expect(getTaskOutputOwner).toHaveBeenCalledWith('user-1');
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

  await expect(processor.process(job)).rejects.toThrow();

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

  await expect(processor.process(job)).rejects.toThrow();

  const [, code, message] = tasksService.markFailed.mock.calls[0] as string[];
  expect(code).toBe(ErrorCodes.AI_IMAGE_GENERATION_FAILED);
  expect(message).not.toContain('一只柴犬');
  expect(message).not.toContain('boom');
});

it('rejects a mode this processor does not implement yet', async () => {
  const tasksService = createTasksService({
    inputConfig: { mode: 'image_to_image', prompt: 'x' },
    inputFileIds: ['file-1'],
  });

  const processor = new AiImageProcessor(
    { upload: vi.fn() } as never,
    tasksService as never,
    { generate: vi.fn() } as never
  );

  await expect(processor.process(job)).rejects.toThrow();
  expect(tasksService.markFailed).toHaveBeenCalled();
});
