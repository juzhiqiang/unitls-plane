import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MINIO_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;
export const MINIO_DELETE_TIMEOUT_MS = 30 * 1000;
export const MINIO_MULTIPART_PART_SIZE = 8 * 1024 * 1024;
export const MINIO_MULTIPART_QUEUE_SIZE = 2;

export type MinioUploadMode = 'auto' | 'multipart' | 'buffer';
export type MinioRuntime = 'node' | 'bun';
export type ResolvedMinioUploadMode = Exclude<MinioUploadMode, 'auto'>;

export function resolveMinioUploadMode(
  rawMode: string | undefined,
  runtime: MinioRuntime
): ResolvedMinioUploadMode {
  const mode = (rawMode?.trim().toLowerCase() || 'auto') as MinioUploadMode;
  if (mode !== 'auto' && mode !== 'multipart' && mode !== 'buffer') {
    throw new Error(
      `Invalid MINIO_UPLOAD_MODE "${rawMode}". Expected auto, multipart, or buffer.`
    );
  }
  if (mode === 'multipart' && runtime === 'bun') {
    throw new Error(
      'MINIO_UPLOAD_MODE=multipart is not supported in Bun; use auto or buffer.'
    );
  }
  if (mode === 'auto') return runtime === 'bun' ? 'buffer' : 'multipart';
  return mode;
}

function currentRuntime(): MinioRuntime {
  return process.versions.bun ? 'bun' : 'node';
}

function withUploadTimeout(signal?: globalThis.AbortSignal) {
  const timeoutSignal = globalThis.AbortSignal.timeout(MINIO_UPLOAD_TIMEOUT_MS);
  return signal
    ? globalThis.AbortSignal.any([timeoutSignal, signal])
    : timeoutSignal;
}

function assertDeclaredSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(`Invalid upload size: ${size}`);
  }
}

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client: S3Client;
  private bucket = process.env.S3_BUCKET ?? 'uploads';
  private readonly uploadMode: ResolvedMinioUploadMode;

  constructor() {
    this.uploadMode = resolveMinioUploadMode(
      process.env.MINIO_UPLOAD_MODE,
      currentRuntime()
    );
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
    const abortSignal = withUploadTimeout();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mimeType,
      }),
      { abortSignal }
    );
    this.logger.debug(`Uploaded ${key} to ${this.bucket}`);
  }

  async uploadStream(
    key: string,
    source: Readable,
    size: number,
    mimeType: string,
    signal?: globalThis.AbortSignal
  ): Promise<void> {
    assertDeclaredSize(size);
    const mode = this.uploadMode;
    const startedAt = Date.now();
    let bytes = 0;

    try {
      bytes =
        mode === 'multipart'
          ? await this.uploadMultipart(key, source, size, mimeType, signal)
          : await this.uploadBuffered(key, source, size, mimeType, signal);
      this.logger.debug(
        `Uploaded key=${key} mode=${mode} bytes=${bytes} durationMs=${Date.now() - startedAt}`
      );
    } catch (error) {
      this.logger.warn(
        `Upload failed key=${key} mode=${mode} bytes=${bytes} durationMs=${Date.now() - startedAt}`
      );
      throw error;
    }
  }

  private async uploadBuffered(
    key: string,
    source: Readable,
    size: number,
    mimeType: string,
    signal?: globalThis.AbortSignal
  ): Promise<number> {
    // Bun 运行时下 SDK 对 Node Readable Body 的流式 PUT 会死锁(约 30 秒后 SDK 内部
    // 锁等待超时抛 "RequestTimeout: A timeout occurred while trying to lock a resource",
    // 与数据库无关;Node 下正常)。auto 模式因此只在 Bun 保留这条兼容路径。
    const abortSignal = withUploadTimeout(signal);
    abortSignal.throwIfAborted();
    const chunks: Buffer[] = [];
    for await (const chunk of source) {
      abortSignal.throwIfAborted();
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
      );
    }
    const body = Buffer.concat(chunks);
    if (body.length !== size) {
      throw new Error(
        `Upload stream produced ${body.length} bytes, expected ${size}`
      );
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentLength: size,
        ContentType: mimeType,
      }),
      { abortSignal }
    );
    return body.length;
  }

  private async uploadMultipart(
    key: string,
    source: Readable,
    size: number,
    mimeType: string,
    signal?: globalThis.AbortSignal
  ): Promise<number> {
    const abortSignal = withUploadTimeout(signal);
    const uploadAbortController = new globalThis.AbortController();
    const abortUpload = () => uploadAbortController.abort();
    abortSignal.addEventListener('abort', abortUpload, { once: true });
    if (abortSignal.aborted) abortUpload();

    let bytes = 0;
    const lengthGuard = new Transform({
      transform(chunk, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as Uint8Array);
        bytes += buffer.length;
        if (bytes > size) {
          callback(new Error(`Upload stream produced more than ${size} bytes`));
          return;
        }
        callback(null, buffer);
      },
      flush(callback) {
        if (bytes !== size) {
          callback(
            new Error(`Upload stream produced ${bytes} bytes, expected ${size}`)
          );
          return;
        }
        callback();
      },
    });
    const onSourceError = (error: Error) => {
      lengthGuard.destroy(error);
    };
    // @aws-sdk/lib-storage observes the guarded stream asynchronously. Keep an
    // immediate error listener so an early source failure is not reported as an
    // unhandled stream error before Upload.done() attaches its iterator.
    const absorbGuardError = () => undefined;
    source.once('error', onSourceError);
    lengthGuard.once('error', absorbGuardError);
    source.pipe(lengthGuard);

    let upload: Upload | undefined;
    try {
      upload = this.createMultipartUpload({
        client: this.client,
        params: {
          Bucket: this.bucket,
          Key: key,
          Body: lengthGuard,
          ContentLength: size,
          ContentType: mimeType,
        },
        partSize: MINIO_MULTIPART_PART_SIZE,
        queueSize: MINIO_MULTIPART_QUEUE_SIZE,
        leavePartsOnError: false,
        abortController: uploadAbortController,
      });
      if (abortSignal.aborted) abortUpload();
      await upload.done();
      if (bytes !== size) {
        throw new Error(
          `Upload stream produced ${bytes} bytes, expected ${size}`
        );
      }
      return bytes;
    } catch (error) {
      if (upload) {
        try {
          await upload.abort();
        } catch (abortError) {
          this.logger.warn(
            `Multipart abort failed key=${key}: ${
              abortError instanceof Error ? abortError.message : 'unknown'
            }`
          );
        }
      }
      throw error;
    } finally {
      abortSignal.removeEventListener('abort', abortUpload);
      source.off('error', onSourceError);
      lengthGuard.off('error', absorbGuardError);
      source.destroy();
      lengthGuard.destroy();
    }
  }

  private createMultipartUpload(
    options: ConstructorParameters<typeof Upload>[0]
  ): Upload {
    return new Upload(options);
  }

  async downloadToFile(
    key: string,
    destPath: string,
    signal?: globalThis.AbortSignal
  ): Promise<void> {
    const temporaryPath = `${destPath}.part-${randomUUID()}`;
    let body: Readable | undefined;

    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
        { abortSignal: signal }
      );
      if (!response.Body) throw new Error('Object body is empty');
      body = response.Body as Readable;

      const writeStream = createWriteStream(temporaryPath, {
        flags: 'wx',
        mode: 0o600,
      });
      if (signal) {
        await pipeline(body, writeStream, { signal });
      } else {
        await pipeline(body, writeStream);
      }

      signal?.throwIfAborted();
      const fileStats = await stat(temporaryPath);
      if (
        response.ContentLength !== undefined &&
        fileStats.size !== response.ContentLength
      ) {
        throw new Error(
          `Downloaded ${fileStats.size} bytes, expected ${response.ContentLength}`
        );
      }
      await rename(temporaryPath, destPath);
    } finally {
      body?.destroy();
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
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

  async head(key: string, signal?: globalThis.AbortSignal): Promise<void> {
    await this.client.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      { abortSignal: signal }
    );
  }

  async checkBucket(signal?: globalThis.AbortSignal): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
      abortSignal: signal,
    });
  }

  async downloadStream(
    key: string,
    signal?: globalThis.AbortSignal
  ): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      { abortSignal: signal }
    );
    if (!response.Body) throw new Error('Object body is empty');
    return response.Body as Readable;
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
    const abortSignal = globalThis.AbortSignal.timeout(MINIO_DELETE_TIMEOUT_MS);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      { abortSignal }
    );
  }

  async probeObjectExists(key: string): Promise<boolean> {
    const abortSignal = globalThis.AbortSignal.timeout(MINIO_DELETE_TIMEOUT_MS);
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
        { abortSignal }
      );
      return true;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        '$metadata' in error &&
        typeof error.$metadata === 'object' &&
        error.$metadata !== null &&
        'httpStatusCode' in error.$metadata &&
        error.$metadata.httpStatusCode === 404
      ) {
        return false;
      }
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.head(key);
      return true;
    } catch {
      return false;
    }
  }
}
