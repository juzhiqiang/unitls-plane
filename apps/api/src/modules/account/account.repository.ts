import { Injectable, NotFoundException } from '@nestjs/common';
import {
  account,
  accountDeletionQueueScans,
  db,
  files,
  session,
  tasks,
  user,
  verification,
  type File,
  type Task,
  type User,
  type AccountDeletionQueueScan,
} from '@utils-plane/db';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  sum,
} from 'drizzle-orm';

export const ACCOUNT_EXPORT_MAX_TASK_ROWS = 1_000;
export const ACCOUNT_EXPORT_MAX_FILE_ROWS = 10_000;

export type AccountExportProfile = Pick<
  User,
  | 'id'
  | 'name'
  | 'email'
  | 'emailVerified'
  | 'image'
  | 'plan'
  | 'role'
  | 'createdAt'
  | 'updatedAt'
>;
export type AccountExportFile = Pick<
  File,
  | 'id'
  | 'filename'
  | 'originalSize'
  | 'storageKey'
  | 'mimeType'
  | 'createdAt'
  | 'deletedAt'
>;
export type AccountExportTask = Pick<
  Task,
  | 'id'
  | 'userId'
  | 'type'
  | 'status'
  | 'inputFileIds'
  | 'inputConfig'
  | 'outputFileId'
  | 'progress'
  | 'errorCode'
  | 'errorMessage'
  | 'retryCount'
  | 'createdAt'
  | 'completedAt'
>;
export interface AccountExportSnapshot {
  profile: AccountExportProfile;
  tasks: AccountExportTask[];
  files: AccountExportFile[];
}

export interface AccountDeletionSnapshot {
  files: Pick<File, 'id' | 'storageKey'>[];
  tasks: Pick<Task, 'id' | 'type'>[];
}

export type AccountDeletionProfile = Pick<
  User,
  'id' | 'email' | 'deletionStartedAt'
>;

@Injectable()
export class AccountRepository {
  async getDeletionProfile(userId: string): Promise<AccountDeletionProfile> {
    const [profile] = await db
      .select({
        id: user.id,
        email: user.email,
        deletionStartedAt: user.deletionStartedAt,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!profile) throw new NotFoundException('Account not found');
    return profile;
  }

  async markDeletionStarted(userId: string): Promise<AccountDeletionProfile> {
    const [profile] = await db
      .update(user)
      .set({
        deletionStartedAt: sql`coalesce(${user.deletionStartedAt}, now())`,
      })
      .where(eq(user.id, userId))
      .returning({
        id: user.id,
        email: user.email,
        deletionStartedAt: user.deletionStartedAt,
      });

    if (!profile) throw new NotFoundException('Account not found');
    return profile;
  }

  async getDeletionSnapshot(userId: string): Promise<AccountDeletionSnapshot> {
    const [fileRows, taskRows] = await Promise.all([
      db
        .select({ id: files.id, storageKey: files.storageKey })
        .from(files)
        .where(eq(files.userId, userId)),
      db
        .select({ id: tasks.id, type: tasks.type })
        .from(tasks)
        .where(eq(tasks.userId, userId)),
    ]);

    return { files: fileRows, tasks: taskRows };
  }

  async getOrCreateDeletionQueueScan(
    userId: string,
    queueName: string
  ): Promise<AccountDeletionQueueScan> {
    await db
      .insert(accountDeletionQueueScans)
      .values({ userId, queueName })
      .onConflictDoNothing();
    const [state] = await db
      .select()
      .from(accountDeletionQueueScans)
      .where(
        and(
          eq(accountDeletionQueueScans.userId, userId),
          eq(accountDeletionQueueScans.queueName, queueName)
        )
      )
      .limit(1);
    if (!state) throw new Error('Failed to persist account queue scan state');
    return state;
  }

  async saveDeletionQueueScan(
    userId: string,
    queueName: string,
    expectedVersion: number,
    state: Pick<
      AccountDeletionQueueScan,
      'cursor' | 'completed' | 'pendingKeys' | 'jobIds'
    >
  ): Promise<AccountDeletionQueueScan | null> {
    const [saved] = await db
      .update(accountDeletionQueueScans)
      .set({
        ...state,
        version: sql`${accountDeletionQueueScans.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(accountDeletionQueueScans.userId, userId),
          eq(accountDeletionQueueScans.queueName, queueName),
          eq(accountDeletionQueueScans.version, expectedVersion)
        )
      )
      .returning();
    return saved ?? null;
  }

  async deleteAccountRecords(userId: string): Promise<void> {
    await db.transaction(async tx => {
      await tx
        .delete(accountDeletionQueueScans)
        .where(eq(accountDeletionQueueScans.userId, userId));
      await tx.delete(tasks).where(eq(tasks.userId, userId));
      await tx.delete(files).where(eq(files.userId, userId));
      await tx.delete(verification).where(eq(verification.value, userId));
      await tx.delete(account).where(eq(account.userId, userId));
      await tx.delete(session).where(eq(session.userId, userId));
      await tx.delete(user).where(eq(user.id, userId));
    });
  }

  async getExportSnapshot(userId: string): Promise<AccountExportSnapshot> {
    const [[profile], taskRows, fileRows] = await Promise.all([
      db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          image: user.image,
          plan: user.plan,
          role: user.role,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1),
      db
        .select({
          id: tasks.id,
          userId: tasks.userId,
          type: tasks.type,
          status: tasks.status,
          inputFileIds: tasks.inputFileIds,
          inputConfig: tasks.inputConfig,
          outputFileId: tasks.outputFileId,
          progress: tasks.progress,
          errorCode: tasks.errorCode,
          errorMessage: tasks.errorMessage,
          retryCount: tasks.retryCount,
          createdAt: tasks.createdAt,
          completedAt: tasks.completedAt,
        })
        .from(tasks)
        .where(eq(tasks.userId, userId))
        .orderBy(asc(tasks.createdAt), asc(tasks.id))
        .limit(ACCOUNT_EXPORT_MAX_TASK_ROWS + 1),
      db
        .select({
          id: files.id,
          filename: files.filename,
          originalSize: files.originalSize,
          storageKey: files.storageKey,
          mimeType: files.mimeType,
          createdAt: files.createdAt,
          deletedAt: files.deletedAt,
        })
        .from(files)
        .where(eq(files.userId, userId))
        .orderBy(asc(files.createdAt), asc(files.id))
        .limit(ACCOUNT_EXPORT_MAX_FILE_ROWS + 1),
    ]);

    if (!profile) throw new NotFoundException('Account not found');
    return { profile, tasks: taskRows, files: fileRows };
  }

  async getSummary(userId: string) {
    const [
      [activeTaskResult],
      [failedTaskResult],
      [activeFileResult],
      [activeFileBytesResult],
      recentTasks,
      recentFiles,
    ] = await Promise.all([
      db
        .select({ value: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.userId, userId),
            inArray(tasks.status, ['pending', 'processing'])
          )
        ),
      db
        .select({ value: count() })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), eq(tasks.status, 'failed'))),
      db
        .select({ value: count() })
        .from(files)
        .where(and(eq(files.userId, userId), isNull(files.deletedAt))),
      db
        .select({ value: sum(files.originalSize) })
        .from(files)
        .where(and(eq(files.userId, userId), isNull(files.deletedAt))),
      db
        .select()
        .from(tasks)
        .where(eq(tasks.userId, userId))
        .orderBy(desc(tasks.createdAt))
        .limit(5),
      db
        .select({
          id: files.id,
          filename: files.filename,
          originalSize: files.originalSize,
          mimeType: files.mimeType,
          createdAt: files.createdAt,
        })
        .from(files)
        .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
        .orderBy(desc(files.createdAt))
        .limit(5),
    ]);

    return {
      activeTaskCount: Number(activeTaskResult?.value ?? 0),
      failedTaskCount: Number(failedTaskResult?.value ?? 0),
      activeFileCount: Number(activeFileResult?.value ?? 0),
      activeFileBytes: Number(activeFileBytesResult?.value ?? 0),
      recentTasks,
      recentFiles,
    };
  }
}
