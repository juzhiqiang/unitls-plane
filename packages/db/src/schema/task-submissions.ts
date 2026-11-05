import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

export const taskSubmissions = pgTable(
  'task_submissions',
  {
    scope: text('scope').notNull(),
    key: uuid('key').notNull(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
    requestHash: text('request_hash').notNull(),
    // 不关联 tasks 外键：任务删除后保留短期墓碑，重试不能重新执行。
    taskId: uuid('task_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.scope, table.key] }),
    expiresIdx: index('task_submissions_expires_idx').on(table.expiresAt),
    userIdx: index('task_submissions_user_idx').on(table.userId),
  })
);

export type TaskSubmission = typeof taskSubmissions.$inferSelect;
export type NewTaskSubmission = typeof taskSubmissions.$inferInsert;
