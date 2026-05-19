import { OnModuleInit } from '@nestjs/common';
export declare class MinioService implements OnModuleInit {
    private readonly logger;
    private client;
    private bucket;
    constructor();
    onModuleInit(): Promise<void>;
    upload(key: string, body: Buffer, mimeType: string): Promise<void>;
    download(key: string): Promise<Buffer>;
    getSignedDownloadUrl(key: string, expiresIn?: number): Promise<string>;
    getSignedUploadUrl(key: string, expiresIn?: number): Promise<string>;
    delete(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
}
//# sourceMappingURL=minio.service.d.ts.map