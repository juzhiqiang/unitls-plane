import { describe, expect, it } from 'bun:test';
import {
  hasExhaustedAttempts,
  isFinalAttempt,
  isRetryableError,
  shouldRecordFailure,
} from './attempt-outcome';

function job(attemptsMade: number, attempts?: number) {
  return {
    attemptsMade,
    opts: attempts === undefined ? {} : { attempts },
  } as never;
}

describe('isRetryableError', () => {
  it('treats ordinary errors as retryable', () => {
    expect(isRetryableError(new Error('sharp exploded'))).toBe(true);
    expect(isRetryableError(undefined)).toBe(true);
  });

  it('honours an explicit retryable flag', () => {
    expect(
      isRetryableError(Object.assign(new Error('x'), { retryable: true }))
    ).toBe(true);
    expect(
      isRetryableError(Object.assign(new Error('x'), { retryable: false }))
    ).toBe(false);
  });
});

describe('isFinalAttempt', () => {
  it('counts the attempt currently running', () => {
    // attemptsMade 在 process() 里还没算上正在跑的这次:0 + 1 === 3 才是最后一次。
    expect(isFinalAttempt(job(0, 3))).toBe(false);
    expect(isFinalAttempt(job(1, 3))).toBe(false);
    expect(isFinalAttempt(job(2, 3))).toBe(true);
  });

  it('treats a job without an attempt cap as single-shot', () => {
    expect(isFinalAttempt(job(0))).toBe(true);
  });
});

describe('shouldRecordFailure', () => {
  it('keeps the task out of failed while a retry is still coming', () => {
    expect(shouldRecordFailure(job(0, 2), new Error('gateway 502'))).toBe(
      false
    );
  });

  it('records the failure on the last attempt', () => {
    expect(shouldRecordFailure(job(1, 2), new Error('gateway 502'))).toBe(true);
  });

  it('records deterministic failures immediately', () => {
    const rejected = Object.assign(new Error('content policy'), {
      retryable: false,
    });
    expect(shouldRecordFailure(job(0, 3), rejected)).toBe(true);
  });
});

describe('hasExhaustedAttempts', () => {
  it('does not count the running attempt twice', () => {
    // 'failed' 事件里 attemptsMade 已经算上刚失败的那次。
    expect(hasExhaustedAttempts(job(1, 2))).toBe(false);
    expect(hasExhaustedAttempts(job(2, 2))).toBe(true);
  });
});
