import { HeadBucketCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'bun:test';
import { Readable } from 'node:stream';
import { MINIO_UPLOAD_TIMEOUT_MS, MinioService } from './minio.service';

function withClient(send: ReturnType<typeof vi.fn>) {
  const service = new MinioService();
  (service as unknown as { client: { send: typeof send } }).client = { send };
  return service;
}

describe('MinioService delete logging', () => {
  it('does not log the storage key or filename after a successful delete', async () => {
    const storageKey = 'anonymous/file-1/private-report.pdf';
    const send = vi.fn(async () => ({}));
    const service = withClient(send);
    const testableService = service as unknown as {
      client: { send: typeof send };
      logger: { debug: (...args: unknown[]) => void };
    };
    const debug = vi
      .spyOn(testableService.logger, 'debug')
      .mockImplementation(() => undefined);

    await service.delete(storageKey);

    expect(send).toHaveBeenCalledTimes(1);
    const debugOutput = debug.mock.calls.flat().map(String).join(' ');
    expect(debugOutput).not.toContain(storageKey);
    expect(debugOutput).not.toContain('private-report.pdf');
  });
});

describe('MinioService upload timeout', () => {
  it('aborts PutObject before the object cleanup lease can expire', async () => {
    const send = vi.fn(async () => ({}));
    const service = withClient(send);
    const abortSignal = new globalThis.AbortController().signal;
    const timeout = vi
      .spyOn(globalThis.AbortSignal, 'timeout')
      .mockReturnValue(abortSignal);

    await service.upload(
      'user-1/file-1/report.pdf',
      Buffer.from('contents'),
      'application/pdf'
    );

    expect(MINIO_UPLOAD_TIMEOUT_MS).toBe(30 * 60 * 1000);
    expect(MINIO_UPLOAD_TIMEOUT_MS).toBeLessThan(60 * 60 * 1000);
    expect(timeout).toHaveBeenCalledWith(MINIO_UPLOAD_TIMEOUT_MS);
    expect(send.mock.calls[0]?.[1]).toEqual({ abortSignal });
  });
});

describe('MinioService object streaming', () => {
  it('heads an object without downloading its body', async () => {
    const send = vi.fn(async () => ({}));
    const service = withClient(send);

    await service.head('user-1/file-1/report.pdf');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
  });

  it('returns the object body as a readable stream', async () => {
    const body = Readable.from(Buffer.from('contents'));
    const send = vi.fn(async () => ({ Body: body }));
    const service = withClient(send);

    await expect(
      service.downloadStream('user-1/file-1/report.pdf')
    ).resolves.toBe(body);
  });

  it('rejects a stream download with an empty object body', async () => {
    const send = vi.fn(async () => ({ Body: undefined }));
    const service = withClient(send);

    await expect(
      service.downloadStream('user-1/file-1/report.pdf')
    ).rejects.toThrow('Object body is empty');
  });

  it('checks existence with a head request', async () => {
    const send = vi.fn(async () => ({}));
    const service = withClient(send);

    await expect(service.exists('user-1/file-1/report.pdf')).resolves.toBe(
      true
    );

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
  });
});

describe('MinioService bucket health', () => {
  it('checks the configured bucket with a HeadBucketCommand', async () => {
    const previousBucket = process.env.S3_BUCKET;
    process.env.S3_BUCKET = 'health-check-bucket';

    try {
      const send = vi.fn(async () => ({}));
      const service = withClient(send);
      const signal = new globalThis.AbortController().signal;

      await service.checkBucket(signal);

      expect(send).toHaveBeenCalledTimes(1);
      const command = send.mock.calls[0]?.[0];
      expect(command).toBeInstanceOf(HeadBucketCommand);
      expect((command as HeadBucketCommand).input).toEqual({
        Bucket: 'health-check-bucket',
      });
      expect(send.mock.calls[0]?.[1]).toEqual({ abortSignal: signal });
    } finally {
      if (previousBucket === undefined) {
        delete process.env.S3_BUCKET;
      } else {
        process.env.S3_BUCKET = previousBucket;
      }
    }
  });
});
