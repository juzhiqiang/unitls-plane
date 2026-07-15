import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';

export const accountDeletionQueueScans = pgTable(
  'account_deletion_queue_scans',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    queueName: text('queue_name').notNull(),
    cursor: text('cursor').default('0').notNull(),
    completed: boolean('completed').default(false).notNull(),
    pendingKeys: jsonb('pending_keys')
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    jobIds: jsonb('job_ids')
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    version: integer('version').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  table => [primaryKey({ columns: [table.userId, table.queueName] })]
);

export type AccountDeletionQueueScan =
  typeof accountDeletionQueueScans.$inferSelect;
export type NewAccountDeletionQueueScan =
  typeof accountDeletionQueueScans.$inferInsert;
