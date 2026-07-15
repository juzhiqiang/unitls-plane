import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

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
  },
  files: {
    name: 'files',
    id: 'files.id',
    userId: 'files.userId',
    storageKey: 'files.storageKey',
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
const select = vi.fn(() => ({
  from: vi.fn((table: { name: string }) => {
    if (table.name === 'user') {
      return {
        where: vi.fn(() => ({ limit: vi.fn(async () => profiles) })),
      };
    }
    return {
      where: vi.fn(async () => (table.name === 'tasks' ? taskRows : fileRows)),
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
  and: vi.fn(),
  asc: vi.fn(),
  count: vi.fn(),
  desc: vi.fn(),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  inArray: vi.fn(),
  isNull: vi.fn(),
  sql: (strings: TemplateStringsArray) => strings.join(''),
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
  updateValues = undefined;
  deleteCalls.length = 0;
  vi.clearAllMocks();
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
