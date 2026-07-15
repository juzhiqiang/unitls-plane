# 公测最终审查修复实施计划

> **供智能体执行者使用：** REQUIRED SUB-SKILL：使用
> `superpowers:subagent-driven-development`（推荐）或
> `superpowers:executing-plans`，逐项实施本计划。所有步骤使用复选框（`- [ ]`）跟踪状态。

**目标：**
关闭最终审查发现的账号注销并发、文件恢复与清理竞态、上传孤儿对象和大账号导出阻断，使免费受限公测版本在已确认范围内具备可验证的数据生命周期保证。

**架构：** 使用 PostgreSQL 事务级 advisory
lock 串行化同一登录用户的上传、任务创建和账号注销，并在对象上传后补偿数据库失败。文件永久删除在行锁事务中重新确认删除资格，使恢复与清理互斥。账号导出改为游标分页和异步 JSON 流，浏览器通过原生附件导航直接落盘，不再物化整个 ZIP。

**技术栈：** Bun 1.3、TypeScript、NestJS 11、Drizzle/PostgreSQL、MinIO/AWS
SDK、BullMQ、archiver、React/Next.js、Vitest、Bun test。

---

## 任务 1：串行化用户写操作并补偿上传失败

**文件：**

- 新建：`apps/api/src/common/database/user-mutation-lock.ts`
- 新建：`apps/api/src/common/database/user-mutation-lock.test.ts`
- 修改：`apps/api/src/modules/files/files.service.ts`
- 修改：`apps/api/src/modules/files/files.service.test.ts`
- 修改：`apps/api/src/modules/tasks/tasks.service.ts`
- 修改：`apps/api/src/modules/tasks/tasks.service.test.ts`
- 修改：`apps/api/src/modules/account/account.service.ts`
- 修改：`apps/api/src/modules/account/account.service.test.ts`
- 修改：`apps/api/src/modules/account/account.repository.ts`
- 修改：`apps/api/src/modules/account/account.repository.test.ts`

- [ ] **步骤 1：为 advisory lock 和上传补偿编写失败测试**

`user-mutation-lock.test.ts` 使用顶层模块 mock 断言同一用户操作按以下顺序执行：

```typescript
expect(events).toEqual([
  'transaction:start',
  'advisory-lock:user-1',
  'user-exists:user-1',
  'operation',
  'transaction:end',
]);
```

在 `files.service.test.ts` 增加：数据库 `insert(...).returning()` 抛错时，已上传的对象必须调用一次
`minio.delete(storageKey)`；补偿删除失败时仍抛出原始数据库错误，且日志不得包含完整 storage key。

在 `tasks.service.test.ts`
增加：登录用户任务创建必须在用户锁回调内完成；锁取得后用户已不存在时，不得插入任务或加入队列。

在 `account.service.test.ts`
增加并发交错：删除持锁期间，模拟上传/任务写操作只能等待；快照、session删除、对象删除和数据库删除顺序必须为：

```text
lock -> snapshot -> confirmation -> sessions -> objects -> account records -> unlock
```

- [ ] **步骤 2：运行定向测试并确认失败**

```powershell
bun --cwd=apps/api test `
  src/common/database/user-mutation-lock.test.ts `
  src/modules/files/files.service.test.ts `
  src/modules/tasks/tasks.service.test.ts `
  src/modules/account/account.service.test.ts `
  src/modules/account/account.repository.test.ts
```

预期：新 helper 不存在，上传失败不补偿，任务创建和账号注销没有共享互斥。

- [ ] **步骤 3：实现用户级事务锁**

`user-mutation-lock.ts` 导出以下唯一入口：

```typescript
export async function withExistingUserMutationLock<T>(
  userId: string,
  operation: () => Promise<T>
): Promise<T> {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    const [existingUser] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!existingUser) throw new NotFoundException('Account not found');
    return operation();
  });
}
```

锁必须覆盖整个外部对象操作和数据库写操作；所有调用者都在锁内重新确认用户存在，防止排队期间账号已被删除后继续使用陈旧 session 用户对象。

- [ ] **步骤 4：接入上传、任务创建和账号注销**

`FilesService.upload()` 将上传与插入提取为私有操作。登录用户通过
`withExistingUserMutationLock(user.id, operation)`
执行；匿名上传保持现有路径。对象上传成功后，任何数据库插入异常或空 returning 都执行幂等
`minio.delete(storageKey)` 再抛出原始错误。

`TasksService.create()` 对登录用户把输入文件权限检查、任务插入和 `queue.add()`
放入同一个用户锁；匿名本地任务保持现有行为。

`AccountService.deleteAccount()` 在用户锁内重新读取快照并核对邮箱；核对成功后先调用新增的
`AccountRepository.deleteSessions(userId)`，再依次删除快照对象和账号数据库记录。对象删除失败仍保留账号记录，用户可重新登录后重试。

- [ ] **步骤 5：验证并提交**

```powershell
bun --cwd=apps/api test `
  src/common/database/user-mutation-lock.test.ts `
  src/modules/files/files.service.test.ts `
  src/modules/tasks/tasks.service.test.ts `
  src/modules/account/account.service.test.ts `
  src/modules/account/account.repository.test.ts
bun --cwd=apps/api run build
bun run lint
git diff --check
```

```bash
git add apps/api/src/common/database apps/api/src/modules/files apps/api/src/modules/tasks/tasks.service.ts apps/api/src/modules/tasks/tasks.service.test.ts apps/api/src/modules/account
git commit -m "fix: 防止注销并发写入和上传孤儿对象"
```

## 任务 2：让恢复与永久删除通过行锁互斥

**文件：**

- 修改：`apps/api/src/modules/files/files.service.ts`
- 修改：`apps/api/src/modules/files/files.service.test.ts`
- 修改：`apps/api/src/modules/tasks/processors/cleanup.processor.test.ts`

- [ ] **步骤 1：编写恢复与清理交错失败测试**

覆盖以下三种顺序：

```text
restore commits first -> cleanup recheck finds no eligible row -> object and row remain
cleanup locks first -> restore waits -> cleanup deletes -> restore reports file missing
MinIO delete fails -> transaction rolls back -> deletedAt row remains restorable
```

同时覆盖 `permanentDelete`、`batchPermanentDelete`、`emptyTrash` 和定时
`cleanupTrashed`，确保所有永久删除入口都使用同一行锁 helper，而不是只修 scheduler。

- [ ] **步骤 2：运行测试并确认失败**

```powershell
bun --cwd=apps/api test `
  src/modules/files/files.service.test.ts `
  src/modules/tasks/processors/cleanup.processor.test.ts
```

预期：当前快照查询后的对象删除不重新确认 `deletedAt`，恢复仍会被后续清理覆盖。

- [ ] **步骤 3：实现带资格重检的行锁删除**

在 `FilesService` 内增加私有 helper，事务内按最终删除条件查询并锁行：

```typescript
const [current] = await tx.select().from(files).where(eligibility).for('update');
if (!current) return false;
await this.minioService.delete(current.storageKey);
const deleted = await tx.delete(files).where(eligibility).returning({ id: files.id });
return deleted.length === 1;
```

匿名过期条件必须包含 `userId IS NULL`、`deletedAt IS NULL`、`expiresAt <= now`；回收站条件必须包含
`deletedAt IS NOT NULL`，定时清理额外包含 `deletedAt <= cutoff`，用户操作额外包含正确 `userId`。

`restore()` 和 `batchRestore()` 改用条件 update +
`returning()`；单文件返回空时抛出 NotFound，批量仅记录实际恢复的 ID。UPDATE 会等待同行 DELETE 锁，从而不再向用户返回虚假的恢复成功。

- [ ] **步骤 4：验证并提交**

```powershell
bun --cwd=apps/api test `
  src/modules/files/files.service.test.ts `
  src/modules/tasks/processors/cleanup.processor.test.ts
bun --cwd=apps/api run build
bun run lint
git diff --check
```

```bash
git add apps/api/src/modules/files/files.service.ts apps/api/src/modules/files/files.service.test.ts apps/api/src/modules/tasks/processors/cleanup.processor.test.ts
git commit -m "fix: 防止文件恢复与永久清理竞态"
```

## 任务 3：分页流式导出任意规模账号

**文件：**

- 修改：`apps/api/src/modules/account/account.repository.ts`
- 修改：`apps/api/src/modules/account/account.repository.test.ts`
- 修改：`apps/api/src/modules/account/account-export.service.ts`
- 修改：`apps/api/src/modules/account/account-export.service.test.ts`
- 修改：`apps/web/src/hooks/api/use-account.ts`
- 修改：`apps/web/src/hooks/api/__tests__/use-account.test.ts`
- 修改：`apps/web/src/app/[locale]/(app)/settings/__tests__/page.test.tsx`

- [ ] **步骤 1：编写超量账号和原生下载失败测试**

服务端测试改为提供异步分页迭代器，生成超过旧上限的 `1_001` 个任务和 `10_001` 个文件，断言
`prepareExport()` 不再返回 503，且 `tasks.json`、`files.json`
与所有对象条目仍完整写入 ZIP。分页测试必须断言每页不超过 `250` 行，并按 `(createdAt, id)`
游标继续，禁止 offset 和一次性无界 select。

前端测试断言 `downloadAccountExport()` 创建指向 `/account/export` 的隐藏 anchor 并点击，但不调用
`fetch()`、`response.blob()`、`URL.createObjectURL()` 或设置 `download` 属性；文件名由响应的
`Content-Disposition` 交给浏览器处理。

- [ ] **步骤 2：运行测试并确认失败**

```powershell
bun --cwd=apps/api test `
  src/modules/account/account.repository.test.ts `
  src/modules/account/account-export.service.test.ts
bun --cwd=apps/web test -- `
  src/hooks/api/__tests__/use-account.test.ts `
  "src/app/[locale]/(app)/settings/__tests__/page.test.tsx"
```

预期：旧实现因行数/32 MiB 元数据上限拒绝，前端仍把整个 ZIP 物化为 Blob。

- [ ] **步骤 3：实现游标分页仓库迭代器**

删除 `ACCOUNT_EXPORT_MAX_TASK_ROWS`、`ACCOUNT_EXPORT_MAX_FILE_ROWS` 和一次性
`getExportSnapshot()`。增加 `getExportProfile(userId)`、`iterateExportTasks(userId, snapshotAt)`、
`iterateExportFiles(userId, snapshotAt)`。每个迭代器固定 `250` 行，条件为：

```typescript
and(
  eq(row.userId, userId),
  lte(row.createdAt, snapshotAt),
  cursor
    ? or(
        gt(row.createdAt, cursor.createdAt),
        and(eq(row.createdAt, cursor.createdAt), gt(row.id, cursor.id))
      )
    : undefined
);
```

排序固定为 `createdAt ASC, id ASC`；一页少于 250 行时结束。

- [ ] **步骤 4：改造导出服务为常量级元数据流**

`PreparedAccountExport` 只保存 `userId`、`snapshotAt`、`filename` 和 `profile`。`prepareExport()`
第一遍分页遍历文件并顺序 `head`，不保留完整任务/文件数组。`writeExport()`：

1. 直接写 `profile.json`。
2. 将任务异步迭代器经 `createExportTask` 转换后流入 `tasks.json`。
3. 第一遍文件异步迭代器以确定性 `usedPaths` 生成 `files.json`。
4. 第二遍文件异步迭代器以相同顺序重新生成相同路径，并逐对象 `downloadStream()` 写入 ZIP。

`createJsonArrayStream()` 支持 `AsyncIterable`；移除 32
MiB 元数据硬拒绝。保留对象预检、敏感配置脱敏、客户端断开 abort、源流错误和 listener 清理行为。

- [ ] **步骤 5：切换浏览器原生流式下载**

`downloadAccountExport()` 保持 `Promise<void>` 接口，但只执行：

```typescript
const anchor = document.createElement('a');
anchor.href = getAccountExportUrl();
anchor.hidden = true;
document.body.appendChild(anchor);
try {
  anchor.click();
} finally {
  anchor.remove();
}
```

不得设置 `download`，使跨 origin 附件文件名由 API `Content-Disposition`
决定；顶层 GET 导航会按浏览器 Cookie 规则携带 API session，ZIP 直接由网络栈落盘。

- [ ] **步骤 6：验证并提交**

```powershell
bun --cwd=apps/api test `
  src/modules/account/account.repository.test.ts `
  src/modules/account/account-export.service.test.ts
bun --cwd=apps/web test -- `
  src/hooks/api/__tests__/use-account.test.ts `
  "src/app/[locale]/(app)/settings/__tests__/page.test.tsx"
bun --cwd=apps/api run openapi:export
bun --cwd=packages/api-client run generate
git diff --exit-code -- apps/api/openapi.json packages/api-client/src/schema.ts
bun run build
git diff --check
```

```bash
git add apps/api/src/modules/account apps/web/src/hooks/api/use-account.ts apps/web/src/hooks/api/__tests__/use-account.test.ts "apps/web/src/app/[locale]/(app)/settings/__tests__/page.test.tsx"
git commit -m "fix: 支持大账号分页流式导出"
```

## 最终验证

- [ ] 运行 `NEXT_PUBLIC_SUPPORT_EMAIL=support@example.com bun run release:verify`。
- [ ] 实测注销锁交错、恢复/清理交错和数据库插入失败补偿，不留下 MinIO 孤儿对象。
- [ ] 用超过旧任务上限的夹具导出，确认 ZIP 包含完整 `profile.json`、`tasks.json`、`files.json`。
- [ ] 重新执行整分支代码审查。
- [ ] 确认 `git status --short` 为空，应用端口全部释放。
