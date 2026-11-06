import type { TaskResponseDto } from '@/hooks/api/types';
import {
  createSubmissionId,
  submissionFingerprint,
} from './submission-identity';
import {
  taskIdentityHeaders,
  taskReceipts,
  RECEIPT_RETENTION_MS,
  type TaskReceiptStore,
} from './task-receipts';

export class TaskSubmissionUnconfirmedError extends Error {
  readonly code = 'TASK_SUBMISSION_UNCONFIRMED';
  constructor(readonly key: string) {
    super(
      'Submission could not be confirmed. Check Recent tasks before submitting again.'
    );
  }
}

export class TaskSubmissionContextChangedError extends Error {
  constructor() {
    super('Account changed. Check the original account’s task history.');
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)])
    );
  return value;
}

type SubmitResponse = {
  data?: TaskResponseDto;
  error?: unknown;
  response?: Response;
};
type Send = (
  headers: Record<string, string>,
  signal: AbortSignal
) => Promise<SubmitResponse>;

/** 每个提交 hook 一个协调器；完成后的下一次相同参数提交仍是新任务。 */
export class TaskSubmitter {
  private inFlight = new Map<string, Promise<TaskResponseDto>>();
  constructor(private readonly receipts: TaskReceiptStore = taskReceipts) {}

  submit(
    scope: string,
    operation: unknown,
    type: string,
    send: Send,
    isCurrent: () => boolean = () => true
  ): Promise<TaskResponseDto> {
    const serialized = JSON.stringify(canonical(operation));
    const identity = `${scope}:${serialized}`;
    const active = this.inFlight.get(identity);
    if (active) return active;
    const pending = this.perform(
      scope,
      serialized,
      type,
      send,
      isCurrent
    ).finally(() => this.inFlight.delete(identity));
    this.inFlight.set(identity, pending);
    return pending;
  }

  private async perform(
    scope: string,
    serialized: string,
    type: string,
    send: Send,
    isCurrent: () => boolean
  ): Promise<TaskResponseDto> {
    const fingerprint = submissionFingerprint(serialized);
    const previous = this.receipts
      .list(scope)
      .find(
        row =>
          !row.acknowledged &&
          row.fingerprint === fingerprint &&
          row.startedAt > Date.now() - RECEIPT_RETENTION_MS
      );
    const receipt = previous ?? {
      key: createSubmissionId(),
      fingerprint,
      type,
      startedAt: Date.now(),
    };
    if (!isCurrent()) throw new TaskSubmissionContextChangedError();
    this.receipts.put(scope, receipt);
    const headers = {
      ...taskIdentityHeaders(scope),
      'Idempotency-Key': receipt.key,
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!isCurrent()) throw new TaskSubmissionContextChangedError();
      let result: SubmitResponse;
      try {
        result = await send(headers, AbortSignal.timeout(30_000));
      } catch {
        if (!isCurrent()) throw new TaskSubmissionContextChangedError();
        if (attempt < 2) {
          await this.pause(attempt);
          continue;
        }
        throw new TaskSubmissionUnconfirmedError(receipt.key);
      }
      if (!isCurrent()) throw new TaskSubmissionContextChangedError();
      if (result.data?.id) {
        this.receipts.confirm(scope, receipt, result.data);
        return result.data;
      }
      const status = result.response?.status ?? (result.error ? 400 : 502);
      if (status >= 400 && status < 500 && status !== 408) {
        // 本次 4xx 不能证明之前响应丢失的请求未提交，保留回执供独立查询。
        if (previous || attempt > 0)
          throw new TaskSubmissionUnconfirmedError(receipt.key);
        this.receipts.remove(scope, receipt.key);
        throw result.error ?? new Error(`Task submission rejected (${status})`);
      }
      if (attempt < 2) await this.pause(attempt);
    }
    throw new TaskSubmissionUnconfirmedError(receipt.key);
  }

  private pause(attempt: number) {
    return new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
  }
}
