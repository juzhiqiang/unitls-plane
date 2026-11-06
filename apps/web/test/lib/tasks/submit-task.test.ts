import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TaskSubmitter,
  TaskSubmissionUnconfirmedError,
} from '@/lib/tasks/submit-task';
import { TaskReceiptStore } from '@/lib/tasks/task-receipts';
import type { TaskResponseDto } from '@/hooks/api/types';

const task = {
  id: '10101010-1010-4010-8010-101010101010',
  type: 'image_generate',
} as TaskResponseDto;
const input = { prompt: 'sensitive prompt', password: 'sensitive password' };
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('TaskSubmitter', () => {
  it('works on HTTP deployments without randomUUID or subtle crypto', async () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('crypto', { getRandomValues });
    const receipts = new TaskReceiptStore(() => sessionStorage);
    await new TaskSubmitter(receipts).submit(
      'user:http',
      input,
      task.type,
      async () => ({ data: task })
    );
    expect(receipts.list('user:http')[0]!.key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
  it('reuses a receipt recovered in the background until the submitting caller sees success', async () => {
    const receipts = new TaskReceiptStore(() => sessionStorage);
    const submitter = new TaskSubmitter(receipts);
    await submitter.submit('user:a', input, task.type, async () => ({
      data: task,
    }));
    const row = receipts.list('user:a')[0]!;
    receipts.put('user:a', { ...row, acknowledged: false } as typeof row);
    await submitter.submit('user:a', input, task.type, async headers => {
      expect(headers['Idempotency-Key']).toBe(row.key);
      return { data: task };
    });
    expect(receipts.list('user:a')).toHaveLength(1);
  });

  it('does not let a stale background recovery downgrade an acknowledged receipt', async () => {
    const receipts = new TaskReceiptStore(() => sessionStorage);
    receipts.put('user:a', {
      key: '30303030-3030-4030-8030-303030303030',
      fingerprint: 'b'.repeat(64),
      taskId: task.id,
      type: task.type,
      startedAt: Date.now(),
      acknowledged: true,
    });
    receipts.confirm(
      'user:a',
      { ...receipts.list('user:a')[0]!, acknowledged: false },
      task,
      false
    );
    expect(receipts.list('user:a')[0]!.acknowledged).toBe(true);
  });
  it('coalesces concurrent submissions but keeps intentional sequential generation separate', async () => {
    const receipts = new TaskReceiptStore(() => sessionStorage);
    const submitter = new TaskSubmitter(receipts);
    const send = vi.fn(async () => ({ data: task }));
    const first = submitter.submit('user:a', input, task.type, send);
    const second = submitter.submit('user:a', input, task.type, send);
    expect(first).toBe(second);
    await Promise.all([first, second]);
    await submitter.submit('user:a', input, task.type, send);
    expect(send).toHaveBeenCalledTimes(2);
    const rows = receipts.list('user:a');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.key).not.toBe(rows[1]!.key);
    expect(JSON.stringify(sessionStorage)).not.toContain('sensitive');
  });

  it('retries lost responses with the same key and restores unconfirmed receipts after refresh', async () => {
    const receipts = new TaskReceiptStore(() => sessionStorage);
    const keys: string[] = [];
    const submitter = new TaskSubmitter(receipts);
    const pending = submitter.submit(
      'user:a',
      input,
      task.type,
      async headers => {
        keys.push(headers['Idempotency-Key']!);
        throw new TypeError('offline');
      }
    );
    const rejected = expect(pending).rejects.toBeInstanceOf(
      TaskSubmissionUnconfirmedError
    );
    await rejected;
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    const refreshedStore = new TaskReceiptStore(() => sessionStorage);
    const refreshed = new TaskSubmitter(refreshedStore);
    await refreshed.submit('user:a', input, task.type, async headers => {
      expect(headers['Idempotency-Key']).toBe(keys[0]);
      return { data: task };
    });
    expect(refreshedStore.list('user:a')[0]!.taskId).toBe(task.id);
    expect(refreshedStore.list('user:b')).toEqual([]);
  });

  it('keeps an ambiguous receipt if a transport retry is throttled', async () => {
    const receipts = new TaskReceiptStore(() => sessionStorage);
    let attempts = 0;
    const pending = new TaskSubmitter(receipts).submit(
      'user:a',
      input,
      task.type,
      async () => {
        if (++attempts === 1) throw new TypeError('response lost');
        return {
          error: { message: 'slow down' },
          response: new Response(null, { status: 429 }),
        };
      }
    );
    const rejected = expect(pending).rejects.toBeInstanceOf(
      TaskSubmissionUnconfirmedError
    );
    await rejected;
    expect(attempts).toBe(2);
    expect(receipts.list('user:a')).toHaveLength(1);
  });

  it('does not retry a definite business rejection and works with unavailable storage', async () => {
    const receipts = new TaskReceiptStore(() => {
      throw new Error('blocked');
    });
    const send = vi.fn(async () => ({
      error: { message: 'quota exceeded' },
      response: new Response(null, { status: 403 }),
    }));
    const submitter = new TaskSubmitter(receipts);
    await expect(
      submitter.submit('user:a', input, task.type, send)
    ).rejects.toEqual({ message: 'quota exceeded' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(receipts.list('user:a')).toEqual([]);
    await submitter.submit('user:a', input, task.type, async () => ({
      data: task,
    }));
    expect(receipts.list('user:a')[0]!.taskId).toBe(task.id);
  });
});
