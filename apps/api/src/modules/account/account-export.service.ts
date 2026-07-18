import {
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import * as archiver from 'archiver';
import { createReadStream } from 'node:fs';
import {
  chmod,
  mkdtemp,
  open,
  readdir,
  rm,
  type FileHandle,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable, type Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { MinioService } from '../files/minio.service';
import {
  type AccountExportFile,
  type AccountExportProfile,
  AccountRepository,
} from './account.repository';
import {
  type ArchivePathRegistry,
  buildExportFilename,
  createArchivePath,
  createExportTask,
  createManifestEntry,
} from './account-export.util';

export interface PreparedAccountExport {
  userId: string;
  snapshotAt: Date;
  filename: string;
  profile: AccountExportProfile;
  spool: AccountExportSpool;
}

const ZipArchive = (
  archiver as unknown as {
    ZipArchive: new (options: { zlib: { level: number } }) => archiver.Archiver;
  }
).ZipArchive;

const ACCOUNT_EXPORT_TEMP_PREFIX = 'utils-plane-account-export-';
const SQLITE_CLOSE_ATTEMPTS = 3;
export const ACCOUNT_EXPORT_TEMP_ROOT = Symbol('ACCOUNT_EXPORT_TEMP_ROOT');

interface ArchivePathDatabase {
  exec(sql: string): void;
  has(path: string): boolean;
  add(path: string): void;
  close(): void;
}

interface BunSqliteDatabase {
  exec(sql: string): void;
  query<Result, Params extends unknown[]>(
    sql: string
  ): {
    get(...params: Params): Result | null;
    run(...params: Params): unknown;
  };
  close(throwOnError?: boolean): void;
}

interface NodeSqliteStatement {
  get(value: string): unknown;
  run(value: string): unknown;
}

interface NodeSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
  close(): void;
}

function openArchivePathDatabase(path: string): ArchivePathDatabase {
  const versions = process.versions as unknown as Record<
    string,
    string | undefined
  >;
  const sqliteModuleName = versions.bun ? 'bun:sqlite' : 'node:sqlite';
  const sqliteModule = process.getBuiltinModule(sqliteModuleName);

  if (!sqliteModule) {
    throw new Error(
      `SQLite runtime module is unavailable: ${sqliteModuleName}`
    );
  }

  if (versions.bun) {
    const { Database } = sqliteModule as {
      Database: new (
        path: string,
        options: { create: boolean; strict: boolean }
      ) => BunSqliteDatabase;
    };
    const database = new Database(path, { create: true, strict: true });

    return {
      exec: sql => database.exec(sql),
      has: value =>
        database
          .query<
            { present: number },
            [string]
          >('SELECT 1 AS present FROM used_paths WHERE path = ?')
          .get(value) !== null,
      add: value =>
        database
          .query<unknown, [string]>('INSERT INTO used_paths (path) VALUES (?)')
          .run(value),
      close: () => database.close(false),
    };
  }

  const { DatabaseSync } = sqliteModule as {
    DatabaseSync: new (path: string) => NodeSqliteDatabase;
  };
  const database = new DatabaseSync(path);

  return {
    exec: sql => database.exec(sql),
    has: value =>
      database
        .prepare('SELECT 1 AS present FROM used_paths WHERE path = ?')
        .get(value) !== undefined,
    add: value => {
      database.prepare('INSERT INTO used_paths (path) VALUES (?)').run(value);
    },
    close: () => database.close(),
  };
}

type AccountExportManifestEntry = ReturnType<typeof createManifestEntry>;

interface AccountExportSpoolEntry {
  manifest: AccountExportManifestEntry;
  exportPath: string;
  storageKey: string;
}

interface AccountExportSpool {
  directory: string;
  tasksPath: string;
  filesPath: string;
}

type AccountExportTaskEntry = ReturnType<typeof createExportTask>;

class SqliteArchivePathRegistry implements ArchivePathRegistry {
  private readonly database: ArchivePathDatabase;
  private closed = false;

  constructor(path: string) {
    this.database = openArchivePathDatabase(path);
    try {
      this.database.exec(`
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = FILE;
        PRAGMA cache_size = -512;
        CREATE TABLE used_paths (path TEXT PRIMARY KEY) WITHOUT ROWID;
        BEGIN IMMEDIATE;
      `);
    } catch (error) {
      let closeFailure: { error: unknown } | undefined;
      try {
        closeSqliteDatabase(this.database);
      } catch (closeError) {
        closeFailure = { error: closeError };
      }
      if (closeFailure) {
        throw new AggregateError(
          [
            toError(error, 'SQLite initialization failed'),
            toError(closeFailure.error, 'SQLite close failed'),
          ],
          'Failed to initialize the account export path index',
          { cause: error }
        );
      }
      throw error;
    }
  }

  has(path: string): boolean {
    return this.database.has(path);
  }

  add(path: string): void {
    this.database.add(path);
  }

  complete(): void {
    if (this.closed) return;
    this.database.exec('COMMIT');
    closeSqliteDatabase(this.database);
    this.closed = true;
  }

  dispose(): void {
    if (this.closed) return;
    try {
      this.database.exec('ROLLBACK');
    } catch {
      // The transaction may already be closed after a failed commit.
    } finally {
      closeSqliteDatabase(this.database);
      this.closed = true;
    }
  }
}

function closeSqliteDatabase(database: ArchivePathDatabase): void {
  const errors: Error[] = [];
  for (let attempt = 0; attempt < SQLITE_CLOSE_ATTEMPTS; attempt++) {
    try {
      database.close();
      return;
    } catch (error) {
      errors.push(toError(error, 'SQLite close failed'));
    }
  }
  throw new AggregateError(
    errors,
    'Failed to close account export path index',
    {
      cause: errors[0],
    }
  );
}

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

async function createAccountExportSpool(
  tasks: AsyncIterable<Parameters<typeof createExportTask>[0]>,
  files: AsyncIterable<AccountExportFile>,
  headObject: (storageKey: string) => Promise<void>,
  tempRoot: string,
  signal?: globalThis.AbortSignal
): Promise<AccountExportSpool> {
  signal?.throwIfAborted();
  const directory = await mkdtemp(
    join(tempRoot, `${ACCOUNT_EXPORT_TEMP_PREFIX}${process.pid}-`)
  );
  const tasksPath = join(directory, 'tasks.jsonl');
  const filesPath = join(directory, 'files.jsonl');
  const pathIndexPath = join(directory, 'paths.sqlite');
  let tasksHandle: FileHandle | undefined;
  let filesHandle: FileHandle | undefined;
  let pathRegistry: SqliteArchivePathRegistry | undefined;

  try {
    signal?.throwIfAborted();
    await chmod(directory, 0o700);
    tasksHandle = await open(tasksPath, 'wx', 0o600);
    for await (const task of tasks) {
      signal?.throwIfAborted();
      await tasksHandle.writeFile(
        `${serializeJson(createExportTask(task))}\n`,
        'utf8'
      );
      signal?.throwIfAborted();
    }
    await tasksHandle.close();
    tasksHandle = undefined;
    await chmod(tasksPath, 0o600);

    filesHandle = await open(filesPath, 'wx', 0o600);
    pathRegistry = new SqliteArchivePathRegistry(pathIndexPath);
    await chmod(pathIndexPath, 0o600);

    for await (const file of files) {
      signal?.throwIfAborted();
      await headObject(file.storageKey);
      signal?.throwIfAborted();
      const exportPath = createArchivePath(
        file.filename,
        file.id,
        pathRegistry
      );
      const entry: AccountExportSpoolEntry = {
        manifest: createManifestEntry(file, exportPath),
        exportPath,
        storageKey: file.storageKey,
      };
      await filesHandle.writeFile(`${serializeJson(entry)}\n`, 'utf8');
      signal?.throwIfAborted();
    }

    await filesHandle.close();
    filesHandle = undefined;
    await chmod(filesPath, 0o600);
    pathRegistry.complete();
    pathRegistry = undefined;
    await rm(pathIndexPath, { force: true });
    return { directory, tasksPath, filesPath };
  } catch (error) {
    const cleanupErrors: Error[] = [];
    await tasksHandle?.close().catch(closeError => {
      cleanupErrors.push(toError(closeError, 'Failed to close tasks spool'));
    });
    await filesHandle?.close().catch(closeError => {
      cleanupErrors.push(toError(closeError, 'Failed to close files spool'));
    });
    try {
      pathRegistry?.dispose();
    } catch (closeError) {
      cleanupErrors.push(
        toError(closeError, 'Failed to close account export path index')
      );
    }
    try {
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
    } catch (removeError) {
      cleanupErrors.push(
        toError(removeError, 'Failed to remove account export spool')
      );
    }
    if (cleanupErrors.length > 0)
      throw new AggregateError(
        [toError(error, 'Account export preparation failed'), ...cleanupErrors],
        'Failed to clean up an incomplete account export',
        { cause: error }
      );
    throw error;
  }
}

async function* readAccountExportSpool<T>(path: string): AsyncGenerator<T> {
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      if (line.length === 0) continue;
      yield JSON.parse(line) as T;
    }
  } finally {
    lines.close();
    input.destroy();
    await finished(input, { cleanup: true }).catch(() => undefined);
  }
}

async function* spoolManifestEntries(spool: AccountExportSpool) {
  for await (const entry of readAccountExportSpool<AccountExportSpoolEntry>(
    spool.filesPath
  )) {
    yield entry.manifest;
  }
}

function getSpoolOwnerPid(name: string): number | undefined {
  if (!name.startsWith(ACCOUNT_EXPORT_TEMP_PREFIX)) return undefined;
  const value = name.slice(ACCOUNT_EXPORT_TEMP_PREFIX.length).split('-', 1)[0];
  if (!value || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM';
  }
}

function createJsonArrayStream(
  items: Iterable<unknown> | AsyncIterable<unknown>
): Readable {
  return Readable.from(
    (async function* () {
      yield '[';
      let first = true;
      for await (const item of items) {
        if (!first) yield ',';
        first = false;
        yield serializeJson(item);
      }
      yield ']';
    })()
  );
}

@Injectable()
export class AccountExportService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly preparedDirectories = new Set<string>();
  private readonly tempRoot: string;

  constructor(
    private readonly repository: AccountRepository,
    private readonly minio: MinioService,
    @Optional()
    @Inject(ACCOUNT_EXPORT_TEMP_ROOT)
    tempRoot?: string
  ) {
    this.tempRoot = tempRoot ?? tmpdir();
  }

  async onModuleInit(): Promise<void> {
    const entries = await readdir(this.tempRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const ownerPid = getSpoolOwnerPid(entry.name);
      if (ownerPid === undefined) continue;
      if (ownerPid !== process.pid && isProcessAlive(ownerPid)) continue;
      await this.removeSpoolDirectory(join(this.tempRoot, entry.name));
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      [...this.preparedDirectories].map(directory =>
        this.removeSpoolDirectory(directory)
      )
    );
  }

  async prepareExport(
    userId: string,
    signal?: globalThis.AbortSignal
  ): Promise<PreparedAccountExport> {
    signal?.throwIfAborted();
    const snapshotAt = new Date();
    const profile = await this.repository.getExportProfile(userId);
    signal?.throwIfAborted();
    let spool: AccountExportSpool;

    try {
      spool = await createAccountExportSpool(
        this.repository.iterateExportTasks(userId, snapshotAt, signal),
        this.repository.iterateExportFiles(userId, snapshotAt, signal),
        storageKey => this.minio.head(storageKey, signal),
        this.tempRoot,
        signal
      );
    } catch (error) {
      throw new ServiceUnavailableException('Account export is incomplete', {
        cause: error,
      });
    }
    this.preparedDirectories.add(spool.directory);

    return {
      userId,
      snapshotAt,
      filename: buildExportFilename(snapshotAt),
      profile,
      spool,
    };
  }

  async disposePreparedExport(prepared: PreparedAccountExport): Promise<void> {
    await this.removeSpoolDirectory(prepared.spool.directory);
  }

  async writeExport(
    prepared: PreparedAccountExport,
    output: Writable
  ): Promise<void> {
    let writeFailure: { error: unknown } | undefined;
    try {
      await this.streamPreparedExport(prepared, output);
    } catch (error) {
      writeFailure = { error };
    }
    let cleanupFailure: { error: unknown } | undefined;
    try {
      await this.disposePreparedExport(prepared);
    } catch (error) {
      cleanupFailure = { error };
    }

    if (writeFailure && cleanupFailure)
      throw new AggregateError(
        [
          toError(writeFailure.error, 'Account export failed'),
          toError(cleanupFailure.error, 'Account export cleanup failed'),
        ],
        'Account export failed during cleanup',
        { cause: writeFailure.error }
      );
    if (writeFailure) throw writeFailure.error;
    if (cleanupFailure) throw cleanupFailure.error;
  }

  private async streamPreparedExport(
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
      activeInput = createJsonArrayStream(
        readAccountExportSpool<AccountExportTaskEntry>(prepared.spool.tasksPath)
      );
      await appendArchiveStream(
        archive,
        activeInput,
        'tasks.json',
        abortController.signal
      );
      activeInput = undefined;

      activeInput = createJsonArrayStream(spoolManifestEntries(prepared.spool));
      await appendArchiveStream(
        archive,
        activeInput,
        'files.json',
        abortController.signal
      );
      activeInput = undefined;

      for await (const file of readAccountExportSpool<AccountExportSpoolEntry>(
        prepared.spool.filesPath
      )) {
        if (abortController.signal.aborted)
          throw getAbortReason(abortController.signal);
        const inputPromise = this.minio.downloadStream(file.storageKey);
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

  private async removeSpoolDirectory(directory: string): Promise<void> {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
    this.preparedDirectories.delete(directory);
  }
}
