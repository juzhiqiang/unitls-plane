import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { db, tasks, type User } from '@utils-plane/db';
import { canUseFeature, type EntitlementUser } from '@utils-plane/utils';
import { eq, desc, and, sql } from 'drizzle-orm';
import type { Task, NewTask } from '@utils-plane/db';
import type {
  CreateTaskInput,
  TaskType,
  TaskStatus,
} from '@utils-plane/validators';
import { ErrorCodes } from '../../common/errors/error-codes';
import { FilesService } from '../files/files.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectQueue('image-queue') private imageQueue: Queue,
    @InjectQueue('pdf-queue') private pdfQueue: Queue,
    @InjectQueue('font-queue') private fontQueue: Queue,
    private readonly filesService: FilesService
  ) {}

  async create(
    input: CreateTaskInput,
    user?: Pick<User, 'id' | 'plan' | 'role'> | null
  ): Promise<Task> {
    this.assertCanCreateTask(input.type, user);
    await this.assertCanAccessInputFiles(input.inputFileIds, user);

    const [task] = await db
      .insert(tasks)
      .values({
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

    const queue = this.getQueue(input.type);
    const job = await queue.add(input.type, { taskId: task.id });
    this.logger.log(
      `Job added: jobId=${job?.id}, taskId=${task.id}, queue=${queue.name}, waiting=${await queue.getWaitingCount()}, active=${await queue.getActiveCount()}`
    );

    return task;
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
    inputFileIds: string[],
    user?: Pick<User, 'id'> | null
  ): Promise<void> {
    for (const fileId of inputFileIds) {
      const file = await this.filesService.getById(fileId);
      if (!file.userId) continue;
      if (user?.id === file.userId) continue;

      throw new ForbiddenException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Access denied',
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
    switch (type) {
      case 'compress':
      case 'convert':
      case 'image_watermark':
      case 'image_id_photo':
        return this.imageQueue;
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
        return this.pdfQueue;
      case 'font_convert':
        return this.fontQueue;
    }
  }
}
