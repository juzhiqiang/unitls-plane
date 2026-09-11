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
    activeListIdx: index('files_active_list_idx')
      .on(t.userId, t.createdAt, t.id)
      .where(sql`${t.deletedAt} IS NULL AND ${t.purgeStartedAt} IS NULL`),
    trashListIdx: index('files_trash_list_idx')
      .on(t.userId, t.deletedAt, t.id)
      .where(sql`${t.deletedAt} IS NOT NULL AND ${t.purgeStartedAt} IS NULL`),
    expiresIdx: index('files_expires_idx')
      .on(t.expiresAt)
      .where(sql`expires_at IS NOT NULL`),
    filenameTrgmIdx: index('files_filename_trgm_idx').using(
      'gin',
      t.filename.op('gin_trgm_ops')
    ),
  })
);

export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
