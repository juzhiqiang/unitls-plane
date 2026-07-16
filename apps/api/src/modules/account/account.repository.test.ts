import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tables = {
  accountDeletionQueueScans: {
    name: 'accountDeletionQueueScans',
    userId: 'accountDeletionQueueScans.userId',
    queueName: 'accountDeletionQueueScans.queueName',
    version: 'accountDeletionQueueScans.version',
  },
  tasks: {
    name: 'tasks',
    id: 'tasks.id',
    userId: 'tasks.userId',
    type: 'tasks.type',
    createdAt: 'tasks.createdAt',
  },
  files: {
    name: 'files',
    id: 'files.id',
    userId: 'files.userId',
    storageKey: 'files.storageKey',
    createdAt: 'files.createdAt',
  },
  verification: { name: 'verification', value: 'verification.value' },
  account: { name: 'account', userId: 'account.userId' },
  session: { name: 'session', userId: 'session.userId' },
  user: {
    name: 'user',
    id: 'user.id',
    email: 'user.email',
    deletionStartedAt: 'user.deletionStartedAt',
  },
};

type DeleteCall = {
  table: string;
  condition?: { column: unknown; value: unknown };
};

let profiles: Array<Record<string, unknown>> = [];
let markedProfiles: Array<Record<string, unknown>> = [];
let fileRows: Array<Record<string, unknown>> = [];
let taskRows: Array<Record<string, unknown>> = [];
let taskExportPages: Array<Array<Record<string, unknown>>> | null = null;
let fileExportPages: Array<Array<Record<string, unknown>>> | null = null;
const exportPageLimits: Array<{ table: string; limit: number }> = [];
const exportOrderBy: Array<{ table: string; columns: unknown[] }> = [];
const exportWhere: Array<{ table: string; condition: unknown }> = [];
let updateValues: Record<string, unknown> | undefined;
const deleteCalls: DeleteCall[] = [];
const tx = {
  delete: vi.fn((table: { name: string }) => {
    const call: DeleteCall = { table: table.name };
    deleteCalls.push(call);
    return {
      where: vi.fn(async condition => {
        call.condition = condition;
      }),
    };
  }),
};
const transaction = vi.fn(async callback => callback(tx));
function thenableRows(rows: Array<Record<string, unknown>>) {
  return {
    then: <TResult1 = Array<Record<string, unknown>>, TResult2 = never>(
      onfulfilled?:
        | ((
            value: Array<Record<string, unknown>>
          ) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ) => Promise.resolve(rows).then(onfulfilled, onrejected),
  };
}

const select = vi.fn(() => ({
  from: vi.fn((table: { name: string }) => {
    if (table.name === 'user') {
      return {
        where: vi.fn(() => ({ limit: vi.fn(async () => profiles) })),
      };
    }
    const rows = table.name === 'tasks' ? taskRows : fileRows;
    return {
      where: vi.fn((condition: unknown) => {
        const pages =
          table.name === 'tasks' ? taskExportPages : fileExportPages;
        if (pages) {
          exportWhere.push({ table: table.name, condition });
          return {
            orderBy: vi.fn((...columns: unknown[]) => {
              exportOrderBy.push({ table: table.name, columns });
              return {
                limit: vi.fn(async (limit: number) => {
                  exportPageLimits.push({ table: table.name, limit });
                  return pages.shift() ?? [];
                }),
              };
            }),
          };
        }
        return thenableRows(rows);
      }),
    };
  }),
}));
const updateReturning = vi.fn(async () => markedProfiles);
const updateWhere = vi.fn(() => ({ returning: updateReturning }));
const updateSet = vi.fn((values: Record<string, unknown>) => {
  updateValues = values;
  return { where: updateWhere };
});
const update = vi.fn(() => ({ set: updateSet }));

mock.module('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  asc: (column: unknown) => ({ asc: column }),
  count: vi.fn(),
  desc: vi.fn(),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  gt: (column: unknown, value: unknown) => ({ gt: [column, value] }),
  inArray: vi.fn(),
  isNull: vi.fn(),
  lte: (column: unknown, value: unknown) => ({ lte: [column, value] }),
  or: (...conditions: unknown[]) => ({ or: conditions }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (result, part, index) =>
        `${result}${part}${index < values.length ? String(values[index]) : ''}`,
      ''
    ),
  sum: vi.fn(),
}));
mock.module('@utils-plane/db', () => ({
  db: { select, transaction, update },
  ...tables,
}));

const { AccountRepository } = await import('./account.repository');

beforeEach(() => {
  profiles = [];
  markedProfiles = [];
  fileRows = [];
  taskRows = [];
  taskExportPages = null;
  fileExportPages = null;
  exportPageLimits.length = 0;
  exportOrderBy.length = 0;
  exportWhere.length = 0;
  updateValues = undefined;
  deleteCalls.length = 0;
  vi.clearAllMocks();
});

describe('AccountRepository export pagination', () => {
  const snapshotAt = new Date('2026-07-16T00:00:00.000Z');

  it('loads only the export profile and removes the bounded snapshot API', async () => {
    profiles = [{ id: 'user-1', email: 'owner@example.com' }];
    const repository = new AccountRepository();

    await expect(repository.getExportProfile('user-1')).resolves.toEqual(
      profiles[0]
    );

    const source = readFileSync(
      join(import.meta.dir, 'account.repository.ts'),
      'utf8'
    );
    expect(source).not.toContain('ACCOUNT_EXPORT_MAX_TASK_ROWS');
    expect(source).not.toContain('ACCOUNT_EXPORT_MAX_FILE_ROWS');
    expect(source).not.toContain('getExportSnapshot');
    expect(source).not.toContain('.offset(');
  });

  it('continues after an exact 250-task page with a createdAt/id cursor', async () => {
    const firstPage = Array.from({ length: 250 }, (_, index) => ({
      id: `task-${String(index).padStart(4, '0')}`,
      createdAt: new Date('2026-07-15T12:00:00.123Z'),
      cursorCreatedAt: `2026-07-15 12:00:00.123${String(index).padStart(3, '0')}`,
    }));
    const publicFirstPage = firstPage.map(row => ({
      id: row.id,
      createdAt: row.createdAt,
    }));
    taskExportPages = [firstPage, []];
    const repository = new AccountRepository();

    const rows: Array<Record<string, unknown>> = [];
    for await (const row of repository.iterateExportTasks('user-1', snapshotAt))
      rows.push(row);

    expect(rows).toEqual(publicFirstPage);
    expect(exportPageLimits).toEqual([
      { table: 'tasks', limit: 250 },
      { table: 'tasks', limit: 250 },
    ]);
    expect(exportOrderBy[0]?.columns).toEqual([
      { asc: 'tasks.createdAt' },
      { asc: 'tasks.id' },
    ]);
    expect(JSON.stringify(exportWhere[0]?.condition)).toContain(
      snapshotAt.toISOString()
    );
    expect(JSON.stringify(exportWhere[1]?.condition)).toContain(
      '2026-07-15 12:00:00.123249'
    );
    expect(JSON.stringify(exportWhere[1]?.condition)).toContain('task-0249');
    expect(rows.at(-1)).not.toHaveProperty('cursorCreatedAt');
  });

  it('streams file pages without exceeding 250 rows or duplicating a cursor row', async () => {
    const firstPage = Array.from({ length: 250 }, (_, index) => ({
      id: `file-${String(index).padStart(4, '0')}`,
      createdAt: new Date('2026-07-15T12:00:00.654Z'),
      cursorCreatedAt: `2026-07-15 12:00:00.654${String(index).padStart(3, '0')}`,
    }));
    const finalRow = {
      id: 'file-0250',
      createdAt: new Date('2026-07-15T12:00:01.000Z'),
      cursorCreatedAt: '2026-07-15 12:00:01.000001',
    };
    const publicFirstPage = firstPage.map(row => ({
      id: row.id,
      createdAt: row.createdAt,
    }));
    const publicFinalRow = {
      id: finalRow.id,
      createdAt: finalRow.createdAt,
    };
    fileExportPages = [firstPage, [finalRow]];
    const repository = new AccountRepository();

    const rows: Array<Record<string, unknown>> = [];
    for await (const row of repository.iterateExportFiles('user-1', snapshotAt))
      rows.push(row);

    expect(rows).toEqual([...publicFirstPage, publicFinalRow]);
    expect(new Set(rows.map(row => row.id)).size).toBe(251);
    expect(exportPageLimits).toEqual([
      { table: 'files', limit: 250 },
      { table: 'files', limit: 250 },
    ]);
    expect(JSON.stringify(exportWhere[1]?.condition)).toContain(
      '2026-07-15 12:00:00.654249'
    );
    expect(JSON.stringify(exportWhere[1]?.condition)).toContain('file-0249');
    expect(rows.at(-1)).not.toHaveProperty('cursorCreatedAt');
  });

  it('stops before querying another task page when export preparation aborts', async () => {
    const firstPage = Array.from({ length: 250 }, (_, index) => ({
      id: `task-${String(index).padStart(4, '0')}`,
      createdAt: new Date('2026-07-15T12:00:00.123Z'),
      cursorCreatedAt: `2026-07-15 12:00:00.123${String(index).padStart(3, '0')}`,
    }));
    taskExportPages = [firstPage, []];
    const abortController = new globalThis.AbortController();
    const iterator = new AccountRepository().iterateExportTasks(
      'user-1',
      snapshotAt,
      abortController.signal
    );

    for (let index = 0; index < firstPage.length; index++)
      expect((await iterator.next()).done).toBe(false);
    const abortError = new Error('client disconnected');
    abortController.abort(abortError);

    await expect(iterator.next()).rejects.toBe(abortError);
    expect(exportPageLimits).toEqual([{ table: 'tasks', limit: 250 }]);
  });
});

describe('AccountRepository deletion state', () => {
  it('reads the deletion profile before confirmation', async () => {
    profiles = [
      {
        id: 'user-1',
        email: 'owner@example.com',
        deletionStartedAt: null,
      },
    ];

    await expect(
      new AccountRepository().getDeletionProfile('user-1')
    ).resolves.toEqual(profiles[0]);
  });

  it('marks deletion with coalesce and returns the persisted state', async () => {
    const deletionStartedAt = new Date('2026-07-15T00:00:00.000Z');
    markedProfiles = [
      { id: 'user-1', email: 'owner@example.com', deletionStartedAt },
    ];

    const result = await new AccountRepository().markDeletionStarted('user-1');

    expect(result).toEqual(markedProfiles[0]);
    expect(updateValues?.deletionStartedAt).toContain('coalesce(');
    expect(updateReturning).toHaveBeenCalledTimes(1);
  });

  it('includes task ids and types in the deletion snapshot', async () => {
    fileRows = [{ id: 'file-1', storageKey: 'user-1/file-1/report.pdf' }];
    taskRows = [{ id: 'task-1', type: 'pdf_merge' }];

    await expect(
      new AccountRepository().getDeletionSnapshot('user-1')
    ).resolves.toEqual({ files: fileRows, tasks: taskRows });
  });

  it('deletes sessions only inside the final account records transaction', async () => {
    await new AccountRepository().deleteAccountRecords('user-1');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleteCalls).toEqual([
      {
        table: 'accountDeletionQueueScans',
        condition: {
          column: 'accountDeletionQueueScans.userId',
          value: 'user-1',
        },
      },
      {
        table: 'tasks',
        condition: { column: 'tasks.userId', value: 'user-1' },
      },
      {
        table: 'files',
        condition: { column: 'files.userId', value: 'user-1' },
      },
      {
        table: 'verification',
        condition: { column: 'verification.value', value: 'user-1' },
      },
      {
        table: 'account',
        condition: { column: 'account.userId', value: 'user-1' },
      },
      {
        table: 'session',
        condition: { column: 'session.userId', value: 'user-1' },
      },
      { table: 'user', condition: { column: 'user.id', value: 'user-1' } },
    ]);
  });
});
