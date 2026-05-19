import { TasksService } from './tasks.service';
import { CreateTaskDto, TaskQueryDto } from './dto/tasks.dto';
import type { User } from '@utils-plane/db';
import type { Request } from 'express';
interface AuthenticatedRequest extends Request {
    user?: User;
}
export declare class TasksController {
    private readonly tasksService;
    constructor(tasksService: TasksService);
    create(dto: CreateTaskDto, req: AuthenticatedRequest): Promise<{
        type: "compress" | "convert" | "pdf_merge" | "pdf_split" | "font_convert";
        errorMessage: string | null;
        id: string;
        createdAt: Date;
        userId: string | null;
        status: "pending" | "processing" | "completed" | "failed";
        inputFileIds: string[] | null;
        inputConfig: unknown;
        outputFileId: string | null;
        progress: number | null;
        errorCode: string | null;
        retryCount: number | null;
        completedAt: Date | null;
    }>;
    getOne(id: string, req: AuthenticatedRequest): Promise<{
        type: "compress" | "convert" | "pdf_merge" | "pdf_split" | "font_convert";
        errorMessage: string | null;
        id: string;
        createdAt: Date;
        userId: string | null;
        status: "pending" | "processing" | "completed" | "failed";
        inputFileIds: string[] | null;
        inputConfig: unknown;
        outputFileId: string | null;
        progress: number | null;
        errorCode: string | null;
        retryCount: number | null;
        completedAt: Date | null;
    }>;
    getStatus(id: string): Promise<{
        status: "pending" | "processing" | "completed" | "failed";
        progress: number | null;
        errorCode: string | null;
        errorMessage: string | null;
    }>;
    list(query: TaskQueryDto, req: AuthenticatedRequest): Promise<{
        tasks: import("@utils-plane/db").Task[];
        total: number;
    }>;
}
export {};
//# sourceMappingURL=tasks.controller.d.ts.map