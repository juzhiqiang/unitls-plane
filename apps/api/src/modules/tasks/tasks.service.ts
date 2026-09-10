import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
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
import {
  eq,
  desc,
  asc,
  and,
  inArray,
  isNotNull,
  sql,
  getTableColumns,
} from 'drizzle-orm';
import {
  cursorCondition,
  finishPage,
  paginationOptions,
} from '../../common/database/list-pagination';
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

    // 生图会话归属在建任务时落列(而非 processor):任务失败也要留在会话流里,
    // 且不依赖 worker 生命周期。非法形状直接丢弃,任务照建。
    const sessionId =
      input.type === 'image_generate'
        ? extractSessionId(input.inputConfig)
        : null;

    const [task] = await database
      .insert(tasks)
      .values({
        id: identity.resourceId,
        userId: user?.id ?? null,
        type: input.type,
        status: 'pending',
        inputFileIds: input.inputFileIds,
        inputConfig: input.inputConfig ?? {},
        ...(sessionId ? { sessionId } : {}),
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

  async getStatuses(ids: string[]): Promise<
    Array<{
      taskId: string;
      status: Task['status'] | 'not_found';
      progress: number;
      outputFileId?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    }>
  > {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return [];

    const rows = await db
      .select({
        id: tasks.id,
        status: tasks.status,
        progress: tasks.progress,
        outputFileId: tasks.outputFileId,
        errorCode: tasks.errorCode,
        errorMessage: tasks.errorMessage,
      })
      .from(tasks)
      .where(inArray(tasks.id, uniqueIds));
    const byId = new Map(rows.map(row => [row.id, row]));

    return uniqueIds.map(taskId => {
      const row = byId.get(taskId);
      if (!row) return { taskId, status: 'not_found' as const, progress: 0 };
      const { id: _id, ...status } = row;
      void _id;
      return { taskId, ...status, progress: status.progress ?? 0 };
    });
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

  /**
   * 当前账号的生图会话列表,按最近活动倒序,最多 50 条。
   *
   * 会话不是独立实体:直接从 image_generate 任务行按 session_id 派生
   * (count/min/max 一查,首条 prompt 标题一查,合并即返回),不建新表、不做删除。
   */
  async listImageGenerateSessions(userId: string): Promise<
    Array<{
      sessionId: string;
      title: string;
      taskCount: number;
      createdAt: string;
      updatedAt: string;
    }>
  > {
    const scope = and(
      eq(tasks.userId, userId),
      eq(tasks.type, 'image_generate'),
      isNotNull(tasks.sessionId)
    );

    const [groups, firstTasks] = await Promise.all([
      db
        .select({
          sessionId: tasks.sessionId,
          taskCount: sql<number>`count(*)::int`,
          // 聚合的 timestamp 不会像普通列那样带时区序号化:直接让 SQL 产出
          // 带 Z 的 ISO 串(created_at 存 UTC),省得 Date 解析按本地时区偏移。
          createdAt: sql<string>`to_char(min(${tasks.createdAt}), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
          updatedAt: sql<string>`to_char(max(${tasks.createdAt}), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
        })
        .from(tasks)
        .where(scope)
        .groupBy(tasks.sessionId)
        .orderBy(desc(sql`max(${tasks.createdAt})`))
        .limit(50),
      // DISTINCT ON (session_id) + createdAt 正序:每个会话取最早一条任务做标题。
      db
        .selectDistinctOn([tasks.sessionId], {
          sessionId: tasks.sessionId,
          prompt: sql<string | null>`${tasks.inputConfig} ->> 'prompt'`,
        })
        .from(tasks)
        .where(scope)
        .orderBy(tasks.sessionId, asc(tasks.createdAt)),
    ]);

    const firstPrompt = new Map(
      firstTasks.map(row => [row.sessionId, row.prompt ?? ''])
    );

    return groups.map(group => ({
      sessionId: group.sessionId as string,
      title: (firstPrompt.get(group.sessionId) ?? '').slice(0, 20),
      taskCount: group.taskCount,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    }));
  }

  /**
   * 单个会话的任务列表(消息流数据源):createdAt 正序,上限 200。
   *
   * 不复用 listByUser 加 sessionId 参数:那边是 desc + offset 分页的通用列表,
   * 会话视图要 asc + 类型固定 + 归属隐含,语义混在一起两边都别扭。
   */
  async listImageGenerateSessionTasks(
    userId: string,
    sessionId: string
  ): Promise<{ tasks: Task[]; total: number }> {
    const scope = and(
      eq(tasks.userId, userId),
      eq(tasks.sessionId, sessionId),
      eq(tasks.type, 'image_generate')
    );

    const [sessionTasks, countResult] = await Promise.all([
      db
        .select()
        .from(tasks)
        .where(scope)
        .orderBy(asc(tasks.createdAt))
        .limit(200),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(scope),
    ]);

    return { tasks: sessionTasks, total: countResult[0]?.count ?? 0 };
  }

  /**
   * 删除一个生图会话:任务行 + 产物文件 + 参考图文件全部硬删(不进回收站)。
   *
   * - 会话里有 pending/processing 任务时拒绝:BullMQ job 还在跑,删行会让
   *   worker 的 markCompleted/markFailed 打空,任务状态永久悬空。
   * - 文件删除走 FilesService.forceDeleteOwned(带归属校验与 purge 租约),
   *   missing(用户已自行删掉参考图等)按成功处理。
   * - 任务删除前清理对应的 cleanup obligation 行,避免留下孤儿记录。
   */
  async deleteImageGenerateSession(
    userId: string,
    sessionId: string
  ): Promise<{ deletedTasks: number }> {
    const sessionTasks = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.sessionId, sessionId),
          eq(tasks.type, 'image_generate')
        )
      );

    if (sessionTasks.length === 0) {
      throw new NotFoundException({
        code: ErrorCodes.SESSION_NOT_FOUND,
        message: 'Session not found',
      });
    }

    if (
      sessionTasks.some(
        task => task.status === 'pending' || task.status === 'processing'
      )
    ) {
      throw new ConflictException({
        code: ErrorCodes.SESSION_HAS_ACTIVE_TASKS,
        message: 'Session has tasks still running',
      });
    }

    // 先删文件再删行:行删了就找不到关联 id 了;文件删失败会让整个请求报错,
    // 任务行保留,用户重试删除即可(文件 purge 租约保证不会重复删对象)。
    const fileIds = new Set<string>();
    for (const task of sessionTasks) {
      if (task.outputFileId) fileIds.add(task.outputFileId);
      for (const fileId of (task.inputFileIds as string[]) ?? []) {
        fileIds.add(fileId);
      }
    }
    for (const fileId of fileIds) {
      await this.filesService.forceDeleteOwned(fileId, userId);
    }

    for (const task of sessionTasks) {
      await this.cleanupObligationService.clear('task-job', task.id);
    }
    await db
      .delete(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.sessionId, sessionId),
          eq(tasks.type, 'image_generate')
        )
      );

    this.logger.log(
      `Deleted image generate session ${sessionId}: ${sessionTasks.length} tasks, ${fileIds.size} files purged`
    );
    return { deletedTasks: sessionTasks.length };
  }

  async listByUser(
    userId: string,
    query: {
      page: number;
      limit: number;
      status?: TaskStatus;
      type?: TaskType;
      cursor?: string;
      includeTotal?: boolean;
    }
  ): Promise<{
    tasks: Task[];
    total: number | null;
    nextCursor: string | null;
  }> {
    const { offset, limit } = paginationOptions(query.page, query.limit);
    const scope = JSON.stringify([
      'tasks',
      userId,
      query.status ?? '',
      query.type ?? '',
    ]);
    const cursor = cursorCondition(
      query.cursor,
      scope,
      tasks.createdAt,
      tasks.id
    );

    const conditions = [eq(tasks.userId, userId)];
    if (query.status) {
      conditions.push(eq(tasks.status, query.status));
    }
    if (query.type) {
      conditions.push(eq(tasks.type, query.type));
    }

    const [tasksList, countResult] = await Promise.all([
      db
        .select({
          ...getTableColumns(tasks),
          cursorTime: sql<string>`${tasks.createdAt}::text`,
        })
        .from(tasks)
        .where(and(...conditions, cursor))
        .orderBy(desc(tasks.createdAt), desc(tasks.id))
        .limit(limit + 1)
        .offset(query.cursor !== undefined ? 0 : offset),
      query.includeTotal === false
        ? Promise.resolve([] as { count: number }[])
        : db
            .select({ count: sql<number>`count(*)::int` })
            .from(tasks)
            .where(and(...conditions)),
    ]);

    const result = finishPage(tasksList, limit, scope);
    return {
      tasks: result.items,
      nextCursor: result.nextCursor,
      total: query.includeTotal === false ? null : (countResult[0]?.count ?? 0),
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

  /**
   * 一次 attempt 失败但还会重试:退回 pending,而不是留在 processing 或写成 failed。
   *
   * 写 failed 会让前端立刻停掉轮询(它把 failed 当终态),后面重试成功也没人再看。
   * 留在 processing 又会被 TaskJobReconciler 判成「processing 但 job 不是 active」——
   * 退避期间 job 正处于 delayed,会被误判并清掉。pending + delayed 是它认可的健康组合。
   */
  async markRetrying(id: string): Promise<void> {
    await db
      .update(tasks)
      .set({
        status: 'pending',
        progress: 0,
        errorCode: null,
        errorMessage: null,
        retryCount: sql`${tasks.retryCount} + 1`,
      })
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
        // 重试成功要清掉上一次 attempt 留下的错误,否则任务记录会同时显示「完成」和失败原因。
        errorCode: null,
        errorMessage: null,
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

/** 建任务时从 inputConfig 提取会话 id;形状不对返回 null,列不写。 */
function extractSessionId(
  inputConfig?: Record<string, unknown>
): string | null {
  const sessionId = inputConfig?.sessionId;
  return typeof sessionId === 'string' && UUID_PATTERN.test(sessionId.trim())
    ? sessionId.trim()
    : null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
