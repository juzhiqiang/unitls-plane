import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import {
  MINIO_DELETE_TIMEOUT_MS,
  MINIO_MULTIPART_PART_SIZE,
  MINIO_MULTIPART_QUEUE_SIZE,
  MINIO_UPLOAD_TIMEOUT_MS,
  MinioService,
  resolveMinioUploadMode,
} from '../../../src/modules/files/minio.service';

function withClient(
  send: ReturnType<typeof vi.fn>,
  uploadMode: 'buffer' | 'multipart' = 'buffer'
) {
  const service = new MinioService();
  (service as unknown as { client: { send: typeof send } }).client = { send };
  (service as unknown as { uploadMode: string }).uploadMode = uploadMode;
  return service;
}

describe('MINIO_UPLOAD_MODE', () => {
  it('uses multipart on Node and Buffer on Bun in auto mode', () => {
    expect(resolveMinioUploadMode(undefined, 'node')).toBe('multipart');
    expect(resolveMinioUploadMode('auto', 'node')).toBe('multipart');
    expect(resolveMinioUploadMode(undefined, 'bun')).toBe('buffer');
    expect(resolveMinioUploadMode('auto', 'bun')).toBe('buffer');
  });

  it('honours forced buffer and multipart modes', () => {
    expect(resolveMinioUploadMode('buffer', 'node')).toBe('buffer');
    expect(resolveMinioUploadMode('buffer', 'bun')).toBe('buffer');
    expect(resolveMinioUploadMode('multipart', 'node')).toBe('multipart');
  });

  it('rejects invalid values and forced multipart on Bun', () => {
    expect(() => resolveMinioUploadMode('stream', 'node')).toThrow(
      'MINIO_UPLOAD_MODE'
    );
    expect(() => resolveMinioUploadMode('multipart', 'bun')).toThrow('Bun');
  });
});
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

  it('aborts DeleteObject before an open file transaction can idle out', async () => {
    const send = vi.fn(async () => ({}));
    const service = withClient(send);
    const abortSignal = new globalThis.AbortController().signal;
    const timeout = vi
      .spyOn(globalThis.AbortSignal, 'timeout')
      .mockReturnValue(abortSignal);

    await service.delete('anonymous/file-1/private-report.pdf');

    expect(MINIO_DELETE_TIMEOUT_MS).toBe(30 * 1000);
    expect(timeout).toHaveBeenCalledWith(MINIO_DELETE_TIMEOUT_MS);
    expect(send.mock.calls[0]?.[1]).toEqual({ abortSignal });
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

describe('MinioService streamed upload', () => {
  it('passes a readable body and exact content length to S3', async () => {
    const send = vi.fn(async () => ({}));
    const service = withClient(send);
    const source = Readable.from(Buffer.from('contents'));
    const signal = new globalThis.AbortController().signal;

    await service.uploadStream(
      'user-1/file-1/report.pdf',
      source,
      8,
      'application/pdf',
      signal
    );

    const command = send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    // Bun 运行时下 SDK 对 Node Readable Body 的流式 PUT 会死锁(30 秒后 SDK 内部锁超时),
    // uploadStream 把流读成 Buffer 再 PUT;Body 应与源内容一致。
    expect(Buffer.isBuffer(command.input.Body)).toBe(true);
    expect((command.input.Body as Buffer).equals(Buffer.from('contents'))).toBe(
      true
    );
    expect(command.input.ContentLength).toBe(8);
    expect(command.input.ContentType).toBe('application/pdf');
    expect(send.mock.calls[0]?.[1]?.abortSignal).toBeDefined();
  });

  it('rejects a streamed upload whose byte count differs from the declared size', async () => {
    const send = vi.fn(async () => ({}));
    const service = withClient(send);
    const source = Readable.from(Buffer.from('mismatched'));

    await expect(
      service.uploadStream(
        'user-1/file-1/report.pdf',
        source,
        8,
        'application/pdf'
      )
    ).rejects.toThrow('expected 8');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('MinioService multipart upload', () => {
  function createMultipartHarness() {
    let options: Record<string, any> | undefined;
    const upload = {
      done: vi.fn(async () => {
        for await (const _chunk of options?.params?.Body as Readable) {
          // Consume the guarded stream like @aws-sdk/lib-storage does.
        }
        return {};
      }),
      abort: vi.fn(async () => {}),
    };
    const factory = vi.fn((nextOptions: Record<string, any>) => {
      options = nextOptions;
      return upload;
    });
    return {
      factory,
      upload,
      get options() {
        return options;
      },
    };
  }

  it('uploads with the fixed multipart size and concurrency settings', async () => {
    const send = vi.fn(async () => ({}));
    const service = withClient(send, 'multipart');
    const harness = createMultipartHarness();
    (
      service as unknown as { createMultipartUpload: typeof harness.factory }
    ).createMultipartUpload = harness.factory;
    const source = Readable.from([Buffer.from('conte'), Buffer.from('nts')]);

    await service.uploadStream(
      'user-1/file-1/report.pdf',
      source,
      8,
      'application/pdf'
    );

    expect(MINIO_MULTIPART_PART_SIZE).toBe(8 * 1024 * 1024);
    expect(MINIO_MULTIPART_QUEUE_SIZE).toBe(2);
    expect(harness.factory).toHaveBeenCalledTimes(1);
    expect(harness.options?.partSize).toBe(MINIO_MULTIPART_PART_SIZE);
    expect(harness.options?.queueSize).toBe(MINIO_MULTIPART_QUEUE_SIZE);
    expect(harness.options?.leavePartsOnError).toBe(false);
    expect(harness.options?.params?.Bucket).toBe('uploads');
    expect(harness.options?.params?.Key).toBe('user-1/file-1/report.pdf');
    expect(harness.options?.params?.ContentLength).toBe(8);
    expect(harness.options?.params?.ContentType).toBe('application/pdf');
    expect(harness.upload.abort).not.toHaveBeenCalled();
    expect(source.destroyed).toBe(true);
  });

  it('aborts the multipart upload and destroys the source on failure', async () => {
    const send = vi.fn(async () => ({}));
    const service = withClient(send, 'multipart');
    const harness = createMultipartHarness();
    const uploadError = new Error('upload failed');
    harness.upload.done.mockRejectedValueOnce(uploadError);
    (
      service as unknown as { createMultipartUpload: typeof harness.factory }
    ).createMultipartUpload = harness.factory;
    const source = new PassThrough();

    await expect(
      service.uploadStream(
        'user-1/file-1/report.pdf',
        source,
        8,
        'application/pdf'
      )
    ).rejects.toBe(uploadError);
    expect(harness.upload.abort).toHaveBeenCalledTimes(1);
    expect(source.destroyed).toBe(true);
  });

  it('forwards source errors and aborts the multipart upload', async () => {
    const send = vi.fn(async () => ({}));
    const service = withClient(send, 'multipart');
    const harness = createMultipartHarness();
    (
      service as unknown as { createMultipartUpload: typeof harness.factory }
    ).createMultipartUpload = harness.factory;
    const source = new PassThrough();

    const pending = service.uploadStream(
      'user-1/file-1/report.pdf',
      source,
      8,
      'application/pdf'
    );
    source.write(Buffer.from('part'));
    source.destroy(new Error('source failed'));

    await expect(pending).rejects.toThrow('source failed');
    expect(harness.upload.abort).toHaveBeenCalledTimes(1);
    expect(source.destroyed).toBe(true);
  });

  it('aborts when the caller cancels the request', async () => {
    const send = vi.fn(async () => ({}));
    const service = withClient(send, 'multipart');
    const harness = createMultipartHarness();
    harness.upload.done.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          harness.options?.abortController?.signal.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true }
          );
        })
    );
    (
      service as unknown as { createMultipartUpload: typeof harness.factory }
    ).createMultipartUpload = harness.factory;
    const source = new PassThrough();
    const caller = new globalThis.AbortController();

    const pending = service.uploadStream(
      'user-1/file-1/report.pdf',
      source,
      8,
      'application/pdf',
      caller.signal
    );
    caller.abort();

    await expect(pending).rejects.toThrow('aborted');
    expect(harness.options?.abortController?.signal.aborted).toBe(true);
    expect(harness.upload.abort).toHaveBeenCalledTimes(1);
    expect(source.destroyed).toBe(true);
  });

  it('aborts when the upload timeout expires', async () => {
    const send = vi.fn(async () => ({}));
    const service = withClient(send, 'multipart');
    const harness = createMultipartHarness();
    harness.upload.done.mockRejectedValueOnce(new Error('timed out'));
    (
      service as unknown as { createMultipartUpload: typeof harness.factory }
    ).createMultipartUpload = harness.factory;
    const timeout = new globalThis.AbortController();
    timeout.abort();
    const timeoutSpy = vi
      .spyOn(globalThis.AbortSignal, 'timeout')
      .mockReturnValue(timeout.signal);
    const source = new PassThrough();

    await expect(
      service.uploadStream(
        'user-1/file-1/report.pdf',
        source,
        8,
        'application/pdf'
      )
    ).rejects.toThrow('timed out');
    expect(timeoutSpy).toHaveBeenCalledWith(MINIO_UPLOAD_TIMEOUT_MS);
    expect(harness.options?.abortController?.signal.aborted).toBe(true);
    expect(harness.upload.abort).toHaveBeenCalledTimes(1);
    expect(source.destroyed).toBe(true);
    timeoutSpy.mockRestore();
  });

  it('aborts when the streamed byte count differs from the declared size', async () => {
    const send = vi.fn(async () => ({}));
    const service = withClient(send, 'multipart');
    const harness = createMultipartHarness();
    (
      service as unknown as { createMultipartUpload: typeof harness.factory }
    ).createMultipartUpload = harness.factory;

    await expect(
      service.uploadStream(
        'user-1/file-1/report.pdf',
        Readable.from(Buffer.from('short')),
        8,
        'application/pdf'
      )
    ).rejects.toThrow('expected 8');
    expect(harness.upload.abort).toHaveBeenCalledTimes(1);
  });
});
describe('MinioService object streaming', () => {
  it('heads an object without downloading its body', async () => {
    const send = vi.fn(async () => ({}));
    const service = withClient(send);
    const signal = new globalThis.AbortController().signal;

    await service.head('user-1/file-1/report.pdf', signal);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect(send.mock.calls[0]?.[1]).toEqual({ abortSignal: signal });
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

  it('reports only an explicit object-storage 404 as missing', async () => {
    const missing = Object.assign(new Error('not found'), {
      $metadata: { httpStatusCode: 404 },
    });
    const send = vi.fn().mockRejectedValue(missing);
    const service = withClient(send);
    const abortSignal = new globalThis.AbortController().signal;
    const timeout = vi
      .spyOn(globalThis.AbortSignal, 'timeout')
      .mockReturnValue(abortSignal);

    await expect(
      service.probeObjectExists('user-1/file-1/report.pdf')
    ).resolves.toBe(false);

    expect(timeout).toHaveBeenCalledWith(MINIO_DELETE_TIMEOUT_MS);
    expect(send.mock.calls[0]?.[1]).toEqual({ abortSignal });
  });

  it('keeps non-404 probe failures indeterminate', async () => {
    const unavailable = Object.assign(new Error('storage unavailable'), {
      $metadata: { httpStatusCode: 503 },
    });
    const service = withClient(vi.fn().mockRejectedValue(unavailable));

    await expect(
      service.probeObjectExists('user-1/file-1/report.pdf')
    ).rejects.toBe(unavailable);
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

describe('MinioService downloadToFile', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of cleanupDirs.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function createTempDir() {
    const directory = mkdtempSync(join(tmpdir(), 'utils-plane-minio-'));
    cleanupDirs.push(directory);
    return directory;
  }

  it('streams to a temporary file and atomically renames the result', async () => {
    const send = vi.fn(async () => ({
      Body: Readable.from(Buffer.from('contents')),
      ContentLength: 8,
    }));
    const service = withClient(send);
    const directory = createTempDir();
    const destination = join(directory, 'download.bin');

    await service.downloadToFile('user-1/file-1/report.pdf', destination);

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(readFileSync(destination, 'utf8')).toBe('contents');
    expect(readdirSync(directory)).toEqual(['download.bin']);
  });

  it('accepts a successful download when ContentLength is absent', async () => {
    const send = vi.fn(async () => ({
      Body: Readable.from(Buffer.from('contents')),
    }));
    const service = withClient(send);
    const directory = createTempDir();
    const destination = join(directory, 'download.bin');

    await service.downloadToFile('user-1/file-1/report.pdf', destination);

    expect(readFileSync(destination, 'utf8')).toBe('contents');
    expect(readdirSync(directory)).toEqual(['download.bin']);
  });

  it('removes the temporary file when ContentLength does not match', async () => {
    const send = vi.fn(async () => ({
      Body: Readable.from(Buffer.from('short')),
      ContentLength: 8,
    }));
    const service = withClient(send);
    const directory = createTempDir();
    const destination = join(directory, 'download.bin');

    await expect(
      service.downloadToFile('user-1/file-1/report.pdf', destination)
    ).rejects.toThrow('expected 8');
    expect(existsSync(destination)).toBe(false);
    expect(readdirSync(directory)).toEqual([]);
  });

  it('removes the temporary file when the response stream fails', async () => {
    const send = vi.fn(async () => ({
      Body: Readable.from(
        (async function* () {
          yield Buffer.from('partial');
          throw new Error('stream failed');
        })()
      ),
      ContentLength: 7,
    }));
    const service = withClient(send);
    const directory = createTempDir();
    const destination = join(directory, 'download.bin');

    await expect(
      service.downloadToFile('user-1/file-1/report.pdf', destination)
    ).rejects.toThrow('stream failed');
    expect(existsSync(destination)).toBe(false);
    expect(readdirSync(directory)).toEqual([]);
  });

  it('removes the temporary file when the caller aborts', async () => {
    const body = new PassThrough();
    const send = vi.fn(async () => ({
      Body: body,
      ContentLength: 100,
    }));
    const service = withClient(send);
    const directory = createTempDir();
    const destination = join(directory, 'download.bin');
    const caller = new globalThis.AbortController();

    const pending = service.downloadToFile(
      'user-1/file-1/report.pdf',
      destination,
      caller.signal
    );
    await new Promise(resolve => setTimeout(resolve, 10));
    caller.abort();

    await expect(pending).rejects.toThrow();
    expect(body.destroyed).toBe(true);
    expect(existsSync(destination)).toBe(false);
    expect(readdirSync(directory)).toEqual([]);
  });
});
