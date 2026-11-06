import { Injectable, Logger } from '@nestjs/common';
import { db, files } from '@utils-plane/db';
import { inArray } from 'drizzle-orm';
import { MinioService } from './minio.service';

export type ThumbnailCleanupSummary = {
  scanned: number;
  deleted: number;
  failed: number;
  continuationToken?: string;
};

// 只回收应用定义的缓存文件，未知布局留待显式迁移处理。
const THUMBNAIL_KEY =
  /^thumbnails\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\/\d+-\d+\.webp$/i;

@Injectable()
export class ThumbnailCleanupService {
  private readonly logger = new Logger(ThumbnailCleanupService.name);

  constructor(private readonly minio: MinioService) {}

  async cleanupPage(
    continuationToken?: string
  ): Promise<ThumbnailCleanupSummary> {
    const page = await this.minio.listObjects('thumbnails/', continuationToken);
    const candidates = page.objects.flatMap(object => {
      const fileId = THUMBNAIL_KEY.exec(object.key)?.[1];
      return fileId ? [{ key: object.key, fileId: fileId.toLowerCase() }] : [];
    });
    const ids = [...new Set(candidates.map(candidate => candidate.fileId))];
    // 包括回收站及正在 purge 的行；这些文件由正常删除链路负责。
    // 文件 id 不会复用，确认行不存在后不会再出现合法的新生产者。
    const existing = ids.length
      ? await db
          .select({ id: files.id })
          .from(files)
          .where(inArray(files.id, ids))
      : [];
    const existingIds = new Set(existing.map(file => file.id));
    const summary: ThumbnailCleanupSummary = {
      scanned: page.objects.length,
      deleted: 0,
      failed: 0,
      continuationToken: page.continuationToken,
    };
    for (const candidate of candidates) {
      if (existingIds.has(candidate.fileId)) continue;
      try {
        await this.minio.delete(candidate.key);
        summary.deleted += 1;
      } catch {
        summary.failed += 1;
        this.logger.warn(
          `Failed to clean up orphan thumbnail file=${candidate.fileId}`
        );
      }
    }
    return summary;
  }
}
