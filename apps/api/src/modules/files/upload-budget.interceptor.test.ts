import { describe, it, expect } from 'bun:test';
import { lastValueFrom, of, Subject, throwError } from 'rxjs';
import { UploadBudgetInterceptor } from './upload-budget.interceptor';
describe('upload memory budget', () => {
  it('rejects excess work before parsing and returns capacity on disconnect', async () => {
    const old = process.env.UPLOAD_MAX_CONCURRENT;
    process.env.UPLOAD_MAX_CONCURRENT = '1';
    const limiter = new UploadBudgetInterceptor();
    if (old === undefined) delete process.env.UPLOAD_MAX_CONCURRENT;
    else process.env.UPLOAD_MAX_CONCURRENT = old;
    const first = limiter
      .intercept({} as never, { handle: () => new Subject() })
      .subscribe();
    let started = false;
    await expect(
      lastValueFrom(
        limiter.intercept({} as never, {
          handle: () => {
            started = true;
            return of(1);
          },
        })
      )
    ).rejects.toThrow('Upload capacity');
    expect(started).toBe(false);
    first.unsubscribe();
    await expect(
      lastValueFrom(
        limiter.intercept({} as never, {
          handle: () => throwError(() => new Error('failed')),
        })
      )
    ).rejects.toThrow('failed');
    expect(
      await lastValueFrom(
        limiter.intercept({} as never, { handle: () => of(1) })
      )
    ).toBe(1);
  });
});
