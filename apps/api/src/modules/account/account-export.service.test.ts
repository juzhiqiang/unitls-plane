import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'bun:test';
import { Database } from 'bun:sqlite';
import { once } from 'node:events';
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough, Readable } from 'node:stream';
import * as archiver from 'archiver';
import { AccountController } from './account.controller';
import type {
  AccountExportFile,
  AccountExportProfile,
  AccountExportTask,
} from './account.repository';
import {
  buildExportFilename,
  createArchivePath,
  createManifestEntry,
} from './account-export.util';
import { AccountExportService } from './account-export.service';

const createdAt = new Date('2026-07-13T08:00:00Z');
const ACCOUNT_EXPORT_TEMP_PREFIX = 'utils-plane-account-export-';
let testTempRoot: string;
type TestExportSnapshot = {
  profile: AccountExportProfile;
  tasks: AccountExportTask[];
  files: AccountExportFile[];
};

const exportSnapshot: TestExportSnapshot = {
  profile: {
    id: 'user-1',
    name: 'Export User',
    email: 'export@example.com',
    emailVerified: true,
    image: null,
    plan: 'free',
    role: 'user',
    createdAt,
    updatedAt: createdAt,
  },
  tasks: [
    {
      id: 'task-1',
      userId: 'user-1',
      type: 'compress',
      status: 'completed',
      inputFileIds: ['file-12345678'],
      inputConfig: {},
      outputFileId: 'file-12345678',
      progress: 100,
      errorCode: null,
      errorMessage: null,
      retryCount: 0,
      createdAt,
      completedAt: createdAt,
    },
  ],
  files: [
    {
      id: 'file-12345678',
      filename: 'report.pdf',
      originalSize: 4,
      storageKey: 'user-1/file-12345678/report.pdf',
      mimeType: 'application/pdf',
      createdAt,
      deletedAt: null,
    },
  ],
};

const repository = {
  getExportSnapshot: vi.fn<() => Promise<TestExportSnapshot>>(),
  getExportProfile: vi.fn(async () => {
    const snapshot = await repository.getExportSnapshot();
    return snapshot.profile;
  }),
  iterateExportTasks: vi.fn(async function* () {
    const snapshot = await repository.getExportSnapshot();
    for (const task of snapshot.tasks) yield task;
  }),
  iterateExportFiles: vi.fn(async function* () {
    const snapshot = await repository.getExportSnapshot();
    for (const file of snapshot.files) yield file;
  }),
};
const minio = {
  head: vi.fn(),
  downloadStream: vi.fn(),
};

function createService(tempRoot = testTempRoot) {
  const TestableAccountExportService = AccountExportService as unknown as new (
    repository: never,
    minio: never,
    tempRoot?: string
  ) => AccountExportService;
  return new TestableAccountExportService(
    repository as never,
    minio as never,
    tempRoot
  );
}

function collect(output: PassThrough) {
  const chunks: Buffer[] = [];
  output.on('data', chunk => chunks.push(Buffer.from(chunk)));
  return new Promise<Buffer>((resolve, reject) => {
    output.once('end', () => resolve(Buffer.concat(chunks)));
    output.once('error', reject);
  });
}

async function waitForCall(mock: ReturnType<typeof vi.fn>) {
  for (
    let attempts = 0;
    attempts < 20 && mock.mock.calls.length === 0;
    attempts++
  )
    await new Promise(resolve => setTimeout(resolve, 0));
  expect(mock).toHaveBeenCalled();
}

async function waitForListener(stream: Readable, event: string) {
  for (
    let attempts = 0;
    attempts < 20 && stream.listenerCount(event) === 0;
    attempts++
  )
    await new Promise(resolve => setTimeout(resolve, 0));
  expect(stream.listenerCount(event)).toBeGreaterThan(0);
}

function observeSettlement(promise: Promise<unknown>, timeoutMs = 100) {
  return Promise.race([
    promise.then(
      () => 'resolved' as const,
      () => 'rejected' as const
    ),
    new Promise<'pending'>(resolve =>
      setTimeout(() => resolve('pending'), timeoutMs)
    ),
  ]);
}

async function accountExportTempDirs(root = testTempRoot) {
  return new Set(
    (await readdir(root, { withFileTypes: true }))
      .filter(
        entry =>
          entry.isDirectory() &&
          entry.name.startsWith(ACCOUNT_EXPORT_TEMP_PREFIX)
      )
      .map(entry => join(root, entry.name))
  );
}

async function waitForNewAccountExportTempDir(baseline: Set<string>) {
  for (let attempts = 0; attempts < 50; attempts++) {
    const current = await accountExportTempDirs();
    const created = [...current].find(path => !baseline.has(path));
    if (created) return created;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  return undefined;
}

async function expectAccountExportTempDirRemoved(
  baseline: Set<string>,
  observed: string | undefined
) {
  expect(observed).toBeDefined();
  expect(await accountExportTempDirs()).toEqual(baseline);
}

async function removeNewAccountExportTempDirs(baseline: Set<string>) {
  for (const directory of await accountExportTempDirs()) {
    if (!baseline.has(directory))
      await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
}

const OUTPUT_COMPLETION_EVENTS = ['finish', 'end', 'error', 'close'] as const;

function outputListenerCounts(output: PassThrough) {
  return new Map(
    OUTPUT_COMPLETION_EVENTS.map(event => [event, output.listenerCount(event)])
  );
}

function expectOutputListenerCounts(
  output: PassThrough,
  baseline: Map<(typeof OUTPUT_COMPLETION_EVENTS)[number], number>
) {
  for (const event of OUTPUT_COMPLETION_EVENTS)
    expect(output.listenerCount(event)).toBe(baseline.get(event));
}

beforeAll(async () => {
  testTempRoot = await mkdtemp(join(tmpdir(), 'utils-plane-export-tests-'));
});

afterAll(async () => {
  await rm(testTempRoot, { recursive: true, force: true, maxRetries: 3 });
});

beforeEach(() => {
  vi.clearAllMocks();
  repository.getExportSnapshot.mockReset();
  repository.getExportProfile.mockClear();
  repository.iterateExportTasks.mockClear();
  repository.iterateExportFiles.mockClear();
  minio.head.mockReset();
  minio.downloadStream.mockReset();
  repository.getExportSnapshot.mockResolvedValue(exportSnapshot);
  minio.head.mockResolvedValue(undefined);
  minio.downloadStream.mockResolvedValue(Readable.from(Buffer.from('%PDF')));
});

describe('account export utilities', () => {
  it('builds a UTC export filename', () => {
    expect(buildExportFilename(new Date('2026-07-13T08:09:10Z'))).toBe(
      'utils-plane-export-20260713-080910.zip'
    );
  });

  it('sanitizes traversal and disambiguates duplicate archive paths', () => {
    const usedPaths = new Set<string>();

    expect(createArchivePath('../report.pdf', 'file-12345678', usedPaths)).toBe(
      'files/report.pdf'
    );
    expect(createArchivePath('report.pdf', 'file-12345678', usedPaths)).toBe(
      'files/report-file-1234.pdf'
    );
  });

  it('removes C1 control characters while preserving the filename extension', () => {
    expect(
      createArchivePath('safe\u0085-report.pdf', 'file-12345678', new Set())
    ).toBe('files/safe-report.pdf');
  });

  it('creates Windows-compatible archive names', () => {
    const usedPaths = new Set<string>();

    expect(createArchivePath('CON.txt', 'file-11111111', usedPaths)).toBe(
      'files/_CON.txt'
    );
    expect(
      createArchivePath('bad:name?.pdf ', 'file-22222222', usedPaths)
    ).toBe('files/bad_name_.pdf');
    expect(createArchivePath('trailing. ', 'file-33333333', usedPaths)).toBe(
      'files/trailing'
    );
  });

  it('deduplicates archive paths case-insensitively', () => {
    const usedPaths = new Set<string>();

    expect(createArchivePath('Report.pdf', 'file-33333333', usedPaths)).toBe(
      'files/Report.pdf'
    );
    expect(createArchivePath('report.pdf', 'file-44444444', usedPaths)).toBe(
      'files/report-file-4444.pdf'
    );
  });

  it('limits archive filename length while retaining its extension', () => {
    const exportPath = createArchivePath(
      `${'x'.repeat(300)}.pdf`,
      'file-55555555',
      new Set()
    );

    expect(Array.from(exportPath).length).toBeLessThanOrEqual(206);
    expect(exportPath).toEndWith('.pdf');
  });

  it('creates a trashed manifest entry without its storage key', () => {
    const entry = createManifestEntry(
      { ...exportSnapshot.files[0]!, deletedAt: createdAt },
      'files/report.pdf'
    );

    expect(entry).toMatchObject({
      id: 'file-12345678',
      status: 'trashed',
      exportPath: 'files/report.pdf',
    });
    expect(entry).not.toHaveProperty('storageKey');
  });
});

describe('AccountExportService', () => {
  it('closes SQLite and removes the spool when path registry initialization fails', async () => {
    const baselineTempDirs = await accountExportTempDirs();
    const openedDatabases = new Set<Database>();
    const exec = vi
      .spyOn(Database.prototype, 'exec')
      .mockImplementationOnce(function (this: Database) {
        openedDatabases.add(this);
        throw new Error('SQLite initialization failed');
      });
    const close = vi.spyOn(Database.prototype, 'close');

    try {
      const failure = await createService()
        .prepareExport('user-1')
        .catch(error => error as Error & { cause?: unknown });

      expect(failure.message).toContain('Account export is incomplete');
      expect(failure.cause).toBeInstanceOf(Error);
      expect((failure.cause as Error).message).toBe(
        'SQLite initialization failed'
      );
      expect(close).toHaveBeenCalledTimes(1);
      expect(await accountExportTempDirs()).toEqual(baselineTempDirs);
    } finally {
      exec.mockRestore();
      close.mockRestore();
      for (const database of openedDatabases) database.close(false);
      await removeNewAccountExportTempDirs(baselineTempDirs);
    }
  });

  it('retries SQLite close failures and still removes the spool directory', async () => {
    const baselineTempDirs = await accountExportTempDirs();
    const originalClose = Database.prototype.close;
    const openedDatabases = new Set<Database>();
    const close = vi
      .spyOn(Database.prototype, 'close')
      .mockImplementation(function (this: Database, throwOnError?: boolean) {
        openedDatabases.add(this);
        if (close.mock.calls.length < 3) throw new Error('SQLite close failed');
        return originalClose.call(this, throwOnError);
      });
    minio.head.mockRejectedValueOnce(new Error('missing object'));

    try {
      await expect(createService().prepareExport('user-1')).rejects.toThrow(
        'Account export is incomplete'
      );

      expect(close).toHaveBeenCalledTimes(3);
      expect(await accountExportTempDirs()).toEqual(baselineTempDirs);
    } finally {
      close.mockRestore();
      for (const database of openedDatabases) database.close(false);
      await removeNewAccountExportTempDirs(baselineTempDirs);
    }
  });

  it('streams 1001 tasks and 10001 files without retaining bounded snapshot rows', async () => {
    const tasks = Array.from({ length: 1_001 }, (_, index) => ({
      ...exportSnapshot.tasks[0]!,
      id: `task-${String(index).padStart(5, '0')}`,
      inputConfig: { sequence: index },
    }));
    const files = Array.from({ length: 10_001 }, (_, index) => ({
      ...exportSnapshot.files[0]!,
      id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
      filename: 'report.pdf',
      storageKey: `user-1/file-${index}/report.pdf`,
    }));
    const iterationSnapshots: Date[] = [];
    const streamingRepository = {
      getExportProfile: vi.fn().mockResolvedValue(exportSnapshot.profile),
      iterateExportTasks: vi.fn(async function* (
        _userId: string,
        snapshotAt: Date
      ) {
        iterationSnapshots.push(snapshotAt);
        for (const task of tasks) yield task;
      }),
      iterateExportFiles: vi.fn(async function* (
        _userId: string,
        snapshotAt: Date
      ) {
        iterationSnapshots.push(snapshotAt);
        for (const file of files) yield file;
      }),
    };
    const largeMinio = {
      head: vi.fn().mockResolvedValue(undefined),
      downloadStream: vi
        .fn()
        .mockImplementation(async () => Readable.from(Buffer.from([1]))),
    };
    const service = new AccountExportService(
      streamingRepository as never,
      largeMinio as never,
      testTempRoot
    );

    const prepared = await service.prepareExport('user-1');
    expect(Object.keys(prepared).sort()).toEqual([
      'filename',
      'profile',
      'snapshotAt',
      'spool',
      'userId',
    ]);
    expect(largeMinio.head).toHaveBeenCalledTimes(10_001);

    const archivePrototype = (
      archiver as unknown as {
        ZipArchive: { prototype: archiver.Archiver };
      }
    ).ZipArchive.prototype;
    const originalAppend = archivePrototype.append;
    const metadataChunks = new Map<string, Buffer[]>([
      ['tasks.json', []],
      ['files.json', []],
    ]);
    const objectPaths: string[] = [];
    const append = vi
      .spyOn(archivePrototype, 'append')
      .mockImplementation(function (this: archiver.Archiver, source, data) {
        const chunks = metadataChunks.get(data.name);
        if (chunks && source instanceof Readable)
          source.on('data', chunk => chunks.push(Buffer.from(chunk)));
        if (data.name.startsWith('files/') && data.name !== 'files.json')
          objectPaths.push(data.name);
        return originalAppend.call(this, source, data);
      });
    const output = new PassThrough();
    output.resume();

    try {
      await service.writeExport(prepared, output);
    } finally {
      append.mockRestore();
    }

    const exportedTasks = JSON.parse(
      Buffer.concat(metadataChunks.get('tasks.json')!).toString('utf8')
    ) as Array<{ id: string }>;
    const exportedFiles = JSON.parse(
      Buffer.concat(metadataChunks.get('files.json')!).toString('utf8')
    ) as Array<{ id: string; exportPath: string }>;
    expect(exportedTasks.map(task => task.id)).toEqual(
      tasks.map(task => task.id)
    );
    expect(exportedFiles.map(file => file.id)).toEqual(
      files.map(file => file.id)
    );
    expect(objectPaths).toEqual(exportedFiles.map(file => file.exportPath));
    expect(new Set(objectPaths).size).toBe(10_001);
    expect(largeMinio.downloadStream).toHaveBeenCalledTimes(10_001);
    expect(streamingRepository.iterateExportTasks).toHaveBeenCalledTimes(1);
    expect(streamingRepository.iterateExportFiles).toHaveBeenCalledTimes(1);
    expect(
      iterationSnapshots.every(value => value === prepared.snapshotAt)
    ).toBe(true);
  }, 60_000);

  it('spools one stable file sequence for matching manifest and object paths', async () => {
    const firstFile = exportSnapshot.files[0]!;
    const secondFile = {
      ...firstFile,
      id: 'file-87654321',
      storageKey: 'user-1/file-87654321/report.pdf',
    };
    const fileSequences = [[firstFile, secondFile], [secondFile]];
    let fileIteration = 0;
    const changingRepository = {
      getExportProfile: vi.fn().mockResolvedValue(exportSnapshot.profile),
      iterateExportTasks: vi.fn(async function* () {
        yield* [];
      }),
      iterateExportFiles: vi.fn(async function* () {
        for (const file of fileSequences[fileIteration++] ?? []) yield file;
      }),
    };
    let resolveFirstDownload: ((source: Readable) => void) | undefined;
    const firstDownload = new Promise<Readable>(resolve => {
      resolveFirstDownload = resolve;
    });
    const changingMinio = {
      head: vi.fn().mockResolvedValue(undefined),
      downloadStream: vi
        .fn()
        .mockReturnValueOnce(firstDownload)
        .mockImplementation(async () => Readable.from(Buffer.from('%PDF'))),
    };
    const service = new AccountExportService(
      changingRepository as never,
      changingMinio as never,
      testTempRoot
    );
    const archivePrototype = (
      archiver as unknown as {
        ZipArchive: { prototype: archiver.Archiver };
      }
    ).ZipArchive.prototype;
    const originalAppend = archivePrototype.append;
    const manifestChunks: Buffer[] = [];
    const objectPaths: string[] = [];
    const append = vi
      .spyOn(archivePrototype, 'append')
      .mockImplementation(function (this: archiver.Archiver, source, data) {
        if (data.name === 'files.json' && source instanceof Readable)
          source.on('data', chunk => manifestChunks.push(Buffer.from(chunk)));
        if (data.name.startsWith('files/') && data.name !== 'files.json')
          objectPaths.push(data.name);
        return originalAppend.call(this, source, data);
      });
    const output = new PassThrough();
    output.resume();
    const baselineTempDirs = await accountExportTempDirs();

    try {
      const prepared = await service.prepareExport('user-1');
      const tempDir = await waitForNewAccountExportTempDir(baselineTempDirs);
      const writing = service.writeExport(prepared, output);
      await waitForCall(changingMinio.downloadStream);
      resolveFirstDownload?.(Readable.from(Buffer.from('%PDF')));
      await writing;

      const manifest = JSON.parse(
        Buffer.concat(manifestChunks).toString('utf8')
      ) as Array<{ exportPath: string }>;
      expect(changingRepository.iterateExportFiles).toHaveBeenCalledTimes(1);
      expect(changingMinio.head.mock.calls.map(([key]) => key)).toEqual([
        firstFile.storageKey,
        secondFile.storageKey,
      ]);
      expect(
        changingMinio.downloadStream.mock.calls.map(([key]) => key)
      ).toEqual([firstFile.storageKey, secondFile.storageKey]);
      expect(objectPaths).toEqual(manifest.map(file => file.exportPath));
      await expectAccountExportTempDirRemoved(baselineTempDirs, tempDir);
    } finally {
      resolveFirstDownload?.(Readable.from(Buffer.from('%PDF')));
      append.mockRestore();
    }
  });

  it('keeps archive path collision tracking off the JavaScript heap', async () => {
    const files = Array.from({ length: 64 }, (_, index) => ({
      ...exportSnapshot.files[0]!,
      id: `file-${String(index).padStart(8, '0')}`,
      filename: 'duplicate.pdf',
      storageKey: `user-1/file-${index}/duplicate.pdf`,
    }));
    repository.getExportSnapshot.mockResolvedValue({
      ...exportSnapshot,
      files,
    });
    const originalAdd = Set.prototype.add as (
      this: Set<unknown>,
      value: unknown
    ) => Set<unknown>;
    const add = vi.spyOn(Set.prototype, 'add').mockImplementation(function (
      this: Set<unknown>,
      value: unknown
    ) {
      if (
        typeof value === 'string' &&
        value.startsWith('files/') &&
        this.size >= 8
      )
        throw new Error('archive paths retained in memory');
      return originalAdd.call(this, value);
    });
    const service = createService();
    let prepared: Awaited<ReturnType<typeof service.prepareExport>> | undefined;

    try {
      prepared = await service.prepareExport('user-1');
      expect(minio.head).toHaveBeenCalledTimes(files.length);
    } finally {
      add.mockRestore();
      if (prepared) await service.disposePreparedExport(prepared);
    }
  });

  it('spools tasks during preparation so later repository changes cannot alter the export', async () => {
    const firstTask = exportSnapshot.tasks[0]!;
    const secondTask = {
      ...firstTask,
      id: 'task-2',
      inputConfig: { sequence: 2 },
    };
    const taskSequences = [[firstTask, secondTask], [secondTask]];
    let taskIteration = 0;
    const changingRepository = {
      getExportProfile: vi.fn().mockResolvedValue(exportSnapshot.profile),
      iterateExportTasks: vi.fn(async function* () {
        for (const task of taskSequences[taskIteration++] ?? []) yield task;
      }),
      iterateExportFiles: vi.fn(async function* () {
        yield* [];
      }),
    };
    const service = new AccountExportService(
      changingRepository as never,
      { head: vi.fn(), downloadStream: vi.fn() } as never,
      testTempRoot
    );
    const archivePrototype = (
      archiver as unknown as {
        ZipArchive: { prototype: archiver.Archiver };
      }
    ).ZipArchive.prototype;
    const originalAppend = archivePrototype.append;
    const taskChunks: Buffer[] = [];
    const append = vi
      .spyOn(archivePrototype, 'append')
      .mockImplementation(function (this: archiver.Archiver, source, data) {
        if (data.name === 'tasks.json' && source instanceof Readable)
          source.on('data', chunk => taskChunks.push(Buffer.from(chunk)));
        return originalAppend.call(this, source, data);
      });
    const output = new PassThrough();
    output.resume();

    try {
      const prepared = await service.prepareExport('user-1');
      expect(changingRepository.iterateExportTasks).toHaveBeenCalledTimes(1);
      await service.writeExport(prepared, output);

      const exportedTasks = JSON.parse(
        Buffer.concat(taskChunks).toString('utf8')
      ) as Array<{ id: string }>;
      expect(exportedTasks.map(task => task.id)).toEqual([
        firstTask.id,
        secondTask.id,
      ]);
      expect(changingRepository.iterateExportTasks).toHaveBeenCalledTimes(1);
    } finally {
      append.mockRestore();
    }
  });

  it('keeps prepared spool files private and disposes an export that never starts writing', async () => {
    const baselineTempDirs = await accountExportTempDirs();
    const service = createService();
    const prepared = await service.prepareExport('user-1');
    const tempDir = await waitForNewAccountExportTempDir(baselineTempDirs);

    expect(tempDir).toBeDefined();
    if (process.platform !== 'win32') {
      expect((await stat(tempDir!)).mode & 0o777).toBe(0o700);
      for (const name of ['tasks.jsonl', 'files.jsonl'])
        expect((await stat(join(tempDir!, name))).mode & 0o777).toBe(0o600);
    }

    await service.disposePreparedExport(prepared);

    await expectAccountExportTempDirRemoved(baselineTempDirs, tempDir);
  });

  it('disposes every prepared spool when the service shuts down', async () => {
    const baselineTempDirs = await accountExportTempDirs();
    const service = createService();
    await service.prepareExport('user-1');
    const tempDir = await waitForNewAccountExportTempDir(baselineTempDirs);

    await service.onApplicationShutdown();

    await expectAccountExportTempDirRemoved(baselineTempDirs, tempDir);
  });

  it('removes a prepared spool when write initialization fails synchronously', async () => {
    const baselineTempDirs = await accountExportTempDirs();
    const service = createService();
    const prepared = await service.prepareExport('user-1');
    const tempDir = await waitForNewAccountExportTempDir(baselineTempDirs);

    try {
      await expect(
        service.writeExport(prepared, {
          destroyed: false,
          closed: false,
        } as never)
      ).rejects.toThrow();

      await expectAccountExportTempDirRemoved(baselineTempDirs, tempDir);
    } finally {
      await service.disposePreparedExport(prepared).catch(() => undefined);
      await removeNewAccountExportTempDirs(baselineTempDirs);
    }
  });

  it('limits startup cleanup to the configured temporary root', async () => {
    const isolatedRoot = await mkdtemp(join(testTempRoot, 'isolated-root-'));
    const insideDir = await mkdtemp(
      join(
        isolatedRoot,
        `${ACCOUNT_EXPORT_TEMP_PREFIX}${process.pid}-inside-test-`
      )
    );
    const outsideDir = await mkdtemp(
      join(
        testTempRoot,
        `${ACCOUNT_EXPORT_TEMP_PREFIX}${process.pid}-outside-test-`
      )
    );

    try {
      await createService(isolatedRoot).onModuleInit();

      expect((await accountExportTempDirs(isolatedRoot)).has(insideDir)).toBe(
        false
      );
      expect((await accountExportTempDirs()).has(outsideDir)).toBe(true);
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('removes spool directories left by a stopped process during module startup', async () => {
    const staleDir = join(
      testTempRoot,
      `${ACCOUNT_EXPORT_TEMP_PREFIX}2147483647-stale-test`
    );
    await mkdir(staleDir, { recursive: true });
    await writeFile(join(staleDir, 'files.jsonl'), '{}\n');

    await createService().onModuleInit();

    expect((await accountExportTempDirs()).has(staleDir)).toBe(false);
  });

  it('removes a startup spool directory even when the operating system reused its pid', async () => {
    const reusedPidDir = join(
      testTempRoot,
      `${ACCOUNT_EXPORT_TEMP_PREFIX}${process.pid}-reused-test`
    );
    await mkdir(reusedPidDir, { recursive: true });

    await createService().onModuleInit();

    expect((await accountExportTempDirs()).has(reusedPidDir)).toBe(false);
  });

  it('keeps spool directories owned by another process that is still alive', async () => {
    const livePid = 2_147_483_646;
    const liveDir = join(
      testTempRoot,
      `${ACCOUNT_EXPORT_TEMP_PREFIX}${livePid}-live-test`
    );
    await mkdir(liveDir, { recursive: true });
    const kill = vi.spyOn(process, 'kill').mockImplementation(pid => {
      if (pid === livePid) return true;
      throw new Error(`Unexpected pid: ${String(pid)}`);
    });

    try {
      await createService().onModuleInit();

      expect((await accountExportTempDirs()).has(liveDir)).toBe(true);
    } finally {
      kill.mockRestore();
      await rm(liveDir, { recursive: true, force: true });
    }
  });

  it('heads objects sequentially and rejects an incomplete snapshot before downloading', async () => {
    repository.getExportSnapshot.mockResolvedValue({
      ...exportSnapshot,
      files: [
        exportSnapshot.files[0]!,
        {
          ...exportSnapshot.files[0]!,
          id: 'file-87654321',
          filename: 'second.pdf',
          storageKey: 'user-1/file-87654321/second.pdf',
        },
      ],
    });
    let finishFirstHead: (() => void) | undefined;
    minio.head
      .mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            finishFirstHead = resolve;
          })
      )
      .mockRejectedValueOnce(new Error('missing object'));

    const baselineTempDirs = await accountExportTempDirs();
    const preparing = createService().prepareExport('user-1');
    await waitForCall(minio.head);
    expect(minio.head).toHaveBeenCalledTimes(1);
    finishFirstHead?.();

    await expect(preparing).rejects.toThrow('Account export is incomplete');

    expect(minio.head.mock.calls.map(([key]) => key)).toEqual([
      'user-1/file-12345678/report.pdf',
      'user-1/file-87654321/second.pdf',
    ]);
    expect(minio.downloadStream).not.toHaveBeenCalled();
    expect(await accountExportTempDirs()).toEqual(baselineTempDirs);
  });

  it('cancels object preflight and removes the spool when preparation aborts', async () => {
    repository.getExportSnapshot.mockResolvedValue({
      ...exportSnapshot,
      files: [
        exportSnapshot.files[0]!,
        {
          ...exportSnapshot.files[0]!,
          id: 'file-87654321',
          filename: 'second.pdf',
          storageKey: 'user-1/file-87654321/second.pdf',
        },
      ],
    });
    let receivedSignal: globalThis.AbortSignal | undefined;
    let releaseFirstHead: (() => void) | undefined;
    minio.head.mockImplementationOnce(
      (_storageKey: string, signal?: globalThis.AbortSignal) => {
        receivedSignal = signal;
        return new Promise<void>((resolve, reject) => {
          releaseFirstHead = resolve;
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
      }
    );
    const abortController = new globalThis.AbortController();
    const baselineTempDirs = await accountExportTempDirs();
    const service = createService();
    const preparing = service.prepareExport('user-1', abortController.signal);
    await waitForCall(minio.head);

    try {
      expect(receivedSignal).toBe(abortController.signal);
      expect(repository.iterateExportTasks.mock.calls[0]?.[2]).toBe(
        abortController.signal
      );
      expect(repository.iterateExportFiles.mock.calls[0]?.[2]).toBe(
        abortController.signal
      );

      abortController.abort(new Error('client disconnected'));

      await expect(preparing).rejects.toThrow('Account export is incomplete');
      expect(minio.head).toHaveBeenCalledTimes(1);
      expect(await accountExportTempDirs()).toEqual(baselineTempDirs);
    } finally {
      abortController.abort(new Error('test cleanup'));
      releaseFirstHead?.();
      const prepared = await preparing.catch(() => undefined);
      if (prepared) await service.disposePreparedExport(prepared);
      await removeNewAccountExportTempDirs(baselineTempDirs);
    }
  });

  it('streams a complete ZIP with metadata and file contents', async () => {
    const service = createService();
    const prepared = await service.prepareExport('user-1');
    const output = new PassThrough();
    const bodyPromise = collect(output);

    await service.writeExport(prepared, output);
    const body = await bodyPromise;

    expect(body.subarray(0, 2).toString()).toBe('PK');
    for (const path of [
      'profile.json',
      'tasks.json',
      'files.json',
      'files/report.pdf',
    ]) {
      expect(body.includes(Buffer.from(path))).toBe(true);
    }
    expect(minio.head).toHaveBeenCalledTimes(1);
    expect(minio.downloadStream).toHaveBeenCalledTimes(1);
  });

  it('redacts nested sensitive task configuration from tasks.json', async () => {
    repository.getExportSnapshot.mockResolvedValue({
      ...exportSnapshot,
      tasks: [
        {
          ...exportSnapshot.tasks[0]!,
          inputConfig: {
            quality: 80,
            ownerPassword: 'owner-password-value',
            nested: {
              TOKEN: 'token-value',
              clientSecret: 'secret-value',
              Authorization: 'Bearer private-value',
              ApiKey: 'api-key-value',
              mode: 'preserve-me',
            },
          },
        },
      ],
    });
    const archivePrototype = (
      archiver as unknown as {
        ZipArchive: { prototype: archiver.Archiver };
      }
    ).ZipArchive.prototype;
    const tasksChunks: Buffer[] = [];
    const originalAppend = archivePrototype.append;
    const append = vi
      .spyOn(archivePrototype, 'append')
      .mockImplementation(function (this: archiver.Archiver, source, data) {
        if (data.name === 'tasks.json' && source instanceof Readable)
          source.on('data', chunk => tasksChunks.push(Buffer.from(chunk)));
        return originalAppend.call(this, source, data);
      });
    const service = createService();
    const prepared = await service.prepareExport('user-1');
    const output = new PassThrough();
    output.resume();

    try {
      await service.writeExport(prepared, output);
      const tasksJson = Buffer.concat(tasksChunks).toString('utf8');
      const [task] = JSON.parse(tasksJson) as Array<{
        inputConfig: Record<string, unknown>;
      }>;
      const nested = task!.inputConfig.nested as Record<string, unknown>;

      for (const secret of [
        'owner-password-value',
        'token-value',
        'secret-value',
        'Bearer private-value',
        'api-key-value',
      ]) {
        expect(tasksJson).not.toContain(secret);
      }
      expect(task!.inputConfig.ownerPassword).toBe('[REDACTED]');
      expect(nested.TOKEN).toBe('[REDACTED]');
      expect(nested.clientSecret).toBe('[REDACTED]');
      expect(nested.Authorization).toBe('[REDACTED]');
      expect(nested.ApiKey).toBe('[REDACTED]');
      expect(task!.inputConfig.quality).toBe(80);
      expect(nested.mode).toBe('preserve-me');
    } finally {
      append.mockRestore();
    }
  });

  it('appends task and file manifests as segmented readable streams', async () => {
    const archivePrototype = (
      archiver as unknown as {
        ZipArchive: { prototype: archiver.Archiver };
      }
    ).ZipArchive.prototype;
    const append = vi.spyOn(archivePrototype, 'append');
    const service = createService();
    const prepared = await service.prepareExport('user-1');
    const output = new PassThrough();
    output.resume();

    try {
      await service.writeExport(prepared, output);
      for (const name of ['tasks.json', 'files.json']) {
        const metadataCall = append.mock.calls.find(
          ([, data]) => data.name === name
        );
        expect(metadataCall?.[0]).toBeInstanceOf(Readable);
      }
    } finally {
      append.mockRestore();
    }
  });

  it('removes successful output completion listeners after export', async () => {
    const service = createService();
    const prepared = await service.prepareExport('user-1');
    const output = new PassThrough();
    output.resume();
    const baseline = outputListenerCounts(output);

    await service.writeExport(prepared, output);

    expectOutputListenerCounts(output, baseline);
  });

  it('destroys the active source and stops downloading after the client disconnects', async () => {
    const secondFile = {
      ...exportSnapshot.files[0]!,
      id: 'file-87654321',
      filename: 'second.pdf',
      storageKey: 'user-1/file-87654321/second.pdf',
    };
    repository.getExportSnapshot.mockResolvedValue({
      ...exportSnapshot,
      files: [exportSnapshot.files[0]!, secondFile],
    });
    const activeSource = new PassThrough();
    minio.downloadStream.mockResolvedValueOnce(activeSource);
    const service = createService();
    const output = new PassThrough();
    output.resume();
    const baselineTempDirs = await accountExportTempDirs();
    const prepared = await service.prepareExport('user-1');
    const tempDir = await waitForNewAccountExportTempDir(baselineTempDirs);

    const writing = service.writeExport(prepared, output);
    await waitForCall(minio.downloadStream);
    output.destroy();

    const outcome = await Promise.race([
      writing.then(
        () => 'resolved',
        () => 'rejected'
      ),
      new Promise<'pending'>(resolve =>
        setTimeout(() => resolve('pending'), 100)
      ),
    ]);
    const sourceDestroyedByService = activeSource.destroyed;
    if (!sourceDestroyedByService)
      activeSource.destroy(new Error('test cleanup'));
    await writing.catch(() => undefined);

    expect(outcome).toBe('rejected');
    expect(sourceDestroyedByService).toBe(true);
    expect(minio.downloadStream).toHaveBeenCalledTimes(1);
    await expectAccountExportTempDirRemoved(baselineTempDirs, tempDir);
  });

  it('rejects when a source closes without ending or emitting an error', async () => {
    const secondFile = {
      ...exportSnapshot.files[0]!,
      id: 'file-87654321',
      filename: 'second.pdf',
      storageKey: 'user-1/file-87654321/second.pdf',
    };
    repository.getExportSnapshot.mockResolvedValue({
      ...exportSnapshot,
      files: [exportSnapshot.files[0]!, secondFile],
    });
    const source = new PassThrough();
    minio.downloadStream.mockResolvedValueOnce(source);
    const service = createService();
    const prepared = await service.prepareExport('user-1');
    const output = new PassThrough();
    output.resume();
    output.on('error', () => undefined);

    const writing = service.writeExport(prepared, output);
    await waitForCall(minio.downloadStream);
    source.destroy();

    const outcome = await observeSettlement(writing);
    if (!output.destroyed) output.destroy(new Error('test cleanup'));

    expect(outcome).toBe('rejected');
    expect(output.destroyed).toBe(true);
    expect(minio.downloadStream).toHaveBeenCalledTimes(1);
  });

  it('rejects when source completion synchronously closes the output', async () => {
    const secondFile = {
      ...exportSnapshot.files[0]!,
      id: 'file-87654321',
      filename: 'second.pdf',
      storageKey: 'user-1/file-87654321/second.pdf',
    };
    repository.getExportSnapshot.mockResolvedValue({
      ...exportSnapshot,
      files: [exportSnapshot.files[0]!, secondFile],
    });
    const source = new PassThrough();
    const output = new PassThrough();
    output.resume();
    output.on('error', () => undefined);
    source.once('end', () => output.destroy());
    source.end('%PDF');
    minio.downloadStream.mockResolvedValueOnce(source);
    const service = createService();
    const prepared = await service.prepareExport('user-1');

    const writing = service.writeExport(prepared, output);
    const outcome = await observeSettlement(writing);

    expect(source.destroyed).toBe(true);
    expect(output.destroyed).toBe(true);
    expect(outcome).toBe('rejected');
    expect(minio.downloadStream).toHaveBeenCalledTimes(1);
  });

  it('rejects when archive aborts between download resolution and continuation', async () => {
    const secondFile = {
      ...exportSnapshot.files[0]!,
      id: 'file-87654321',
      filename: 'second.pdf',
      storageKey: 'user-1/file-87654321/second.pdf',
    };
    repository.getExportSnapshot.mockResolvedValue({
      ...exportSnapshot,
      files: [exportSnapshot.files[0]!, secondFile],
    });
    let resolveDownload: ((source: Readable) => void) | undefined;
    const download = new Promise<Readable>(resolve => {
      resolveDownload = resolve;
    });
    minio.downloadStream.mockReturnValueOnce(download);
    const archivePrototype = (
      archiver as unknown as {
        ZipArchive: { prototype: archiver.Archiver };
      }
    ).ZipArchive.prototype;
    const archiveInstances: archiver.Archiver[] = [];
    const originalAppend = archivePrototype.append;
    const append = vi
      .spyOn(archivePrototype, 'append')
      .mockImplementation(function (this: archiver.Archiver, source, data) {
        if (!archiveInstances.includes(this)) archiveInstances.push(this);
        return originalAppend.call(this, source, data);
      });
    const source = new PassThrough();
    const output = new PassThrough();
    output.resume();
    output.on('error', () => undefined);
    const service = createService();
    const prepared = await service.prepareExport('user-1');

    try {
      const writing = service.writeExport(prepared, output);
      await waitForCall(minio.downloadStream);
      expect(archiveInstances).toHaveLength(1);
      download.then(() =>
        archiveInstances[0]!.emit(
          'error',
          new Error('archive failed after download')
        )
      );
      resolveDownload?.(source);

      const outcome = await observeSettlement(writing);
      const sourceDestroyedByService = source.destroyed;
      if (!sourceDestroyedByService) source.destroy(new Error('test cleanup'));
      await writing.catch(() => undefined);

      expect(outcome).toBe('rejected');
      expect(sourceDestroyedByService).toBe(true);
      expect(output.destroyed).toBe(true);
      expect(archiveInstances[0]!.listenerCount('error')).toBe(0);
      expect(minio.downloadStream).toHaveBeenCalledTimes(1);
    } finally {
      append.mockRestore();
    }
  });

  it('rejects an asynchronous archive error during finalize', async () => {
    const finalizeError = new Error('archive finalize failed');
    const finalizedArchives: archiver.Archiver[] = [];
    let markFinalizeStarted: (() => void) | undefined;
    const finalizeStarted = new Promise<void>(resolve => {
      markFinalizeStarted = resolve;
    });
    const archivePrototype = (
      archiver as unknown as {
        ZipArchive: { prototype: archiver.Archiver };
      }
    ).ZipArchive.prototype;
    const finalize = vi
      .spyOn(archivePrototype, 'finalize')
      .mockImplementation(function (this: archiver.Archiver) {
        finalizedArchives.push(this);
        markFinalizeStarted?.();
        return new Promise<void>(() => undefined);
      });
    const service = createService();
    const output = new PassThrough();
    output.resume();
    const baseline = outputListenerCounts(output);
    const baselineTempDirs = await accountExportTempDirs();
    const prepared = await service.prepareExport('user-1');
    const tempDir = await waitForNewAccountExportTempDir(baselineTempDirs);

    try {
      const writing = service.writeExport(prepared, output);
      await finalizeStarted;
      finalizedArchives[0]!.emit('error', finalizeError);

      await expect(writing).rejects.toThrow('archive finalize failed');
      expect(output.destroyed).toBe(true);
      expectOutputListenerCounts(output, baseline);
      expect(finalizedArchives[0]?.listenerCount('error')).toBe(0);
      await expectAccountExportTempDirRemoved(baselineTempDirs, tempDir);
    } finally {
      finalize.mockRestore();
    }
  });

  it('rejects a previously closed output before downloading any objects', async () => {
    repository.getExportSnapshot.mockResolvedValue({
      ...exportSnapshot,
      files: [
        exportSnapshot.files[0]!,
        {
          ...exportSnapshot.files[0]!,
          id: 'file-87654321',
          filename: 'second.pdf',
          storageKey: 'user-1/file-87654321/second.pdf',
        },
      ],
    });
    minio.downloadStream.mockImplementation(async () =>
      Readable.from(Buffer.from('%PDF'))
    );
    const service = createService();
    const prepared = await service.prepareExport('user-1');
    const output = new PassThrough();
    output.destroy();
    await once(output, 'close');

    const error = await service
      .writeExport(prepared, output)
      .catch(error => error);

    expect(minio.downloadStream).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Account export aborted');
  });

  it('rejects and destroys the response when a source stream fails', async () => {
    repository.getExportSnapshot.mockResolvedValue({
      ...exportSnapshot,
      files: [
        exportSnapshot.files[0]!,
        {
          ...exportSnapshot.files[0]!,
          id: 'file-87654321',
          filename: 'second.pdf',
          storageKey: 'user-1/file-87654321/second.pdf',
        },
      ],
    });
    const source = new PassThrough();
    minio.downloadStream.mockResolvedValueOnce(source);
    const service = createService();
    const output = new PassThrough();
    output.resume();
    output.on('error', () => undefined);
    const baseline = outputListenerCounts(output);
    const baselineTempDirs = await accountExportTempDirs();
    const prepared = await service.prepareExport('user-1');
    const tempDir = await waitForNewAccountExportTempDir(baselineTempDirs);

    const writing = service.writeExport(prepared, output);
    await waitForCall(minio.downloadStream);
    await waitForListener(source, 'error');
    source.destroy(new Error('source failed'));

    await expect(writing).rejects.toThrow('source failed');
    expect(output.destroyed).toBe(true);
    expect(minio.downloadStream).toHaveBeenCalledTimes(1);
    expectOutputListenerCounts(output, baseline);
    await expectAccountExportTempDirRemoved(baselineTempDirs, tempDir);
  });
});

describe('AccountController export', () => {
  const accountService = { getSummary: vi.fn() };
  const exportService = {
    prepareExport: vi.fn(),
    writeExport: vi.fn(),
    disposePreparedExport: vi.fn(),
  };

  function createController() {
    return new AccountController(
      accountService as never,
      exportService as never
    );
  }

  it('rejects an export without an authenticated user', async () => {
    await expect(
      createController().exportAccount(undefined, {} as never)
    ).rejects.toThrow();
    expect(exportService.prepareExport).not.toHaveBeenCalled();
  });

  it('sets download headers only after preflight succeeds and streams the ZIP', async () => {
    const prepared = {
      userId: 'user-1',
      snapshotAt: createdAt,
      filename: 'utils-plane-export-20260713-080910.zip',
      profile: exportSnapshot.profile,
      spool: {
        directory: 'unused',
        tasksPath: 'unused',
        filesPath: 'unused',
      },
    };
    const response = {
      type: vi.fn(() => response),
      attachment: vi.fn(() => response),
      once: vi.fn(() => response),
      off: vi.fn(() => response),
      writableFinished: false,
    };
    exportService.prepareExport.mockImplementation(async () => {
      expect(response.type).not.toHaveBeenCalled();
      expect(response.attachment).not.toHaveBeenCalled();
      return prepared;
    });
    exportService.writeExport.mockResolvedValue(undefined);

    await createController().exportAccount(
      exportSnapshot.profile as never,
      response as never
    );

    expect(response.type).toHaveBeenCalledWith('application/zip');
    expect(response.attachment).toHaveBeenCalledWith(prepared.filename);
    expect(exportService.writeExport).toHaveBeenCalledWith(prepared, response);
    expect(exportService.disposePreparedExport).not.toHaveBeenCalled();
    expect(response.once).toHaveBeenCalledWith('close', expect.any(Function));
    expect(response.off).toHaveBeenCalledWith('close', expect.any(Function));
  });

  it('disposes the prepared export when setting response headers fails', async () => {
    const prepared = {
      filename: 'utils-plane-export.zip',
      spool: {
        directory: 'unused',
        tasksPath: 'unused',
        filesPath: 'unused',
      },
    };
    const headerError = new Error('headers failed');
    const response = {
      type: vi.fn(() => {
        throw headerError;
      }),
      attachment: vi.fn(),
      once: vi.fn(() => response),
      off: vi.fn(() => response),
      writableFinished: false,
    };
    exportService.prepareExport.mockResolvedValue(prepared);

    await expect(
      createController().exportAccount(
        exportSnapshot.profile as never,
        response as never
      )
    ).rejects.toThrow('headers failed');

    expect(exportService.writeExport).not.toHaveBeenCalled();
    expect(exportService.disposePreparedExport).toHaveBeenCalledWith(prepared);
  });

  it('aborts preflight without setting headers when the response closes', async () => {
    const prepared = {
      userId: 'user-1',
      snapshotAt: createdAt,
      filename: 'utils-plane-export.zip',
      profile: exportSnapshot.profile,
      spool: {
        directory: 'unused',
        tasksPath: 'unused',
        filesPath: 'unused',
      },
    };
    let receivedSignal: globalThis.AbortSignal | undefined;
    let finishPrepare: ((value: typeof prepared) => void) | undefined;
    exportService.prepareExport.mockImplementation(
      (_userId: string, signal?: globalThis.AbortSignal) => {
        receivedSignal = signal;
        return new Promise((resolve, reject) => {
          finishPrepare = resolve;
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
      }
    );
    const response = new PassThrough() as PassThrough & {
      type: ReturnType<typeof vi.fn>;
      attachment: ReturnType<typeof vi.fn>;
    };
    response.type = vi.fn(() => response);
    response.attachment = vi.fn(() => response);
    const exporting = createController().exportAccount(
      exportSnapshot.profile as never,
      response as never
    );
    await waitForCall(exportService.prepareExport);

    try {
      expect(receivedSignal).toBeInstanceOf(globalThis.AbortSignal);
      const closed = once(response, 'close');
      response.destroy();
      await closed;

      await expect(exporting).rejects.toThrow('Account export aborted');
      expect(receivedSignal?.aborted).toBe(true);
      expect(response.type).not.toHaveBeenCalled();
      expect(response.attachment).not.toHaveBeenCalled();
      expect(exportService.writeExport).not.toHaveBeenCalled();
      expect(exportService.disposePreparedExport).not.toHaveBeenCalled();
    } finally {
      if (!response.destroyed) response.destroy();
      finishPrepare?.(prepared);
      await exporting.catch(() => undefined);
    }
  });
});
