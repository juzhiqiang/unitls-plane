var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var MinioService_1;
import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, CreateBucketCommand, } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
let MinioService = MinioService_1 = class MinioService {
    logger = new Logger(MinioService_1.name);
    client;
    bucket = process.env.S3_BUCKET ?? 'uploads';
    constructor() {
        this.client = new S3Client({
            endpoint: process.env.S3_ENDPOINT,
            region: process.env.S3_REGION ?? 'us-east-1',
            credentials: {
                accessKeyId: process.env.S3_ACCESS_KEY,
                secretAccessKey: process.env.S3_SECRET_KEY,
            },
            forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
        });
    }
    async onModuleInit() {
        try {
            await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
            this.logger.log(`Bucket ${this.bucket} already exists`);
        }
        catch {
            await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
            this.logger.log(`Created bucket ${this.bucket}`);
        }
    }
    async upload(key, body, mimeType) {
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: body,
            ContentType: mimeType,
        }));
        this.logger.debug(`Uploaded ${key} to ${this.bucket}`);
    }
    async download(key) {
        const response = await this.client.send(new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        }));
        const chunks = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body = response.Body;
        for await (const chunk of body) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }
    async getSignedDownloadUrl(key, expiresIn = 3600) {
        return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
    }
    async getSignedUploadUrl(key, expiresIn = 600) {
        return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
    }
    async delete(key) {
        await this.client.send(new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
        }));
        this.logger.debug(`Deleted ${key} from ${this.bucket}`);
    }
    async exists(key) {
        try {
            await this.client.send(new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
            }));
            return true;
        }
        catch {
            return false;
        }
    }
};
MinioService = MinioService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [])
], MinioService);
export { MinioService };
//# sourceMappingURL=minio.service.js.map