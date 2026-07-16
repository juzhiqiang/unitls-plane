# Utils-Plane 公开公测完善实施计划

> **供智能体执行者使用：** REQUIRED SUB-SKILL：使用
> `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐项实施本计划。
> 所有步骤使用复选框（`- [ ]`）跟踪状态。

**目标：** 交付已确认的受限公开公测版本，覆盖正确的文件保留、自助账号导出与注销、公开法务页面、
完全无遥测、真实 Dashboard 数据、非打扰式 PWA 安装、工具级 SEO、依赖健康检查和一个可复现的本地
发布命令。

**架构：** 保持现有处理工具不变，在其外围增加职责明确的边界：`FilesService` 负责保留策略，
`AccountModule` 负责账号汇总、导出和注销，`HealthModule` 负责运行诊断，Web 侧小型辅助模块负责法务
内容、安装状态和元数据。最终仍作为一个版本交付，但每项任务都必须独立测试并提交，再进入下一个边界。

**技术栈：** Bun 1.3、TypeScript、NestJS 11、Next.js 14 App Router、Drizzle/PostgreSQL、BullMQ、
MinIO/AWS SDK、archiver、next-intl、TanStack Query、Vitest、Bun test、Playwright。

---

## 文件清单

### 发布基线与遥测移除

- 新建：.gitattributes
- 修改：.prettierrc.js
- 删除：.prettierrc.json
- 修改：package.json
- 修改：apps/api/package.json
- 修改：apps/web/package.json
- 修改：Dockerfile
- 修改：apps/api/Dockerfile
- 修改：apps/api/src/main.ts
- 修改：apps/web/src/app/[locale]/layout.tsx
- 删除：scripts/upload-sourcemaps.ts
- 删除：apps/api/src/config/error-tracker.config.ts
- 删除：apps/api/src/config/error-tracker.config.test.ts
- 删除：apps/web/src/components/error-tracker-init.tsx
- 删除：`apps/web/src/components/__tests__/error-tracker-init.test.tsx`
- 删除：docs/superpowers/specs/2026-06-18-local-error-tracker-sdk-integration-design.md
- 删除：docs/superpowers/plans/2026-06-18-local-error-tracker-sdk-integration.md
- 新建：apps/api/src/config/no-telemetry.test.ts

### 文件生命周期

- 修改：apps/api/src/modules/files/files.service.ts
- 修改：apps/api/src/modules/files/files.service.test.ts
- 修改：apps/api/src/modules/tasks/processors/cleanup.processor.ts
- 修改：apps/api/src/modules/tasks/processors/cleanup.scheduler.ts
- 新建：apps/api/src/modules/tasks/processors/cleanup.processor.test.ts

### 账号数据

- 新建：apps/api/src/modules/account/account.module.ts
- 新建：apps/api/src/modules/account/account.controller.ts
- 新建：apps/api/src/modules/account/account.service.ts
- 新建：apps/api/src/modules/account/account.repository.ts
- 新建：apps/api/src/modules/account/account-export.service.ts
- 新建：apps/api/src/modules/account/account-export.util.ts
- 新建：apps/api/src/modules/account/dto/account.dto.ts
- 新建：apps/api/src/modules/account/account.service.test.ts
- 新建：apps/api/src/modules/account/account-export.service.test.ts
- 修改：apps/api/src/app.module.ts
- 修改：apps/api/src/modules/files/minio.service.ts
- 新建：apps/web/src/hooks/api/use-account.ts
- 修改：apps/web/src/app/[locale]/(app)/dashboard/page.tsx
- 修改：apps/web/src/app/[locale]/(app)/settings/page.tsx
- 修改：apps/web/messages/zh.json
- 修改：apps/web/messages/en.json

### 公开信任页面与产品文案

- 新建：apps/web/src/components/legal/legal-document.tsx
- 新建：apps/web/src/lib/public-site.ts
- 新建：apps/web/src/app/[locale]/(marketing)/privacy/page.tsx
- 新建：apps/web/src/app/[locale]/(marketing)/terms/page.tsx
- 新建：apps/web/src/app/[locale]/(marketing)/beta/page.tsx
- 新建：`apps/web/src/app/[locale]/(marketing)/__tests__/public-trust-pages.test.ts`
- 修改：apps/web/src/app/[locale]/(marketing)/layout.tsx
- 修改：apps/web/src/middleware.ts
- 修改：apps/web/src/middleware.test.ts
- 修改：`apps/web/src/app/[locale]/(marketing)/__tests__/marketing-copy.test.ts`

### PWA 与 SEO

- 新建：apps/web/src/components/pwa/install-provider.tsx
- 新建：`apps/web/src/components/pwa/__tests__/install-provider.test.tsx`
- 删除：apps/web/src/components/pwa/install-prompt.tsx
- 删除：`apps/web/src/components/pwa/__tests__/install-prompt.test.tsx`
- 新建：apps/web/src/lib/tools/tool-route-metadata.ts
- 新建：apps/web/src/lib/tools/tool-route-metadata.test.ts
- 新建：任务 9 列出的路由 `layout` 文件
- 修改：apps/web/src/app/sitemap.ts
- 修改：apps/web/src/app/robots.ts

### 运行诊断与发布验证

- 新建：apps/api/src/modules/health/health.service.ts
- 新建：apps/api/src/modules/health/libreoffice-health.ts
- 新建：apps/api/src/modules/health/health.service.test.ts
- 修改：apps/api/src/modules/health/health.controller.ts
- 修改：apps/api/src/modules/health/health.module.ts
- 修改：apps/api/src/modules/files/minio.service.ts
- 新建：scripts/release-verify.ts
- 新建：playwright.config.ts
- 新建：apps/web/e2e/public-beta-smoke.spec.ts
- 修改：apps/web/package.json
- 修改：.env.example
- 修改：docker-compose.prod.yml (environment keys only; no port/network changes)
- 修改：apps/api/openapi.json
- 修改：packages/api-client/src/schema.ts
- 修改：README.md
- 修改：PROJECT_SPECS.md
- 修改：CLAUDE.md
- 修改：docs/docker-offline-deployment.md
- 新建：apps/api/src/config/public-beta-docs.test.ts

## 任务 1：建立跨平台测试与 Lint 基线

**文件：**

- 新建：.gitattributes
- 修改：.prettierrc.js
- 删除：.prettierrc.json
- 修改：package.json
- 修改：apps/api/package.json

- [ ] **步骤 1：记录当前失败基线**

运行：

```bash
bun --cwd apps/api test
bun run lint
```

预期：API 命令因缺少 `test` 脚本而失败；Lint 报告 Prettier 回车符错误。

- [ ] **步骤 2：建立唯一格式配置**

新建 `.gitattributes`：

```text
* text=auto
*.ts text eol=lf
*.tsx text eol=lf
*.js text eol=lf
*.mjs text eol=lf
*.json text eol=lf
*.md text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
*.sql text eol=lf
*.sh text eol=lf
```

将 `.prettierrc.js` 改为：

```javascript
endOfLine: 'auto',
```

删除 `.prettierrc.json`，让 Prettier 只保留一个配置事实源。不要重新规范化未触碰的文件。

- [ ] **步骤 3：增加明确的测试脚本**

在 `apps/api/package.json` 中加入：

```json
"test": "bun test src"
```

在根 `package.json` 中加入：

```json
"test": "bun run test:packages && bun run test:api && bun run test:web",
"test:packages": "bun test packages",
"test:api": "bun --cwd apps/api test",
"test:web": "bun --cwd apps/web test"
```

- [ ] **步骤 4：验证基线命令**

运行：

```bash
bun run test:packages
bun run test:api
bun run test:web
bun run lint
```

预期：四条命令均以 0 退出。若 Lint 在本计划触碰的文件中发现真实格式问题，将报告的准确路径作为
`bunx prettier --write` 的最后一个参数运行，再执行 `bun run lint`。不要格式化本计划文件清单之外的文件。

- [ ] **步骤 5：提交**

```bash
git add .gitattributes .prettierrc.js .prettierrc.json package.json apps/api/package.json
git commit -m "chore: 统一本地测试和换行门禁"
```

## 任务 2：移除遥测及其构建依赖

**文件：**

- 新建：apps/api/src/config/no-telemetry.test.ts
- 修改：package.json
- 修改：apps/api/package.json
- 修改：apps/web/package.json
- 修改：apps/api/src/main.ts
- 修改：apps/web/src/app/[locale]/layout.tsx
- 修改：apps/web/next.config.mjs
- 修改：Dockerfile
- 修改：apps/api/Dockerfile
- 删除：scripts/upload-sourcemaps.ts
- 删除：apps/api/src/config/error-tracker.config.ts
- 删除：apps/api/src/config/error-tracker.config.test.ts
- 删除：apps/web/src/components/error-tracker-init.tsx
- 删除：`apps/web/src/components/__tests__/error-tracker-init.test.tsx`
- 删除：docs/superpowers/specs/2026-06-18-local-error-tracker-sdk-integration-design.md
- 删除：docs/superpowers/plans/2026-06-18-local-error-tracker-sdk-integration.md

- [ ] **步骤 1：编写无遥测回归失败测试**

新建 `apps/api/src/config/no-telemetry.test.ts`：

```typescript
import { expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '../../../..');
const trackerPackage = ['@error', 'tracker/sdk'].join('-');
const trackerContext = ['error', 'tracker', 'sdk'].join('_');

it('keeps runtime and Docker builds free of telemetry integrations', () => {
  for (const file of [
    'package.json',
    'apps/api/package.json',
    'apps/web/package.json',
    'apps/api/src/main.ts',
    'apps/web/src/app/[locale]/layout.tsx',
    'Dockerfile',
    'apps/api/Dockerfile',
  ]) {
    const source = readFileSync(join(repoRoot, file), 'utf8');
    expect(source).not.toContain(trackerPackage);
    expect(source).not.toContain(trackerContext);
    expect(source).not.toContain('ReplayPlugin');
  }

  for (const obsoleteDoc of [
    'docs/superpowers/specs/2026-06-18-local-error-tracker-sdk-integration-design.md',
    'docs/superpowers/plans/2026-06-18-local-error-tracker-sdk-integration.md',
  ]) {
    expect(existsSync(join(repoRoot, obsoleteDoc))).toBe(false);
  }
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：

```bash
bun test apps/api/src/config/no-telemetry.test.ts
```

预期：失败，因为包清单、布局、`main.ts` 和 Dockerfile 仍引用 tracker SDK。

- [ ] **步骤 3：移除集成**

从三个包清单中移除 tracker 依赖；从 locale 布局移除 `ErrorTrackerInit`；从
`apps/api/src/main.ts` 移除 tracker 初始化；删除上方列出的专用源码、测试、上传脚本和已过时的接入文档。

在两个 Dockerfile 中删除：

```dockerfile
COPY --from=error_tracker_sdk . /error-tracker/packages/sdk
```

移除全部 `ERROR_TRACKER` 构建参数和环境变量赋值。根 Docker 命令改为不带
`--build-context error_tracker_sdk` 的普通构建。在 `apps/web/next.config.mjs` 中移除
`productionBrowserSourceMaps`，因为已不存在上传或符号化消费者。

修改组合 Dockerfile 时加入以下构建期公开值，因为 Next.js 会把它们固化到 canonical 和公开法务内容：

```dockerfile
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_SUPPORT_EMAIL=support@utils-plane.local
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL
```

在组合镜像构建命令前加入生产校验：`NEXT_PUBLIC_SUPPORT_EMAIL` 必须匹配
`^[^@\s]+@[^@\s]+\.[^@\s]+$` 且不能以 `.local` 结尾，否则非零退出。这样 Docker 发布路径与
`release:verify` 执行相同规则。

```dockerfile
RUN if [ "$NEXT_PUBLIC_RELEASE" = "prod" ]; then \
      bun -e "const email=process.env.NEXT_PUBLIC_SUPPORT_EMAIL||''; if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||email.endsWith('.local')){console.error('NEXT_PUBLIC_SUPPORT_EMAIL must be a reachable email');process.exit(1)}"; \
    fi
```

在 `docker:package:all` 和 `docker:package:offline` 中额外传入
`--build-arg NEXT_PUBLIC_APP_URL=http://202.104.149.204:5005` 与
`--build-arg NEXT_PUBLIC_SUPPORT_EMAIL`，并保留 API、S3、邮箱验证和 release 参数。无显式值的支持
邮箱构建参数从操作者 Shell 环境读取；不要硬编码运营邮箱。不要修改端口、Docker 网络、S3 凭据或桶策略。

运行：

```bash
bun install
```

预期：`bun.lock` 不再解析 `@error-tracker/sdk` 或相邻仓库路径。

- [ ] **步骤 4：验证移除结果**

运行：

```bash
bun test apps/api/src/config/no-telemetry.test.ts
rg -n -g '!*.tsbuildinfo' "ERROR_TRACKER|error-tracker|ReplayPlugin" apps package.json Dockerfile scripts
bun run build
```

预期：测试和构建通过；`rg` 不返回任何运行时或构建集成匹配。

- [ ] **步骤 5：提交**

```bash
git add package.json bun.lock apps/api apps/web Dockerfile scripts/upload-sourcemaps.ts docs/superpowers
git commit -m "refactor: 移除遥测和错误回放集成"
```

## 任务 3：实现正确且幂等的文件保留策略

**文件：**

- 修改：apps/api/src/modules/files/files.service.ts
- 修改：apps/api/src/modules/files/files.service.test.ts
- 修改：apps/api/src/modules/tasks/processors/cleanup.processor.ts
- 修改：apps/api/src/modules/tasks/processors/cleanup.scheduler.ts
- 新建：apps/api/src/modules/tasks/processors/cleanup.processor.test.ts

- [ ] **步骤 1：扩展 FilesService 保留边界测试**

用下列准确变量和链式函数扩展 `files.service.test.ts` 现有的顶层 mock 装置，并保留现有的 `insert` 和
`findFirst` mock：

```typescript
let selectedRows: Record<string, unknown>[] = [];
const minioService = { delete: vi.fn() };

const lte = vi.fn((_column: unknown, value: unknown) => value);
const eq = vi.fn((_column: unknown, value: unknown) => value);
const selectWhere = vi.fn(async () => selectedRows);
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const select = vi.fn(() => ({ from: selectFrom }));
const deleteWhere = vi.fn(async () => undefined);
const deleteFrom = vi.fn(() => ({ where: deleteWhere }));

mock.module('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  desc: vi.fn(),
  eq,
  gte: vi.fn(),
  lte,
  inArray: vi.fn(),
  isNotNull: vi.fn((column: unknown) => column),
  isNull: vi.fn((column: unknown) => column),
  like: vi.fn(),
  sql: vi.fn(),
}));

mock.module('@utils-plane/db', () => ({
  db: {
    insert,
    select,
    delete: deleteFrom,
    query: { files: { findFirst } },
  },
  files: {
    id: 'id',
    userId: 'userId',
    expiresAt: 'expiresAt',
    deletedAt: 'deletedAt',
  },
  tasks: {},
}));
```

`eq` mock 有意返回其 value 参数，因此 `db.delete(files).where(eq(files.id, file.id))` 会把文件 ID
字面量传给 `deleteWhere`。新增保留策略 `describe` 块；其 `beforeEach` 重置 `selectedRows = []`、清空
所有 mock，并把 `minioService.delete` 设为成功的 mock。加入以下断言：

```typescript
it('selects anonymous files whose expiry is at or before now', async () => {
  const now = new Date('2026-07-13T00:00:00.000Z');
  selectedRows = [anonymousFile({ expiresAt: now })];
  const service = new FilesService(minioService as never);

  const summary = await service.cleanupExpired(now);

  expect(lte).toHaveBeenCalledWith('expiresAt', now);
  expect(summary).toEqual({
    scanned: 1,
    deleted: 1,
    failed: 0,
    deletedFileIds: ['file-1'],
    failedFileIds: [],
  });
  expect(deleteWhere).toHaveBeenCalledWith('file-1');
});

it('uses a thirty day cutoff for trashed files', async () => {
  const now = new Date('2026-07-31T00:00:00.000Z');
  selectedRows = [
    userFile({ deletedAt: new Date('2026-07-01T00:00:00.000Z') }),
  ];
  const service = new FilesService(minioService as never);

  const summary = await service.cleanupTrashed(now);

  expect(lte).toHaveBeenCalledWith(
    'deletedAt',
    new Date('2026-07-01T00:00:00.000Z')
  );
  expect(summary.deleted).toBe(1);
});

it('keeps the database record when object deletion fails', async () => {
  selectedRows = [anonymousFile()];
  minioService.delete.mockRejectedValueOnce(new Error('storage unavailable'));
  const service = new FilesService(minioService as never);

  const summary = await service.cleanupExpired(
    new Date('2026-07-13T00:00:00.000Z')
  );

  expect(summary.failed).toBe(1);
  expect(summary.failedFileIds).toEqual(['file-1']);
  expect(deleteWhere).not.toHaveBeenCalled();
});

it('removes the row when idempotent object deletion reports success', async () => {
  selectedRows = [anonymousFile()];
  minioService.delete.mockResolvedValueOnce(undefined);
  const service = new FilesService(minioService as never);

  const summary = await service.cleanupExpired(
    new Date('2026-07-13T00:00:00.000Z')
  );

  expect(summary.deletedFileIds).toEqual(['file-1']);
  expect(deleteWhere).toHaveBeenCalledWith('file-1');
});
```

在测试文件中增加 `import type { File } from '@utils-plane/db'`，并定义完整工厂：

```typescript
const baseFile: File = {
  id: 'file-1',
  userId: null,
  filename: 'report.pdf',
  originalSize: 128,
  storageKey: 'anonymous/file-1/report.pdf',
  bucket: 'uploads',
  mimeType: 'application/pdf',
  metadata: null,
  expiresAt: new Date('2026-07-13T00:00:00.000Z'),
  deletedAt: null,
  createdAt: new Date('2026-07-12T00:00:00.000Z'),
  updatedAt: new Date('2026-07-12T00:00:00.000Z'),
};

function anonymousFile(overrides: Partial<File> = {}): File {
  return { ...baseFile, ...overrides };
}

function userFile(overrides: Partial<File> = {}): File {
  return {
    ...baseFile,
    userId: 'user-1',
    storageKey: 'user-1/file-1/report.pdf',
    expiresAt: null,
    deletedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}
```

- [ ] **步骤 2：运行定向测试并确认失败**

运行：

```bash
bun test apps/api/src/modules/files/files.service.test.ts
```

预期：失败，因为 `cleanupTrashed` 尚不存在，`cleanupExpired` 使用 `gte`，且旧方法返回数字。

- [ ] **步骤 3：实现保留方法**

在 `files.service.ts` 中用 `lte` 替换 `gte`，并加入：

```typescript
export type CleanupSummary = {
  scanned: number;
  deleted: number;
  failed: number;
  deletedFileIds: string[];
  failedFileIds: string[];
};

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

async cleanupExpired(now = new Date()): Promise<CleanupSummary> {
  const records = await db
    .select()
    .from(files)
    .where(
      and(
        isNull(files.userId),
        isNull(files.deletedAt),
        isNotNull(files.expiresAt),
        lte(files.expiresAt, now)
      )
    );
  return this.cleanupRecords(records);
}

async cleanupTrashed(now = new Date()): Promise<CleanupSummary> {
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_MS);
  const records = await db
    .select()
    .from(files)
    .where(and(isNotNull(files.deletedAt), lte(files.deletedAt, cutoff)));
  return this.cleanupRecords(records);
}

private async cleanupRecords(records: File[]): Promise<CleanupSummary> {
  const deletedFileIds: string[] = [];
  const failedFileIds: string[] = [];
  for (const file of records) {
    try {
      await this.minioService.delete(file.storageKey);
      await db.delete(files).where(eq(files.id, file.id));
      deletedFileIds.push(file.id);
    } catch (error) {
      failedFileIds.push(file.id);
      this.logger.error(
        'Failed to permanently clean file ' + file.id,
        error instanceof Error ? error.stack : undefined
      );
    }
  }
  return {
    scanned: records.length,
    deleted: deletedFileIds.length,
    failed: failedFileIds.length,
    deletedFileIds,
    failedFileIds,
  };
}
```

最后一个用例代表对象已不存在：S3 `DeleteObject` 是幂等边界，前面不得先执行存在性检查。日志和返回
摘要可以包含文件 ID，但不得包含文件名、存储键或文件内容。

- [ ] **步骤 4：接入 Worker 与稳定调度器**

新建 `cleanup.processor.test.ts`：

```typescript
import { expect, it, vi } from 'bun:test';
import { CleanupProcessor } from './cleanup.processor';

it('runs anonymous expiry and trash retention in one job', async () => {
  const files = {
    cleanupExpired: vi.fn().mockResolvedValue({
      scanned: 1,
      deleted: 1,
      failed: 0,
      deletedFileIds: ['expired-1'],
      failedFileIds: [],
    }),
    cleanupTrashed: vi.fn().mockResolvedValue({
      scanned: 2,
      deleted: 1,
      failed: 1,
      deletedFileIds: ['trash-1'],
      failedFileIds: ['trash-2'],
    }),
  };
  const processor = new CleanupProcessor(files as never);
  const result = await processor.process({ id: 'cleanup-1' } as never);

  expect(files.cleanupExpired).toHaveBeenCalledTimes(1);
  expect(files.cleanupTrashed).toHaveBeenCalledTimes(1);
  expect(result).toEqual({
    expired: {
      scanned: 1,
      deleted: 1,
      failed: 0,
      deletedFileIds: ['expired-1'],
      failedFileIds: [],
    },
    trash: {
      scanned: 2,
      deleted: 1,
      failed: 1,
      deletedFileIds: ['trash-1'],
      failedFileIds: ['trash-2'],
    },
  });
});
```

向 `CleanupProcessor` 注入 `FilesService` 并返回两类摘要。记录组合结果中的计数字段和文件 ID 数组。
在重复调度选项中加入 `jobId: 'hourly-file-retention'`。

- [ ] **步骤 5：验证并提交**

运行：

```bash
bun test apps/api/src/modules/files/files.service.test.ts
bun test apps/api/src/modules/tasks/processors/cleanup.processor.test.ts
```

预期：全部保留策略测试通过。

```bash
git add apps/api/src/modules/files apps/api/src/modules/tasks/processors
git commit -m "fix: 实现匿名文件和回收站定期清理"
```

## 任务 4：增加账号汇总与真实 Dashboard 数据

**文件：**

- 新建：apps/api/src/modules/account/account.module.ts
- 新建：apps/api/src/modules/account/account.controller.ts
- 新建：apps/api/src/modules/account/account.service.ts
- 新建：apps/api/src/modules/account/account.repository.ts
- 新建：apps/api/src/modules/account/dto/account.dto.ts
- 新建：apps/api/src/modules/account/account.service.test.ts
- 修改：apps/api/src/app.module.ts
- 新建：apps/web/src/hooks/api/use-account.ts
- 修改：apps/web/src/app/[locale]/(app)/dashboard/page.tsx

- [ ] **步骤 1：编写 AccountService 汇总测试**

新建 `account.service.test.ts`：

```typescript
import { beforeEach, expect, it, vi } from 'bun:test';
import { AccountService } from './account.service';

const repository = {
  getSummary: vi.fn(),
  getDeletionSnapshot: vi.fn(),
  deleteAccountRecords: vi.fn(),
};
const minio = { delete: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  minio.delete.mockResolvedValue(undefined);
});

function createService(options?: { profile: { id: string; email: string } }) {
  if (options) {
    repository.getDeletionSnapshot.mockResolvedValue({
      profile: options.profile,
      files: [],
    });
  }
  return new AccountService(repository as never, minio as never);
}

function deletionSnapshot() {
  return {
    profile: { id: 'user-1', email: 'owner@example.com' },
    files: [
      { id: 'file-1', storageKey: 'user-1/file-1/a.pdf' },
      { id: 'file-2', storageKey: 'user-1/file-2/b.pdf' },
    ],
  };
}

it('returns full counts instead of deriving them from recent rows', async () => {
  repository.getSummary.mockResolvedValue({
    activeTaskCount: 7,
    failedTaskCount: 4,
    activeFileCount: 23,
    activeFileBytes: 123456,
    recentTasks: [{ id: 'task-1', status: 'completed' }],
    recentFiles: [{ id: 'file-1', filename: 'result.pdf' }],
  });
  const service = createService();

  await expect(service.getSummary('user-1')).resolves.toMatchObject({
    activeTaskCount: 7,
    failedTaskCount: 4,
    activeFileCount: 23,
    activeFileBytes: 123456,
  });
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：

```bash
bun test apps/api/src/modules/account/account.service.test.ts
```

预期：失败，因为 `AccountService` 尚不存在。

- [ ] **步骤 3：实现 Repository、DTO、Service、Controller 和 Module**

`AccountSummaryDto` 必须使用显式 Swagger 字段，不直接公开数据库 `File` 类型：

```typescript
export class AccountRecentFileDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty()
  filename!: string;

  @ApiProperty()
  originalSize!: number;

  @ApiProperty()
  mimeType!: string;

  @ApiProperty()
  createdAt!: Date;
}

export class AccountSummaryDto {
  @ApiProperty()
  activeTaskCount!: number;

  @ApiProperty()
  failedTaskCount!: number;

  @ApiProperty()
  activeFileCount!: number;

  @ApiProperty()
  activeFileBytes!: number;

  @ApiProperty({ type: () => [TaskResponseDto] })
  recentTasks!: TaskResponseDto[];

  @ApiProperty({ type: () => [AccountRecentFileDto] })
  recentFiles!: AccountRecentFileDto[];
}
```

`AccountRepository.getSummary(userId)` 分别执行使用 `count`、`sum`、`inArray`、`eq` 和 `isNull` 的
聚合查询，并执行两个排序后的 `limit(5)` 查询。返回前用 `Number` 转换 PostgreSQL 的 bigint/string
聚合结果。活动任务条件准确为当前用户且状态在 `['pending', 'processing']`；失败任务条件准确为当前用户
且状态为 `failed`；活动文件数量和字节数条件准确为当前用户且 `deletedAt IS NULL`。最近任务按
`createdAt DESC LIMIT 5`，最近活动文件按 `createdAt DESC LIMIT 5`。最近文件查询只选择 `id`、
`filename`、`originalSize`、`mimeType` 和 `createdAt`，不返回 `storageKey`、bucket 或内部 metadata。

`AccountController`：

```typescript
@ApiTags('account')
@Controller('account')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get('summary')
  @ApiBearerAuth()
  @ApiOkResponse({ type: AccountSummaryDto })
  async summary(@CurrentUser() currentUser?: User) {
    if (!currentUser) throw new UnauthorizedException();
    return this.accountService.getSummary(currentUser.id);
  }
}
```

`AccountService` 构造函数从一开始就接收 `AccountRepository` 和 `MinioService`。`AccountModule` 导入
`FilesModule`，注册 `AccountRepository`、`AccountService` 和 Controller，再在 `AppModule` 中注册
`AccountModule`。任务 5 增加 `AccountExportService`，任务 6 只增加方法，不再改变构造函数契约。

- [ ] **步骤 4：接入 Web Dashboard**

在 `use-account.ts` 中加入 `useAccountSummary`：

```typescript
export function useAccountSummary() {
  return useQuery({
    queryKey: ['account', 'summary'],
    queryFn: async () => {
      const { data, error } = await api.GET('/account/summary');
      if (error) throw error;
      return data;
    },
  });
}
```

更新 Dashboard，改用 `summary.activeTaskCount`、`summary.failedTaskCount`、
`summary.activeFileCount`、`summary.activeFileBytes`、`summary.recentTasks` 和
`summary.recentFiles`。用 `formatBytes` 展示存储量并显示文件数副标题；移除 `useTasks`、`useFiles` 和
本地过滤。

- [ ] **步骤 5：导出 OpenAPI、验证并提交**

运行：

```bash
bun --cwd apps/api run openapi:export
bun --cwd packages/api-client run generate
bun test apps/api/src/modules/account/account.service.test.ts
bun --cwd apps/web test
```

预期：账号测试和 Web 测试通过；生成的客户端包含 `/account/summary`。

```bash
git add apps/api/src/modules/account apps/api/src/app.module.ts apps/api/openapi.json packages/api-client/src/schema.ts apps/web/src/hooks apps/web/src/app
git commit -m "feat: 添加账号汇总和真实仪表盘数据"
```

## 任务 5：流式导出完整账号 ZIP

**文件：**

- 修改：apps/api/src/modules/files/minio.service.ts
- 新建：apps/api/src/modules/account/account-export.util.ts
- 新建：apps/api/src/modules/account/account-export.service.ts
- 新建：apps/api/src/modules/account/account-export.service.test.ts
- 修改：apps/api/src/modules/account/account.repository.ts
- 修改：apps/api/src/modules/account/account.controller.ts
- 修改：apps/api/src/modules/account/account.module.ts

- [ ] **步骤 1：编写导出工具与编排测试**

新建 `account-export.service.test.ts`，内容包括：

```typescript
import { expect, it, vi } from 'bun:test';
import { PassThrough, Readable } from 'node:stream';
import { AccountExportService } from './account-export.service';
import {
  buildExportFilename,
  createArchivePath,
  createManifestEntry,
} from './account-export.util';

it('builds a stable UTC export filename', () => {
  expect(buildExportFilename(new Date('2026-07-13T08:09:10.000Z'))).toBe(
    'utils-plane-export-20260713-080910.zip'
  );
});

it('sanitizes traversal and disambiguates duplicate names', () => {
  expect(createArchivePath('../report.pdf', 'file-12345678', new Set())).toBe(
    'files/report.pdf'
  );
  const used = new Set(['files/report.pdf']);
  expect(createArchivePath('report.pdf', 'file-12345678', used)).toBe(
    'files/report-file-1234.pdf'
  );
});

it('omits storage internals and marks trash state in the public manifest', () => {
  const source = exportSnapshot().files[0];
  const entry = createManifestEntry(
    { ...source, deletedAt: new Date('2026-07-13T00:00:00.000Z') },
    'files/report.pdf'
  );

  expect(entry).toMatchObject({
    id: 'file-12345678',
    status: 'trashed',
    exportPath: 'files/report.pdf',
  });
  expect(entry).not.toHaveProperty('storageKey');
});

it('preflights every object before opening the archive stream', async () => {
  const minio = {
    head: vi.fn().mockRejectedValue(new Error('missing object')),
    downloadStream: vi.fn().mockResolvedValue(Readable.from('body')),
  };
  const repository = {
    getExportSnapshot: vi.fn().mockResolvedValue(exportSnapshot()),
  };
  const service = new AccountExportService(repository as never, minio as never);

  await expect(service.prepareExport('user-1')).rejects.toThrow(
    'Account export is incomplete'
  );
  expect(minio.downloadStream).not.toHaveBeenCalled();
});

it('writes a prepared export to a writable stream', async () => {
  const minio = {
    head: vi.fn().mockResolvedValue(undefined),
    downloadStream: vi.fn().mockResolvedValue(Readable.from('body')),
  };
  const repository = {
    getExportSnapshot: vi.fn().mockResolvedValue(exportSnapshot()),
  };
  const service = new AccountExportService(repository as never, minio as never);
  const prepared = await service.prepareExport('user-1');
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', chunk => chunks.push(Buffer.from(chunk)));

  await service.writeExport(prepared, output);

  const zip = Buffer.concat(chunks);
  expect(zip.subarray(0, 2).toString()).toBe('PK');
  for (const entryName of [
    'profile.json',
    'tasks.json',
    'files.json',
    'files/report.pdf',
  ]) {
    expect(zip.includes(Buffer.from(entryName))).toBe(true);
  }
  expect(minio.head).toHaveBeenCalledTimes(1);
  expect(minio.downloadStream).toHaveBeenCalledTimes(1);
});
```

在测试中定义包含一份安全资料、一条任务和一条文件记录的 `exportSnapshot`。文件必须使用
`id: 'file-12345678'`、`filename: 'report.pdf'`、
`storageKey: 'user-1/file-12345678/report.pdf'` 与 `deletedAt: null`，使预检和 ZIP 测试断言同一个
稳定归档路径。

- [ ] **步骤 2：运行测试并确认失败**

运行：

```bash
bun test apps/api/src/modules/account/account-export.service.test.ts
```

预期：失败，因为导出 Service 和工具函数尚不存在。

- [ ] **步骤 3：增加 MinIO head 与流式 API**

在 `MinioService` 中导入 `HeadObjectCommand` 和 `Readable`，并加入：

```typescript
async head(key: string): Promise<void> {
  await this.client.send(
    new HeadObjectCommand({ Bucket: this.bucket, Key: key })
  );
}

async downloadStream(key: string): Promise<Readable> {
  const response = await this.client.send(
    new GetObjectCommand({ Bucket: this.bucket, Key: key })
  );
  if (!response.Body) throw new Error('Object body is empty');
  return response.Body as Readable;
}
```

将 `exists` 改为调用 `head`，不再下载完整对象。

- [ ] **步骤 4：实现导出快照与 ZIP 流式输出**

在 `account.repository.ts` 中用下列类型定义 Repository/导出边界。资料查询只能选择这些具名用户列；
任务和文件查询按 `userId` 过滤，但不按 `deletedAt` 过滤，因此活动文件和回收站文件都会导出：

```typescript
export type AccountExportProfile = Pick<
  User,
  | 'id'
  | 'name'
  | 'email'
  | 'emailVerified'
  | 'image'
  | 'plan'
  | 'role'
  | 'createdAt'
  | 'updatedAt'
>;

export type AccountExportFile = Pick<
  File,
  | 'id'
  | 'filename'
  | 'originalSize'
  | 'storageKey'
  | 'mimeType'
  | 'createdAt'
  | 'deletedAt'
>;

export interface AccountExportSnapshot {
  profile: AccountExportProfile;
  tasks: Task[];
  files: AccountExportFile[];
}
```

`AccountRepository.getExportSnapshot(userId): Promise<AccountExportSnapshot>` 返回上述三项查询结果。
`account-export.util.ts` 必须统一斜杠、去除路径穿越与控制字符、保留扩展名，并在冲突时附加文件 ID 的
前八位字符。它还导出 `createManifestEntry(source, exportPath)`：显式解构移除 `storageKey`，保留公开文件
字段，加入 `status: 'active' | 'trashed'` 与 `exportPath`。

文件名生成函数使用 UTC，准确实现为：

```typescript
export function buildExportFilename(date: Date): string {
  const iso = date.toISOString();
  const day = iso.slice(0, 10).replaceAll('-', '');
  const time = iso.slice(11, 19).replaceAll(':', '');
  return `utils-plane-export-${day}-${time}.zip`;
}
```

按下列准确形式定义已准备导出和两个 Service 阶段。`prepareExport` 必须在 Controller 发送响应头之前完成
全部对象 head 请求；使用顺序循环，避免无配额账号造成无界对象存储并发：

```typescript
export interface PreparedAccountExport {
  filename: string;
  profile: AccountExportProfile;
  tasks: Task[];
  files: Array<{
    source: AccountExportFile;
    exportPath: string;
  }>;
}

async prepareExport(userId: string): Promise<PreparedAccountExport> {
  const snapshot = await this.repository.getExportSnapshot(userId);
  try {
    for (const file of snapshot.files) {
      await this.minio.head(file.storageKey);
    }
  } catch {
    throw new ServiceUnavailableException('Account export is incomplete');
  }

  const used = new Set<string>();
  const preparedFiles = snapshot.files.map(source => {
    const exportPath = createArchivePath(source.filename, source.id, used);
    used.add(exportPath);
    return { source, exportPath };
  });

  return {
    filename: buildExportFilename(new Date()),
    profile: snapshot.profile,
    tasks: snapshot.tasks,
    files: preparedFiles,
  };
}

function appendArchiveStream(
  archive: archiver.Archiver,
  input: Readable,
  name: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      archive.off('entry', onEntry);
      archive.off('error', onError);
      input.off('error', onError);
    };
    const onEntry = (entry: archiver.EntryData) => {
      if (entry.name !== name) return;
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    archive.on('entry', onEntry);
    archive.once('error', onError);
    input.once('error', onError);
    archive.append(input, { name });
  });
}

async writeExport(
  prepared: PreparedAccountExport,
  output: Writable
): Promise<void> {
  const archive = archiver.create('zip', { zlib: { level: 6 } });
  let activeInput: Readable | null = null;
  let aborted = false;
  const abortError = new Error('Account export aborted');
  const onClose = () => {
    if (output.writableFinished) return;
    aborted = true;
    activeInput?.destroy(abortError);
    archive.abort();
  };
  output.once('close', onClose);
  archive.pipe(output);

  try {
    archive.append(JSON.stringify(prepared.profile, null, 2), {
      name: 'profile.json',
    });
    archive.append(JSON.stringify(prepared.tasks, null, 2), {
      name: 'tasks.json',
    });
    const manifest = prepared.files.map(({ source, exportPath }) =>
      createManifestEntry(source, exportPath)
    );
    archive.append(JSON.stringify(manifest, null, 2), { name: 'files.json' });

    for (const { source, exportPath } of prepared.files) {
      if (aborted) throw abortError;
      activeInput = await this.minio.downloadStream(source.storageKey);
      await appendArchiveStream(archive, activeInput, exportPath);
      activeInput = null;
    }
    await archive.finalize();
    await finished(output);
  } catch (error) {
    archive.abort();
    if (!output.destroyed) {
      output.destroy(error instanceof Error ? error : new Error(String(error)));
    }
    throw error;
  } finally {
    output.off('close', onClose);
  }
}
```

沿用项目现有导入风格：`import * as archiver from 'archiver'`，从 `node:stream` 导入
`Readable`/`Writable` 类型，从 `node:stream/promises` 导入 `finished`。

按此顺序加入 Controller 路由；从 `express` 导入带别名的 `Response`，避免与全局 Fetch Response 类型冲突：

```typescript
@Get('export')
@ApiBearerAuth()
@ApiProduces('application/zip')
@ApiOkResponse({
  schema: { type: 'string', format: 'binary' },
  description: 'Complete account export ZIP',
})
async exportAccount(
  @CurrentUser() currentUser: User | undefined,
  @Res() response: ExpressResponse
): Promise<void> {
  if (!currentUser) throw new UnauthorizedException();
  const prepared = await this.accountExportService.prepareExport(currentUser.id);
  response.type('application/zip');
  response.attachment(prepared.filename);
  await this.accountExportService.writeExport(prepared, response);
}
```

在 `AccountModule` 注册 `AccountExportService`。若发送响应头后源流失败，`writeExport` 必须拒绝并销毁
响应，不能返回看似完成的局部归档。跟踪当前追加的可读流并监听输出提前 `close`；客户端断开时销毁该
可读流、调用 `archive.abort()`、停止请求后续对象并拒绝写入。每次等待归档的 `entry` 事件后，才为下一
文件调用 `downloadStream`，确保同一时间只打开一个对象 body。

- [ ] **步骤 5：验证并提交**

运行：

```bash
bun test apps/api/src/modules/account/account-export.service.test.ts
bun --cwd apps/api run build
```

预期：导出测试和 API 构建通过。

```bash
git add apps/api/src/modules/account apps/api/src/modules/files/minio.service.ts
git commit -m "feat: 添加账号完整数据流式导出"
```

## 任务 6：实现立即注销账号与设置页控件

**文件：**

- 修改：apps/api/src/modules/account/dto/account.dto.ts
- 修改：apps/api/src/modules/account/account.repository.ts
- 修改：apps/api/src/modules/account/account.service.ts
- 修改：apps/api/src/modules/account/account.controller.ts
- 修改：apps/api/src/modules/account/account.service.test.ts
- 修改：apps/web/src/hooks/api/use-account.ts
- 修改：apps/web/src/app/[locale]/(app)/settings/page.tsx
- 修改：apps/web/messages/zh.json
- 修改：apps/web/messages/en.json

- [ ] **步骤 1：编写注销行为测试**

在 `account.service.test.ts` 中加入：

```typescript
it('rejects deletion when confirmation email does not match', async () => {
  const service = createService({
    profile: { id: 'user-1', email: 'owner@example.com' },
  });
  await expect(
    service.deleteAccount('user-1', 'other@example.com')
  ).rejects.toThrow('Confirmation email does not match');
  expect(repository.deleteAccountRecords).not.toHaveBeenCalled();
});

it('keeps database data when an object cannot be deleted', async () => {
  repository.getDeletionSnapshot.mockResolvedValue({
    profile: { id: 'user-1', email: 'owner@example.com' },
    files: [{ id: 'file-1', storageKey: 'user-1/file-1/a.pdf' }],
  });
  minio.delete.mockRejectedValueOnce(new Error('storage unavailable'));

  await expect(
    service.deleteAccount('user-1', 'owner@example.com')
  ).rejects.toThrow('Account deletion is incomplete');
  expect(repository.deleteAccountRecords).not.toHaveBeenCalled();
});

it('deletes records only after all objects are removed', async () => {
  repository.getDeletionSnapshot.mockResolvedValue(deletionSnapshot());
  await service.deleteAccount('user-1', 'owner@example.com');
  expect(minio.delete).toHaveBeenCalledTimes(2);
  expect(repository.deleteAccountRecords).toHaveBeenCalledWith(
    'user-1',
    'owner@example.com'
  );
});

it('retries idempotently after one object was already removed', async () => {
  repository.getDeletionSnapshot.mockResolvedValue(deletionSnapshot());
  minio.delete
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('storage unavailable'));

  await expect(
    service.deleteAccount('user-1', 'owner@example.com')
  ).rejects.toThrow('Account deletion is incomplete');
  expect(repository.deleteAccountRecords).not.toHaveBeenCalled();

  minio.delete.mockResolvedValue(undefined);
  await service.deleteAccount('user-1', 'owner@example.com');

  expect(repository.deleteAccountRecords).toHaveBeenCalledTimes(1);
});
```

`deletionSnapshot()` 包含两条文件记录。第二次调用会有意再次删除第一个键；MinIO `DeleteObject` 把键
不存在视为成功，只有确认两个键均已移除后才允许执行数据库事务。

- [ ] **步骤 2：运行测试并确认失败**

运行：

```bash
bun test apps/api/src/modules/account/account.service.test.ts
```

预期：失败，因为 `deleteAccount` 尚未实现。

- [ ] **步骤 3：实现 DTO 与注销事务**

`DeleteAccountDto`：

```typescript
export class DeleteAccountDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  confirmationEmail!: string;
}
```

`AccountService` 用 `trim().toLowerCase()` 规范化两个邮箱，删除全部对象，并在任一对象失败时抛出
`ServiceUnavailableException`。`AccountRepository.deleteAccountRecords` 使用一个 `db.transaction`，
按以下顺序显式删除：

```typescript
await tx.delete(tasks).where(eq(tasks.userId, userId));
await tx.delete(files).where(eq(files.userId, userId));
await tx.delete(verification).where(eq(verification.identifier, email));
await tx.delete(account).where(eq(account.userId, userId));
await tx.delete(session).where(eq(session.userId, userId));
await tx.delete(user).where(eq(user.id, userId));
```

在 `AccountController` 中加入 `DELETE /account`，使用 `@HttpCode(HttpStatus.NO_CONTENT)` 与
`@ApiNoContentResponse()` 并返回 HTTP 204。

- [ ] **步骤 4：增加导出与危险区控件**

在 `use-account.ts` 中加入：

```typescript
export function getAccountExportUrl() {
  return (
    (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001') +
    '/account/export'
  );
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (confirmationEmail: string) => {
      const { error } = await api.DELETE('/account', {
        body: { confirmationEmail },
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.clear(),
  });
}
```

设置页增加：

- “导出全部数据”按钮，使用 `window.location.assign(getAccountExportUrl())`。
- 由任务 8 实现的“安装应用”入口位置。
- 包含邮箱输入和明确永久删除确认的危险区。
- 注销成功后以 `await signOut().catch(() => undefined)` 尽力清理 Better-Auth 客户端状态；无论该请求是否
  因服务端 Session 已删除而失败，都清理 Query 缓存、跳转 `/` 并刷新。
- 输入邮箱与当前邮箱忽略大小写后完全匹配前，禁用注销操作。

为导出准备、导出失败、注销警告、邮箱确认、注销进度、成功和重试补齐中英文文案。

- [ ] **步骤 5：重新生成 API 类型、验证并提交**

运行：

```bash
bun --cwd apps/api run openapi:export
bun --cwd packages/api-client run generate
bun run test:api
bun run test:web
```

预期：API 与 Web 测试套件通过，生成的客户端包含 `GET /account/export` 和 `DELETE /account`。

```bash
git add apps/api apps/web packages/api-client/src/schema.ts
git commit -m "feat: 添加账号导出和立即注销入口"
```

## 任务 7：增加公开法务页面与真实公测文案

**文件：**

- 新建：apps/web/src/components/legal/legal-document.tsx
- 新建：apps/web/src/lib/public-site.ts
- 新建：apps/web/src/app/[locale]/(marketing)/privacy/page.tsx
- 新建：apps/web/src/app/[locale]/(marketing)/terms/page.tsx
- 新建：apps/web/src/app/[locale]/(marketing)/beta/page.tsx
- 新建：`apps/web/src/app/[locale]/(marketing)/__tests__/public-trust-pages.test.ts`
- 修改：apps/web/src/app/[locale]/(marketing)/layout.tsx
- 修改：apps/web/src/middleware.ts
- 修改：apps/web/src/middleware.test.ts
- 修改：`apps/web/src/app/[locale]/(marketing)/__tests__/marketing-copy.test.ts`
- 修改：apps/web/messages/zh.json
- 修改：apps/web/messages/en.json

- [ ] **步骤 1：编写公开路由与文案测试**

扩展 `middleware.test.ts`：

```typescript
it('keeps legal and beta pages public', () => {
  for (const path of ['/zh/privacy', '/zh/terms', '/zh/beta']) {
    const response = middleware(request(path));
    expect(response.status).not.toBe(307);
    expect(response.headers.get('location')).toBeNull();
  }
});
```

新建 `public-trust-pages.test.ts`：

```typescript
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import zh from '../../../../../messages/zh.json';
import en from '../../../../../messages/en.json';

function collectCopy(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectCopy);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectCopy);
  }
  return [];
}

it('publishes complete bilingual trust content without commercial roadmap copy', () => {
  for (const messages of [zh, en]) {
    expect(messages.PublicSite.privacy.sections.length).toBeGreaterThanOrEqual(
      6
    );
    expect(messages.PublicSite.terms.sections.length).toBeGreaterThanOrEqual(5);
    expect(messages.PublicSite.beta.sections.length).toBeGreaterThanOrEqual(4);
  }
  const combinedCopy = collectCopy([zh, en]).join('\n');
  expect(combinedCopy).not.toMatch(/商业版|付费|commercial|paid/i);
});

it('removes dead docs and github footer links', () => {
  const layout = readFileSync(join(import.meta.dir, '../layout.tsx'), 'utf8');
  expect(layout).not.toContain('href="/docs"');
  expect(layout).not.toContain('href="/github"');
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：

```bash
bun --cwd apps/web test src/middleware.test.ts "src/app/[locale]/(marketing)/__tests__/public-trust-pages.test.ts" "src/app/[locale]/(marketing)/__tests__/marketing-copy.test.ts"
```

预期：失败，因为路由和消息命名空间尚不存在，失效链接仍保留。

- [ ] **步骤 3：实现支持配置与共享法务布局**

public-site.ts:

```typescript
export function getSupportEmail() {
  return process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@utils-plane.local';
}

export function assertProductionSupportEmail(email: string) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.endsWith('.local')) {
    throw new Error('NEXT_PUBLIC_SUPPORT_EMAIL must be a reachable email');
  }
}
```

`LegalDocument` 渲染紧凑标题、生效日期、导语、章节标题、段落、列表和 `mailto` 支持链接；接收已经翻译
的内容，不渲染嵌套卡片。

- [ ] **步骤 4：加入准确公开内容与路由**

在两份消息文件中增加 `PublicSite` 命名空间，章节主题如下：

两个 locale 都必须把运营主体渲染为准确文本 `Utils Plane 项目团队`；支持地址只能来自
`getSupportEmail()`，不得在页面组件中另写邮箱字面量。

隐私：本地处理；服务端处理；账号与认证 Cookie；匿名文件保留 24 小时；回收站保留 30 天；导出与注销；
无分析/回放；可选外部 AI 提供商；HTTP 受限公测警告；运营主体与支持方式。

条款：公测状态；用户内容责任；禁止用途；结果复核；可用性；账号终止；运营主体与支持方式。

公测说明：当前免费本地工具；登录增强工具；数据保留；IP + HTTP 敏感文件警告；支持渠道。

每个页面使用 `getTranslations('PublicSite.<page>')`、`getSupportEmail()`、
`setRequestLocale(locale)`，并用页面专属 canonical 实现 `generateMetadata`。

把 `/privacy`、`/terms` 和 `/beta` 加入 `PUBLIC_PATHS`。页脚改用 locale-aware `Link` 指向这些页面，
并提供 `mailto` 支持地址。

将所有用户可见的“商业版/Commercial mode/future paid”改为“登录增强能力/公测增强选项”及对应英文。
把计划值 `free` 映射为本地化的“免费公测/Free beta”。

同步修改 `marketing-copy.test.ts`：删除要求 “Ready for commercial workflows” 的断言，改为断言中英文
营销文案包含“登录增强能力/Signed-in enhanced capabilities”，且所有用户可见消息值不包含上述商业版或
未来付费措辞。只改用户文案和文案测试；`commercial`、`pro` 等内部权益字段与处理函数名继续保留兼容性。

- [ ] **步骤 5：验证并提交**

运行：

```bash
bun --cwd apps/web test src/middleware.test.ts "src/app/[locale]/(marketing)/__tests__/public-trust-pages.test.ts" "src/app/[locale]/(marketing)/__tests__/marketing-copy.test.ts"
bun --cwd apps/web run build
```

预期：测试和 Web 生产构建通过。

```bash
git add apps/web
git commit -m "feat: 添加公测隐私条款和公开说明"
```

## 任务 8：将 PWA 安装入口移入设置页

**文件：**

- 新建：apps/web/src/components/pwa/install-provider.tsx
- 新建：`apps/web/src/components/pwa/__tests__/install-provider.test.tsx`
- 删除：apps/web/src/components/pwa/install-prompt.tsx
- 删除：`apps/web/src/components/pwa/__tests__/install-prompt.test.tsx`
- 修改：apps/web/src/app/[locale]/layout.tsx
- 修改：apps/web/src/app/[locale]/(app)/settings/page.tsx
- 修改：apps/web/messages/zh.json
- 修改：apps/web/messages/en.json

- [ ] **步骤 1：编写 Provider 行为测试**

新建 `install-provider.test.tsx`：

```typescript
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { InstallProvider, useInstallApp } from '../install-provider';

function Consumer() {
  const { canInstall, install } = useInstallApp();
  return canInstall ? <button onClick={install}>install-command</button> : null;
}

it('does not render a global prompt and exposes a command after the browser event', async () => {
  const prompt = vi.fn();
  render(<InstallProvider><Consumer /></InstallProvider>);
  expect(screen.queryByText('install-command')).not.toBeInTheDocument();

  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
  });
  window.dispatchEvent(event);

  fireEvent.click(await screen.findByText('install-command'));
  await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：

```bash
bun --cwd apps/web test src/components/pwa/__tests__/install-provider.test.tsx
```

预期：失败，因为 `InstallProvider` 尚不存在。

- [ ] **步骤 3：实现 Context Provider**

`install-provider.tsx` 导出：

```typescript
type InstallContextValue = {
  canInstall: boolean;
  install: () => Promise<'accepted' | 'dismissed' | null>;
};

export function InstallProvider({ children }: { children: React.ReactNode }) {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const listener = (next: Event) => {
      next.preventDefault();
      setEvent(next as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', listener);
    return () => window.removeEventListener('beforeinstallprompt', listener);
  }, []);
  const install = async () => {
    if (!event) return null;
    await event.prompt();
    const { outcome } = await event.userChoice;
    setEvent(null);
    return outcome;
  };
  return (
    <InstallContext.Provider value={{ canInstall: Boolean(event), install }}>
      {children}
    </InstallContext.Provider>
  );
}
```

加入带保护的 `useInstallApp` Hook，在 Provider 外使用时抛出错误。

- [ ] **步骤 4：接入布局与设置页**

用 `InstallProvider` 包裹 `QueryProvider` 内容，并从 locale 布局移除 `InstallPrompt`。删除旧提示组件及测试。

`BeforeInstallPromptEvent` 类型必须同时声明 `prompt()` 和
`userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>`。设置页调用
`useInstallApp`；仅在 `canInstall` 为 true 时渲染图标加文字的“安装应用/Install app”按钮；点击后等待
`install`，仅在返回 `accepted` 时显示本地化成功 Toast，返回 `dismissed` 时不宣称安装成功。

- [ ] **步骤 5：验证并提交**

运行：

```bash
bun --cwd apps/web test src/components/pwa
bun --cwd apps/web run build
```

预期：Provider 测试通过，根布局不再渲染安装弹窗。

```bash
git add apps/web/src/components/pwa apps/web/src/app apps/web/messages
git commit -m "update: 将应用安装入口移到设置页"
```

## 任务 9：增加工具级元数据与完整 Sitemap

**文件：**

- 新建：apps/web/src/lib/tools/tool-route-metadata.ts
- 新建：apps/web/src/lib/tools/tool-route-metadata.test.ts
- 新建：apps/web/src/app/[locale]/(app)/image/layout.tsx
- 新建：apps/web/src/app/[locale]/(app)/pdf/layout.tsx
- 新建：下方列出的路由 `layout` 文件
- 修改：apps/web/src/app/sitemap.ts
- 修改：apps/web/src/app/robots.ts

- [ ] **步骤 1：编写元数据与 Sitemap 测试**

新建 `tool-route-metadata.test.ts`：

```typescript
import { expect, it } from 'vitest';
import { allTools } from './tool-metadata';
import {
  createCategoryRouteMetadata,
  createToolRouteMetadata,
} from './tool-route-metadata';

it('builds a self-canonical metadata object for every unique tool route', async () => {
  const hrefs = [...new Set(allTools.map(tool => tool.href))];
  for (const href of hrefs) {
    const metadata = await createToolRouteMetadata('zh', href);
    expect(metadata.alternates?.canonical).toBe(
      'http://localhost:3000/zh' + href
    );
    expect(String(metadata.title)).not.toBe('Utils Plane - 文件进化处理核心');
  }
});

it('uses category copy and self canonicals for image and PDF catalogs', async () => {
  const image = await createCategoryRouteMetadata('zh', '/image');
  const pdf = await createCategoryRouteMetadata('zh', '/pdf');

  expect(image.alternates?.canonical).toBe('http://localhost:3000/zh/image');
  expect(pdf.alternates?.canonical).toBe('http://localhost:3000/zh/pdf');
  expect(String(image.title)).not.toBe(String(pdf.title));
});
```

新建 `apps/web/src/app/sitemap.test.ts`：

```typescript
import { expect, it } from 'vitest';
import { routing } from '@/i18n/routing';
import { allTools } from '@/lib/tools/tool-metadata';
import sitemap from './sitemap';

it('includes every public route in both locales and excludes auth/workbench routes', () => {
  const urls = new Set(sitemap().map(entry => entry.url));
  const publicPaths = [
    '',
    '/image',
    '/pdf',
    '/font',
    '/privacy',
    '/terms',
    '/beta',
    ...new Set(allTools.map(tool => tool.href)),
  ];

  for (const locale of routing.locales) {
    for (const path of publicPaths) {
      expect(urls.has('http://localhost:3000/' + locale + path)).toBe(true);
    }
  }

  for (const entry of urls) {
    expect(entry).not.toMatch(
      /\/(login|register|dashboard|files|tasks|settings)(\/|$)/
    );
  }
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：

```bash
bun --cwd apps/web test src/lib/tools/tool-route-metadata.test.ts src/app/sitemap.test.ts
```

预期：失败，因为元数据辅助函数和完整 Sitemap 尚不存在。

- [ ] **步骤 3：实现共享元数据辅助函数**

tool-route-metadata.ts:

```typescript
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { routing, type Locale } from '@/i18n/routing';
import { getToolByHref } from './tool-metadata';

export async function createToolRouteMetadata(
  locale: Locale,
  href: string
): Promise<Metadata> {
  const tool = getToolByHref(href);
  if (!tool) return {};
  const t = await getTranslations({ locale });
  const base = (
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  ).replace(/\/+$/, '');
  const canonical = base + '/' + locale + href;
  return {
    title: t(tool.titleKey),
    description: t(tool.descriptionKey),
    alternates: {
      canonical,
      languages: {
        zh: base + '/zh' + href,
        en: base + '/en' + href,
        'x-default': base + '/' + routing.defaultLocale + href,
      },
    },
  };
}

const categoryMessages = {
  '/image': {
    titleKey: 'ImageTool.title',
    descriptionKey: 'ImageTool.description',
  },
  '/pdf': {
    titleKey: 'PdfTool.title',
    descriptionKey: 'PdfTool.description',
  },
} as const;

export async function createCategoryRouteMetadata(
  locale: Locale,
  href: keyof typeof categoryMessages
): Promise<Metadata> {
  const t = await getTranslations({ locale });
  const message = categoryMessages[href];
  const base = (
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  ).replace(/\/+$/, '');
  return {
    title: t(message.titleKey),
    description: t(message.descriptionKey),
    alternates: {
      canonical: base + '/' + locale + href,
      languages: {
        zh: base + '/zh' + href,
        en: base + '/en' + href,
        'x-default': base + '/' + routing.defaultLocale + href,
      },
    },
  };
}

export function createToolMetadataGenerator(href: string) {
  return async ({ params }: { params: Promise<{ locale: Locale }> }) => {
    const { locale } = await params;
    return createToolRouteMetadata(locale, href);
  };
}

export function createCategoryMetadataGenerator(
  href: keyof typeof categoryMessages
) {
  return async ({ params }: { params: Promise<{ locale: Locale }> }) => {
    const { locale } = await params;
    return createCategoryRouteMetadata(locale, href);
  };
}

export function ToolMetadataLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
```

- [ ] **步骤 4：增加准确的路由包装层**

使用下列准确分类模板新建 `image/layout.tsx` 和 `pdf/layout.tsx`，只替换所示的两个路由字面量：

```typescript
import {
  createCategoryMetadataGenerator,
  ToolMetadataLayout,
} from '@/lib/tools/tool-route-metadata';

export const generateMetadata = createCategoryMetadataGenerator('/image');
export default ToolMetadataLayout;
```

`apps/web/src/app/[locale]/(app)/image/layout.tsx` 使用 `/image`，
`apps/web/src/app/[locale]/(app)/pdf/layout.tsx` 使用 `/pdf`。

对下表每一行，用表后的准确工具模板新建对应文件。只把单个 `ROUTE_HREF` 标记替换为该行带引号的
href，不做其他替换：

```text
apps/web/src/app/[locale]/(app)/font/layout.tsx                         /font
apps/web/src/app/[locale]/(app)/image/compress/layout.tsx               /image/compress
apps/web/src/app/[locale]/(app)/image/convert/layout.tsx                /image/convert
apps/web/src/app/[locale]/(app)/image/animation/layout.tsx              /image/animation
apps/web/src/app/[locale]/(app)/image/stitch/layout.tsx                 /image/stitch
apps/web/src/app/[locale]/(app)/image/watermark/layout.tsx              /image/watermark
apps/web/src/app/[locale]/(app)/image/id-photo/layout.tsx               /image/id-photo
apps/web/src/app/[locale]/(app)/pdf/merge/layout.tsx                    /pdf/merge
apps/web/src/app/[locale]/(app)/pdf/split/layout.tsx                    /pdf/split
apps/web/src/app/[locale]/(app)/pdf/rearrange/layout.tsx                /pdf/rearrange
apps/web/src/app/[locale]/(app)/pdf/rotate/layout.tsx                   /pdf/rotate
apps/web/src/app/[locale]/(app)/pdf/from-image/layout.tsx               /pdf/from-image
apps/web/src/app/[locale]/(app)/pdf/from-document/layout.tsx            /pdf/from-document
apps/web/src/app/[locale]/(app)/pdf/to-image/layout.tsx                 /pdf/to-image
apps/web/src/app/[locale]/(app)/pdf/to-text/layout.tsx                  /pdf/to-text
apps/web/src/app/[locale]/(app)/pdf/metadata/layout.tsx                 /pdf/metadata
apps/web/src/app/[locale]/(app)/pdf/encrypt/layout.tsx                  /pdf/encrypt
apps/web/src/app/[locale]/(app)/pdf/watermark/layout.tsx                /pdf/watermark
apps/web/src/app/[locale]/(app)/pdf/compress/layout.tsx                 /pdf/compress
```

```typescript
import {
  createToolMetadataGenerator,
  ToolMetadataLayout,
} from '@/lib/tools/tool-route-metadata';

export const generateMetadata = createToolMetadataGenerator(ROUTE_HREF);
export default ToolMetadataLayout;
```

例如 image-compress 行使用字面量 `createToolMetadataGenerator('/image/compress')`。字体包装层使用
`/font`，因此字体目录与其唯一工具共享一个 canonical 路由。

- [ ] **步骤 5：从元数据生成 Sitemap 并验证**

按下列方式实现 Sitemap 路由集合，并沿用现有的 locale 迭代、alternates 和 `x-default` 结构。`baseUrl`
必须先用 `.replace(/\/+$/, '')` 去除尾部斜杠：

```typescript
const PUBLIC_PATHS = [
  ...new Set([
    '',
    '/image',
    '/pdf',
    '/font',
    '/privacy',
    '/terms',
    '/beta',
    ...allTools.map(tool => tool.href),
  ]),
];

const ROUTES = PUBLIC_PATHS.map(path => ({
  path,
  changeFrequency: path === '' ? ('weekly' as const) : ('monthly' as const),
  priority:
    path === '' ? 1 : ['/image', '/pdf', '/font'].includes(path) ? 0.8 : 0.7,
}));
```

`robots.ts` 导入 `routing`，按下列方式生成准确的 locale-aware 禁止路径，同时保留 Sitemap URL：

```typescript
const privateSegments = [
  'login',
  'register',
  'dashboard',
  'files',
  'tasks',
  'settings',
];
const privatePaths = routing.locales.flatMap(locale =>
  privateSegments.map(segment => `/${locale}/${segment}`)
);

return {
  rules: [
    {
      userAgent: '*',
      allow: '/',
      disallow: [...privatePaths, '/api/', '/admin/'],
    },
  ],
  sitemap: `${baseUrl}/sitemap.xml`,
};
```

运行：

```bash
bun --cwd apps/web test src/lib/tools/tool-route-metadata.test.ts src/app/sitemap.test.ts
bun --cwd apps/web run build
```

预期：测试通过，构建输出包含全部路由布局。

```bash
git add apps/web/src/app apps/web/src/lib/tools
git commit -m "feat: 完善工具页元数据和站点地图"
```

## 任务 10：增加依赖感知的健康检查

**文件：**

- 新建：apps/api/src/modules/health/health.service.ts
- 新建：apps/api/src/modules/health/libreoffice-health.ts
- 新建：apps/api/src/modules/health/health.service.test.ts
- 修改：apps/api/src/modules/health/health.controller.ts
- 修改：apps/api/src/modules/health/health.module.ts
- 修改：apps/api/src/modules/files/minio.service.ts

- [ ] **步骤 1：编写健康状态测试**

新建 `health.service.test.ts`：

```typescript
import { expect, it, vi } from 'bun:test';
import { HealthService } from './health.service';

it('returns 503 readiness when a core dependency fails', async () => {
  const checks = createChecks();
  checks.database.mockRejectedValue(new Error('database unavailable'));
  const service = new HealthService(checks);

  const readiness = await service.ready();

  expect(readiness.status).toBe('error');
  expect(readiness.httpStatus).toBe(503);
  expect(JSON.stringify(readiness)).not.toContain('database unavailable');
});

it('reports missing LibreOffice as degraded without failing readiness', async () => {
  const checks = createChecks();
  checks.libreOffice.mockResolvedValue(false);
  const service = new HealthService(checks);

  const readiness = await service.ready();

  expect(readiness.status).toBe('degraded');
  expect(readiness.httpStatus).toBe(200);
  expect(readiness.components.libreOffice.status).toBe('degraded');
});

for (const name of ['database', 'redis', 'minio', 'queues'] as const) {
  it(
    name + ' failure makes readiness unavailable without leaking errors',
    async () => {
      const checks = createChecks();
      checks[name].mockRejectedValue(new Error('secret internal address'));
      const readiness = await new HealthService(checks).ready();

      expect(readiness.status).toBe('error');
      expect(readiness.httpStatus).toBe(503);
      expect(readiness.components[name].status).toBe('error');
      expect(JSON.stringify(readiness)).not.toContain(
        'secret internal address'
      );
    }
  );
}

it('times out a stalled core dependency', async () => {
  const checks = createChecks();
  checks.redis.mockImplementation(() => new Promise(() => undefined));
  const readiness = await new HealthService(checks, 5).ready();

  expect(readiness.httpStatus).toBe(503);
  expect(readiness.components.redis.status).toBe('error');
});
```

按以下准确形式定义全部成功的测试工厂：

```typescript
function createChecks() {
  return {
    database: vi.fn().mockResolvedValue(undefined),
    redis: vi.fn().mockResolvedValue(undefined),
    minio: vi.fn().mockResolvedValue(undefined),
    queues: vi.fn().mockResolvedValue(undefined),
    libreOffice: vi.fn().mockResolvedValue(true),
  };
}
```

- [ ] **步骤 2：运行测试并确认失败**

运行：

```bash
bun test apps/api/src/modules/health/health.service.test.ts
```

预期：失败，因为 `HealthService` 尚不存在。

- [ ] **步骤 3：实现依赖适配器**

使用 `HeadBucketCommand` 增加 `MinioService.checkBucket(): Promise<void>`。

`libreoffice-health.ts` 先检查 `process.env.LIBREOFFICE_BIN`，再依次检查 `soffice` 与 `libreoffice`；
使用带 `['--version']` 和 3 秒超时的 `execFile`。首个命令成功时返回 true，全部候选失败后返回 false。

在 `health.service.ts` 中定义注入边界：

```typescript
export interface HealthChecks {
  database(): Promise<void>;
  redis(): Promise<void>;
  minio(): Promise<void>;
  queues(): Promise<void>;
  libreOffice(): Promise<boolean>;
}

export const HEALTH_CHECKS = Symbol('HEALTH_CHECKS');
export const HEALTH_TIMEOUT_MS = Symbol('HEALTH_TIMEOUT_MS');

@Injectable()
export class HealthService {
  private readonly startedAt = new Date(
    Date.now() - process.uptime() * 1000
  ).toISOString();

  constructor(
    @Inject(HEALTH_CHECKS) private readonly checks: HealthChecks,
    @Optional()
    @Inject(HEALTH_TIMEOUT_MS)
    private readonly timeoutMs = 3000
  ) {}
}
```

`ready()` 通过私有 `runCheck(name, operation)` 辅助函数调用五个检查，让每个操作与 `timeoutMs` 竞速，
记录 `durationMs`，并把任意拒绝/超时只转换为状态，绝不返回原始错误。核心组件名为 `database`、
`redis`、`minio` 和 `queues`；`libreOffice` 是唯一允许降级的组件。

`HealthModule` 导入 `FilesModule`，并注册 `image-queue`、`pdf-queue`、`font-queue` 和
`cleanup-queue`。用工厂提供 `HEALTH_CHECKS`，注入 `MinioService` 和四个 Queue token，并返回以下准确操作：

```typescript
{
  database: async () => {
    await db.execute(sql`SELECT 1`);
  },
  redis: async () => {
    const client = await imageQueue.client;
    await client.ping();
  },
  minio: async () => minioService.checkBucket(),
  queues: async () => {
    await Promise.all(queues.map(queue => queue.getJobCounts()));
  },
  libreOffice: checkLibreOffice,
}
```

在 providers 中注册 `HealthService` 和 `HEALTH_CHECKS` 工厂，二者均不导出。工厂的 `inject` 数组准确
使用 `MinioService`、`getQueueToken('image-queue')`、`getQueueToken('pdf-queue')`、
`getQueueToken('font-queue')` 和 `getQueueToken('cleanup-queue')`，使 `useFactory` 依次拿到 MinIO 服务与
四个已注册 Queue 实例。

- [ ] **步骤 4：实现端点与状态映射**

`HealthController`：

```typescript
@Public()
@Get('live')
live() {
  return this.healthService.live();
}

@Public()
@Get('ready')
async ready(@Res({ passthrough: true }) response: Response) {
  const result = await this.healthService.ready();
  response.status(result.httpStatus);
  const { httpStatus, ...body } = result;
  return body;
}

@Public()
@Get()
summary() {
  return this.healthService.live();
}
```

`live()` 返回 `status: 'ok'`、时间戳、`process.env.RELEASE ?? 'dev'`、
`process.env.BUILD_COMMIT ?? 'dev'`、`process.env.BUILD_TIME ?? null` 和稳定的 `startedAt`。
`ready()` 并行执行检查；PostgreSQL/Redis/MinIO/queues 失败映射为 `error`/503，只有 LibreOffice 缺失
映射为 `degraded`/200。绝不序列化原始错误消息。

- [ ] **步骤 5：验证、重新生成 OpenAPI 并提交**

运行：

```bash
bun test apps/api/src/modules/health/health.service.test.ts
bun --cwd apps/api run openapi:export
bun --cwd packages/api-client run generate
bun --cwd apps/api run build
```

预期：测试与构建通过；OpenAPI 包含 `/health/live` 和 `/health/ready`。

```bash
git add apps/api/src/modules/health apps/api/src/modules/files/minio.service.ts apps/api/openapi.json packages/api-client/src/schema.ts
git commit -m "feat: 添加依赖就绪和版本健康检查"
```

## 任务 11：增加本地发布验证与浏览器冒烟测试

**文件：**

- 新建：scripts/release-verify.ts
- 新建：playwright.config.ts
- 新建：apps/web/e2e/public-beta-smoke.spec.ts
- 修改：package.json
- 修改：apps/web/package.json

- [ ] **步骤 1：安装 Playwright 并编写冒烟测试套件**

运行：

```bash
bun add -d @playwright/test
bunx playwright install chromium
```

新建 `playwright.config.ts`：

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e',
  use: { baseURL: 'http://127.0.0.1:3100' },
  webServer: {
    command: 'bun --cwd apps/web run start -- -p 3100',
    url: 'http://127.0.0.1:3100/zh',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
```

新建 `public-beta-smoke.spec.ts`：

```typescript
import { expect, test } from '@playwright/test';

for (const path of [
  '/zh',
  '/zh/image/compress',
  '/zh/privacy',
  '/zh/terms',
  '/zh/beta',
]) {
  test(path + ' is publicly reachable', async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).not.toContainText('Page not found');
  });
}

test('protected workbench still redirects to login', async ({ page }) => {
  await page.goto('/zh/dashboard');
  await expect(page).toHaveURL(/\/zh\/login\?next=%2Fdashboard$/);
});

test('tool canonical points to the tool itself', async ({ page }) => {
  await page.goto('/zh/image/compress');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    /\/zh\/image\/compress$/
  );
});
```

- [ ] **步骤 2：针对已完成的公开路由构建并运行冒烟测试**

运行：

```bash
$env:NEXT_PUBLIC_SUPPORT_EMAIL='support@example.com'
bun --cwd apps/web run build
bunx playwright test
```

预期：任务 1-10 完成后，Web 构建以 0 退出，Playwright 准确报告 7 项测试通过：五个公开路由、一个
受保护路由重定向和一个 self-canonical 断言。

- [ ] **步骤 3：实现跨平台发布运行器**

`scripts/release-verify.ts` 使用继承 stdout/stderr 的 `Bun.spawn`，且必须：

1. 用脚本内小型纯函数复制 `assertProductionSupportEmail` 逻辑，验证 `NEXT_PUBLIC_SUPPORT_EMAIL`，避免
   导入 Next alias。
2. 以 500 ms 超时请求 `http://127.0.0.1:3000`；若开发服务器响应，则在构建前失败并输出
   “Stop the Web dev server before release verification”。
3. 按顺序运行命令，并在首次非零退出时停止：

```typescript
const commands = [
  ['bun', ['run', 'format:check']],
  ['bun', ['run', 'lint']],
  ['bun', ['run', 'test:packages']],
  ['bun', ['run', 'test:api']],
  ['bun', ['run', 'test:web']],
  ['bun', ['--cwd', 'apps/api', 'run', 'openapi:export']],
  ['bun', ['--cwd', 'packages/api-client', 'run', 'generate']],
  [
    'git',
    [
      'diff',
      '--exit-code',
      '--',
      'apps/api/openapi.json',
      'packages/api-client/src/schema.ts',
    ],
  ],
  ['bun', ['run', 'build']],
  ['bunx', ['playwright', 'test']],
] as const;
```

每个进程前打印带编号的命令标签，并保留失败退出码。

- [ ] **步骤 4：增加包脚本**

根 `package.json`：

```json
"release:verify": "bun scripts/release-verify.ts",
"test:e2e": "playwright test"
```

`apps/web/package.json` 的 `start` 脚本保持 `next start`，不需要单独的冒烟服务器脚本。

- [ ] **步骤 5：验证并提交**

完整命令前停止正在运行的 Web 开发服务器，然后运行：

```bash
$env:NEXT_PUBLIC_SUPPORT_EMAIL='support@example.com'
bun run release:verify
```

预期：全部步骤通过，Playwright 报告 7 项测试通过，OpenAPI 漂移验证后 `git diff` 保持为空。

```bash
git add package.json bun.lock scripts/release-verify.ts playwright.config.ts apps/web/e2e
git commit -m "chore: 添加本地发布验证和浏览器冒烟测试"
```

## 任务 12：同步环境与产品文档

**文件：**

- 修改：.env.example
- 修改：docker-compose.prod.yml (environment keys only; no port/network changes)
- 新建：apps/api/src/config/public-beta-docs.test.ts
- 修改：README.md
- 修改：PROJECT_SPECS.md
- 修改：CLAUDE.md
- 修改：docs/docker-offline-deployment.md

- [ ] **步骤 1：编写文档一致性测试**

新建 `apps/api/src/config/public-beta-docs.test.ts`：

```typescript
import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '../../../..');

it('documents beta support, retention, no telemetry, and retained HTTP risks', () => {
  const env = readFileSync(join(root, '.env.example'), 'utf8');
  const specs = readFileSync(join(root, 'PROJECT_SPECS.md'), 'utf8');
  const deployment = readFileSync(
    join(root, 'docs/docker-offline-deployment.md'),
    'utf8'
  );
  const productionCompose = readFileSync(
    join(root, 'docker-compose.prod.yml'),
    'utf8'
  );

  expect(env).toContain('NEXT_PUBLIC_SUPPORT_EMAIL=');
  expect(env).not.toContain('ERROR_TRACKER');
  expect(specs).toContain('匿名文件保留 24 小时');
  expect(specs).toContain('回收站文件保留 30 天');
  expect(specs).toContain('当前不启用遥测');
  expect(deployment).toContain('HTTP 受限公测');
  expect(deployment).toContain('匿名桶');
  expect(deployment).toContain('默认凭据');
  expect(productionCompose).toContain('RELEASE: ${RELEASE:-prod}');
  expect(productionCompose).toContain('BUILD_COMMIT: ${BUILD_COMMIT:-unknown}');
  expect(productionCompose).toContain('BUILD_TIME: ${BUILD_TIME:-}');
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：

```bash
bun test apps/api/src/config/public-beta-docs.test.ts
```

预期：失败，因为环境和产品文档仍描述 Error Tracker，且没有一致说明新的生命周期与保留风险。

- [ ] **步骤 3：更新环境与文档**

.env.example:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPPORT_EMAIL=support@example.com
RELEASE=dev
BUILD_COMMIT=dev
BUILD_TIME=
```

移除全部 Error Tracker 变量。保留现有 S3 默认值，因为修改它们明确不在本次范围内。
在 `docker-compose.prod.yml` 的 API `environment` 中只加入以下三项；不要改动任何 Compose 端口、
网络、默认凭据或 MinIO 匿名策略：

```yaml
RELEASE: ${RELEASE:-prod}
BUILD_COMMIT: ${BUILD_COMMIT:-unknown}
BUILD_TIME: ${BUILD_TIME:-}
```

`README`、`PROJECT_SPECS`、`CLAUDE` 和部署文档必须说明：

- 免费受限公测，以及“登录增强能力”术语。
- 不使用分析、错误追踪或会话回放。
- 匿名文件在 24 小时后永久删除。
- 回收站文件在 30 天后永久删除。
- ZIP 导出与立即注销账号行为。
- `/health/live` 和 `/health/ready` 行为。
- `NEXT_PUBLIC_SUPPORT_EMAIL` 要求。
- 组合镜像构建必须传入 `NEXT_PUBLIC_APP_URL` 和 `NEXT_PUBLIC_SUPPORT_EMAIL` 构建参数；支持邮箱由 Shell
  环境提供。
- `release:verify` 的前置条件和命令。
- 当前 IP + HTTP、默认凭据、匿名桶和公开任务状态风险仍然存在。
- 本次不增加匿名文件/任务访问令牌，也不改变 `/tasks/:id/status` 的现有访问方式。
- HTTPS、支付、Team 功能、存储/每日任务/并发配额和云端 CI 均不在本次发布范围内。
- 上述保留风险未改变前，不得把版本描述为安全的公网正式生产版本。

移除过时的外部 Error Tracker SDK build-context 说明。

- [ ] **步骤 4：验证全部文档与完整发布**

运行：

```bash
bun test apps/api/src/config/public-beta-docs.test.ts
git diff --check
$env:NEXT_PUBLIC_SUPPORT_EMAIL='support@example.com'
bun run release:verify
```

预期：文档测试、diff 检查和完整发布验证通过。

- [ ] **步骤 5：提交**

```bash
git add .env.example docker-compose.prod.yml README.md PROJECT_SPECS.md CLAUDE.md docs/docker-offline-deployment.md apps/api/src/config/public-beta-docs.test.ts
git commit -m "docs: 同步公开公测保留规则和发布说明"
```

## 最终验证清单

- [x] 运行 `git status --short`，确认只存在预期实施改动。
- [x] 将 `NEXT_PUBLIC_SUPPORT_EMAIL` 设为可联系的非本地邮箱，运行 `bun run release:verify`。
- [x] 启动 API，确认 `/health/live` 返回 200。
- [x] 在受控本地测试中暂时停止 PostgreSQL，确认 `/health/ready` 返回 503；重启 PostgreSQL 后确认
      readiness 返回 200，或只因 LibreOffice 返回 degraded。
- [x] 上传一份到达过期边界的匿名测试文件并运行一次清理任务，确认对象和数据库行都被删除。
- [x] 将一份账号文件移入回收站，把 `deletedAt` 设为 30 天前并运行清理，确认永久删除。
- [x] 导出测试账号，检查 `profile.json`、`tasks.json`、`files.json` 和文件内容。
- [x] 注销测试账号，确认对象、任务、文件、Session、Account 和 User 行全部消失。
- [x] 把 `/zh`、`/zh/privacy`、`/zh/terms`、`/zh/beta`、`/zh/settings` 和 `/zh/dashboard` 的桌面与
      移动端截图保存到 `artifacts/screenshots/`。
- [x] 确认最终文档仍明确：访问令牌加固、HTTPS、生产凭据、匿名桶策略、配额、支付和云端 CI 不在本次
      发布范围内。
