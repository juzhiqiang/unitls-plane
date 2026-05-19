var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var FilesService_1;
import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger, } from '@nestjs/common';
import { eq, desc, and, isNull, gte, sql } from 'drizzle-orm';
import { db, files } from '@utils-plane/db';
import { MinioService } from './minio.service';
import { ErrorCodes } from '../../common/errors/error-codes';
const ALLOWED_MIME_TYPES = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'font/ttf',
    'font/otf',
    'font/woff',
    'font/woff2',
    'application/octet-stream',
];
const ANONYMOUS_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const USER_MAX_SIZE = 50 * 1024 * 1024; // 50MB
let FilesService = FilesService_1 = class FilesService {
    minioService;
    logger = new Logger(FilesService_1.name);
    constructor(minioService) {
        this.minioService = minioService;
    }
    async upload(file, meta, userId) {
        // 验证文件类型
        if (!this.isAllowedMimeType(meta.mimeType)) {
            throw new BadRequestException({
                code: ErrorCodes.INVALID_FILE_TYPE,
                message: `File type ${meta.mimeType} is not allowed`,
            });
        }
        // 验证文件大小
        const maxSize = userId ? USER_MAX_SIZE : ANONYMOUS_MAX_SIZE;
        if (meta.size > maxSize) {
            throw new BadRequestException({
                code: ErrorCodes.FILE_TOO_LARGE,
                message: `File size exceeds limit of ${maxSize / 1024 / 1024}MB`,
            });
        }
        const fileId = globalThis.crypto.randomUUID();
        const prefix = userId ?? 'anonymous';
        const storageKey = `${prefix}/${fileId}/${meta.filename}`;
        // 上传到 MinIO
        await this.minioService.upload(storageKey, file, meta.mimeType);
        // 计算过期时间（匿名用户 24 小时）
        const expiresAt = userId
            ? null
            : new Date(Date.now() + 24 * 60 * 60 * 1000);
        // 写入数据库
        const [newFile] = await db
            .insert(files)
            .values({
            userId: userId ?? null,
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
        this.logger.log(`Uploaded file ${newFile.id} by user ${userId ?? 'anonymous'}`);
        return newFile;
    }
    async getById(id, userId) {
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
        return file;
    }
    async getSignedUrl(id, userId) {
        const file = await this.getById(id, userId);
        return this.minioService.getSignedDownloadUrl(file.storageKey);
    }
    async listByUser(userId, options = {}) {
        const page = options.page ?? 1;
        const limit = options.limit ?? 20;
        const offset = (page - 1) * limit;
        const where = and(eq(files.userId, userId), isNull(files.deletedAt));
        const [fileList, countResult] = await Promise.all([
            db
                .select()
                .from(files)
                .where(where)
                .orderBy(desc(files.createdAt))
                .limit(limit)
                .offset(offset),
            db
                .select({ count: sql `count(*)` })
                .from(files)
                .where(where),
        ]);
        return {
            files: fileList,
            total: countResult[0]?.count ?? 0,
        };
    }
    async softDelete(id, userId) {
        await this.getById(id, userId);
        await db
            .update(files)
            .set({ deletedAt: new Date() })
            .where(eq(files.id, id));
        this.logger.log(`Soft deleted file ${id}`);
    }
    async permanentDelete(id, userId) {
        const file = await this.getById(id, userId);
        // 删除 MinIO 对象
        await this.minioService.delete(file.storageKey);
        // 删除数据库记录
        await db.delete(files).where(eq(files.id, id));
        this.logger.log(`Permanently deleted file ${id}`);
    }
    async cleanupExpired() {
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
            }
            catch (error) {
                this.logger.error(`Failed to delete expired file ${file.id}`, error);
            }
        }
        return expiredFiles.length;
    }
    isAllowedMimeType(mimeType) {
        // 检查精确匹配或 image/* 等通配符
        if (ALLOWED_MIME_TYPES.includes(mimeType)) {
            return true;
        }
        // 处理通配符
        const prefix = mimeType.split('/')[0];
        const wildcardTypes = ALLOWED_MIME_TYPES.filter(t => t.endsWith('/*'));
        return wildcardTypes.some(t => t.startsWith(`${prefix}/`));
    }
};
FilesService = FilesService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [MinioService])
], FilesService);
export { FilesService };
//# sourceMappingURL=files.service.js.map