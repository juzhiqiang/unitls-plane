import { Injectable } from '@nestjs/common';
import { db, files, tasks } from '@utils-plane/db';
import { and, count, desc, eq, inArray, isNull, sum } from 'drizzle-orm';

@Injectable()
export class AccountRepository {
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
