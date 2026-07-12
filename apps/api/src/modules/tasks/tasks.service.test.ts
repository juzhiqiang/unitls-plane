import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let insertedTask: Record<string, unknown> | null = null;

const returning = vi.fn(() => [
  {
    id: 'task-1',
    userId: insertedTask?.userId ?? null,
    type: insertedTask?.type,
    status: insertedTask?.status,
    inputFileIds: insertedTask?.inputFileIds,
    inputConfig: insertedTask?.inputConfig,
    outputFileId: null,
    progress: 0,
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: new Date('2026-07-12T00:00:00.000Z'),
    completedAt: null,
  },
]);

const values = vi.fn((task: Record<string, unknown>) => {
  insertedTask = task;
  return { returning };
});

const insert = vi.fn(() => ({ values }));

mock.module('@utils-plane/db', () => ({
  db: { insert },
  tasks: {},
}));

const { TasksService } = await import('./tasks.service');

function queue(name: string) {
  return {
    name,
    add: vi.fn().mockResolvedValue({ id: `${name}-job-1` }),
    getWaitingCount: vi.fn().mockResolvedValue(0),
    getActiveCount: vi.fn().mockResolvedValue(0),
  };
}

function createService(
  filesService = {
    getById: vi.fn().mockResolvedValue({ id: 'file-1', userId: null }),
  }
) {
  const imageQueue = queue('image-queue');
  const pdfQueue = queue('pdf-queue');
  const fontQueue = queue('font-queue');

  return {
    service: new TasksService(
      imageQueue as any,
      pdfQueue as any,
      fontQueue as any,
      filesService as any
    ),
    filesService,
    imageQueue,
    pdfQueue,
    fontQueue,
  };
}

beforeEach(() => {
  insertedTask = null;
  vi.clearAllMocks();
});

describe('TasksService queue routing', () => {
  it('checks server task entitlement before creating a task', () => {
    const source = readFileSync(
      join(import.meta.dir, 'tasks.service.ts'),
      'utf8'
    );

    expect(source).toContain("canUseFeature(user, 'task.serverProcessing')");
    expect(source).toContain('assertCanCreateTask');
  });

  it('receives the full current user from task controller', () => {
    const source = readFileSync(
      join(import.meta.dir, 'tasks.controller.ts'),
      'utf8'
    );

    expect(source).toMatch(/@Post\(\)\s+@Public\(\)/);
    expect(source).toContain('const user = req.user');
    expect(source).toContain('this.tasksService.create(');
    expect(source).toContain('user ?? null');
  });

  it('routes image processing tasks to the image queue', () => {
    const source = readFileSync(
      join(import.meta.dir, 'tasks.service.ts'),
      'utf8'
    ).replace(/\r\n/g, '\n');

    expect(source).toContain("case 'image_watermark':");
    expect(source).toContain("case 'image_id_photo':");
    expect(source).toMatch(
      /case 'image_watermark':\n\s+case 'image_id_photo':\n\s+return this\.imageQueue;/
    );
  });

  it('routes document-to-PDF tasks to the PDF queue', () => {
    const source = readFileSync(
      join(import.meta.dir, 'tasks.service.ts'),
      'utf8'
    ).replace(/\r\n/g, '\n');

    expect(source).toContain("case 'pdf_from_document':");
    expect(source).toMatch(
      /case 'pdf_rearrange':\n\s+case 'pdf_from_document':\n\s+return this\.pdfQueue;/
    );
  });
});

describe('TasksService task creation entitlements', () => {
  it('rejects anonymous server tasks before inserting or queueing', async () => {
    const { service, filesService, pdfQueue } = createService();

    await expect(
      service.create(
        {
          type: 'pdf_merge',
          inputFileIds: ['file-1'],
          inputConfig: {},
        },
        null
      )
    ).rejects.toThrow('Sign in is required for server processing tasks');

    expect(filesService.getById).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(pdfQueue.add).not.toHaveBeenCalled();
  });

  it('creates anonymous local image tasks for anonymous input files', async () => {
    const { service, filesService, imageQueue } = createService();

    const task = await service.create(
      {
        type: 'compress',
        inputFileIds: ['file-1'],
        inputConfig: {},
      },
      null
    );

    expect(filesService.getById).toHaveBeenCalledWith('file-1', null);
    expect(task.userId).toBeNull();
    expect(insertedTask?.userId).toBeNull();
    expect(imageQueue.add).toHaveBeenCalledWith('compress', {
      taskId: 'task-1',
    });
  });

  it('allows signed-in users to create server tasks', async () => {
    const { service, filesService, pdfQueue } = createService({
      getById: vi.fn((fileId: string, userId?: string | null) => {
        if (fileId !== 'file-1' || userId !== 'user-1') {
          throw new Error('Access denied');
        }
        return Promise.resolve({ id: 'file-1', userId: 'user-1' });
      }),
    });

    const task = await service.create(
      {
        type: 'pdf_merge',
        inputFileIds: ['file-1'],
        inputConfig: {},
      },
      { id: 'user-1', plan: 'free', role: 'user' }
    );

    expect(filesService.getById).toHaveBeenCalledWith('file-1', 'user-1');
    expect(task.userId).toBe('user-1');
    expect(insertedTask?.userId).toBe('user-1');
    expect(pdfQueue.add).toHaveBeenCalledWith('pdf_merge', {
      taskId: 'task-1',
    });
  });

  it('rejects anonymous local tasks that reference user-owned files', async () => {
    const { service, filesService, imageQueue } = createService({
      getById: vi.fn((fileId: string, userId?: string | null) => {
        if (fileId === 'file-1' && !userId) {
          throw new Error('Access denied');
        }
        return Promise.resolve({ id: fileId, userId: userId ?? null });
      }),
    });

    await expect(
      service.create(
        {
          type: 'compress',
          inputFileIds: ['file-1'],
          inputConfig: {},
        },
        null
      )
    ).rejects.toThrow('Access denied');

    expect(filesService.getById).toHaveBeenCalledWith('file-1', null);
    expect(insert).not.toHaveBeenCalled();
    expect(imageQueue.add).not.toHaveBeenCalled();
  });

  it('validates ordered file ids before creating PDF merge tasks', async () => {
    const { service, filesService, pdfQueue } = createService({
      getById: vi.fn((fileId: string, userId?: string | null) => {
        const ownerId = fileId === 'owned-file' ? 'user-1' : 'user-2';

        if (userId !== ownerId) {
          throw new Error('Access denied');
        }

        return Promise.resolve({
          id: fileId,
          userId: ownerId,
        });
      }),
    });

    await expect(
      service.create(
        {
          type: 'pdf_merge',
          inputFileIds: ['owned-file'],
          inputConfig: { order: ['owned-file', 'foreign-file'] },
        },
        { id: 'user-1', plan: 'free', role: 'user' }
      )
    ).rejects.toThrow('Access denied');

    expect(filesService.getById).toHaveBeenCalledWith('foreign-file', 'user-1');
    expect(insert).not.toHaveBeenCalled();
    expect(pdfQueue.add).not.toHaveBeenCalled();
  });
});
