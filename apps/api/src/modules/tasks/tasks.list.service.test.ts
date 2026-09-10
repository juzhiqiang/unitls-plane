import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

const eq = vi.fn((column: unknown, value: unknown) => ({
  kind: 'eq',
  column,
  value,
}));
const inArray = vi.fn((column: unknown, values: readonly unknown[]) => ({
  kind: 'inArray',
  column,
  values,
}));
const and = vi.fn((...conditions: unknown[]) => ({
  kind: 'and',
  conditions,
}));
const asc = vi.fn();
const desc = vi.fn();
const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
  kind: 'sql',
  strings: [...strings],
  values,
}));
const getTableColumns = vi.fn(() => ({ id: 'id', type: 'type' }));
const gte = vi.fn();
const ne = vi.fn();
const cursorCondition = vi.fn((cursor: string | undefined, scope: string) => ({
  kind: 'cursor',
  cursor,
  scope,
}));
const finishPage = vi.fn((_rows: unknown[], _limit: number, scope: string) => {
  return { items: [], nextCursor: scope };
});
const paginationOptions = vi.fn(() => ({
  offset: 0,
  limit: 20,
}));

const tasks = {
  userId: 'userId',
  status: 'status',
  type: 'type',
  createdAt: 'createdAt',
  id: 'id',
};
const selectCalls: Array<{
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
}> = [];
const select = vi.fn(() => {
  const selectionIndex = selectCalls.length;
  const offset = vi.fn(async () => []);
  const limit = vi.fn(() => ({ offset }));
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn((condition: unknown) => {
    if (selectionIndex === 0) {
      return { orderBy };
    }
    return Promise.resolve([{ count: 0, condition }]);
  });
  const from = vi.fn(() => ({ where }));
  selectCalls.push({ where, orderBy });
  return { from };
});

mock.module('drizzle-orm', () => ({
  and,
  asc,
  desc,
  eq,
  gte,
  getTableColumns,
  inArray,
  ne,
  sql,
}));
mock.module('@utils-plane/db', () => ({
  db: { select },
  tasks,
}));
mock.module('../files/files.service', () => ({
  FilesService: class {},
}));
mock.module('../files/cleanup-obligation.service', () => ({
  CleanupObligationService: class {},
}));
mock.module('./task-job-reconciler.service', () => ({
  TaskJobReconciler: class {},
}));
mock.module('../../common/database/active-user-transaction', () => ({
  withActiveUserTransaction: vi.fn(),
  withProducerTransaction: vi.fn(),
}));
mock.module('../../common/database/list-pagination', () => ({
  cursorCondition,
  finishPage,
  paginationOptions,
}));

const { TasksService } = await import('./tasks.service');

function createService() {
  return new TasksService(
    { name: 'image-queue' } as never,
    { name: 'pdf-queue' } as never,
    { name: 'font-queue' } as never,
    { name: 'ai-queue' } as never,
    {} as never,
    {} as never,
    {} as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  selectCalls.length = 0;
});

describe('TasksService listByUser category filtering', () => {
  it('maps the image category to every image task type and scopes cursors by category', async () => {
    const service = createService();

    await service.listByUser('user-1', {
      page: 1,
      limit: 20,
      category: 'image',
      cursor: 'cursor-1',
      includeTotal: false,
    });

    expect(inArray).toHaveBeenCalledWith(tasks.type, [
      'compress',
      'convert',
      'image_watermark',
      'image_id_photo',
      'image_generate',
    ]);
    expect(cursorCondition).toHaveBeenCalledWith(
      'cursor-1',
      JSON.stringify(['tasks', 'user-1', '', '', 'image']),
      tasks.createdAt,
      tasks.id
    );
    expect(finishPage).toHaveBeenCalledWith(
      [],
      20,
      JSON.stringify(['tasks', 'user-1', '', '', 'image'])
    );
  });

  it('combines category inArray and exact type filters with AND semantics', async () => {
    const service = createService();

    await service.listByUser('user-1', {
      page: 1,
      limit: 20,
      category: 'pdf',
      type: 'pdf_merge',
      includeTotal: false,
    });

    expect(inArray).toHaveBeenCalledWith(tasks.type, [
      'pdf_merge',
      'pdf_split',
      'pdf_to_image',
      'pdf_to_text',
      'image_to_pdf',
      'pdf_rotate',
      'pdf_watermark',
      'pdf_encrypt',
      'pdf_compress',
      'pdf_metadata',
      'pdf_rearrange',
      'pdf_from_document',
    ]);

    const listWhere = selectCalls[0]?.where;
    expect(listWhere).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'and',
        conditions: expect.arrayContaining([
          { kind: 'eq', column: tasks.userId, value: 'user-1' },
          {
            kind: 'eq',
            column: tasks.type,
            value: 'pdf_merge',
          },
          expect.objectContaining({
            kind: 'inArray',
            column: tasks.type,
          }),
        ]),
      })
    );
  });

  it('maps the font category to font_convert', async () => {
    const service = createService();

    await service.listByUser('user-1', {
      page: 1,
      limit: 20,
      category: 'font',
      includeTotal: false,
    });

    expect(inArray).toHaveBeenCalledWith(tasks.type, ['font_convert']);
  });
});
