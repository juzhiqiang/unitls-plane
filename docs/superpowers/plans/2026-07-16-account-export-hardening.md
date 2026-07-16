# 账号导出加固实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**目标：** 修复账号导出分页精度、预检取消、Windows
ZIP 路径和临时资源生命周期问题，使任务 5 通过全新质量复审。

**架构：**
Repository 使用 PostgreSQL 原始文本时间戳作为私有 keyset 游标，外部导出类型保持不变；Controller 创建请求级
`AbortSignal` 并向 Repository、spool 和 S3
HEAD 传播；ZIP 工具生成 Windows 安全显示路径和大小写无关碰撞键；Service 最外层统一拥有 spool 清理，并支持测试注入独立临时根目录。

**技术栈：** Bun 1.3、TypeScript、NestJS 11、Drizzle/PostgreSQL、AWS SDK v3、Archiver、Bun
SQLite、Vitest。

---

## 任务 1：保留 PostgreSQL 微秒游标

**文件：**

- 修改：`apps/api/src/modules/account/account.repository.test.ts`
- 修改：`apps/api/src/modules/account/account.repository.ts`

- [x] **步骤 1：编写微秒游标失败测试**

让 Repository mock 的第一页最后一行同时包含公开 `createdAt: Date` 和私有
`cursorCreatedAt: '2026-07-15 12:00:00.123456'`。断言第二页 where 条件使用完整字符串，生成器输出不包含
`cursorCreatedAt`：

```typescript
const boundary = {
  id: 'task-0249',
  createdAt: new Date('2026-07-15T12:00:00.123Z'),
  cursorCreatedAt: '2026-07-15 12:00:00.123456',
};

expect(JSON.stringify(exportWhere[1]?.condition)).toContain(boundary.cursorCreatedAt);
expect(rows.at(-1)).not.toHaveProperty('cursorCreatedAt');
```

文件第一页边界使用：

```typescript
const fileBoundary = {
  id: 'file-0249',
  createdAt: new Date('2026-07-15T12:00:00.654Z'),
  cursorCreatedAt: '2026-07-15 12:00:00.654321',
};

expect(JSON.stringify(exportWhere[1]?.condition)).toContain(fileBoundary.cursorCreatedAt);
expect(rows.at(-1)).not.toHaveProperty('cursorCreatedAt');
```

- [x] **步骤 2：运行测试并确认失败**

运行：

```bash
cd apps/api
bun test src/modules/account/account.repository.test.ts
```

预期：失败，因为当前游标只使用丢失微秒的 JS `Date`。

- [x] **步骤 3：实现私有文本游标**

在两个迭代器中使用以下游标结构：

```typescript
interface AccountExportCursor {
  createdAt: string;
  id: string;
}

const cursorCreatedAt = sql<string>`${tasks.createdAt}::text`;
const cursorTimestamp = cursor ? sql`${cursor.createdAt}::timestamp` : undefined;
```

查询 selection 增加 `cursorCreatedAt`。下一页条件使用 `cursorTimestamp` 与 `cursor.id`，排序仍为
`createdAt, id`。yield 前准确移除私有字段：

```typescript
for (const { cursorCreatedAt, ...row } of page) yield row;
const last = page.at(-1)!;
cursor = { createdAt: last.cursorCreatedAt, id: last.id };
```

文件迭代器定义：

```typescript
const cursorCreatedAt = sql<string>`${files.createdAt}::text`;
const cursorTimestamp = cursor ? sql`${cursor.createdAt}::timestamp` : undefined;
```

它的 selection、下一页条件、yield 解构和 cursor 更新与上述任务迭代器使用相同字段名。两个迭代器都在每次查询前后调用可选
`signal?.throwIfAborted()`，为任务 2 预留边界。

- [x] **步骤 4：运行测试并确认通过**

运行：

```bash
cd apps/api
bun test src/modules/account/account.repository.test.ts
```

预期：Repository 测试全部通过。

## 任务 2：取消断连后的预检

**文件：**

- 修改：`apps/api/src/modules/files/minio.service.test.ts`
- 修改：`apps/api/src/modules/files/minio.service.ts`
- 修改：`apps/api/src/modules/account/account-export.service.test.ts`
- 修改：`apps/api/src/modules/account/account-export.service.ts`
- 修改：`apps/api/src/modules/account/account.controller.ts`

- [x] **步骤 1：编写 S3 HEAD 取消失败测试**

断言调用：

```typescript
const signal = new AbortController().signal;
await service.head('user-1/file-1/report.pdf', signal);
expect(send).toHaveBeenCalledWith(expect.any(HeadObjectCommand), {
  abortSignal: signal,
});
```

- [x] **步骤 2：编写预检断连失败测试**

Service 测试让第一个 `head` 等待 abort，调用 `prepareExport('user-1', signal)`
后中止，断言 Promise 拒绝、后续 HEAD 未调用且临时目录恢复基线。Controller 测试使用可发出 `close`
的响应对象，捕获传给 `prepareExport` 的 signal，断言 close 后 signal 已中止、未设置下载头。

- [x] **步骤 3：运行测试并确认失败**

运行：

```bash
cd apps/api
bun test src/modules/files/minio.service.test.ts
bun test src/modules/account/account-export.service.test.ts -t "preflight|preparation"
```

预期：失败，因为现有 HEAD 和 prepare 链路不接收 signal。

- [x] **步骤 4：实现信号传播**

`MinioService.head` 改为：

```typescript
async head(key: string, signal?: globalThis.AbortSignal): Promise<void> {
  await this.client.send(
    new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    { abortSignal: signal }
  );
}
```

Repository 两个迭代器增加第三个可选参数
`signal?: AbortSignal`，每次查询前后检查信号。`createAccountExportSpool` 和 `prepareExport`
接收 signal，在 task/file 写入和 HEAD 前后检查，并调用 `this.minio.head(storageKey, signal)`。

Controller 在 prepare 前注册 close：

```typescript
const abortController = new AbortController();
let prepared: PreparedAccountExport | undefined;
let writeStarted = false;
const onClose = () => {
  if (!response.writableFinished) abortController.abort(new Error('Account export aborted'));
};
response.once('close', onClose);
try {
  prepared = await this.accountExportService.prepareExport(currentUser.id, abortController.signal);
  abortController.signal.throwIfAborted();
  response.type('application/zip');
  response.attachment(prepared.filename);
  writeStarted = true;
  await this.accountExportService.writeExport(prepared, response);
} finally {
  response.off('close', onClose);
  if (prepared && !writeStarted) await this.accountExportService.disposePreparedExport(prepared);
}
```

- [x] **步骤 5：运行测试并确认通过**

运行任务 2 的两个测试命令，预期全部通过。

## 任务 3：生成 Windows 安全 ZIP 路径

**文件：**

- 修改：`apps/api/src/modules/account/account-export.service.test.ts`
- 修改：`apps/api/src/modules/account/account-export.util.ts`

- [x] **步骤 1：编写失败测试**

覆盖以下准确行为：

```typescript
expect(createArchivePath('CON.txt', 'file-11111111', registry)).toBe('files/_CON.txt');
expect(createArchivePath('bad:name?.pdf ', 'file-22222222', registry)).toBe('files/bad_name_.pdf');
expect(createArchivePath('Report.pdf', 'file-33333333', registry)).toBe('files/Report.pdf');
expect(createArchivePath('report.pdf', 'file-44444444', registry)).toBe(
  'files/report-file-4444.pdf'
);
expect(
  [...createArchivePath('x'.repeat(300) + '.pdf', 'file-5', registry)].length
).toBeLessThanOrEqual(206);
```

最后一个上限包含 `files/` 六个字符，文件名上限为 200 个 Unicode code point。

- [x] **步骤 2：运行测试并确认失败**

运行：

```bash
cd apps/api
bun test src/modules/account/account-export.service.test.ts -t "archive path|Windows"
```

- [x] **步骤 3：实现规范化和碰撞键**

在 util 中增加：

```typescript
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const MAX_ARCHIVE_FILENAME_LENGTH = 200;

function collisionKey(path: string) {
  return path.normalize('NFKC').toLowerCase();
}
```

basename 先做 NFC 规范化，移除控制字符，将非法字符替换为 `_`，去除尾随点空格，设备名前加
`_`，再按 code point 截断并保留最长 20 个 code point 的扩展名。所有 `has/add` 使用
`collisionKey(exportPath)`；冲突后缀通过独立 helper 为 `-${idPrefix}` 和数字 suffix 预留长度。

- [x] **步骤 4：运行测试并确认通过**

运行任务 3 测试命令，预期全部通过。

## 任务 4：统一写阶段清理并隔离测试临时目录

**文件：**

- 修改：`apps/api/src/modules/account/account-export.service.test.ts`
- 修改：`apps/api/src/modules/account/account-export.service.ts`

- [x] **步骤 1：编写初始化失败清理测试**

准备导出后，把只有 `destroyed: false` 与 `closed: false`、但没有事件 API 的对象作为 `Writable` 传给
`writeExport`。它会在监听器初始化阶段同步失败；断言 Promise 拒绝并恢复独立临时目录基线：

```typescript
const invalidOutput = { destroyed: false, closed: false } as Writable;
await expect(service.writeExport(prepared, invalidOutput)).rejects.toThrow();
expect(await accountExportTempDirs()).toEqual(baselineTempDirs);
```

- [x] **步骤 2：编写临时根目录隔离测试**

测试创建唯一根目录并传给 Service。根目录外创建同前缀目录，运行 `onModuleInit`
后断言外部目录未被扫描或删除，根目录内 stale spool 已删除。

- [x] **步骤 3：运行测试并确认失败**

运行：

```bash
cd apps/api
bun test src/modules/account/account-export.service.test.ts -t "initialization|temporary root|startup spool"
```

- [x] **步骤 4：实现最外层所有权和临时根目录注入**

定义可选注入 token：

```typescript
export const ACCOUNT_EXPORT_TEMP_ROOT = Symbol('ACCOUNT_EXPORT_TEMP_ROOT');
```

构造函数通过 `@Optional()`/`@Inject()` 接收 string，缺省使用 `tmpdir()`。`mkdtemp`、`readdir`
和启动清理都使用该根目录。

把现有写流主体提取为私有 `streamPreparedExport`。公开 `writeExport` 只负责最外层清理：

```typescript
async writeExport(prepared: PreparedAccountExport, output: Writable) {
  let writeError: unknown;
  try {
    await this.streamPreparedExport(prepared, output);
  } catch (error) {
    writeError = error;
    throw error;
  } finally {
    try {
      await this.disposePreparedExport(prepared);
    } catch (cleanupError) {
      if (writeError)
        throw new AggregateError(
          [toError(writeError, 'Account export failed'), cleanupError],
          'Account export failed during cleanup',
          { cause: writeError }
        );
      throw cleanupError;
    }
  }
}
```

- [x] **步骤 5：运行测试并确认通过**

完整运行 `account-export.service.test.ts`，预期全部通过且测试结束后独立根目录可删除。

## 任务 5：验证、提交和复审

**文件：**

- 修改：`docs/superpowers/plans/2026-07-16-account-export-hardening.md`（更新复选框）

- [x] **步骤 1：格式化和静态检查**

运行：

```bash
bunx prettier --write apps/api/src/modules/account
bun run lint
bun run format:check:changed
git diff --check
```

- [x] **步骤 2：全量测试和构建**

运行：

```bash
bun run test:packages
bun run test:api
bun run test:web
cd apps/api && bun run build
cd apps/web && NEXT_PUBLIC_SUPPORT_EMAIL=support@example.com bun run build
```

- [x] **步骤 3：验证生成文件无漂移**

运行 OpenAPI export 和 client generate，随后执行：

```bash
git diff --exit-code -- apps/api/openapi.json packages/api-client/src/schema.ts
```

- [x] **步骤 4：提交实现**

只暂存本计划涉及的文件，不暂存 `packages/db/drizzle/meta/0012_snapshot.json`：

```bash
git commit -m "fix: 加固大账号导出分页和资源清理"
```

- [x] **步骤 5：fresh 复审**

以任务 5 前一提交为 base、新实现为 head，分别执行规格审查和质量审查。Critical/Important 必须清零；并发配额建议因用户明确排除而作为已知范围边界记录，不得擅自实现。

复审结果：规格符合；质量审查 Critical/Important 均为 0，可进入后续整分支验证。并发配额未实现，符合用户明确排除范围。
