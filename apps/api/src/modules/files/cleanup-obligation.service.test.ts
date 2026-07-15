import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

const conflictUpdate = vi.fn(async () => undefined);
const insertValues = vi.fn(() => ({ onConflictDoUpdate: conflictUpdate }));
const insert = vi.fn(() => ({ values: insertValues }));
const transactionConflictUpdate = vi.fn(async () => undefined);
const transactionInsertValues = vi.fn(() => ({
  onConflictDoUpdate: transactionConflictUpdate,
}));
const transactionInsert = vi.fn(() => ({ values: transactionInsertValues }));
const transactionDeleteWhere = vi.fn(async () => undefined);
const transactionDelete = vi.fn(() => ({ where: transactionDeleteWhere }));
const transactionForUpdate = vi.fn(async () => selectRows);
const transactionSelectLimit = vi.fn(() => ({ for: transactionForUpdate }));
const transactionSelectWhere = vi.fn(() => ({
  limit: transactionSelectLimit,
}));
const transactionSelectFrom = vi.fn(() => ({
  where: transactionSelectWhere,
}));
const transactionSelect = vi.fn(() => ({ from: transactionSelectFrom }));
const transaction = {
  delete: transactionDelete,
  insert: transactionInsert,
  select: transactionSelect,
};
const deleteWhere = vi.fn(async () => undefined);
const deleteFrom = vi.fn(() => ({ where: deleteWhere }));
let updateRows: Record<string, unknown>[] = [];
const updateReturning = vi.fn(async () => updateRows);
const updateWhere = vi.fn(() => ({ returning: updateReturning }));
const updateSet = vi.fn(() => ({ where: updateWhere }));
const update = vi.fn(() => ({ set: updateSet }));
let selectRows: Record<string, unknown>[] = [];
const selectLimit = vi.fn(async () => selectRows);
const selectOrderBy = vi.fn(() => ({ limit: selectLimit }));
const selectWhere = vi.fn(() => ({
  limit: selectLimit,
  orderBy: selectOrderBy,
}));
const selectFrom = vi.fn(() => ({
  orderBy: selectOrderBy,
  where: selectWhere,
}));
const select = vi.fn(() => ({ from: selectFrom }));
const eq = vi.fn((column: unknown, value: unknown) => [column, value]);
const and = vi.fn((...conditions: unknown[]) => conditions);
const asc = vi.fn((column: unknown) => ['asc', column]);
const desc = vi.fn((column: unknown) => ['desc', column]);
const inArray = vi.fn((column: unknown, values: unknown) => [column, values]);
const isNotNull = vi.fn((column: unknown) => ['is-not-null', column]);
const isNull = vi.fn((column: unknown) => ['is-null', column]);
const like = vi.fn((column: unknown, value: unknown) => [
  'like',
  column,
  value,
]);
const lte = vi.fn((column: unknown, value: unknown) => ['lte', column, value]);
const or = vi.fn((...conditions: unknown[]) => ['or', ...conditions]);
const sql = vi.fn((strings: TemplateStringsArray) => strings.join('?'));

mock.module('drizzle-orm', () => ({
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  or,
  sql,
}));
mock.module('@utils-plane/db', () => ({
  cleanupObligations: {
    kind: 'obligation-kind',
    resourceId: 'obligation-resource-id',
    state: 'obligation-state',
    reconcileAfter: 'obligation-reconcile-after',
    createdAt: 'obligation-created-at',
  },
  db: {
    delete: deleteFrom,
    insert,
    select,
    update,
  },
  files: { id: 'file-id' },
  tasks: { id: 'task-id' },
  user: {},
}));

const {
  CLEANUP_OBLIGATION_LEASE_MS,
  CLEANUP_OBLIGATION_RETRY_MS,
  CleanupObligationService,
} = await import('./cleanup-obligation.service');

describe('CleanupObligationService', () => {
  beforeEach(() => {
    selectRows = [];
    updateRows = [];
    vi.clearAllMocks();
  });

  it('upserts object cleanup intent before object storage work', async () => {
    const service = new CleanupObligationService();

    await service.recordObject(
      '00000000-0000-4000-8000-000000000001',
      'user-1/file-1/private.png'
    );

    expect(CLEANUP_OBLIGATION_LEASE_MS).toBe(60 * 60 * 1000);

    expect(insertValues).toHaveBeenCalledWith({
      kind: 'object',
      state: 'producing',
      resourceId: '00000000-0000-4000-8000-000000000001',
      storageKey: 'user-1/file-1/private.png',
      queueName: null,
      jobId: null,
    });
    expect(conflictUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: ['obligation-kind', 'obligation-resource-id'],
        set: expect.objectContaining({
          state: 'producing',
          storageKey: 'user-1/file-1/private.png',
          reconcileAfter: expect.stringContaining('now()'),
        }),
      })
    );
  });

  it('upserts an immediately eligible task outbox row with the caller transaction', async () => {
    const service = new CleanupObligationService();
    const now = new Date('2026-07-15T00:00:00.000Z');

    await service.recordTaskJob(
      '00000000-0000-4000-8000-000000000002',
      'pdf-queue',
      '00000000-0000-4000-8000-000000000002',
      transaction as any,
      now
    );

    expect(transactionInsertValues).toHaveBeenCalledWith({
      kind: 'task-job',
      state: 'ready',
      resourceId: '00000000-0000-4000-8000-000000000002',
      storageKey: null,
      queueName: 'pdf-queue',
      jobId: '00000000-0000-4000-8000-000000000002',
      reconcileAfter: expect.stringContaining('now()'),
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it('locks and accepts only a producing object row for the file transaction', async () => {
    const service = new CleanupObligationService();
    selectRows = [{ state: 'producing' }];

    await expect(
      service.lockObjectProducer(
        transaction as any,
        '00000000-0000-4000-8000-000000000001'
      )
    ).resolves.toBe(true);

    expect(transactionForUpdate).toHaveBeenCalledWith('update');
    selectRows = [{ state: 'cleanup' }];
    await expect(
      service.lockObjectProducer(
        transaction as any,
        '00000000-0000-4000-8000-000000000001'
      )
    ).resolves.toBe(false);
  });

  it('claims due object cleanup with a persistent retry lease', async () => {
    const service = new CleanupObligationService();
    updateRows = [{ id: 'obligation-1' }];

    await expect(
      service.claimObjectCleanup('00000000-0000-4000-8000-000000000001')
    ).resolves.toBe(true);

    expect(updateSet).toHaveBeenCalledWith({
      state: 'cleanup',
      reconcileAfter: expect.stringContaining('now()'),
    });
    updateRows = [];
    await expect(
      service.claimObjectCleanup('00000000-0000-4000-8000-000000000001')
    ).resolves.toBe(false);
  });

  it('clears one obligation by kind and resource id', async () => {
    const service = new CleanupObligationService();

    await service.clear('task-job', '00000000-0000-4000-8000-000000000002');

    expect(and).toHaveBeenCalledWith(
      ['obligation-kind', 'task-job'],
      ['obligation-resource-id', '00000000-0000-4000-8000-000000000002']
    );
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it('lists only obligations whose initial safety lease has expired', async () => {
    selectRows = [{ id: 'obligation-1' }];
    const service = new CleanupObligationService();
    const now = new Date('2026-07-15T00:59:59.999Z');

    await expect(service.list(25, now)).resolves.toEqual(selectRows);

    expect(lte).toHaveBeenCalledWith('obligation-reconcile-after', now);
    expect(selectWhere).toHaveBeenCalledWith([
      'lte',
      'obligation-reconcile-after',
      now,
    ]);
    expect(asc).toHaveBeenCalledWith('obligation-reconcile-after');
    expect(asc).toHaveBeenCalledWith('obligation-created-at');
    expect(selectOrderBy).toHaveBeenCalledWith(
      ['asc', 'obligation-reconcile-after'],
      ['asc', 'obligation-created-at']
    );
    expect(selectLimit).toHaveBeenCalledWith(25);
  });

  it('defers a failed reconciliation without rewriting its creation time', async () => {
    const service = new CleanupObligationService();
    const now = new Date('2026-07-15T01:00:00.000Z');

    await service.defer('object', '00000000-0000-4000-8000-000000000001', now);

    const updateValues = updateSet.mock.calls[0]?.[0] as {
      createdAt?: Date;
      reconcileAfter?: Date;
    };
    expect(CLEANUP_OBLIGATION_RETRY_MS).toBe(60 * 1000);
    expect(updateValues).toEqual({
      reconcileAfter: new Date(now.getTime() + 60 * 1000),
    });
    expect(updateValues.createdAt).toBeUndefined();
    expect(and).toHaveBeenCalledWith(
      ['obligation-kind', 'object'],
      ['obligation-resource-id', '00000000-0000-4000-8000-000000000001']
    );
    expect(updateWhere).toHaveBeenCalledTimes(1);
  });

  it('releases a confirmed failed request for immediate reconciliation', async () => {
    const service = new CleanupObligationService();
    const now = new Date('2026-07-15T01:00:00.000Z');

    await service.release(
      'task-job',
      '00000000-0000-4000-8000-000000000002',
      now
    );

    expect(updateSet).toHaveBeenCalledWith({ reconcileAfter: now });
    expect(updateWhere).toHaveBeenCalledTimes(1);
  });

  it('checks authoritative file and task rows without loading their data', async () => {
    const service = new CleanupObligationService();
    selectRows = [{ id: 'present' }];

    await expect(
      service.fileExists('00000000-0000-4000-8000-000000000001')
    ).resolves.toBe(true);
    selectRows = [];
    await expect(
      service.taskExists('00000000-0000-4000-8000-000000000002')
    ).resolves.toBe(false);

    expect(select).toHaveBeenNthCalledWith(1, { id: 'file-id' });
    expect(select).toHaveBeenNthCalledWith(2, { id: 'task-id' });
    expect(selectLimit).toHaveBeenNthCalledWith(1, 1);
    expect(selectLimit).toHaveBeenNthCalledWith(2, 1);
  });
});
