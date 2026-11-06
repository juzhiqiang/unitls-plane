import { TaskResourceBudgetService } from '../services/task-resource-budget.service';
import { TaskResourceLimitError } from '../../../common/resources/resource-error';
import { DelayedError } from 'bullmq';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PdfService } from '../services/pdf.service';
import { PdfToCadService } from '../services/cad/pdf-to-cad.service';
import { isCadError } from '../services/cad/types';
import { FilesService } from '../../files/files.service';
import { TasksService } from '../tasks.service';
import {
  hasExhaustedAttempts,
  isRetryableError,
  shouldRecordFailure,
} from './attempt-outcome';
import { workerConcurrency } from '../../../config/worker-concurrency';
import { dispatchPdfTask } from './pdf/dispatch';
import { PdfTaskContext } from './pdf/task-context';

/** CAD 契约错误保留自己的错误码，其余归为 PDF_PROCESSING_FAILED。 */
function failureCodeOf(err: unknown): string {
  return err instanceof TaskResourceLimitError || isCadError(err)
    ? err.code
    : 'PDF_PROCESSING_FAILED';
}

@Processor('pdf-queue', {
  concurrency: workerConcurrency('PDF_WORKER_CONCURRENCY', 2),
  lockDuration: 300000,
})
export class PdfProcessor extends WorkerHost {
  private readonly logger = new Logger(PdfProcessor.name);

  constructor(
    private readonly pdfService: PdfService,
    private readonly filesService: FilesService,
    private readonly tasksService: TasksService,
    private readonly pdfToCadService: PdfToCadService,
    private readonly resourceBudget: TaskResourceBudgetService
  ) {
    super();
  }

  async process(
    job: Job<{ taskId: string }>,
    token?: string
  ): Promise<unknown> {
    const { taskId } = job.data;
    this.logger.log(
      `[START] jobId=${job.id}, taskId=${taskId}, attempt=${job.attemptsMade}`
    );
    const task = await this.tasksService.getById(taskId);

    try {
      return await this.resourceBudget.run(task, job, token, async () => {
        await this.tasksService.markProcessing(taskId);

        return await dispatchPdfTask(
          task,
          new PdfTaskContext(
            task,
            job,
            this.pdfService,
            this.filesService,
            this.tasksService,
            this.pdfToCadService
          )
        );
      });
    } catch (err) {
      if (err instanceof DelayedError) {
        if (task.status === 'processing') await this.markRetryingSafely(taskId);
        throw err;
      }
      // 还有重试机会时只退回 pending:提前写 failed 会让前端停掉轮询,
      // 之后重试成功也没人再看,页面永远停在报错上。见 attempt-outcome.ts。
      if (!shouldRecordFailure(job, err)) {
        await this.markRetryingSafely(taskId);
        throw err;
      }
      try {
        await this.tasksService.markFailed(
          taskId,
          failureCodeOf(err),
          (err as Error).message
        );
      } catch (dbErr) {
        this.logger.error(
          `Failed to mark task ${taskId} as failed: ${(dbErr as Error).message}`
        );
      }
      // 确定性失败(CAD 契约错误:配置非法、DWG 未支持、OCR 缺失、损坏 PDF)重跑结果一样,
      // 用 UnrecoverableError 掐断后续 attempt,避免同一错误反复落库。
      if (err instanceof TaskResourceLimitError || isRetryableError(err))
        throw err;
      throw new UnrecoverableError((err as Error).message);
    }
  }

  private async markRetryingSafely(taskId: string): Promise<void> {
    try {
      await this.tasksService.markRetrying(taskId);
    } catch (dbErr) {
      this.logger.error(
        `Failed to mark task ${taskId} for retry: ${(dbErr as Error).message}`
      );
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    this.logger.error(
      `Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`
    );
    if (hasExhaustedAttempts(job)) {
      const { taskId } = job.data as { taskId: string };
      await this.tasksService.markFailed(
        taskId,
        failureCodeOf(err),
        err.message
      );
    }
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`Job ${jobId} stalled — will be retried by BullMQ`);
  }
}
