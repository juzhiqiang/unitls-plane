import { describe, expect, it } from 'bun:test';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import {
  ResourcePool,
  resourceLimits,
} from '../../../src/common/resources/resource-limits';
import { TaskResourceLimitError } from '../../../src/common/resources/resource-error';
import {
  readBoundedStream,
  readBoundedResponse,
} from '../../../src/common/resources/bounded-read';
import {
  runWithTaskResources,
  readTaskInput,
  assertTaskImage,
} from '../../../src/common/resources/task-resource-context';

describe('共享任务资源', () => {
  it('已返回响应头但没有继续传输的流能被中止', async () => {
    const stream = new Readable({
      read() {
        /* 等待上游数据 */
      },
    });
    const controller = new globalThis.AbortController();
    const reading = readBoundedStream(stream, 5, undefined, controller.signal);
    controller.abort();
    await expect(reading).rejects.toThrow();
    expect(stream.destroyed).toBe(true);
  });
  it('同时按字节和计算权重原子预留，重复释放不扩大容量', () => {
    const pool = new ResourcePool(100, 3);
    const release = pool.tryAcquire({ memoryBytes: 70, cpu: 2 })!;
    expect(pool.tryAcquire({ memoryBytes: 40, cpu: 1 })).toBeNull();
    expect(pool.tryAcquire({ memoryBytes: 20, cpu: 2 })).toBeNull();
    const second = pool.tryAcquire({ memoryBytes: 30, cpu: 1 })!;
    expect(second).toBeFunction();
    release();
    release();
    second();
    expect(pool.tryAcquire({ memoryBytes: 100, cpu: 3 })).toBeFunction();
    expect(pool.tryAcquire({ memoryBytes: 1, cpu: 1 })).toBeNull();
  });

  it('无法放入总预算的任务直接拒绝，不永久排队', () => {
    expect(() =>
      new ResourcePool(100, 1).tryAcquire({ memoryBytes: 101, cpu: 1 })
    ).toThrow(TaskResourceLimitError);
    expect(() =>
      new ResourcePool(100, 1).tryAcquire({ memoryBytes: 1, cpu: 2 })
    ).toThrow(TaskResourceLimitError);
  });

  it('非法配置启动失败，默认值可独立解析', () => {
    expect(resourceLimits({}).memoryBytes).toBe(1024 * 1024 * 1024);
    expect(() => resourceLimits({ WORKER_MEMORY_BUDGET_MB: 'NaN' })).toThrow();
    expect(() => resourceLimits({ TASK_MAX_IMAGE_PIXELS: '0' })).toThrow();
  });

  it('读取超过实际字节上限时销毁流，等于上限允许', async () => {
    expect(
      await readBoundedStream(
        Readable.from([Buffer.alloc(3), Buffer.alloc(2)]),
        5
      )
    ).toHaveLength(5);
    const stream = Readable.from([Buffer.alloc(3), Buffer.alloc(3)]);
    await expect(readBoundedStream(stream, 5)).rejects.toBeInstanceOf(
      TaskResourceLimitError
    );
    expect(stream.destroyed).toBe(true);
  });

  it('HTTP 未声明长度也按实际响应字节拒绝', async () => {
    await expect(
      readBoundedResponse(new Response('123456'), 5)
    ).rejects.toBeInstanceOf(TaskResourceLimitError);
  });

  it('并发输入共享累计字节，低报元信息不能绕过预算', async () => {
    await runWithTaskResources(
      { limits: resourceLimits({}), inputBytes: 5, files: new Map() },
      async () => {
        const result = await Promise.allSettled([
          readTaskInput(Readable.from([Buffer.alloc(3)])),
          readTaskInput(Readable.from([Buffer.alloc(3)])),
        ]);
        expect(result.filter(item => item.status === 'rejected')).toHaveLength(
          1
        );
      }
    );
  });

  it('图片解码前检查累计像素，不以压缩文件大小代替像素', async () => {
    const input = await sharp({
      create: { width: 10, height: 10, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await runWithTaskResources(
      {
        limits: { ...resourceLimits({}), imagePixels: 150 },
        inputBytes: 1024,
        files: new Map(),
      },
      async () => {
        await assertTaskImage(input);
        await expect(assertTaskImage(input)).rejects.toBeInstanceOf(
          TaskResourceLimitError
        );
      }
    );
  });
});
