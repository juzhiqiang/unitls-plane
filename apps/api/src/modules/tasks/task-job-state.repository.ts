import { Injectable } from '@nestjs/common';
import { AccountSummaryCache } from '../../common/cache/account-summary-cache.service';
import { db, tasks, user } from '@utils-plane/db';
import type { TaskStatus, TaskType } from '@utils-plane/validators';
import { and, eq } from 'drizzle-orm';

export type TaskJobState = {
  id: string;
  type: TaskType;
  status: TaskStatus;
  userId: string | null;
  ownerId: string | null;
  deletionStartedAt: Date | null;
};

@Injectable()
export class TaskJobStateRepository {
  constructor(
    private readonly summaryCache: AccountSummaryCache = new AccountSummaryCache()
  ) {}
  async getTaskState(taskId: string): Promise<TaskJobState | null> {
    const [state] = await db
      .select({
        id: tasks.id,
        type: tasks.type,
        status: tasks.status,
        userId: tasks.userId,
        ownerId: user.id,
        deletionStartedAt: user.deletionStartedAt,
      })
      .from(tasks)
      .leftJoin(user, eq(tasks.userId, user.id))
      .where(eq(tasks.id, taskId))
      .limit(1);
    return state ?? null;
  }

  async markProcessingFailed(taskId: string): Promise<void> {
    const rows = await db
      .update(tasks)
      .set({
        status: 'failed',
        errorCode: 'TASK_JOB_LOST',
        errorMessage: 'Task job is unavailable',
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.status, 'processing')))
      .returning({ userId: tasks.userId });
    for (const row of rows) this.summaryCache.invalidate(row.userId);
  }
}
