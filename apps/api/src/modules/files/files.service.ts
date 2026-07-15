import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  eq,
  desc,
  and,
  isNull,
  isNotNull,
  lte,
  like,
  inArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { db, files, type File, type NewFile, type User } from '@utils-plane/db';
import { getLimit, type EntitlementUser } from '@utils-plane/utils';
import { MinioService } from './minio.service';
import { ErrorCodes } from '../../common/errors/error-codes';
import {
  withActiveUserTransaction,
  withProducerTransaction,
  type ActiveUserTransaction,
} from '../../common/database/active-user-transaction';
import { normalizeUploadedFilename } from './filename.util';
import { CleanupObligationService } from './cleanup-obligation.service';

const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/zip',
  'font/ttf',
  'font/otf',
  'font/woff',
  'font/woff2',
  'application/octet-stream',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain',
];

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const FILE_PURGE_LEASE_MS = 2 * 60 * 1000;
type FileEligibility = SQL<unknown>;
type FilePurgeResult = 'deleted' | 'in-progress' | 'missing';
type FilePurgeClaim = {
  id: string;
  storageKey: string;
  purgeStartedAt: Date;
};

export type CleanupSummary = {
  scanned: number;
  deleted: number;
  failed: number;
  deletedFileIds: string[];
  failedFileIds: string[];
};

function normalizeFileRecord(file: File): File {
  return {
    ...file,
    filename: normalizeUploadedFilename(file.filename),
  };
}

function requireFileEligibility(
  eligibility: SQL<unknown> | undefined
): FileEligibility {
  if (!eligibility) throw new Error('File purge eligibility is required');
  return eligibility;
}

export interface UploadMeta {
  filename: string;
  mimeType: string;
  size: number;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly minioService: MinioService,
    @InjectQueue('cleanup-queue') private readonly cleanupQueue: Queue,
    private readonly cleanupObligationService: CleanupObligationService
  ) {}

  async upload(
    file: Buffer,
    meta: UploadMeta,
    user: Pick<User, 'id' | 'plan' | 'role'> | null
  ): Promise<File> {
    let entitlementUser:
      | (Pick<User, 'id' | 'plan' | 'role'> & EntitlementUser)
      | null = user ?? null;

    if (entitlementUser) {
      entitlementUser = {
        ...entitlementUser,
        userId: entitlementUser.id,
      };
    }

    // 验证文件类型
    if (!this.isAllowedMimeType(meta.mimeType)) {
      throw new BadRequestException({
        code: ErrorCodes.INVALID_FILE_TYPE,
        message: `File type ${meta.mimeType} is not allowed`,
      });
    }

    // 验证文件大小
    const maxSize = getLimit(entitlementUser, 'upload.maxFileSize');
    if (meta.size > maxSize) {
      throw new BadRequestException({
        code: ErrorCodes.FILE_TOO_LARGE,
        message: `File size exceeds limit of ${maxSize / 1024 / 1024}MB`,
      });
    }

    const fileId = globalThis.crypto.randomUUID();
    const prefix = entitlementUser?.id ?? 'anonymous';
    const storageKey = `${prefix}/${fileId}/${meta.filename}`;

    await this.cleanupObligationService.recordObject(fileId, storageKey);

    // 上传到 MinIO
    try {
      await this.minioService.upload(storageKey, file, meta.mimeType);
    } catch (error) {
      await this.releaseObjectProduction(fileId);
      throw error;
    }

    // 计算过期时间（匿名用户 24 小时）
    const expiresAt = entitlementUser?.id
      ? null
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

    // 写入数据库
    const newFileValues: NewFile = {
      id: fileId,
      userId: entitlementUser?.id ?? null,
      filename: meta.filename,
      originalSize: meta.size,
      storageKey,
      mimeType: meta.mimeType,
      expiresAt,
    };

    let newFile: File;
    try {
      newFile = entitlementUser
        ? await withActiveUserTransaction(entitlementUser.id, tx =>
            this.insertUploadedFile(tx, newFileValues)
          )
        : await withProducerTransaction(tx =>
            this.insertUploadedFile(tx, newFileValues)
          );
    } catch (error) {
      await this.releaseObjectProduction(fileId);
      throw error;
    }

    this.logger.log(
      `Uploaded file ${newFile.id} by user ${entitlementUser?.id ?? 'anonymous'}`
    );
    return normalizeFileRecord(newFile);
  }

  private async insertUploadedFile(
    database: ActiveUserTransaction,
    values: NewFile
  ): Promise<File> {
    const ownsProduction =
      await this.cleanupObligationService.lockObjectProducer(
        database,
        values.id!
      );
    if (!ownsProduction) {
      throw new Error('Object production was claimed for cleanup');
    }

    const [newFile] = await database.insert(files).values(values).returning();
    if (!newFile) throw new Error('Failed to create file record');
    await this.cleanupObligationService.clearObjectInTransaction(
      database,
      values.id!
    );
    return newFile;
  }

  private async releaseObjectProduction(fileId: string): Promise<void> {
    try {
      await this.cleanupObligationService.releaseObject(fileId);
    } catch {
      this.logger.error(
        `Failed to release object cleanup obligation for file ${fileId}`
      );
    }
  }

  async getById(
    id: string,
    userId?: string | null,
    transaction?: Pick<ActiveUserTransaction, 'select'>
  ): Promise<File> {
    const file = transaction
      ? (
          await transaction
            .select()
            .from(files)
            .where(and(eq(files.id, id), isNull(files.purgeStartedAt)))
            .limit(1)
        )[0]
      : await db.query.files.findFirst({
          where: and(eq(files.id, id), isNull(files.purgeStartedAt)),
        });

    if (!file) {
      throw new NotFoundException({
        code: ErrorCodes.TASK_NOT_FOUND,
        message: 'File not found',
      });
    }

    // 检查权限
    if (file.userId && (!userId || file.userId !== userId)) {
      throw new ForbiddenException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Access denied',
      });
    }

    // 检查是否过期
    if (file.expiresAt && new Date() > file.expiresAt) {
      throw new NotFoundException({
        code: ErrorCodes.FILE_TOO_LARGE,
        message: 'File has expired',
      });
    }

    return normalizeFileRecord(file);
  }

  async download(storageKey: string): Promise<Buffer> {
    return this.minioService.download(storageKey);
  }

  async getSignedUrl(id: string, userId?: string): Promise<string> {
    const file = await this.getById(id, userId);
    return this.minioService.getSignedDownloadUrl(file.storageKey);
  }

  async listByUser(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      mimeType?: string;
      search?: string;
    } = {}
  ): Promise<{ files: File[]; total: number }> {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [
      eq(files.userId, userId),
      isNull(files.deletedAt),
      isNull(files.purgeStartedAt),
    ];
    if (options.mimeType) {
      conditions.push(like(files.mimeType, `${options.mimeType}%`));
    }
    if (options.search) {
      conditions.push(like(files.filename, `%${options.search}%`));
    }

    const where = and(...conditions);

    const [fileList, countResult] = await Promise.all([
      db
        .select()
        .from(files)
        .where(where)
        .orderBy(desc(files.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(files)
        .where(where),
    ]);

    return {
      files: fileList.map(normalizeFileRecord),
      total: countResult[0]?.count ?? 0,
    };
  }

  async softDelete(id: string, userId: string): Promise<void> {
    await this.getById(id, userId);

    await db
      .update(files)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(files.id, id),
          eq(files.userId, userId),
          isNull(files.purgeStartedAt)
        )
      );

    this.logger.log(`Soft deleted file ${id}`);
  }

  async batchSoftDelete(ids: string[], userId: string): Promise<void> {
    const userFiles = await db
      .select()
      .from(files)
      .where(
        and(
          inArray(files.id, ids),
          eq(files.userId, userId),
          isNull(files.purgeStartedAt)
        )
      );

    if (userFiles.length === 0) return;

    const validIds = userFiles.map(f => f.id);
    await db
      .update(files)
      .set({ deletedAt: new Date() })
      .where(
        and(
          inArray(files.id, validIds),
          eq(files.userId, userId),
          isNull(files.purgeStartedAt)
        )
      );

    this.logger.log(`Batch soft deleted ${validIds.length} files`);
  }

  async batchRestore(ids: string[], userId: string): Promise<void> {
    if (ids.length === 0) return;

    const restored = await db
      .update(files)
      .set({ deletedAt: null })
      .where(
        and(
          inArray(files.id, ids),
          eq(files.userId, userId),
          isNotNull(files.deletedAt),
          isNull(files.purgeStartedAt)
        )
      )
      .returning({ id: files.id });

    this.logger.log(`Batch restored ${restored.length} files`);
  }

  async restore(id: string, userId: string): Promise<void> {
    const restored = await db
      .update(files)
      .set({ deletedAt: null })
      .where(this.userRestorableFileEligibility(id, userId))
      .returning({ id: files.id });

    if (restored.length === 0) {
      throw new NotFoundException({
        code: ErrorCodes.TASK_NOT_FOUND,
        message: 'File not found',
      });
    }

    this.logger.log(`Restored file ${id}`);
  }

  async listTrashed(
    userId: string,
    options: { page?: number; limit?: number } = {}
  ): Promise<{ files: File[]; total: number }> {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = (page - 1) * limit;

    const where = and(
      eq(files.userId, userId),
      isNotNull(files.deletedAt),
      isNull(files.purgeStartedAt)
    );

    const [fileList, countResult] = await Promise.all([
      db
        .select()
        .from(files)
        .where(where)
        .orderBy(desc(files.deletedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(files)
        .where(where),
    ]);

    return {
      files: fileList.map(normalizeFileRecord),
      total: countResult[0]?.count ?? 0,
    };
  }

  async permanentDelete(id: string, userId: string): Promise<void> {
    const result = await this.permanentlyDeleteEligibleFile(
      this.userTrashedFileEligibility(id, userId)
    );
    if (result === 'missing') {
      throw new NotFoundException({
        code: ErrorCodes.TASK_NOT_FOUND,
        message: 'File not found in trash',
      });
    }
    if (result === 'in-progress') {
      throw new ServiceUnavailableException('File deletion is in progress');
    }
    if (result === 'deleted') {
      this.logger.log(`Permanently deleted file ${id}`);
    }
  }

  async batchPermanentDelete(ids: string[], userId: string): Promise<void> {
    const userFiles = await db
      .select()
      .from(files)
      .where(
        and(
          inArray(files.id, ids),
          eq(files.userId, userId),
          isNotNull(files.deletedAt)
        )
      );

    if (userFiles.length === 0) return;

    let deleted = 0;
    let incomplete = false;
    for (const file of userFiles) {
      const result = await this.permanentlyDeleteEligibleFile(
        this.userTrashedFileEligibility(file.id, userId)
      );
      if (result === 'deleted') {
        deleted += 1;
      } else if (result === 'in-progress') {
        incomplete = true;
      }
    }

    this.logger.log(`Batch permanently deleted ${deleted} files`);
    if (incomplete) {
      throw new ServiceUnavailableException('File deletion is incomplete');
    }
  }

  async emptyTrash(userId: string): Promise<void> {
    const userFiles = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), isNotNull(files.deletedAt)));

    if (userFiles.length === 0) return;

    let deleted = 0;
    let incomplete = false;
    for (const file of userFiles) {
      const result = await this.permanentlyDeleteEligibleFile(
        this.userTrashedFileEligibility(file.id, userId)
      );
      if (result === 'deleted') {
        deleted += 1;
      } else if (result === 'in-progress') {
        incomplete = true;
      }
    }

    this.logger.log(`Emptied trash for user ${userId}: ${deleted} files`);
    if (incomplete) {
      throw new ServiceUnavailableException('File deletion is incomplete');
    }
  }

  async cleanupExpired(now = new Date()): Promise<CleanupSummary> {
    const expiredFiles = await db
      .select()
      .from(files)
      .where(
        and(
          isNull(files.userId),
          isNull(files.deletedAt),
          isNotNull(files.expiresAt),
          lte(files.expiresAt, now)
        )
      );

    return this.cleanupRecords(expiredFiles, file =>
      requireFileEligibility(
        and(
          eq(files.id, file.id),
          isNull(files.userId),
          isNull(files.deletedAt),
          isNotNull(files.expiresAt),
          lte(files.expiresAt, now)
        )
      )
    );
  }

  async cleanupTrashed(now = new Date()): Promise<CleanupSummary> {
    const cutoff = new Date(now.getTime() - TRASH_RETENTION_MS);
    const trashedFiles = await db
      .select()
      .from(files)
      .where(
        and(
          isNotNull(files.deletedAt),
          or(lte(files.deletedAt, cutoff), isNotNull(files.purgeStartedAt))
        )
      );

    return this.cleanupRecords(trashedFiles, file =>
      requireFileEligibility(
        and(
          eq(files.id, file.id),
          isNotNull(files.deletedAt),
          or(lte(files.deletedAt, cutoff), isNotNull(files.purgeStartedAt))
        )
      )
    );
  }

  private async cleanupRecords(
    records: File[],
    eligibilityFor: (file: File) => FileEligibility
  ): Promise<CleanupSummary> {
    const deletedFileIds: string[] = [];
    const failedFileIds: string[] = [];

    for (const file of records) {
      try {
        const result = await this.permanentlyDeleteEligibleFile(
          eligibilityFor(file)
        );
        if (result === 'deleted') {
          deletedFileIds.push(file.id);
        }
      } catch (error) {
        failedFileIds.push(file.id);
        this.logger.error(
          `Failed to clean up file ${file.id}`,
          error instanceof Error ? error.stack : undefined
        );
      }
    }

    return {
      scanned: records.length,
      deleted: deletedFileIds.length,
      failed: failedFileIds.length,
      deletedFileIds,
      failedFileIds,
    };
  }

  private userTrashedFileEligibility(
    id: string,
    userId: string
  ): FileEligibility {
    return requireFileEligibility(
      and(
        eq(files.id, id),
        eq(files.userId, userId),
        isNotNull(files.deletedAt)
      )
    );
  }

  private userRestorableFileEligibility(
    id: string,
    userId: string
  ): FileEligibility {
    return requireFileEligibility(
      and(
        eq(files.id, id),
        eq(files.userId, userId),
        isNotNull(files.deletedAt),
        isNull(files.purgeStartedAt)
      )
    );
  }

  private async permanentlyDeleteEligibleFile(
    eligibility: FileEligibility
  ): Promise<FilePurgeResult> {
    const claim = await withProducerTransaction(async tx => {
      const [current] = await tx
        .select()
        .from(files)
        .where(eligibility)
        .limit(1)
        .for('update');

      if (!current) return null;

      const [claimed] = await tx
        .update(files)
        .set({
          purgeStartedAt: sql`date_trunc('milliseconds', clock_timestamp())`,
        })
        .where(
          and(
            eq(files.id, current.id),
            or(
              isNull(files.purgeStartedAt),
              lte(
                files.purgeStartedAt,
                sql`now() - (${FILE_PURGE_LEASE_MS} * interval '1 millisecond')`
              )
            )
          )
        )
        .returning({
          id: files.id,
          storageKey: files.storageKey,
          purgeStartedAt: files.purgeStartedAt,
        });

      return claimed?.purgeStartedAt ? (claimed as FilePurgeClaim) : undefined;
    });

    if (claim === null) return 'missing';
    if (!claim) return 'in-progress';

    try {
      await this.minioService.delete(claim.storageKey);
    } catch (error) {
      let objectExists: boolean;
      try {
        objectExists = await this.minioService.probeObjectExists(
          claim.storageKey
        );
      } catch {
        throw error;
      }

      if (objectExists) {
        await db
          .update(files)
          .set({ purgeStartedAt: null })
          .where(this.filePurgeClaimEligibility(claim));
        throw error;
      }
    }

    const deleted = await withProducerTransaction(tx =>
      tx
        .delete(files)
        .where(this.filePurgeClaimEligibility(claim))
        .returning({ id: files.id })
    );
    return deleted.length === 1 ? 'deleted' : 'in-progress';
  }

  private filePurgeClaimEligibility(claim: FilePurgeClaim): FileEligibility {
    return requireFileEligibility(
      and(
        eq(files.id, claim.id),
        eq(files.purgeStartedAt, claim.purgeStartedAt)
      )
    );
  }

  private isAllowedMimeType(mimeType: string): boolean {
    // 检查精确匹配或 image/* 等通配符
    if (ALLOWED_MIME_TYPES.includes(mimeType)) {
      return true;
    }
    // 处理通配符
    const prefix = mimeType.split('/')[0];
    const wildcardTypes = ALLOWED_MIME_TYPES.filter(t => t.endsWith('/*'));
    return wildcardTypes.some(t => t.startsWith(`${prefix}/`));
  }
}
