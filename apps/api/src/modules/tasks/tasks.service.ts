import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { db, tasks, type User } from '@utils-plane/db';
import {
  canUseFeature,
  getLimit,
  type EntitlementUser,
} from '@utils-plane/utils';
import { eq, desc, and, sql } from 'drizzle-orm';
import type { Task, NewTask } from '@utils-plane/db';
import type {
  CreateTaskInput,
  TaskType,
  TaskStatus,
} from '@utils-plane/validators';
import { ErrorCodes } from '../../common/errors/error-codes';
import {
  withActiveUserTransaction,
  withProducerTransaction,
  type ActiveUserTransaction,
} from '../../common/database/active-user-transaction';
import { FilesService } from '../files/files.service';
import { CleanupObligationService } from '../files/cleanup-obligation.service';
import { getTaskQueueName } from './task-queue';
import { countTasksCreatedToday } from './daily-task-quota';
import {
  TaskJobReconciler,
  type TaskJobIdentity,
} from './task-job-reconciler.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectQueue('image-queue') private imageQueue: Queue,
    @InjectQueue('pdf-queue') private pdfQueue: Queue,
    @InjectQueue('font-queue') private fontQueue: Queue,
    @InjectQueue('ai-queue') private aiQueue: Queue,
    private readonly filesService: FilesService,
    private readonly cleanupObligationService: CleanupObligationService,
    private readonly taskJobReconciler: TaskJobReconciler
  ) {}

  async create(
    input: CreateTaskInput,
    user?: Pick<User, 'id' | 'plan' | 'role'> | null
  ): Promise<Task> {
    this.assertCanCreateTask(input.type, user);

    const queue = this.getQueue(input.type);
    const taskId = globalThis.crypto.randomUUID();
    const identity: TaskJobIdentity = {
      resourceId: taskId,
      queueName: queue.name,
      jobId: taskId,
    };
    const operation = (tx: ActiveUserTransaction) =>
      this.createTask(input, user ?? null, tx, identity);
    const task = user
      ? await withActiveUserTransaction(user.id, operation)
      : await withProducerTransaction(operation);

    let job: Job | null = null;
    try {
      job = await this.taskJobReconciler.reconcile(identity);
    } catch {
      this.logger.error(`Task job dispatch deferred for task ${task.id}`);
    }
    if (job) this.logCreatedTask(task, job, queue);
    return task;
  }

  private async createTask(
    input: CreateTaskInput,
    user: Pick<User, 'id' | 'plan' | 'role'> | null,
    database: ActiveUserTransaction,
    identity: TaskJobIdentity
  ): Promise<Task> {
    await this.assertCanAccessInputFiles(input, user, database);
    await this.assertWithinDailyQuota(input.type, user, database);

    const [task] = await database
      .insert(tasks)
      .values({
        id: identity.resourceId,
        userId: user?.id ?? null,
        type: input.type,
        status: 'pending',
        inputFileIds: input.inputFileIds,
        inputConfig: input.inputConfig ?? {},
      } as NewTask)
      .returning();

    if (!task) {
      throw new Error('Failed to create task');
    }

    await this.cleanupObligationService.recordTaskJob(
      identity.resourceId,
      identity.queueName,
      identity.jobId,
      database
    );
    return task;
  }

  private logCreatedTask(task: Task, job: Job, queue: Queue): void {
    this.logger.log(
      `Job added: jobId=${job.id}, taskId=${task.id}, queue=${queue.name}`
    );
  }

  async getById(id: string, userId?: string): Promise<Task> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));

    if (!task) {
      throw new NotFoundException({
        code: ErrorCodes.TASK_NOT_FOUND,
        message: 'Task not found',
      });
    }

    if (userId && task.userId && task.userId !== userId) {
      throw new ForbiddenException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Access denied',
      });
    }

    return task;
  }

  /**
   * 返回当前账号今日生图的额度快照（limit / used / remaining）。
   *
   * 只读查询,用全局 db 直接 count,不进事务、不持有 user 行锁:
   * 这是给前端展示用的最终一致性快照,真正的超额拦截仍由 create() 内
   * assertWithinDailyQuota 在事务里完成。匿名用户没有额度（free = 0）。
   */
  async getImageGenerateQuota(
    user: Pick<User, 'id' | 'plan' | 'role'>
  ): Promise<{ limit: number; used: number; remaining: number }> {
    const limit = getLimit(
      { userId: user.id, plan: user.plan, role: user.role },
      'image.generate.dailyCount'
    );
    const used = await countTasksCreatedToday(db, user.id, 'image_generate');
    return { limit, used, remaining: Math.max(0, limit - used) };
  }

  async listByUser(
    userId: string,
    query: { page: number; limit: number; status?: TaskStatus; type?: TaskType }
  ): Promise<{ tasks: Task[]; total: number }> {
    const offset = (query.page - 1) * query.limit;

    const conditions = [eq(tasks.userId, userId)];
    if (query.status) {
      conditions.push(eq(tasks.status, query.status));
    }
    if (query.type) {
      conditions.push(eq(tasks.type, query.type));
    }

    const [tasksList, countResult] = await Promise.all([
      db
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(desc(tasks.createdAt))
        .limit(query.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(...conditions)),
    ]);

    return {
      tasks: tasksList,
      total: countResult[0]?.count ?? 0,
    };
  }

  async updateProgress(id: string, progress: number): Promise<void> {
    await db
      .update(tasks)
      .set({ progress: Math.min(100, Math.max(0, progress)) })
      .where(eq(tasks.id, id));
  }

  async markProcessing(id: string): Promise<void> {
    await db
      .update(tasks)
      .set({ status: 'processing' })
      .where(eq(tasks.id, id));
  }

  async markCompleted(id: string, outputFileId: string): Promise<void> {
    await db
      .update(tasks)
      .set({
        status: 'completed',
        outputFileId: outputFileId,
        progress: 100,
        completedAt: new Date(),
      })
      .where(eq(tasks.id, id));
  }

  async markFailed(
    id: string,
    errorCode: string,
    errorMessage: string
  ): Promise<void> {
    await db
      .update(tasks)
      .set({
        status: 'failed',
        errorCode,
        errorMessage,
      })
      .where(eq(tasks.id, id));
  }

  async incrementRetry(id: string): Promise<number> {
    const [task] = await db
      .update(tasks)
      .set({
        retryCount: sql`${tasks.retryCount} + 1`,
      })
      .where(eq(tasks.id, id))
      .returning();

    return task?.retryCount ?? 0;
  }

  private async assertCanAccessInputFiles(
    input: CreateTaskInput,
    user: Pick<User, 'id' | 'plan' | 'role'> | null,
    transaction?: ActiveUserTransaction
  ): Promise<void> {
    const fileIds = new Set<string>(input.inputFileIds);
    const order = (input.inputConfig as { order?: unknown }).order;

    if (Array.isArray(order)) {
      for (const entry of order) {
        if (typeof entry === 'string' && entry.length > 0) {
          fileIds.add(entry);
        }
      }
    }

    const entitlementUser: EntitlementUser | null = user
      ? { userId: user.id, plan: user.plan, role: user.role }
      : null;
    const maxFileSize =
      input.type === 'compress'
        ? getLimit(entitlementUser, 'upload.maxFileSize')
        : null;

    for (const fileId of fileIds) {
      const file = transaction
        ? await this.filesService.getById(fileId, user?.id ?? null, transaction)
        : await this.filesService.getById(fileId, user?.id ?? null);

      if (maxFileSize !== null && file.originalSize > maxFileSize) {
        throw new BadRequestException({
          code: ErrorCodes.FILE_TOO_LARGE,
          message: `File size exceeds limit of ${maxFileSize / 1024 / 1024}MB`,
        });
      }
    }
  }

  /**
   * 生图有真实外部计费,必须限每日张数。
   *
   * 放在事务内,借 withActiveUserTransaction 已持有的 user 行锁保证并发不超发。
   */
  private async assertWithinDailyQuota(
    type: TaskType,
    user: Pick<User, 'id' | 'plan' | 'role'> | null,
    database: ActiveUserTransaction
  ): Promise<void> {
    if (type !== 'image_generate' || !user) return;

    const limit = getLimit(
      { userId: user.id, plan: user.plan, role: user.role },
      'image.generate.dailyCount'
    );
    const used = await countTasksCreatedToday(database, user.id, type);

    if (used >= limit) {
      throw new ForbiddenException({
        code: ErrorCodes.AI_IMAGE_DAILY_LIMIT_EXCEEDED,
        message: `Daily image generation limit of ${limit} reached`,
      });
    }
  }

  private assertCanCreateTask(
    type: TaskType,
    currentUser?: Pick<User, 'id' | 'plan' | 'role'> | null
  ): void {
    if (!this.isServerTask(type)) return;

    const user: EntitlementUser | null = currentUser
      ? {
          userId: currentUser.id,
          plan: currentUser.plan,
          role: currentUser.role,
        }
      : null;

    if (!canUseFeature(user, 'task.serverProcessing')) {
      throw new ForbiddenException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Sign in is required for server processing tasks',
      });
    }
  }

  private isServerTask(type: TaskType): boolean {
    switch (type) {
      case 'compress':
      case 'convert':
      case 'image_watermark':
        return false;
      case 'image_id_photo':
      case 'image_generate':
      case 'pdf_merge':
      case 'pdf_split':
      case 'pdf_to_image':
      case 'pdf_to_text':
      case 'image_to_pdf':
      case 'pdf_rotate':
      case 'pdf_watermark':
      case 'pdf_encrypt':
      case 'pdf_compress':
      case 'pdf_metadata':
      case 'pdf_rearrange':
      case 'pdf_from_document':
      case 'font_convert':
        return true;
    }
  }

  private getQueue(type: TaskType): Queue {
    switch (getTaskQueueName(type)) {
      case 'image-queue':
        return this.imageQueue;
      case 'pdf-queue':
        return this.pdfQueue;
      case 'font-queue':
        return this.fontQueue;
      case 'ai-queue':
        return this.aiQueue;
    }
  }
}
