import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import multer from 'multer';
import {
  ensureUploadTempDir,
  createUploadTempStorage,
  removeUploadTempFile,
  resolveUploadMaxFileSize,
  reclaimExpiredUploadTempFiles,
  retryUploadTempCleanup,
  UPLOAD_TEMP_FILE_RETENTION_MS,
  UPLOAD_TEMP_DIR,
} from './upload-temp-file';

const requests: EventEmitter[] = [];

afterEach(() => {
  for (const request of requests) request.removeAllListeners();
  requests.length = 0;
});

describe('upload temporary storage', () => {
  it('does not scan expired files during a request directory check', () => {
    const stalePath = join(
      UPLOAD_TEMP_DIR,
      `ensure-${Date.now()}-${Math.random()}-stale`
    );
    const staleTime = new Date(
      Date.now() - UPLOAD_TEMP_FILE_RETENTION_MS - 1_000
    );
    writeFileSync(stalePath, 'stale');
    utimesSync(stalePath, staleTime, staleTime);

    try {
      ensureUploadTempDir();
      expect(existsSync(stalePath)).toBe(true);
    } finally {
      if (existsSync(stalePath)) unlinkSync(stalePath);
    }
  });

  it('resolves upload limits from anonymous, signed-in, and highest-tier users', () => {
    expect(resolveUploadMaxFileSize({})).toBe(10 * 1024 * 1024);
    expect(
      resolveUploadMaxFileSize({
        user: { userId: 'user-1', plan: 'free', role: 'user' },
      })
    ).toBe(50 * 1024 * 1024);
    expect(
      resolveUploadMaxFileSize({
        user: { id: 'user-1', plan: 'free', role: 'user' },
      })
    ).toBe(50 * 1024 * 1024);
    expect(
      resolveUploadMaxFileSize({
        user: { userId: 'user-2', plan: 'private', role: 'user' },
      })
    ).toBe(250 * 1024 * 1024);
  });

  it('passes only the authenticated user to the limit resolver', async () => {
    const request = Object.assign(new EventEmitter(), {
      readableEnded: false,
      destroyed: false,
      user: { id: 'user-1', plan: 'free', role: 'user' },
    });
    requests.push(request);
    const source = new PassThrough();
    const resolveMaxBytes = vi.fn(() => Number.POSITIVE_INFINITY);
    const storage = createUploadTempStorage(resolveMaxBytes);
    let result: { path?: string } | undefined;
    let callbackError: unknown;
    const completed = new Promise<void>(resolve => {
      storage._handleFile(
        request as never,
        {
          fieldname: 'file',
          originalname: 'upload.bin',
          encoding: '7bit',
          mimetype: 'application/octet-stream',
          stream: source,
        } as never,
        (error, info) => {
          callbackError = error;
          result = info as typeof result;
          resolve();
        }
      );
    });

    source.end(Buffer.from('payload'));
    await completed;

    try {
      expect(callbackError).toBeUndefined();
      expect(resolveMaxBytes).toHaveBeenCalledWith({ user: request.user });
    } finally {
      if (result?.path) await removeUploadTempFile(result.path);
    }
  });

  it('reclaims only expired regular files in the upload root', () => {
    const suffix = `reclaim-${Date.now()}-${Math.random()}`;
    const stalePath = join(UPLOAD_TEMP_DIR, `${suffix}-stale`);
    const freshPath = join(UPLOAD_TEMP_DIR, `${suffix}-fresh`);
    const directoryPath = join(UPLOAD_TEMP_DIR, `${suffix}-directory`);
    const staleTime = new Date(
      Date.now() - UPLOAD_TEMP_FILE_RETENTION_MS - 1_000
    );

    writeFileSync(stalePath, 'stale');
    writeFileSync(freshPath, 'fresh');
    mkdirSync(directoryPath);
    utimesSync(stalePath, staleTime, staleTime);

    try {
      const result = reclaimExpiredUploadTempFiles();

      expect(result.deleted).toContain(stalePath);
      expect(existsSync(stalePath)).toBe(false);
      expect(existsSync(freshPath)).toBe(true);
      expect(existsSync(directoryPath)).toBe(true);
    } finally {
      unlinkSync(freshPath);
      rmdirSync(directoryPath);
    }
  });

  it.skipIf(process.platform === 'win32')(
    'does not reclaim an external symbolic link or its target',
    () => {
      const suffix = `symlink-${Date.now()}-${Math.random()}`;
      const externalPath = join(UPLOAD_TEMP_DIR, `${suffix}-external`);
      const externalTarget = join(tmpdir(), `${suffix}-target`);
      const staleTime = new Date(
        Date.now() - UPLOAD_TEMP_FILE_RETENTION_MS - 1_000
      );
      writeFileSync(externalTarget, 'outside');
      symlinkSync(externalTarget, externalPath);
      utimesSync(externalTarget, staleTime, staleTime);

      try {
        const result = reclaimExpiredUploadTempFiles();

        expect(result.deleted).not.toContain(externalPath);
        expect(existsSync(externalPath)).toBe(true);
        expect(existsSync(externalTarget)).toBe(true);
      } finally {
        unlinkSync(externalPath);
        unlinkSync(externalTarget);
      }
    }
  );

  it('retries a failed temporary cleanup operation', async () => {
    let attempts = 0;

    await expect(
      retryUploadTempCleanup(
        async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('temporary failure');
        },
        2,
        0
      )
    ).resolves.toBeUndefined();

    expect(attempts).toBe(2);
  });

  it('returns disk metadata and supports Multer cleanup after success', async () => {
    ensureUploadTempDir();
    const request = Object.assign(new EventEmitter(), {
      readableEnded: false,
      destroyed: false,
    });
    requests.push(request);
    const source = new PassThrough();
    const storage = createUploadTempStorage();
    let result: { path?: string; size?: number } | undefined;
    let callbackError: unknown;
    const completed = new Promise<void>(resolve => {
      storage._handleFile(
        request as never,
        {
          fieldname: 'file',
          originalname: 'upload.bin',
          encoding: '7bit',
          mimetype: 'application/octet-stream',
          stream: source,
        } as never,
        (error, info) => {
          callbackError = error;
          result = info as typeof result;
          resolve();
        }
      );
    });

    source.end(Buffer.from('payload'));
    await completed;

    expect(callbackError).toBeUndefined();
    expect(result?.size).toBe(7);
    expect(result?.path).toBeDefined();
    expect(existsSync(result!.path!)).toBe(true);

    await new Promise<void>((resolve, reject) => {
      storage._removeFile(request as never, result as never, error =>
        error ? reject(error) : resolve()
      );
    });
    expect(existsSync(result!.path!)).toBe(false);
  });

  it('removes a file when the input stream fails', async () => {
    const directory = ensureUploadTempDir();
    const before = new Set(readdirSync(directory));
    const request = Object.assign(new EventEmitter(), {
      readableEnded: false,
      destroyed: false,
    });
    requests.push(request);
    const source = new PassThrough();
    const storage = createUploadTempStorage();
    let callbackError: unknown;
    const completed = new Promise<void>(resolve => {
      storage._handleFile(
        request as never,
        {
          fieldname: 'file',
          originalname: 'upload.bin',
          encoding: '7bit',
          mimetype: 'application/octet-stream',
          stream: source,
        } as never,
        error => {
          callbackError = error;
          resolve();
        }
      );
    });

    await waitFor(() => readdirSync(directory).some(name => !before.has(name)));
    const created = readdirSync(directory).filter(name => !before.has(name));
    source.destroy(new Error('source failed'));
    await completed;
    await waitFor(() =>
      created.every(name => !existsSync(`${directory}/${name}`))
    );

    expect(callbackError).toBeInstanceOf(Error);
  });

  it('removes an in-flight file when the request is aborted', async () => {
    const directory = ensureUploadTempDir();
    const before = new Set(readdirSync(directory));
    const request = Object.assign(new EventEmitter(), {
      readableEnded: false,
      destroyed: false,
    });
    requests.push(request);
    const source = new PassThrough();
    const storage = createUploadTempStorage();
    let callbackError: unknown;

    storage._handleFile(
      request as never,
      {
        fieldname: 'file',
        originalname: 'upload.bin',
        encoding: '7bit',
        mimetype: 'application/octet-stream',
        stream: source,
      } as never,
      error => {
        callbackError = error;
      }
    );

    await waitFor(() => readdirSync(directory).some(name => !before.has(name)));
    const created = readdirSync(directory).filter(name => !before.has(name));
    request.emit('aborted');
    source.end(Buffer.from('partial payload'));

    await waitFor(() =>
      created.every(name => !existsSync(`${directory}/${name}`))
    );

    expect(callbackError).toBeInstanceOf(Error);
  });

  it('stops writing when the request-specific file limit is exceeded', async () => {
    const directory = ensureUploadTempDir();
    const before = new Set(readdirSync(directory));
    const request = Object.assign(new EventEmitter(), {
      readableEnded: false,
      destroyed: false,
      user: undefined,
    });
    requests.push(request);
    const source = new PassThrough();
    const storage = createUploadTempStorage(() => 4);
    const callback = vi.fn();
    const completed = new Promise<void>(resolve => {
      storage._handleFile(
        request as never,
        {
          fieldname: 'file',
          originalname: 'upload.bin',
          encoding: '7bit',
          mimetype: 'application/octet-stream',
          stream: source,
        } as never,
        (...args: unknown[]) => {
          callback(...args);
          resolve();
        }
      );
    });

    source.end(Buffer.from('12345'));
    await completed;

    try {
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0]?.[0]).toMatchObject({
        message: 'File too large',
      });
      await waitFor(() =>
        readdirSync(directory).every(name => before.has(name))
      );
    } finally {
      for (const name of readdirSync(directory)) {
        if (!before.has(name)) unlinkSync(join(directory, name));
      }
    }
  });

  it('accepts a file exactly at the request-specific file limit', async () => {
    const directory = ensureUploadTempDir();
    const before = new Set(readdirSync(directory));
    const request = Object.assign(new EventEmitter(), {
      readableEnded: false,
      destroyed: false,
    });
    requests.push(request);
    const source = new PassThrough();
    const storage = createUploadTempStorage(() => 4);
    let result: { path?: string; size?: number } | undefined;
    let callbackError: unknown;
    const completed = new Promise<void>(resolve => {
      storage._handleFile(
        request as never,
        {
          fieldname: 'file',
          originalname: 'upload.bin',
          encoding: '7bit',
          mimetype: 'application/octet-stream',
          stream: source,
        } as never,
        (error, info) => {
          callbackError = error;
          result = info as typeof result;
          resolve();
        }
      );
    });

    source.end(Buffer.from('1234'));
    await completed;

    try {
      expect(callbackError).toBeUndefined();
      expect(result?.size).toBe(4);
    } finally {
      for (const name of readdirSync(directory)) {
        if (!before.has(name)) unlinkSync(join(directory, name));
      }
    }
  });

  it('maps a request-specific limit through the real Multer middleware', async () => {
    const directory = ensureUploadTempDir();
    const before = new Set(readdirSync(directory));
    const boundary = `----utils-plane-${Date.now()}-${Math.random()}`;
    const request = createMultipartRequest(boundary);
    const storage = createUploadTempStorage(() => 4);
    const callbackCount = trackStorageCallbacks(storage);
    const { next, completed } = runMulter(request, storage, boundary, 8);

    const error = await completed;
    try {
      expect(error?.message).toBe('File too large');
      expect(next).toHaveBeenCalledTimes(1);
      expect(callbackCount()).toBe(1);
      await waitFor(() =>
        readdirSync(directory).every(name => before.has(name))
      );
    } finally {
      for (const name of readdirSync(directory)) {
        if (!before.has(name)) unlinkSync(join(directory, name));
      }
    }
  });

  it('cleans the temporary file when Multer enforces its static file limit', async () => {
    const directory = ensureUploadTempDir();
    const before = new Set(readdirSync(directory));
    const boundary = `----utils-plane-${Date.now()}-${Math.random()}`;
    const request = createMultipartRequest(boundary);
    const storage = createUploadTempStorage();
    const callbackCount = trackStorageCallbacks(storage);
    const { next, completed } = runMulter(request, storage, boundary, 8, 4);

    const error = await completed;
    try {
      expect(error?.message).toBe('File too large');
      expect(next).toHaveBeenCalledTimes(1);
      expect(callbackCount()).toBe(1);
      await waitFor(() =>
        readdirSync(directory).every(name => before.has(name))
      );
    } finally {
      for (const name of readdirSync(directory)) {
        if (!before.has(name)) unlinkSync(join(directory, name));
      }
    }
  });

  it.each(['aborted', 'close'] as const)(
    'cleans the temporary file when the request emits %s',
    async event => {
      const directory = ensureUploadTempDir();
      const before = new Set(readdirSync(directory));
      const boundary = `----utils-plane-${Date.now()}-${Math.random()}`;
      const request = createMultipartRequest(boundary);
      const storage = createUploadTempStorage();
      const callbackCount = trackStorageCallbacks(storage);
      const { next, completed } = runMulter(
        request,
        storage,
        boundary,
        undefined,
        undefined,
        false
      );

      request.write(multipartHeader(boundary));
      request.write(Buffer.from('partial'));
      await waitFor(() =>
        readdirSync(directory).some(name => !before.has(name))
      );
      request.emit(event);
      request.destroy();

      const error = await completed;
      try {
        expect(error).toBeDefined();
        expect(next).toHaveBeenCalledTimes(1);
        await waitFor(() => callbackCount() === 1);
        expect(callbackCount()).toBe(1);
        await waitFor(() =>
          readdirSync(directory).every(name => before.has(name))
        );
      } finally {
        for (const name of readdirSync(directory)) {
          if (!before.has(name)) unlinkSync(join(directory, name));
        }
      }
    }
  );
});

function createMultipartRequest(boundary: string): PassThrough & {
  headers: Record<string, string>;
  method: string;
  url: string;
  httpVersion: string;
} {
  const request = new PassThrough() as PassThrough & {
    headers: Record<string, string>;
    method: string;
    url: string;
    httpVersion: string;
  };
  request.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
  };
  request.method = 'POST';
  request.url = '/files/upload';
  request.httpVersion = '1.1';
  request.on('error', () => undefined);
  return request;
}

function multipartHeader(boundary: string): Buffer {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`
  );
}

function multipartBody(boundary: string, size: number): Buffer {
  return Buffer.concat([
    multipartHeader(boundary),
    Buffer.alloc(size, 0x31),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

function runMulter(
  request: PassThrough & { headers: Record<string, string> },
  storage: ReturnType<typeof createUploadTempStorage>,
  boundary: string,
  bodySize?: number,
  fileSize?: number,
  endRequest = true
) {
  const next = vi.fn();
  let resolveCompleted!: (error: any) => void;
  const completed = new Promise<any>(resolve => {
    resolveCompleted = resolve;
  });
  if (bodySize !== undefined) {
    const body = multipartBody(boundary, bodySize);
    request.headers['content-length'] = String(body.byteLength);
    delete request.headers['transfer-encoding'];
  } else {
    request.headers['transfer-encoding'] = 'chunked';
    delete request.headers['content-length'];
  }
  const middleware = multer({
    storage,
    limits: fileSize === undefined ? undefined : { fileSize },
  }).single('file');

  middleware(request as never, {} as never, (error: any) => {
    next(error);
    resolveCompleted(error);
  });
  if (endRequest && bodySize !== undefined) {
    request.end(multipartBody(boundary, bodySize));
  }
  return { next, completed };
}

function trackStorageCallbacks(
  storage: ReturnType<typeof createUploadTempStorage>
): () => number {
  let calls = 0;
  const original = storage._handleFile.bind(storage);
  storage._handleFile = ((request, file, callback) => {
    original(request, file, (error, info) => {
      calls += 1;
      callback(error, info);
    });
  }) as typeof storage._handleFile;
  return () => calls;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
