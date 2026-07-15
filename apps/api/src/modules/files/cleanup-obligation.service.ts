import { Injectable } from '@nestjs/common';
import {
  cleanupObligations,
  db,
  files,
  tasks,
  type CleanupObligation,
  type CleanupObligationKind,
} from '@utils-plane/db';
import { and, asc, eq, lte, or, sql } from 'drizzle-orm';
import type { ActiveUserTransaction } from '../../common/database/active-user-transaction';

export const CLEANUP_OBLIGATION_LEASE_MS = 60 * 60 * 1000;
export const CLEANUP_OBLIGATION_RETRY_MS = 60 * 1000;

@Injectable()
export class CleanupObligationService {
  async recordObject(resourceId: string, storageKey: string): Promise<void> {
    await db
      .insert(cleanupObligations)
      .values({
        kind: 'object',
        state: 'producing',
        resourceId,
        storageKey,
        queueName: null,
        jobId: null,
      })
      .onConflictDoUpdate({
        target: [cleanupObligations.kind, cleanupObligations.resourceId],
        set: {
          state: 'producing',
          storageKey,
          queueName: null,
          jobId: null,
          reconcileAfter: sql`now() + interval '1 hour'`,
        },
      });
  }

  async recordTaskJob(
    resourceId: string,
    queueName: string,
    jobId: string,
    database: Pick<ActiveUserTransaction, 'insert'>
  ): Promise<void> {
    await database
      .insert(cleanupObligations)
      .values({
        kind: 'task-job',
        state: 'ready',
        resourceId,
        storageKey: null,
        queueName,
        jobId,
        reconcileAfter: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [cleanupObligations.kind, cleanupObligations.resourceId],
        set: {
          state: 'ready',
          storageKey: null,
          queueName,
          jobId,
          reconcileAfter: sql`now()`,
        },
      });
  }

  async lockObjectProducer(
    database: Pick<ActiveUserTransaction, 'select'>,
    resourceId: string
  ): Promise<boolean> {
    const [obligation] = await database
      .select({ state: cleanupObligations.state })
      .from(cleanupObligations)
      .where(
        and(
          eq(cleanupObligations.kind, 'object'),
          eq(cleanupObligations.resourceId, resourceId)
        )
      )
      .limit(1)
      .for('update');
    return obligation?.state === 'producing';
  }

  async clearObjectInTransaction(
    database: Pick<ActiveUserTransaction, 'delete'>,
    resourceId: string
  ): Promise<void> {
    await database
      .delete(cleanupObligations)
      .where(
        and(
          eq(cleanupObligations.kind, 'object'),
          eq(cleanupObligations.resourceId, resourceId)
        )
      );
  }

  async releaseObject(resourceId: string): Promise<void> {
    await db
      .update(cleanupObligations)
      .set({ state: 'cleanup', reconcileAfter: sql`now()` })
      .where(
        and(
          eq(cleanupObligations.kind, 'object'),
          eq(cleanupObligations.resourceId, resourceId),
          eq(cleanupObligations.state, 'producing')
        )
      );
  }

  async claimObjectCleanup(resourceId: string): Promise<boolean> {
    const claimed = await db
      .update(cleanupObligations)
      .set({
        state: 'cleanup',
        reconcileAfter: sql`now() + interval '1 minute'`,
      })
      .where(
        and(
          eq(cleanupObligations.kind, 'object'),
          eq(cleanupObligations.resourceId, resourceId),
          or(
            eq(cleanupObligations.state, 'producing'),
            eq(cleanupObligations.state, 'cleanup')
          ),
          lte(cleanupObligations.reconcileAfter, sql`now()`)
        )
      )
      .returning({ id: cleanupObligations.id });
    return claimed.length > 0;
  }

  async clear(kind: CleanupObligationKind, resourceId: string): Promise<void> {
    await db
      .delete(cleanupObligations)
      .where(
        and(
          eq(cleanupObligations.kind, kind),
          eq(cleanupObligations.resourceId, resourceId)
        )
      );
  }

  async list(limit = 100, now = new Date()): Promise<CleanupObligation[]> {
    return db
      .select()
      .from(cleanupObligations)
      .where(lte(cleanupObligations.reconcileAfter, now))
      .orderBy(
        asc(cleanupObligations.reconcileAfter),
        asc(cleanupObligations.createdAt)
      )
      .limit(Math.min(500, Math.max(1, limit)));
  }

  async defer(
    kind: CleanupObligationKind,
    resourceId: string,
    now = new Date()
  ): Promise<void> {
    await this.reschedule(
      kind,
      resourceId,
      new Date(now.getTime() + CLEANUP_OBLIGATION_RETRY_MS)
    );
  }

  async release(
    kind: CleanupObligationKind,
    resourceId: string,
    now = new Date()
  ): Promise<void> {
    await this.reschedule(kind, resourceId, now);
  }

  private async reschedule(
    kind: CleanupObligationKind,
    resourceId: string,
    reconcileAfter: Date
  ): Promise<void> {
    await db
      .update(cleanupObligations)
      .set({ reconcileAfter })
      .where(
        and(
          eq(cleanupObligations.kind, kind),
          eq(cleanupObligations.resourceId, resourceId)
        )
      );
  }

  async fileExists(resourceId: string): Promise<boolean> {
    const rows = await db
      .select({ id: files.id })
      .from(files)
      .where(eq(files.id, resourceId))
      .limit(1);
    return rows.length > 0;
  }

  async taskExists(resourceId: string): Promise<boolean> {
    const rows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, resourceId))
      .limit(1);
    return rows.length > 0;
  }
}
