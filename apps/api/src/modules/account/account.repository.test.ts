import { beforeEach, expect, it, mock, vi } from 'bun:test';

const tables = {
  tasks: { name: 'tasks', userId: 'tasks.userId' },
  files: { name: 'files', userId: 'files.userId' },
  verification: {
    name: 'verification',
    identifier: 'verification.identifier',
    value: 'verification.value',
  },
  account: { name: 'account', userId: 'account.userId' },
  session: { name: 'session', userId: 'session.userId' },
  user: { name: 'user', id: 'user.id' },
};

type DeleteCall = {
  table: string;
  condition?: { column: unknown; value: unknown };
};

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

mock.module('drizzle-orm', () => ({
  and: vi.fn(),
  asc: vi.fn(),
  count: vi.fn(),
  desc: vi.fn(),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  inArray: vi.fn(),
  isNull: vi.fn(),
  sum: vi.fn(),
}));

mock.module('@utils-plane/db', () => ({
  db: { transaction },
  ...tables,
}));

const { AccountRepository } = await import('./account.repository');

beforeEach(() => {
  deleteCalls.length = 0;
  vi.clearAllMocks();
});

it('deletes password reset verification rows by user id in the fixed transaction order', async () => {
  await new AccountRepository().deleteAccountRecords('user-1');

  expect(transaction).toHaveBeenCalledTimes(1);
  expect(deleteCalls).toEqual([
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
    {
      table: 'user',
      condition: { column: 'user.id', value: 'user-1' },
    },
  ]);
});
