import {
  pgTable,
  uuid,
  text,
  bigint,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    filename: text('filename').notNull(),
    originalSize: bigint('original_size', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull(),
    bucket: text('bucket').default('uploads').notNull(),
    mimeType: text('mime_type').notNull(),
    metadata: jsonb('metadata'),
    expiresAt: timestamp('expires_at'),
    deletedAt: timestamp('deleted_at'),
    purgeStartedAt: timestamp('purge_started_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  t => ({
    userCreatedIdx: index('files_user_created_idx').on(t.userId, t.createdAt),
    expiresIdx: index('files_expires_idx')
      .on(t.expiresAt)
      .where(sql`expires_at IS NOT NULL`),
  })
);

export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
