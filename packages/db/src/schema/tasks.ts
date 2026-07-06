import {
  pgTable,
  uuid,
  text,
  smallint,
  jsonb,
  timestamp,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

export const taskTypeEnum = pgEnum('task_type', [
  'compress',
  'convert',
  'image_watermark',
  'pdf_merge',
  'pdf_split',
  'pdf_to_image',
  'font_convert',
  'pdf_to_text',
  'image_to_pdf',
  'pdf_rotate',
  'pdf_watermark',
  'pdf_encrypt',
  'pdf_compress',
  'pdf_metadata',
  'pdf_rearrange',
]);

export const taskStatusEnum = pgEnum('task_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    type: taskTypeEnum('type').notNull(),
    status: taskStatusEnum('status').default('pending').notNull(),
    inputFileIds: jsonb('input_file_ids').$type<string[]>().default([]),
    inputConfig: jsonb('input_config').default({}),
    outputFileId: uuid('output_file_id'),
    progress: smallint('progress').default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    retryCount: smallint('retry_count').default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
  },
  t => ({
    userCreatedIdx: index('tasks_user_created_idx').on(t.userId, t.createdAt),
    statusIdx: index('tasks_status_idx').on(t.status),
  })
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
