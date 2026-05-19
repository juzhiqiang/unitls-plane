import { z } from 'zod';
export declare const taskQuerySchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
    status: z.ZodOptional<z.ZodEnum<["pending", "processing", "completed", "failed"]>>;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
    status?: "pending" | "processing" | "completed" | "failed" | undefined;
}, {
    status?: "pending" | "processing" | "completed" | "failed" | undefined;
    page?: number | undefined;
    limit?: number | undefined;
}>;
export type TaskQueryInput = z.infer<typeof taskQuerySchema>;
export declare class CreateTaskDto {
    type: 'compress' | 'convert' | 'pdf_merge' | 'pdf_split' | 'font_convert';
    inputFileIds: string[];
    inputConfig?: Record<string, unknown>;
}
export declare class TaskQueryDto {
    page?: number;
    limit?: number;
    status?: 'pending' | 'processing' | 'completed' | 'failed';
}
export declare class TaskResponseDto {
    id: string;
    userId?: string;
    type: string;
    status: string;
    inputFileIds: string[];
    inputConfig?: Record<string, unknown>;
    outputFileId?: string;
    progress: number;
    errorCode?: string;
    errorMessage?: string;
    createdAt: Date;
    completedAt?: Date;
}
export declare class TaskStatusDto {
    status: string;
    progress: number;
    errorCode?: string;
    errorMessage?: string;
}
//# sourceMappingURL=tasks.dto.d.ts.map