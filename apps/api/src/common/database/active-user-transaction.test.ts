import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import * as database from '@utils-plane/db';
import * as drizzleOrm from 'drizzle-orm';

let selectedUsers: Array<{
  id: string;
  deletionStartedAt: Date | null;
}> = [];
const events: string[] = [];
const insert = vi.fn(async () => {
  events.push('insert');
  return 'inserted';
});
const forUpdate = vi.fn(async () => {
  events.push('select-for-update');
  return selectedUsers;
});
const tx = {
  execute: vi.fn(async () => {
    events.push('transaction-timeout');
  }),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => ({ for: forUpdate })),
      })),
    })),
  })),
  insert,
};
const transaction = vi.fn(
  async (operation: (transaction: typeof tx) => Promise<unknown>) => {
    events.push('transaction');
    const result = await operation(tx);
    events.push('commit');
    return result;
  }
);
const globalInsert = vi.fn(() => {
  throw new Error('operation requested a second database connection');
});

mock.module('drizzle-orm', () => ({
  ...drizzleOrm,
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

mock.module('@utils-plane/db', () => ({
  ...database,
  db: { ...database.db, insert: globalInsert, transaction },
}));

const {
  PRODUCER_IDLE_TIMEOUT_MS,
  PRODUCER_LOCK_TIMEOUT_MS,
  PRODUCER_STATEMENT_TIMEOUT_MS,
  withActiveUserTransaction,
  withProducerTransaction,
} = await import('./active-user-transaction');

beforeEach(() => {
  selectedUsers = [{ id: 'user-1', deletionStartedAt: null }];
  events.length = 0;
  vi.clearAllMocks();
});

describe('withActiveUserTransaction', () => {
  it('uses one transaction for the user lock and operation insert', async () => {
    let operationTransaction: unknown;

    const result = await withActiveUserTransaction(
      'user-1',
      async operationTx => {
        operationTransaction = operationTx;
        return operationTx.insert();
      }
    );

    expect(result).toBe('inserted');
    expect(operationTransaction).toBe(tx);
    expect(globalInsert).not.toHaveBeenCalled();
    expect(forUpdate).toHaveBeenCalledWith('update');
    expect(events).toEqual([
      'transaction',
      'transaction-timeout',
      'transaction-timeout',
      'transaction-timeout',
      'select-for-update',
      'insert',
      'commit',
    ]);
  });

  it('bounds every producer transaction below the object intent lease', () => {
    expect(PRODUCER_LOCK_TIMEOUT_MS).toBe(30 * 1000);
    expect(PRODUCER_STATEMENT_TIMEOUT_MS).toBe(2 * 60 * 1000);
    expect(PRODUCER_IDLE_TIMEOUT_MS).toBe(2 * 60 * 1000);
    expect(
      Math.max(
        PRODUCER_LOCK_TIMEOUT_MS,
        PRODUCER_STATEMENT_TIMEOUT_MS,
        PRODUCER_IDLE_TIMEOUT_MS
      )
    ).toBeLessThan(60 * 60 * 1000);
  });

  it('configures anonymous producer transactions before database work', async () => {
    await expect(
      withProducerTransaction(operationTx => operationTx.insert())
    ).resolves.toBe('inserted');

    expect(events).toEqual([
      'transaction',
      'transaction-timeout',
      'transaction-timeout',
      'transaction-timeout',
      'insert',
      'commit',
    ]);
  });

  it('rejects without running the operation when the user is missing', async () => {
    selectedUsers = [];
    const operation = vi.fn();

    await expect(
      withActiveUserTransaction('user-1', operation)
    ).rejects.toThrow('Account not found');

    expect(operation).not.toHaveBeenCalled();
  });

  it('rejects without running the operation when account deletion started', async () => {
    selectedUsers = [
      {
        id: 'user-1',
        deletionStartedAt: new Date('2026-07-15T00:00:00.000Z'),
      },
    ];
    const operation = vi.fn();

    await expect(
      withActiveUserTransaction('user-1', operation)
    ).rejects.toThrow('Account deletion is in progress');

    expect(operation).not.toHaveBeenCalled();
  });
});
