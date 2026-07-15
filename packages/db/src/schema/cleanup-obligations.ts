import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export type CleanupObligationKind = 'object' | 'task-job';
export type CleanupObligationState = 'producing' | 'cleanup' | 'ready';

export const cleanupObligations = pgTable(
  'cleanup_obligations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').$type<CleanupObligationKind>().notNull(),
    state: text('state')
      .$type<CleanupObligationState>()
      .default('ready')
      .notNull(),
    resourceId: uuid('resource_id').notNull(),
    storageKey: text('storage_key'),
    queueName: text('queue_name'),
    jobId: text('job_id'),
    reconcileAfter: timestamp('reconcile_after')
      .default(sql`now() + interval '1 hour'`)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  table => ({
    kindResourceIdx: uniqueIndex('cleanup_obligations_kind_resource_idx').on(
      table.kind,
      table.resourceId
    ),
    reconcileAfterIdx: index('cleanup_obligations_reconcile_after_idx').on(
      table.reconcileAfter
    ),
    payloadCheck: check(
      'cleanup_obligations_payload_check',
      sql`(
        (${table.kind} = 'object' AND ${table.state} IN ('producing', 'cleanup') AND ${table.storageKey} IS NOT NULL AND ${table.queueName} IS NULL AND ${table.jobId} IS NULL)
        OR
        (${table.kind} = 'task-job' AND ${table.state} = 'ready' AND ${table.storageKey} IS NULL AND ${table.queueName} IS NOT NULL AND ${table.jobId} IS NOT NULL)
      )`
    ),
  })
);

export type CleanupObligation = typeof cleanupObligations.$inferSelect;
export type NewCleanupObligation = typeof cleanupObligations.$inferInsert;
