import { Injectable, NotFoundException } from '@nestjs/common';
import {
  account,
  db,
  files,
  session,
  tasks,
  user,
  verification,
  type File,
  type Task,
  type User,
} from '@utils-plane/db';
import { and, asc, count, desc, eq, inArray, isNull, sum } from 'drizzle-orm';

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
  profile: Pick<User, 'id' | 'email'>;
  files: Pick<File, 'id' | 'storageKey'>[];
}

@Injectable()
export class AccountRepository {
  async getDeletionSnapshot(userId: string): Promise<AccountDeletionSnapshot> {
    const [[profile], fileRows] = await Promise.all([
      db
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1),
      db
        .select({ id: files.id, storageKey: files.storageKey })
        .from(files)
        .where(eq(files.userId, userId)),
    ]);

    if (!profile) throw new NotFoundException('Account not found');
    return { profile, files: fileRows };
  }

  async deleteAccountRecords(userId: string): Promise<void> {
    await db.transaction(async tx => {
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
