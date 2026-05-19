import { Queue } from 'bullmq';
import type { Task } from '@utils-plane/db';
import type { CreateTaskInput, TaskStatus } from '@utils-plane/validators';
export declare class TasksService {
    private imageQueue;
    private pdfQueue;
    private fontQueue;
    constructor(imageQueue: Queue, pdfQueue: Queue, fontQueue: Queue);
    create(input: CreateTaskInput, userId?: string): Promise<Task>;
    getById(id: string, userId?: string): Promise<Task>;
    listByUser(userId: string, query: {
        page: number;
        limit: number;
        status?: TaskStatus;
    }): Promise<{
        tasks: Task[];
        total: number;
    }>;
    updateProgress(id: string, progress: number): Promise<void>;
    markProcessing(id: string): Promise<void>;
    markCompleted(id: string, outputFileId: string): Promise<void>;
    markFailed(id: string, errorCode: string, errorMessage: string): Promise<void>;
    incrementRetry(id: string): Promise<number>;
    private getQueue;
}
//# sourceMappingURL=tasks.service.d.ts.map