import { expect, it, vi } from 'bun:test';
import { DelayedError } from 'bullmq';
import { TaskResourceBudgetService } from '../../../../src/modules/tasks/services/task-resource-budget.service';
import { TaskResourceLimitError } from '../../../../src/common/resources/resource-error';

const task = {
  id: 'task',
  type: 'pdf_merge',
  userId: 'owner',
  inputFileIds: ['a', 'b'],
  inputConfig: {},
};

it.each(['6000x6000', ' 6000x6000 '])(
  'AI 显式尺寸 %s 超像素在收费操作之前拒绝',
  async size => {
    const { service } = fixture();
    const operation = vi.fn();
    await expect(
      service.run(
        {
          type: 'image_generate',
          inputFileIds: [],
          inputConfig: { size },
        },
        {} as never,
        undefined,
        operation
      )
    ).rejects.toBeInstanceOf(TaskResourceLimitError);
    expect(operation).not.toHaveBeenCalled();
  }
);
function fixture(size = 1024) {
  const files = {
    getById: vi.fn(async (id: string) => ({
      id,
      originalSize: size,
      storageKey: id,
      mimeType: 'application/pdf',
    })),
  };
  return { files, service: new TaskResourceBudgetService(files as never) };
}

it('资源不足延后调度，operation 不运行，释放后可继续执行', async () => {
  const { files, service } = fixture();
  let finish!: () => void;
  const blocked = new Promise<void>(resolve => {
    finish = resolve;
  });
  const job = { moveToDelayed: vi.fn(async () => undefined), attemptsMade: 0 };
  const first = service.run(task, job as never, 'token', () => blocked);
  const second = service.run(task, job as never, 'token', () => blocked);
  await new Promise(resolve => setTimeout(resolve, 0));
  const operation = vi.fn();
  await expect(
    service.run(task, job as never, 'token', operation)
  ).rejects.toBeInstanceOf(DelayedError);
  expect(operation).not.toHaveBeenCalled();
  expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'token');
  expect(job.attemptsMade).toBe(0);
  expect(files.getById).toHaveBeenCalledWith('a', 'owner');
  finish();
  await Promise.all([first, second]);
  await service.run(task, job as never, 'token', operation);
  expect(operation).toHaveBeenCalledTimes(1);
});

it('执行异常后仍释放全部资源', async () => {
  const { service } = fixture();
  for (let index = 0; index < 5; index++) {
    await expect(
      service.run(task, {} as never, undefined, async () => {
        throw new Error('processor failed');
      })
    ).rejects.toThrow('processor failed');
  }
});

it('累计输入超限在任何业务处理前失败，包含 order 重复项', async () => {
  const { service } = fixture(70 * 1024 * 1024);
  const operation = vi.fn();
  await expect(
    service.run(
      { ...task, inputFileIds: ['a'], inputConfig: { order: ['a', 'a'] } },
      {} as never,
      undefined,
      operation
    )
  ).rejects.toBeInstanceOf(TaskResourceLimitError);
  expect(operation).not.toHaveBeenCalled();
});
