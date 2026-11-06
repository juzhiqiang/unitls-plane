import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import { db, tasks, taskSubmissions, type Task } from '@utils-plane/db';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { CreateTaskInput } from '@utils-plane/validators';
import type { ActiveUserTransaction } from '../../common/database/active-user-transaction';

export interface TaskSubmissionIdentity {
  key: string;
  clientId?: string;
}
export const SUBMISSION_RETENTION_MS = 24 * 60 * 60 * 1000;

export function submissionScope(
  identity: TaskSubmissionIdentity,
  userId?: string | null
): string {
  if (!isUUID(identity.key))
    throw new BadRequestException('Idempotency-Key must be a UUID');
  if (userId) return `user:${userId}`;
  if (!identity.clientId || !isUUID(identity.clientId)) {
    throw new BadRequestException(
      'X-Task-Client-Id must be a UUID for anonymous submissions'
    );
  }
  return `anonymous:${identity.clientId.toLowerCase()}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, canonical(v)])
    );
  }
  return value;
}

export function taskRequestHash(input: CreateTaskInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonical({ ...input, inputConfig: input.inputConfig ?? {} })
      )
    )
    .digest('hex');
}

async function readTask(
  database: Pick<ActiveUserTransaction, 'select'>,
  taskId: string
): Promise<Task> {
  const [task] = await database
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!task)
    throw new GoneException({
      code: 'TASK_SUBMISSION_GONE',
      message: 'The submitted task was deleted',
    });
  return task;
}

export async function createTaskOnce(
  tx: ActiveUserTransaction,
  input: CreateTaskInput,
  userId: string | null,
  identity: TaskSubmissionIdentity,
  create: () => Promise<Task>
): Promise<Task> {
  const scope = submissionScope(identity, userId);
  const key = identity.key.toLowerCase();
  const hash = taskRequestHash(input);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope}:${key}`}, 0))`
  );
  const condition = and(
    eq(taskSubmissions.scope, scope),
    eq(taskSubmissions.key, key)
  );
  const [existing] = await tx.select().from(taskSubmissions).where(condition);
  const now = new Date();
  if (existing && existing.expiresAt > now) {
    if (existing.requestHash !== hash) {
      throw new ConflictException({
        code: 'TASK_SUBMISSION_CONFLICT',
        message: 'Idempotency-Key was used with different parameters',
      });
    }
    return readTask(tx, existing.taskId);
  }
  if (existing) await tx.delete(taskSubmissions).where(condition);
  const task = await create();
  await tx.insert(taskSubmissions).values({
    scope,
    key,
    userId,
    requestHash: hash,
    taskId: task.id,
    expiresAt: new Date(now.getTime() + SUBMISSION_RETENTION_MS),
  });
  return task;
}

export async function getTaskSubmission(
  identity: TaskSubmissionIdentity,
  userId?: string | null
): Promise<Task> {
  const scope = submissionScope(identity, userId);
  const [receipt] = await db
    .select()
    .from(taskSubmissions)
    .where(
      and(
        eq(taskSubmissions.scope, scope),
        eq(taskSubmissions.key, identity.key.toLowerCase()),
        gt(taskSubmissions.expiresAt, new Date())
      )
    );
  if (!receipt) throw new NotFoundException('Submission not found');
  return readTask(db, receipt.taskId);
}

export async function cleanupTaskSubmissions(): Promise<void> {
  // 有界清理，每分钟继续处理；回执到期与重放的竞争由原子 DELETE 和主键约束收敛。
  await db.execute(sql`DELETE FROM task_submissions WHERE (scope, key) IN (
    SELECT scope, key FROM task_submissions WHERE expires_at <= now() ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
  )`);
}
