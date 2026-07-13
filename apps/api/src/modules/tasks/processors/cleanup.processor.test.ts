import { describe, expect, it, vi } from 'bun:test';
import type { Job } from 'bullmq';
import { CleanupProcessor } from './cleanup.processor';
import { CleanupScheduler } from './cleanup.scheduler';

describe('CleanupProcessor', () => {
  it('runs expired and trash cleanup once in order and returns both summaries', async () => {
    const callOrder: string[] = [];
    const expired = {
      scanned: 1,
      deleted: 1,
      failed: 0,
      deletedFileIds: ['expired-1'],
      failedFileIds: [],
    };
    const trash = {
      scanned: 2,
      deleted: 1,
      failed: 1,
      deletedFileIds: ['trash-1'],
      failedFileIds: ['trash-2'],
    };
    const cleanupExpired = vi.fn(async () => {
      callOrder.push('expired');
      return expired;
    });
    const cleanupTrashed = vi.fn(async () => {
      callOrder.push('trash');
      return trash;
    });
    const processor = new CleanupProcessor({
      cleanupExpired,
      cleanupTrashed,
    } as any);

    const result = await processor.process({ id: 'cleanup-1' } as Job);

    expect(callOrder).toEqual(['expired', 'trash']);
    expect(cleanupExpired).toHaveBeenCalledTimes(1);
    expect(cleanupTrashed).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ expired, trash });
  });
});

describe('CleanupScheduler', () => {
  it('uses a stable job id for the hourly retention schedule', async () => {
    const add = vi.fn(async () => undefined);
    const scheduler = new CleanupScheduler({ add } as any);

    await scheduler.onModuleInit();

    expect(add).toHaveBeenCalledWith(
      'cleanup-expired-files',
      {},
      {
        jobId: 'hourly-file-retention',
        repeat: { pattern: '0 * * * *' },
      }
    );
  });
});
