import type { Response } from 'express';
import { FilesService } from './files.service';
import type { User } from '@utils-plane/db';
interface FileMetadata {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    destination: string;
    filename: string;
    path: string;
    buffer: Buffer;
}
export declare class FilesController {
    private readonly filesService;
    constructor(filesService: FilesService);
    upload(file: FileMetadata, user?: User): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        expiresAt: Date | null;
        userId: string | null;
        filename: string;
        originalSize: number;
        storageKey: string;
        bucket: string;
        mimeType: string;
        metadata: unknown;
        deletedAt: Date | null;
    }>;
    getOne(id: string, user?: User): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        expiresAt: Date | null;
        userId: string | null;
        filename: string;
        originalSize: number;
        storageKey: string;
        bucket: string;
        mimeType: string;
        metadata: unknown;
        deletedAt: Date | null;
    }>;
    download(id: string, user?: User, res?: Response): Promise<void | {
        url: string;
    }>;
    list(page?: string, limit?: string, user?: User): Promise<{
        files: import("@utils-plane/db").File[];
        total: number;
    }>;
    remove(id: string, user?: User): Promise<{
        success: boolean;
    }>;
}
export {};
//# sourceMappingURL=files.controller.d.ts.map