import type { TaskResponseDto } from '@/hooks/api/types';
import { createSubmissionId } from './submission-identity';

export const RECEIPT_RETENTION_MS = 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = 'utils-plane:task-receipts:v1:';
const CLIENT_KEY = 'utils-plane:task-client:v1';
const EMPTY: readonly TaskReceipt[] = [];
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let anonymousId: string | undefined;

export interface TaskReceipt {
  key: string;
  fingerprint: string;
  taskId?: string;
  type: string;
  startedAt: number;
  hidden?: boolean;
  /** 只有提交调用方收到成功才确认；后台找回的回执仍可用于原操作重放。 */
  acknowledged?: boolean;
}

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function getTaskScope(userId?: string): string {
  if (userId) return `user:${userId}`;
  if (!anonymousId) {
    try {
      anonymousId = storage()?.getItem(CLIENT_KEY) ?? undefined;
    } catch {
      /* 内存降级 */
    }
    if (!anonymousId || !uuidPattern.test(anonymousId))
      anonymousId = createSubmissionId();
    try {
      storage()?.setItem(CLIENT_KEY, anonymousId);
    } catch {
      /* 内存降级 */
    }
  }
  return `anonymous:${anonymousId}`;
}

export function taskIdentityHeaders(scope: string): Record<string, string> {
  return scope.startsWith('anonymous:')
    ? { 'X-Task-Client-Id': scope.slice('anonymous:'.length) }
    : {};
}

export class TaskReceiptStore {
  private snapshots = new Map<string, readonly TaskReceipt[]>();
  private listeners = new Set<() => void>();
  constructor(
    private readonly getStorage: () => Storage | undefined = storage
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  serverSnapshot = () => EMPTY;

  list = (scope: string): readonly TaskReceipt[] => {
    if (!this.snapshots.has(scope)) {
      let entries: unknown;
      try {
        entries = JSON.parse(
          this.getStorage()?.getItem(STORAGE_PREFIX + scope) ?? '[]'
        );
      } catch {
        entries = [];
      }
      const rows = Array.isArray(entries)
        ? entries.filter(
            (entry): entry is TaskReceipt =>
              entry &&
              typeof entry.key === 'string' &&
              uuidPattern.test(entry.key) &&
              typeof entry.fingerprint === 'string' &&
              /^[a-f0-9]{64}$/.test(entry.fingerprint) &&
              (entry.taskId === undefined ||
                (typeof entry.taskId === 'string' &&
                  uuidPattern.test(entry.taskId))) &&
              typeof entry.type === 'string' &&
              typeof entry.startedAt === 'number' &&
              entry.startedAt > Date.now() - RECEIPT_RETENTION_MS &&
              entry.startedAt <= Date.now()
          )
        : [];
      this.snapshots.set(scope, rows.slice(-100));
    }
    return this.snapshots.get(scope)!;
  };

  put(scope: string, receipt: TaskReceipt): void {
    const rows = [
      ...this.list(scope).filter(
        row =>
          row.key !== receipt.key &&
          row.startedAt > Date.now() - RECEIPT_RETENTION_MS
      ),
      receipt,
    ].slice(-100);
    this.save(scope, rows);
  }

  remove(scope: string, key: string): void {
    this.save(
      scope,
      this.list(scope).filter(row => row.key !== key)
    );
  }

  confirm(
    scope: string,
    receipt: TaskReceipt,
    task: Pick<TaskResponseDto, 'id' | 'type'>,
    acknowledged = true
  ): void {
    this.put(scope, {
      ...receipt,
      taskId: task.id,
      type: task.type,
      acknowledged,
    });
  }

  private save(scope: string, rows: readonly TaskReceipt[]) {
    this.snapshots.set(scope, rows);
    try {
      this.getStorage()?.setItem(STORAGE_PREFIX + scope, JSON.stringify(rows));
    } catch {
      /* 不可用/配额满时仍可在当前页面恢复 */
    }
    this.listeners.forEach(listener => listener());
  }
}

export const taskReceipts = new TaskReceiptStore();
