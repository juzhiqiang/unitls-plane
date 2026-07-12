import { expect, it, vi } from 'bun:test';
import { ImageProcessor } from './image.processor';

it('processes image_id_photo tasks through IdPhotoService', async () => {
  const filesService = {
    getById: vi.fn().mockResolvedValue({
      id: 'file-1',
      filename: 'portrait.jpg',
      mimeType: 'image/jpeg',
      storageKey: 'uploads/portrait.jpg',
    }),
    download: vi.fn().mockResolvedValue(Buffer.from('input')),
    upload: vi.fn().mockResolvedValue({ id: 'output-1' }),
  };
  const tasksService = {
    getById: vi.fn().mockResolvedValue({
      id: 'task-1',
      type: 'image_id_photo',
      userId: 'user-1',
      inputFileIds: ['file-1'],
      inputConfig: {
        preset: 'one_inch',
        backgroundColor: '#ffffff',
        outputType: 'image/jpeg',
        dpi: 300,
      },
    }),
    markProcessing: vi.fn(),
    updateProgress: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
  };
  const idPhotoService = {
    render: vi.fn().mockResolvedValue({
      buffer: Buffer.from('output'),
      mimeType: 'image/jpeg',
      extension: 'jpg',
    }),
  };
  const processor = new ImageProcessor(
    {} as any,
    filesService as any,
    tasksService as any,
    idPhotoService as any
  );

  await processor.process({
    id: 'job-1',
    data: { taskId: 'task-1' },
    attemptsMade: 0,
    updateProgress: vi.fn(),
    opts: {},
  } as any);

  expect(idPhotoService.render).toHaveBeenCalled();
  expect(filesService.upload).toHaveBeenCalledWith(
    Buffer.from('output'),
    expect.objectContaining({
      filename: 'id-photo-one_inch-portrait.jpg',
      mimeType: 'image/jpeg',
    }),
    { id: 'user-1', plan: 'free', role: 'user' }
  );
  expect(tasksService.markCompleted).toHaveBeenCalledWith('task-1', 'output-1');
});
