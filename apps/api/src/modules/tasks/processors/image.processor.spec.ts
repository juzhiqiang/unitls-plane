import { expect, it, mock, vi } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const getTaskOutputOwner = mock(async () => ({
  id: 'user-1',
  plan: 'team',
  role: 'admin',
}));

mock.module('./task-output-owner', () => ({
  getTaskOutputOwner,
}));

const { ImageProcessor } = await import('./image.processor');

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
  expect(getTaskOutputOwner).toHaveBeenCalledWith('user-1');
  expect(filesService.upload).toHaveBeenCalledWith(
    Buffer.from('output'),
    expect.objectContaining({
      filename: 'id-photo-one_inch-portrait.jpg',
      mimeType: 'image/jpeg',
    }),
    { id: 'user-1', plan: 'team', role: 'admin' }
  );
  expect(tasksService.markCompleted).toHaveBeenCalledWith('task-1', 'output-1');
});

it('uses shared task output owner lookup instead of fabricating free users', () => {
  for (const processor of [
    'image.processor.ts',
    'pdf.processor.ts',
    'font.processor.ts',
  ]) {
    const source = readFileSync(join(import.meta.dir, processor), 'utf8');

    expect(source).toContain(
      "import { getTaskOutputOwner } from './task-output-owner'"
    );
    expect(source).toContain('await getTaskOutputOwner(task.userId)');
    expect(source).not.toContain("plan: 'free'");
    expect(source).not.toContain("role: 'user'");
  }
});
