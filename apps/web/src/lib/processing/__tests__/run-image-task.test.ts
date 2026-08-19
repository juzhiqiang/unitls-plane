import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  waitForTask: vi.fn(),
}));

vi.mock('@/lib/wait-for-task', () => ({
  waitForTask: mocks.waitForTask,
}));

import { runImageTask } from '../run-image-task';

function inputFile() {
  return new File(['source'], 'photo.jpg', { type: 'image/jpeg' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.waitForTask.mockResolvedValue({ outputFileId: 'out-1' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['result'], { type: 'image/webp' }),
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runImageTask', () => {
  it('uploads, creates the task, waits and downloads the output', async () => {
    const upload = vi.fn().mockResolvedValue({ id: 'file-1' });
    const createTask = vi.fn().mockResolvedValue({ id: 'task-1' });

    const result = await runImageTask({
      file: inputFile(),
      type: 'convert',
      inputConfig: { toFormat: 'webp' },
      outputName: 'photo.webp',
      upload,
      createTask,
    });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(createTask).toHaveBeenCalledWith({
      type: 'convert',
      inputFileIds: ['file-1'],
      inputConfig: { toFormat: 'webp' },
    });
    expect(mocks.waitForTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ onProgress: expect.any(Function) })
    );
    expect(result.name).toBe('photo.webp');
  });

  it('reports monotonic progress that ends at 100', async () => {
    mocks.waitForTask.mockImplementation(
      async (_id: string, options?: { onProgress?: (v: number) => void }) => {
        options?.onProgress?.(0);
        options?.onProgress?.(50);
        options?.onProgress?.(100);
        return { outputFileId: 'out-1' };
      }
    );

    const seen: number[] = [];
    await runImageTask({
      file: inputFile(),
      type: 'convert',
      inputConfig: {},
      outputName: 'photo.webp',
      upload: vi.fn().mockResolvedValue({ id: 'f' }),
      createTask: vi.fn().mockResolvedValue({ id: 't' }),
      onProgress: value => seen.push(value),
    });

    // 任务进度被压进上传之后的区间,进度条不能回退。
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
    expect(seen.at(-1)).toBe(100);
  });

  it('propagates task failure', async () => {
    mocks.waitForTask.mockRejectedValue(new Error('Task failed'));

    await expect(
      runImageTask({
        file: inputFile(),
        type: 'convert',
        inputConfig: {},
        outputName: 'photo.webp',
        upload: vi.fn().mockResolvedValue({ id: 'f' }),
        createTask: vi.fn().mockResolvedValue({ id: 't' }),
      })
    ).rejects.toThrow('Task failed');
  });

  it('fails loudly when the download is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false }))
    );

    await expect(
      runImageTask({
        file: inputFile(),
        type: 'convert',
        inputConfig: {},
        outputName: 'photo.webp',
        upload: vi.fn().mockResolvedValue({ id: 'f' }),
        createTask: vi.fn().mockResolvedValue({ id: 't' }),
      })
    ).rejects.toThrow('Failed to download result');
  });

  it('stops before creating a task once aborted', async () => {
    const controller = new AbortController();
    const createTask = vi.fn();

    await expect(
      runImageTask({
        file: inputFile(),
        type: 'convert',
        inputConfig: {},
        outputName: 'photo.webp',
        upload: vi.fn().mockImplementation(async () => {
          controller.abort();
          return { id: 'f' };
        }),
        createTask,
        signal: controller.signal,
      })
    ).rejects.toThrow('Aborted');

    expect(createTask).not.toHaveBeenCalled();
  });
});
