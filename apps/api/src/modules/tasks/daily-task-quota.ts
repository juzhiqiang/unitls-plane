// 本文件只导出每日用量的计数 helper;每日配额的 policy 判定(读取额度、抛错)
// 在 tasks.service.ts 的 assertWithinDailyQuota 内完成。
import { tasks } from '@utils-plane/db';
import type { TaskType } from '@utils-plane/validators';
import { and, eq, gte, ne, sql } from 'drizzle-orm';
import type { ActiveUserTransaction } from '../../common/database/active-user-transaction';

/**
 * 统计某用户当天已创建的指定类型任务数,用于每日配额判定。
 *
 * 命中 tasks_user_created_idx (user_id, created_at) 索引。
 * failed 不计数:provider 报错不该扣用户额度。
 * date_trunc 走数据库时区,与 created_at 的写入时区一致。
 */
export async function countTasksCreatedToday(
  database: Pick<ActiveUserTransaction, 'select'>,
  userId: string,
  type: TaskType
): Promise<number> {
  const rows = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.type, type),
        ne(tasks.status, 'failed'),
        gte(tasks.createdAt, sql`date_trunc('day', now())`)
      )
    );

  return rows[0]?.count ?? 0;
}
