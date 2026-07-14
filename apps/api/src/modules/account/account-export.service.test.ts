import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { once } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import * as archiver from 'archiver';
import { AccountController } from './account.controller';
import type { AccountExportSnapshot } from './account.repository';
import {
  buildExportFilename,
  createArchivePath,
  createManifestEntry,
} from './account-export.util';
import { AccountExportService } from './account-export.service';

const createdAt = new Date('2026-07-13T08:00:00Z');
const exportSnapshot: AccountExportSnapshot = {
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

const repository = { getExportSnapshot: vi.fn() };
const minio = {
  head: vi.fn(),
  downloadStream: vi.fn(),
};

function createService(metadataByteLimit?: number) {
  const TestableAccountExportService = AccountExportService as unknown as new (
    repository: never,
    minio: never,
    metadataByteLimit?: number
  ) => AccountExportService;
  return new TestableAccountExportService(
    repository as never,
    minio as never,
    metadataByteLimit
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

beforeEach(() => {
  vi.clearAllMocks();
  repository.getExportSnapshot.mockReset();
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
  it('rejects oversized metadata before checking object storage', async () => {
    repository.getExportSnapshot.mockResolvedValue({
      ...exportSnapshot,
      tasks: [
        {
          ...exportSnapshot.tasks[0]!,
          inputConfig: { notes: 'x'.repeat(256) },
        },
      ],
    });

    await expect(createService(128).prepareExport('user-1')).rejects.toThrow(
      'Account export metadata is too large'
    );
    expect(minio.head).not.toHaveBeenCalled();
  });

  it('rejects too many task rows before checking object storage', async () => {
    repository.getExportSnapshot.mockResolvedValue({
      ...exportSnapshot,
      tasks: Array.from({ length: 1_001 }, (_, index) => ({
        ...exportSnapshot.tasks[0]!,
        id: `task-${index}`,
      })),
    });

    await expect(createService().prepareExport('user-1')).rejects.toThrow(
      'Account export metadata is too large'
    );
    expect(minio.head).not.toHaveBeenCalled();
  });

  it('rejects too many file rows before checking object storage', async () => {
    repository.getExportSnapshot.mockResolvedValue({
      ...exportSnapshot,
      files: Array.from({ length: 10_001 }, (_, index) => ({
        ...exportSnapshot.files[0]!,
        id: `file-${index}`,
        filename: `report-${index}.pdf`,
        storageKey: `user-1/file-${index}/report.pdf`,
      })),
    });
    minio.head.mockRejectedValueOnce(new Error('head must not run'));

    await expect(createService().prepareExport('user-1')).rejects.toThrow(
      'Account export metadata is too large'
    );
    expect(minio.head).not.toHaveBeenCalled();
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
    const prepared = await service.prepareExport('user-1');
    const output = new PassThrough();
    output.resume();

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
    const archivePrototype = (
      archiver as unknown as {
        ZipArchive: { prototype: archiver.Archiver };
      }
    ).ZipArchive.prototype;
    const finalize = vi
      .spyOn(archivePrototype, 'finalize')
      .mockImplementation(function (this: archiver.Archiver) {
        finalizedArchives.push(this);
        globalThis.queueMicrotask(() => this.emit('error', finalizeError));
        return new Promise<void>(() => undefined);
      });
    const service = createService();
    const prepared = await service.prepareExport('user-1');
    const output = new PassThrough();
    output.resume();
    const baseline = outputListenerCounts(output);

    try {
      await expect(service.writeExport(prepared, output)).rejects.toThrow(
        'archive finalize failed'
      );
      expect(output.destroyed).toBe(true);
      expectOutputListenerCounts(output, baseline);
      expect(finalizedArchives[0]?.listenerCount('error')).toBe(0);
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
    const prepared = await service.prepareExport('user-1');
    const output = new PassThrough();
    output.resume();
    output.on('error', () => undefined);
    const baseline = outputListenerCounts(output);

    const writing = service.writeExport(prepared, output);
    await waitForCall(minio.downloadStream);
    await waitForListener(source, 'error');
    source.destroy(new Error('source failed'));

    await expect(writing).rejects.toThrow('source failed');
    expect(output.destroyed).toBe(true);
    expect(minio.downloadStream).toHaveBeenCalledTimes(1);
    expectOutputListenerCounts(output, baseline);
  });
});

describe('AccountController export', () => {
  const accountService = { getSummary: vi.fn() };
  const exportService = {
    prepareExport: vi.fn(),
    writeExport: vi.fn(),
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
      filename: 'utils-plane-export-20260713-080910.zip',
      profile: exportSnapshot.profile,
      tasks: exportSnapshot.tasks,
      files: [],
    };
    const response = {
      type: vi.fn(() => response),
      attachment: vi.fn(() => response),
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
  });
});
