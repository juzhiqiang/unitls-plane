import { type File } from '@utils-plane/db';
import { MinioService } from './minio.service';
export interface UploadMeta {
    filename: string;
    mimeType: string;
    size: number;
}
export declare class FilesService {
    private readonly minioService;
    private readonly logger;
    constructor(minioService: MinioService);
    upload(file: Buffer, meta: UploadMeta, userId?: string): Promise<File>;
    getById(id: string, userId?: string): Promise<File>;
    getSignedUrl(id: string, userId?: string): Promise<string>;
    listByUser(userId: string, options?: {
        page?: number;
        limit?: number;
    }): Promise<{
        files: File[];
        total: number;
    }>;
    softDelete(id: string, userId: string): Promise<void>;
    permanentDelete(id: string, userId: string): Promise<void>;
    cleanupExpired(): Promise<number>;
    private isAllowedMimeType;
}
//# sourceMappingURL=files.service.d.ts.map