import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client: S3Client;
  private bucket = process.env.S3_BUCKET ?? 'uploads';

  constructor() {
    const accessKey = process.env.S3_ACCESS_KEY;
    const secretKey = process.env.S3_SECRET_KEY;
    const endpoint = process.env.S3_ENDPOINT;

    this.logger.log(
      `S3_CONFIG: endpoint=${endpoint}, accessKey=${accessKey ? 'set' : 'NOT SET'}, secretKey=${secretKey ? 'set' : 'NOT SET'}`
    );

    this.client = new S3Client({
      endpoint: endpoint,
      region: process.env.S3_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: accessKey || 'minioadmin',
        secretAccessKey: secretKey || 'minioadmin',
      },
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    });
  }

  async onModuleInit() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Bucket ${this.bucket} already exists`);
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created bucket ${this.bucket}`);
    }
  }

  async upload(key: string, body: Buffer, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mimeType,
      })
    );
    this.logger.debug(`Uploaded ${key} to ${this.bucket}`);
  }

  async download(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
    const chunks: Uint8Array[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = response.Body;
    for await (const chunk of body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn }
    );
  }

  async getSignedUploadUrl(key: string, expiresIn = 600): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn }
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
    this.logger.debug(`Deleted ${key} from ${this.bucket}`);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }
}
