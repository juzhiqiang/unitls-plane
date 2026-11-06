import { expect, it, vi } from 'bun:test';
import { DelayedError } from 'bullmq';
import { ImageProcessor } from '../../../../src/modules/tasks/processors/image.processor';
import { PdfProcessor } from '../../../../src/modules/tasks/processors/pdf.processor';
import { FontProcessor } from '../../../../src/modules/tasks/processors/font.processor';
import { AiImageProcessor } from '../../../../src/modules/tasks/processors/ai-image.processor';
import { TaskResourceLimitError } from '../../../../src/common/resources/resource-error';

for (const kind of ['image', 'pdf', 'font', 'ai'] as const) {
  for (const outcome of ['busy', 'oversized'] as const) {
    it(`${kind}: ${outcome} 在处理和下载前退出，并保留错误语义`, async () => {
      const tasks = {
        getById: vi.fn(async () => ({ id: 'task', type: 'compress' })),
        markProcessing: vi.fn(),
        markFailed: vi.fn(),
        markRetrying: vi.fn(),
      };
      const files = { download: vi.fn() };
      const error =
        outcome === 'busy'
          ? new DelayedError()
          : new TaskResourceLimitError('input too large');
      const budget = {
        run: vi.fn(async () => {
          throw error;
        }),
      };
      const processor =
        kind === 'image'
          ? new ImageProcessor(
              {} as never,
              files as never,
              tasks as never,
              {} as never,
              budget as never
            )
          : kind === 'pdf'
            ? new PdfProcessor(
                {} as never,
                files as never,
                tasks as never,
                {} as never,
                budget as never
              )
            : kind === 'font'
              ? new FontProcessor(
                  {} as never,
                  files as never,
                  tasks as never,
                  budget as never
                )
              : new AiImageProcessor(
                  files as never,
                  tasks as never,
                  {} as never,
                  budget as never
                );
      const job = {
        id: 'job',
        data: { taskId: 'task' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      };
      await expect(processor.process(job as never, 'lock-token')).rejects.toBe(
        error
      );
      expect(tasks.markProcessing).not.toHaveBeenCalled();
      expect(files.download).not.toHaveBeenCalled();
      expect(tasks.markRetrying).not.toHaveBeenCalled();
      if (outcome === 'busy') expect(tasks.markFailed).not.toHaveBeenCalled();
      else {
        expect(tasks.markFailed).toHaveBeenCalledWith(
          'task',
          'TASK_RESOURCE_LIMIT_EXCEEDED',
          expect.any(String)
        );
        await processor.onFailed({ ...job, attemptsMade: 3 } as never, error);
        expect(tasks.markFailed.mock.calls.at(-1)?.[1]).toBe(
          'TASK_RESOURCE_LIMIT_EXCEEDED'
        );
      }
    });
  }
}
