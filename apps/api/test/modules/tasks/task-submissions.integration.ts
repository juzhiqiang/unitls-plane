/** 显式执行：bun apps/api/test/modules/tasks/task-submissions.integration.ts。只使用独立本机数据库。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import postgres from 'postgres';

const root = resolve(import.meta.dir, '../../../../..');
config({ path: resolve(root, '.env.local'), quiet: true });
const sourceUrl = new URL(
  process.env.DATABASE_URL ??
    'postgresql://utils:utils@localhost:5433/utils_plane'
);
assert(['localhost', '127.0.0.1', '[::1]'].includes(sourceUrl.hostname));
const databaseName = `task_submissions_it_${randomUUID().replaceAll('-', '')}`;
const admin = postgres(sourceUrl.toString(), { max: 1 });
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${databaseName}`;
process.env.DATABASE_URL = testUrl.toString();
const client = postgres(testUrl.toString());
let created = false;
let close: (() => Promise<void>) | undefined;
try {
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const migration = Bun.spawn(['bunx', 'drizzle-kit', 'migrate'], {
    cwd: resolve(root, 'packages/db'),
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, output, errors] = await Promise.all([
    migration.exited,
    new Response(migration.stdout).text(),
    new Response(migration.stderr).text(),
  ]);
  assert.equal(exitCode, 0, `Isolated migration failed: ${output} ${errors}`);
  const { db } = await import('@utils-plane/db');
  close = () => db.$client.end();
  const { TasksService } =
    await import('../../../src/modules/tasks/tasks.service');
  const { CleanupObligationService } =
    await import('../../../src/modules/files/cleanup-obligation.service');
  const queue = { name: 'image-queue' };
  const dispatched: string[] = [];
  const service = new TasksService(
    queue as never,
    queue as never,
    queue as never,
    queue as never,
    { getById: async (id: string) => ({ id, userId: null }) } as never,
    new CleanupObligationService(),
    {
      reconcile: async (identity: { resourceId: string }) => {
        dispatched.push(identity.resourceId);
        return null;
      },
    } as never,
    { invalidate: () => {} } as never
  );
  const input = {
    type: 'compress' as const,
    inputFileIds: [randomUUID()],
    inputConfig: { quality: 80, format: 'png' },
  };
  const submission = { key: randomUUID(), clientId: randomUUID() };
  // 第三个参数此前不存在；先验证真实并发请求是否产生重复任务。
  const submit = service.create.bind(service) as (
    ...args: unknown[]
  ) => Promise<{ id: string }>;
  const results = await Promise.all(
    Array.from({ length: 8 }, () => submit(input, null, submission))
  );
  assert.equal(
    new Set(results.map(task => task.id)).size,
    1,
    'concurrent retries must return one task'
  );
  const [counts] =
    await client`SELECT (SELECT count(*)::int FROM tasks) AS tasks, (SELECT count(*)::int FROM cleanup_obligations) AS obligations`;
  assert.equal(counts!.tasks, 1);
  assert.equal(counts!.obligations, 1);
  assert(dispatched.every(id => id === results[0]!.id));
  console.log('PASS: concurrent retries create one task and one outbox');

  const { eq } = await import('drizzle-orm');
  const { user, tasks, taskSubmissions } = await import('@utils-plane/db');
  const { getLimit } = await import('@utils-plane/utils');
  const { cleanupTaskSubmissions } =
    await import('../../../src/modules/tasks/task-submissions');
  const statusIs = (status: number) => (error: unknown) =>
    (error as { getStatus?: () => number }).getStatus?.() === status;
  assert.equal(
    (
      await submit(
        { ...input, inputConfig: { format: 'png', quality: 80 } },
        null,
        submission
      )
    ).id,
    results[0]!.id
  );
  await assert.rejects(
    submit({ ...input, inputConfig: { quality: 90 } }, null, submission),
    statusIs(409)
  );
  assert.equal(
    (
      await service.getSubmission(
        submission.key,
        undefined,
        submission.clientId
      )
    ).id,
    results[0]!.id
  );
  await assert.rejects(
    service.getSubmission(submission.key, undefined, randomUUID()),
    statusIs(404)
  );
  const another = await submit(input, null, {
    ...submission,
    clientId: randomUUID(),
  });
  assert.notEqual(another.id, results[0]!.id);
  await assert.rejects(
    submit(input, null, { key: 'invalid', clientId: submission.clientId }),
    statusIs(400)
  );
  await assert.rejects(
    submit(input, null, { key: randomUUID() }),
    statusIs(400)
  );
  console.log(
    'PASS: canonical parameters, conflicts, header validation and anonymous identity isolation'
  );

  await db.delete(tasks).where(eq(tasks.id, results[0]!.id));
  await assert.rejects(submit(input, null, submission), statusIs(410));
  await assert.rejects(
    service.getSubmission(submission.key, undefined, submission.clientId),
    statusIs(410)
  );
  await db
    .update(taskSubmissions)
    .set({ expiresAt: new Date(0) })
    .where(eq(taskSubmissions.key, submission.key));
  const afterExpiry = await submit(input, null, submission);
  assert.notEqual(afterExpiry.id, results[0]!.id);
  await cleanupTaskSubmissions();
  assert.equal(
    (
      await client`SELECT count(*)::int AS count FROM task_submissions WHERE expires_at <= now()`
    )[0]!.count,
    0
  );
  console.log('PASS: deletion tombstone, expiration and bounded cleanup');

  const owner = { id: randomUUID(), plan: 'pro_preview', role: 'user' };
  const otherOwner = { ...owner, id: randomUUID() };
  for (const current of [owner, otherOwner])
    await db
      .insert(user)
      .values({
        ...current,
        name: 'Submission test',
        email: `${current.id}@example.invalid`,
      });
  const generate = {
    type: 'image_generate',
    inputFileIds: [],
    inputConfig: { prompt: 'test' },
  };
  const ownerKey = { key: randomUUID() };
  const generated = await submit(generate, owner, ownerKey);
  const otherGenerated = await submit(generate, otherOwner, ownerKey);
  assert.notEqual(generated.id, otherGenerated.id);
  await assert.rejects(
    service.getSubmission(ownerKey.key, undefined, submission.clientId),
    statusIs(404)
  );
  const limit = getLimit(
    { userId: owner.id, plan: owner.plan, role: owner.role },
    'image.generate.dailyCount'
  );
  for (let i = 1; i < limit; i++)
    await db
      .insert(tasks)
      .values({
        userId: owner.id,
        type: 'image_generate',
        status: 'completed',
      });
  assert.equal((await submit(generate, owner, ownerKey)).id, generated.id);
  const rejectedKey = { key: randomUUID() };
  await assert.rejects(submit(generate, owner, rejectedKey), statusIs(403));
  assert.equal(
    (
      await client`SELECT count(*)::int AS count FROM task_submissions WHERE key = ${rejectedKey.key}`
    )[0]!.count,
    0
  );
  await db.delete(user).where(eq(user.id, owner.id));
  assert.equal(
    (
      await client`SELECT count(*)::int AS count FROM task_submissions WHERE user_id = ${owner.id}`
    )[0]!.count,
    0
  );
  console.log(
    'PASS: user isolation, quota replay, rejected transaction rollback and account deletion'
  );
} finally {
  await close?.();
  await client.end();
  if (created)
    await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  await admin.end();
}
