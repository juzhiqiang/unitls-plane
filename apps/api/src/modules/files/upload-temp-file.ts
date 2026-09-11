import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  createWriteStream,
  lstatSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { lstat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import type { StorageEngine } from 'multer';
import { getLimit, type EntitlementUser } from '@utils-plane/utils';

export const UPLOAD_TEMP_DIR = resolve(
  process.env.UPLOAD_TEMP_DIR ?? join(tmpdir(), 'utils-plane-uploads')
);
export const UPLOAD_TEMP_FILE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const UPLOAD_TEMP_CLEANUP_MAX_ATTEMPTS = 3;
export const UPLOAD_TEMP_CLEANUP_RETRY_DELAY_MS = 25;

type NodeError = Error & { code?: string };

function isNodeError(error: unknown): error is NodeError {
  return error instanceof Error && 'code' in error;
}

export function ensureUploadTempDir(): string {
  try {
    mkdirSync(UPLOAD_TEMP_DIR, { recursive: true, mode: 0o700 });
    const directoryStats = lstatSync(UPLOAD_TEMP_DIR);
    if (!directoryStats.isDirectory()) {
      throw new Error('Upload temporary path is not a directory');
    }
    if (process.platform !== 'win32') chmodSync(UPLOAD_TEMP_DIR, 0o700);
    return UPLOAD_TEMP_DIR;
  } catch (error) {
    throw new Error('Upload temporary directory is unavailable', {
      cause: error,
    });
  }
}

export function initializeUploadTempDir(): string {
  const directory = ensureUploadTempDir();
  try {
    const reclaimResult = reclaimExpiredUploadTempFiles();
    if (reclaimResult.failed.length > 0) {
      console.warn(
        `Failed to reclaim ${reclaimResult.failed.length} upload temporary files`
      );
    }
    return directory;
  } catch (error) {
    throw new Error('Upload temporary directory cleanup is unavailable', {
      cause: error,
    });
  }
}

export type UploadTempReclaimResult = {
  deleted: string[];
  failed: string[];
};

export function reclaimExpiredUploadTempFiles(
  now = Date.now()
): UploadTempReclaimResult {
  const cutoff = now - UPLOAD_TEMP_FILE_RETENTION_MS;
  const deleted: string[] = [];
  const failed: string[] = [];

  for (const entry of readdirSync(UPLOAD_TEMP_DIR, { withFileTypes: true })) {
    const filePath = join(UPLOAD_TEMP_DIR, entry.name);
    let stats;
    try {
      stats = lstatSync(filePath);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') continue;
      failed.push(filePath);
      continue;
    }

    if (!stats.isFile() || stats.mtimeMs >= cutoff) continue;

    try {
      unlinkSync(filePath);
      deleted.push(filePath);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') continue;
      failed.push(filePath);
    }
  }

  return { deleted, failed };
}

export function isUploadTempPath(filePath: string): boolean {
  if (!filePath) return false;

  const root = resolve(UPLOAD_TEMP_DIR);
  const candidate = resolve(filePath);
  const relativePath = relative(root, candidate);

  return (
    relativePath.length > 0 &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

export async function retryUploadTempCleanup(
  operation: () => Promise<void>,
  maxAttempts = UPLOAD_TEMP_CLEANUP_MAX_ATTEMPTS,
  retryDelayMs = UPLOAD_TEMP_CLEANUP_RETRY_DELAY_MS
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      if (retryDelayMs > 0) {
        await new Promise(resolvePromise =>
          setTimeout(resolvePromise, retryDelayMs)
        );
      }
    }
  }
  throw lastError;
}

export async function removeUploadTempFile(filePath: string): Promise<void> {
  if (!isUploadTempPath(filePath)) return;

  await retryUploadTempCleanup(async () => {
    let stats;
    try {
      stats = await lstat(filePath);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return;
      throw error;
    }

    if (!stats.isFile()) return;

    try {
      await unlink(filePath);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return;
      throw error;
    }
  });
}

export type UploadTempRequest = {
  user?: (EntitlementUser & { id?: string | null }) | null;
};

export type UploadMaxFileSizeResolver = (request: UploadTempRequest) => number;

type MulterUploadRequest = Parameters<StorageEngine['_handleFile']>[0];
type MulterUploadRequestWithUser = MulterUploadRequest & UploadTempRequest;

export function resolveUploadMaxFileSize(request: UploadTempRequest): number {
  const requestUser = request.user;
  if (!requestUser) return getLimit(null, 'upload.maxFileSize');

  return getLimit(
    {
      ...requestUser,
      userId: requestUser.userId ?? requestUser.id,
    },
    'upload.maxFileSize'
  );
}

function createUploadLimitError(fieldname: string): Error & {
  code: 'LIMIT_FILE_SIZE';
  field: string;
} {
  const error = new Error('File too large') as Error & {
    code: 'LIMIT_FILE_SIZE';
    field: string;
  };
  error.code = 'LIMIT_FILE_SIZE';
  error.field = fieldname;
  return error;
}

function createSizeLimitedStream(maxBytes: number, fieldname: string) {
  let bytes = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      const data = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk, encoding);
      const remaining = maxBytes - bytes;
      if (data.byteLength > remaining) {
        if (remaining > 0) this.push(data.subarray(0, remaining));
        bytes = maxBytes;
        callback(createUploadLimitError(fieldname));
        return;
      }
      bytes += data.byteLength;
      callback(null, data);
    },
  });
}

/**
 * Multer storage that keeps an in-flight upload removable when the request
 * ends before Multer has received the storage callback.
 */
export function createUploadTempStorage(
  resolveMaxBytes: UploadMaxFileSizeResolver = () => Number.POSITIVE_INFINITY
): StorageEngine {
  return {
    _handleFile: (request, file, callback) => {
      let directory: string;
      try {
        directory = ensureUploadTempDir();
      } catch (error) {
        callback(error);
        return;
      }

      let maxBytes: number;
      try {
        const requestWithUser = request as MulterUploadRequestWithUser;
        maxBytes = resolveMaxBytes({ user: requestWithUser.user });
        if (
          maxBytes !== Number.POSITIVE_INFINITY &&
          (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
        ) {
          throw new Error('Upload file size limit is invalid');
        }
      } catch (error) {
        callback(error);
        return;
      }

      const filename = randomUUID();
      const filePath = join(directory, filename);
      const output = createWriteStream(filePath, {
        flags: 'wx',
        mode: 0o600,
      });
      const limited = createSizeLimitedStream(maxBytes, file.fieldname);
      let settled = false;
      let aborted = false;
      let abortError: Error | undefined;

      const removeListeners = () => {
        request.off('aborted', onRequestAborted);
        request.off('error', onRequestError);
        request.off('close', onRequestClosed);
      };

      const removeAfterClose = async () => {
        if (!output.closed) {
          await new Promise<void>(resolvePromise => {
            output.once('close', () => resolvePromise());
          });
        }
        await removeUploadTempFile(filePath);
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        aborted = true;
        abortError ??= error;
        removeListeners();
        file.stream.destroy(abortError);
        limited.destroy(abortError);
        output.destroy(abortError);
        void removeAfterClose()
          .catch(error => {
            console.warn(
              'Failed to remove upload temporary file; it will be retried during startup',
              error
            );
          })
          .finally(() => callback(abortError));
      };

      const onRequestAborted = () => {
        fail(new Error('Upload request aborted'));
      };
      const onRequestError = (error: Error) => {
        fail(error);
      };
      const onRequestClosed = () => {
        if (!request.readableEnded) fail(new Error('Upload request closed'));
      };

      request.once('aborted', onRequestAborted);
      request.once('error', onRequestError);
      request.once('close', onRequestClosed);

      file.stream.once('error', fail);
      limited.once('error', fail);
      output.once('error', fail);
      output.once('finish', () => {
        if (settled) return;
        if (aborted) {
          fail(abortError ?? new Error('Upload request aborted'));
          return;
        }
        settled = true;
        removeListeners();
        callback(undefined, {
          destination: directory,
          filename,
          path: filePath,
          size: output.bytesWritten,
        });
      });

      if (request.destroyed || request.readableEnded) {
        fail(new Error('Upload request closed'));
        return;
      }

      file.stream.pipe(limited).pipe(output);
    },
    _removeFile: (_request, file, callback) => {
      removeUploadTempFile(file.path)
        .then(() => callback(null))
        .catch(error => callback(error as Error));
    },
  };
}
