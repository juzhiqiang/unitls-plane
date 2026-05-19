var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Injectable, NotFoundException, ForbiddenException, } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { db, tasks } from '@utils-plane/db';
import { eq, desc, and, sql } from 'drizzle-orm';
import { ErrorCodes } from '../../common/errors/error-codes';
let TasksService = class TasksService {
    imageQueue;
    pdfQueue;
    fontQueue;
    constructor(imageQueue, pdfQueue, fontQueue) {
        this.imageQueue = imageQueue;
        this.pdfQueue = pdfQueue;
        this.fontQueue = fontQueue;
    }
    async create(input, userId) {
        const [task] = await db
            .insert(tasks)
            .values({
            userId: userId ?? null,
            type: input.type,
            status: 'pending',
            inputFileIds: input.inputFileIds,
            inputConfig: input.inputConfig ?? {},
        })
            .returning();
        if (!task) {
            throw new Error('Failed to create task');
        }
        const queue = this.getQueue(input.type);
        await queue.add(input.type, { taskId: task.id }, { jobId: task.id });
        return task;
    }
    async getById(id, userId) {
        const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
        if (!task) {
            throw new NotFoundException({
                code: ErrorCodes.TASK_NOT_FOUND,
                message: 'Task not found',
            });
        }
        if (userId && task.userId && task.userId !== userId) {
            throw new ForbiddenException({
                code: ErrorCodes.UNAUTHORIZED,
                message: 'Access denied',
            });
        }
        return task;
    }
    async listByUser(userId, query) {
        const offset = (query.page - 1) * query.limit;
        const conditions = [eq(tasks.userId, userId)];
        if (query.status) {
            conditions.push(eq(tasks.status, query.status));
        }
        const [tasksList, countResult] = await Promise.all([
            db
                .select()
                .from(tasks)
                .where(and(...conditions))
                .orderBy(desc(tasks.createdAt))
                .limit(query.limit)
                .offset(offset),
            db
                .select({ count: sql `count(*)::int` })
                .from(tasks)
                .where(and(...conditions)),
        ]);
        return {
            tasks: tasksList,
            total: countResult[0]?.count ?? 0,
        };
    }
    async updateProgress(id, progress) {
        await db
            .update(tasks)
            .set({ progress: Math.min(100, Math.max(0, progress)) })
            .where(eq(tasks.id, id));
    }
    async markProcessing(id) {
        await db
            .update(tasks)
            .set({ status: 'processing' })
            .where(eq(tasks.id, id));
    }
    async markCompleted(id, outputFileId) {
        await db
            .update(tasks)
            .set({
            status: 'completed',
            outputFileId: outputFileId,
            progress: 100,
            completedAt: new Date(),
        })
            .where(eq(tasks.id, id));
    }
    async markFailed(id, errorCode, errorMessage) {
        await db
            .update(tasks)
            .set({
            status: 'failed',
            errorCode,
            errorMessage,
        })
            .where(eq(tasks.id, id));
    }
    async incrementRetry(id) {
        const [task] = await db
            .update(tasks)
            .set({
            retryCount: sql `${tasks.retryCount} + 1`,
        })
            .where(eq(tasks.id, id))
            .returning();
        return task?.retryCount ?? 0;
    }
    getQueue(type) {
        switch (type) {
            case 'compress':
            case 'convert':
                return this.imageQueue;
            case 'pdf_merge':
            case 'pdf_split':
                return this.pdfQueue;
            case 'font_convert':
                return this.fontQueue;
        }
    }
};
TasksService = __decorate([
    Injectable(),
    __param(0, InjectQueue('image-queue')),
    __param(1, InjectQueue('pdf-queue')),
    __param(2, InjectQueue('font-queue')),
    __metadata("design:paramtypes", [Queue,
        Queue,
        Queue])
], TasksService);
export { TasksService };
//# sourceMappingURL=tasks.service.js.map