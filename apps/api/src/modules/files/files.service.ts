import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  eq,
  desc,
  and,
  isNull,
  isNotNull,
  gte,
  like,
  inArray,
  sql,
} from 'drizzle-orm';
import { db, files, type File, type User } from '@utils-plane/db';
import { getLimit, type EntitlementUser } from '@utils-plane/utils';
import { MinioService } from './minio.service';
import { ErrorCodes } from '../../common/errors/error-codes';
import { normalizeUploadedFilename } from './filename.util';

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

function normalizeFileRecord(file: File): File {
  return {
    ...file,
    filename: normalizeUploadedFilename(file.filename),
  };
}

export interface UploadMeta {
  filename: string;
  mimeType: string;
  size: number;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(private readonly minioService: MinioService) {}

  async upload(
    file: Buffer,
    meta: UploadMeta,
    user?: Pick<User, 'id' | 'plan' | 'role'> | null
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

    // 上传到 MinIO
    await this.minioService.upload(storageKey, file, meta.mimeType);

    // 计算过期时间（匿名用户 24 小时）
    const expiresAt = entitlementUser?.id
      ? null
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

    // 写入数据库
    const [newFile] = await db
      .insert(files)
      .values({
        userId: entitlementUser?.id ?? null,
        filename: meta.filename,
        originalSize: meta.size,
        storageKey,
        mimeType: meta.mimeType,
        expiresAt,
      })
      .returning();

    if (!newFile) {
      throw new Error('Failed to create file record');
    }

    this.logger.log(
      `Uploaded file ${newFile.id} by user ${entitlementUser?.id ?? 'anonymous'}`
    );
    return normalizeFileRecord(newFile);
  }

  async getById(id: string, userId?: string): Promise<File> {
    const file = await db.query.files.findFirst({
      where: eq(files.id, id),
    });

    if (!file) {
      throw new NotFoundException({
        code: ErrorCodes.TASK_NOT_FOUND,
        message: 'File not found',
      });
    }

    // 检查权限
    if (file.userId && userId && file.userId !== userId) {
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

    const conditions = [eq(files.userId, userId), isNull(files.deletedAt)];
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
      .where(eq(files.id, id));

    this.logger.log(`Soft deleted file ${id}`);
  }

  async batchSoftDelete(ids: string[], userId: string): Promise<void> {
    const userFiles = await db
      .select()
      .from(files)
      .where(and(inArray(files.id, ids), eq(files.userId, userId)));

    if (userFiles.length === 0) return;

    const validIds = userFiles.map(f => f.id);
    await db
      .update(files)
      .set({ deletedAt: new Date() })
      .where(inArray(files.id, validIds));

    this.logger.log(`Batch soft deleted ${validIds.length} files`);
  }

  async batchRestore(ids: string[], userId: string): Promise<void> {
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

    const validIds = userFiles.map(f => f.id);
    await db
      .update(files)
      .set({ deletedAt: null })
      .where(inArray(files.id, validIds));

    this.logger.log(`Batch restored ${validIds.length} files`);
  }

  async restore(id: string, userId: string): Promise<void> {
    const file = await db.query.files.findFirst({
      where: eq(files.id, id),
    });

    if (!file) {
      throw new NotFoundException({
        code: ErrorCodes.TASK_NOT_FOUND,
        message: 'File not found',
      });
    }

    if (file.userId !== userId) {
      throw new ForbiddenException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Access denied',
      });
    }

    await db.update(files).set({ deletedAt: null }).where(eq(files.id, id));

    this.logger.log(`Restored file ${id}`);
  }

  async listTrashed(
    userId: string,
    options: { page?: number; limit?: number } = {}
  ): Promise<{ files: File[]; total: number }> {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = (page - 1) * limit;

    const where = and(eq(files.userId, userId), isNotNull(files.deletedAt));

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
    const file = await this.getDeletedFileById(id, userId);

    // 删除 MinIO 对象
    await this.minioService.delete(file.storageKey);

    // 删除数据库记录
    await db.delete(files).where(eq(files.id, id));

    this.logger.log(`Permanently deleted file ${id}`);
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

    for (const file of userFiles) {
      await this.minioService.delete(file.storageKey);
    }

    if (userFiles.length === 0) return;

    await db.delete(files).where(
      inArray(
        files.id,
        userFiles.map(f => f.id)
      )
    );

    this.logger.log(`Batch permanently deleted ${userFiles.length} files`);
  }

  async emptyTrash(userId: string): Promise<void> {
    const userFiles = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), isNotNull(files.deletedAt)));

    for (const file of userFiles) {
      await this.minioService.delete(file.storageKey);
    }

    if (userFiles.length === 0) return;

    await db
      .delete(files)
      .where(and(eq(files.userId, userId), isNotNull(files.deletedAt)));

    this.logger.log(`Emptied trash for user ${userId}`);
  }

  async cleanupExpired(): Promise<number> {
    const now = new Date();
    const expiredFiles = await db
      .select()
      .from(files)
      .where(and(isNull(files.deletedAt), gte(files.expiresAt, now)));

    for (const file of expiredFiles) {
      try {
        await this.minioService.delete(file.storageKey);
        await db
          .update(files)
          .set({ deletedAt: new Date() })
          .where(eq(files.id, file.id));
      } catch (error) {
        this.logger.error(`Failed to delete expired file ${file.id}`, error);
      }
    }

    return expiredFiles.length;
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

  private async getDeletedFileById(id: string, userId: string): Promise<File> {
    const file = await db.query.files.findFirst({
      where: and(eq(files.id, id), isNotNull(files.deletedAt)),
    });

    if (!file) {
      throw new NotFoundException({
        code: ErrorCodes.TASK_NOT_FOUND,
        message: 'File not found in trash',
      });
    }

    if (file.userId !== userId) {
      throw new ForbiddenException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Access denied',
      });
    }

    return normalizeFileRecord(file);
  }
}
