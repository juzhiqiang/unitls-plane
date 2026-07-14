import {
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as archiver from 'archiver';
import { Readable, type Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { MinioService } from '../files/minio.service';
import {
  type AccountExportFile,
  type AccountExportProfile,
  type AccountExportTask,
  ACCOUNT_EXPORT_MAX_FILE_ROWS,
  ACCOUNT_EXPORT_MAX_TASK_ROWS,
  AccountRepository,
} from './account.repository';
import {
  buildExportFilename,
  createArchivePath,
  createExportTask,
  createManifestEntry,
} from './account-export.util';

export interface PreparedAccountExport {
  filename: string;
  profile: AccountExportProfile;
  tasks: AccountExportTask[];
  files: Array<{ source: AccountExportFile; exportPath: string }>;
}

export const ACCOUNT_EXPORT_MAX_METADATA_BYTES = 32 * 1024 * 1024;
const METADATA_TOO_LARGE_MESSAGE = 'Account export metadata is too large';

const ZipArchive = (
  archiver as unknown as {
    ZipArchive: new (options: { zlib: { level: number } }) => archiver.Archiver;
  }
).ZipArchive;

function appendArchiveStream(
  archive: archiver.Archiver,
  input: Readable,
  name: string,
  signal: globalThis.AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onEntry = (entry: archiver.EntryData) => {
      if (entry.name === name) settle();
    };
    const onAbort = () => settle(getAbortReason(signal));
    const cleanup = () => {
      archive.off('entry', onEntry);
      signal.removeEventListener('abort', onAbort);
    };
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };

    archive.on('entry', onEntry);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    finished(input, { cleanup: true }).then(
      () => undefined,
      error => settle(toError(error, 'Account export input failed'))
    );
    try {
      archive.append(input, { name });
    } catch (error) {
      settle(toError(error, 'Account export append failed'));
    }
  });
}

function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function getAbortReason(signal: globalThis.AbortSignal): Error {
  return toError(signal.reason, 'Account export aborted');
}

function waitWithAbort<T>(
  promise: Promise<T>,
  signal: globalThis.AbortSignal
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const resolveOnce = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(toError(error, 'Account export failed'));
    };
    const onAbort = () => rejectOnce(getAbortReason(signal));

    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolveOnce, rejectOnce);
  });
}

function serializeJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw new Error('Account export JSON is invalid');
  return serialized;
}

function* manifestEntries(
  files: PreparedAccountExport['files']
): Generator<ReturnType<typeof createManifestEntry>> {
  for (const { source, exportPath } of files)
    yield createManifestEntry(source, exportPath);
}

function createJsonArrayStream(items: Iterable<unknown>): Readable {
  return Readable.from(
    (function* () {
      yield '[';
      let first = true;
      for (const item of items) {
        if (!first) yield ',';
        first = false;
        yield serializeJson(item);
      }
      yield ']';
    })()
  );
}

function assertMetadataWithinLimit(
  profile: AccountExportProfile,
  tasks: AccountExportTask[],
  files: PreparedAccountExport['files'],
  maxBytes: number
): void {
  let totalBytes = 0;
  const addBytes = (value: string) => {
    totalBytes += Buffer.byteLength(value, 'utf8');
    if (totalBytes > maxBytes)
      throw new ServiceUnavailableException(METADATA_TOO_LARGE_MESSAGE);
  };
  const addArray = (items: Iterable<unknown>) => {
    addBytes('[');
    let first = true;
    for (const item of items) {
      if (!first) addBytes(',');
      first = false;
      addBytes(serializeJson(item));
    }
    addBytes(']');
  };

  addBytes(serializeJson(profile));
  addArray(tasks);
  addArray(manifestEntries(files));
}

@Injectable()
export class AccountExportService {
  constructor(
    private readonly repository: AccountRepository,
    private readonly minio: MinioService,
    @Optional()
    private readonly metadataByteLimit = ACCOUNT_EXPORT_MAX_METADATA_BYTES
  ) {}

  async prepareExport(userId: string): Promise<PreparedAccountExport> {
    const snapshot = await this.repository.getExportSnapshot(userId);
    if (
      snapshot.tasks.length > ACCOUNT_EXPORT_MAX_TASK_ROWS ||
      snapshot.files.length > ACCOUNT_EXPORT_MAX_FILE_ROWS
    )
      throw new ServiceUnavailableException(METADATA_TOO_LARGE_MESSAGE);

    const usedPaths = new Set<string>();
    const tasks = snapshot.tasks.map(createExportTask);
    const preparedFiles = snapshot.files.map(source => ({
      source,
      exportPath: createArchivePath(source.filename, source.id, usedPaths),
    }));
    assertMetadataWithinLimit(
      snapshot.profile,
      tasks,
      preparedFiles,
      this.metadataByteLimit
    );

    try {
      for (const file of snapshot.files) await this.minio.head(file.storageKey);
    } catch {
      throw new ServiceUnavailableException('Account export is incomplete');
    }

    return {
      filename: buildExportFilename(new Date()),
      profile: snapshot.profile,
      tasks,
      files: preparedFiles,
    };
  }

  async writeExport(
    prepared: PreparedAccountExport,
    output: Writable
  ): Promise<void> {
    const abortError = new Error('Account export aborted');
    if (output.destroyed || output.closed) throw abortError;

    const archive = new ZipArchive({ zlib: { level: 6 } });
    const abortController = new globalThis.AbortController();
    let activeInput: Readable | undefined;
    const abort = (error: Error) => {
      if (!abortController.signal.aborted) {
        abortController.abort(error);
        archive.abort();
      }
      const cause = getAbortReason(abortController.signal);
      activeInput?.destroy();
      if (!output.destroyed) output.destroy(cause);
    };
    const onArchiveError = (error: Error) => abort(error);
    const onOutputError = (error: Error) => abort(error);
    const onOutputClose = () => {
      if (output.writableFinished) return;
      abort(abortError);
    };

    archive.on('error', onArchiveError);
    output.on('error', onOutputError);
    output.once('close', onOutputClose);
    const outputFinished = finished(output, { cleanup: true });
    outputFinished.catch(() => undefined);

    try {
      archive.pipe(output);
      archive.append(Readable.from([serializeJson(prepared.profile)]), {
        name: 'profile.json',
      });
      archive.append(createJsonArrayStream(prepared.tasks), {
        name: 'tasks.json',
      });
      archive.append(createJsonArrayStream(manifestEntries(prepared.files)), {
        name: 'files.json',
      });

      for (const file of prepared.files) {
        if (abortController.signal.aborted)
          throw getAbortReason(abortController.signal);
        const inputPromise = this.minio.downloadStream(file.source.storageKey);
        inputPromise.then(
          input => {
            if (abortController.signal.aborted) input.destroy();
          },
          () => undefined
        );
        const input = await waitWithAbort(inputPromise, abortController.signal);
        activeInput = input;
        if (abortController.signal.aborted) {
          const cause = getAbortReason(abortController.signal);
          input.destroy();
          throw cause;
        }
        await appendArchiveStream(
          archive,
          activeInput,
          file.exportPath,
          abortController.signal
        );
        activeInput = undefined;
      }

      await waitWithAbort(archive.finalize(), abortController.signal);
      await waitWithAbort(outputFinished, abortController.signal);
    } catch (error) {
      const cause = toError(error, 'Account export failed');
      abort(cause);
      await outputFinished.catch(() => undefined);
      throw error;
    } finally {
      archive.off('error', onArchiveError);
      output.off('error', onOutputError);
      output.off('close', onOutputClose);
    }
  }
}
