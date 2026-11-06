import { expect, it, vi } from 'bun:test';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { TaskResourceBudgetService } from '../../../../src/modules/tasks/services/task-resource-budget.service';

it.skipIf(!process.env.RESOURCE_REDIS_TEST)(
  '真实 Redis 资源延期不消耗 attemptsMade，释放后原任务完成',
  async () => {
    const connection = { host: '127.0.0.1', port: 6379 };
    const name = `resource-budget-test-${globalThis.crypto.randomUUID()}`;
    const queue = new Queue(name, { connection });
    const events = new QueueEvents(name, { connection });
    const budget = new TaskResourceBudgetService({ getById: vi.fn() } as never);
    const task = { type: 'pdf_merge', inputFileIds: [] };
    let release!: () => void;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    const first = budget.run(task, {} as never, undefined, () => blocked);
    const second = budget.run(task, {} as never, undefined, () => blocked);
    const processed = vi.fn(async () => 'done');
    const worker = new Worker(
      name,
      (job, token) => budget.run(task, job, token, processed),
      { connection }
    );
    let job: Awaited<ReturnType<typeof queue.add>> | undefined;
    try {
      await events.waitUntilReady();
      job = await queue.add('test', {}, { attempts: 1 });
      const deadline = Date.now() + 5000;
      while ((await job.getState()) !== 'delayed' && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 20));
      expect(await job.getState()).toBe('delayed');
      expect((await queue.getJob(job.id!))?.attemptsMade).toBe(0);
      expect(processed).not.toHaveBeenCalled();
      release();
      await Promise.all([first, second]);
      expect(await job.waitUntilFinished(events, 6000)).toBe('done');
      expect(processed).toHaveBeenCalledTimes(1);
      expect((await queue.getJob(job.id!))?.attemptsMade).toBe(1);
    } finally {
      release();
      await Promise.all([first, second]);
      await worker.close();
      await job?.remove();
      await events.close();
      // 只清理本测试随机命名的队列元数据。
      await queue.obliterate();
      await queue.close();
    }
  },
  15_000
);
