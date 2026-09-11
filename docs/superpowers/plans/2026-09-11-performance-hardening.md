# 性能与发布风险加固实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:**
在保持现有 API 和匿名任务兼容的前提下，降低上传内存峰值、实现多实例摘要缓存、收敛任务轮询与文件搜索成本，并修复 Web 构建发布告警。

**Architecture:**
上传请求由 Multer 写入受控临时目录，业务校验后通过 S3 流上传并在所有结果路径清理临时文件。账号摘要采用本地 LRU/in-flight 加 Redis 短 TTL 与失效频道；前端单任务轮询统一使用已有批量状态接口。文件名包含搜索使用 PostgreSQL
trigram GIN 索引，Next 在 Windows 使用普通输出、Linux/Docker 保留 standalone。

**Tech Stack:** NestJS 11、Express/Multer、AWS SDK S3、ioredis、Drizzle/PostgreSQL、React
Query、Next.js 14、next-pwa、Bun test。

---

### Task 1: 上传临时文件与流式对象存储

**Files:**

- Create: `apps/api/src/modules/files/upload-temp-file.ts`
- Modify: `apps/api/src/modules/files/files.controller.ts`
- Modify: `apps/api/src/modules/files/files.service.ts`
- Modify: `apps/api/src/modules/files/minio.service.ts`
- Modify: `apps/api/src/modules/files/files.module.ts`
- Modify: `apps/api/src/modules/files/upload-budget.interceptor.ts`
- Test: `apps/api/src/modules/files/files.controller.test.ts`
- Test: `apps/api/src/modules/files/files.service.test.ts`
- Test: `apps/api/src/modules/files/minio.service.test.ts`
- Test: `apps/api/src/modules/files/upload-budget.interceptor.test.ts`

- [x] **Step 1: 写临时文件生命周期失败测试**

  在 controller/service 测试中增加三条行为断言：上传控制器把 `path` 和 `size`
  传给 service；service 在对象上传成功、对象上传失败和数据库插入失败时都删除临时文件；Minio 流上传收到文件长度和 abort
  signal。使用 `mkdtemp` 与真实 `fs.writeFile`，只 mock 数据库、队列和 S3 客户端。

- [x] **Step 2: 运行上传相关测试确认失败**

  运行
  `bun --cwd apps/api test src/modules/files/files.controller.test.ts src/modules/files/files.service.test.ts src/modules/files/minio.service.test.ts`。

  预期：新增断言因控制器仍读取 `file.buffer`、Minio 没有流上传方法而失败。

- [x] **Step 3: 增加受控临时目录和 Multer 磁盘存储**

  新建 `upload-temp-file.ts`，导出
  `UPLOAD_TEMP_DIR`、`ensureUploadTempDir()`、`removeUploadTempFile()` 和
  `isUploadTempPath()`。目录取 `process.env.UPLOAD_TEMP_DIR` 或
  `os.tmpdir()/utils-plane-uploads`，创建模式限制为当前用户可读写；删除函数只允许删除该目录下的普通文件。控制器的
  `FileInterceptor` 使用 `diskStorage`，随机文件名由 `crypto.randomUUID()`
  生成，不使用原始文件名；`FileMetadata` 改为包含 `path`，保留 `buffer` 可选以兼容内部测试。
  `FileInterceptor` 通过 `createUploadTempStorage()`
  使用该受控目录，不直接使用默认的内存 storage 或未约束的 `diskStorage`。

- [x] **Step 4: 实现 S3 流上传和 service 清理**

  在 `MinioService` 增加 `uploadStream(key, source, size, mimeType, signal?)`，向 `PutObjectCommand`
  传入 `Body: source`、`ContentLength: size`、`ContentType`，用 `AbortSignal.timeout`
  与调用方 signal 合并。`FilesService.upload` 接受 `{ path, size }` 或 Buffer；路径输入通过
  `createReadStream` 上传，业务完成后在 `finally` 调用安全删除函数。控制器用 `try/finally`
  保证 service 抛错也清理临时文件，service 内部再做一次幂等清理以覆盖直接调用者。

- [x] **Step 5: 运行上传测试确认通过**

  重跑同一组 API 文件测试，并运行
  `bun --cwd apps/api test src/modules/files/upload-budget.interceptor.test.ts`。预期新增清理、流参数和旧 Buffer 兼容测试全部通过。

- [x] **Step 6: 检查临时目录和忽略规则**

  在 `.gitignore` 或现有日志/临时目录规则中加入 `utils-plane-uploads/`
  仅当该目录位于仓库内；默认系统临时目录不新增仓库规则。确认启动时目录创建失败返回可识别错误，且没有把临时文件名写入日志；启动时会回收超过保留期的孤儿临时文件。

### Task 2: Redis 共享账号摘要缓存

**Files:**

- Create: `apps/api/src/common/cache/account-summary-redis.ts`
- Modify: `apps/api/src/common/cache/account-summary-cache.service.ts`
- Modify: `apps/api/src/common/cache/account-summary-cache.module.ts`
- Modify: `apps/api/src/config/redis.config.ts` or existing Redis provider file
- Test: `apps/api/src/common/cache/account-summary-cache.service.test.ts`
- Test: `apps/api/src/common/cache/account-summary-cache.redis.test.ts`

- [x] **Step 1: 写 Redis 命中、回退和失效广播失败测试**

  使用注入的 Redis adapter interface，而不是在测试中连接真实 Redis。断言 Redis
  JSON 命中不调用数据库；Redis `get`/`set`/`publish`
  抛错时仍返回数据库结果；收到外部失效消息只删除本地条目；模块销毁会关闭 subscriber 和定时器。

- [x] **Step 2: 运行缓存测试确认失败**

  运行
  `bun --cwd apps/api test src/common/cache/account-summary-cache.service.test.ts src/common/cache/account-summary-cache.redis.test.ts`。

  预期：Redis adapter 文件和跨实例行为尚不存在，新增测试失败。

- [x] **Step 3: 定义可选 Redis adapter 和配置**

  新建小型 adapter，提供 `get(key)`, `set(key,value,ttlSeconds)`, `del(key)`,
  `publish(channel,message)`, `subscribe(channel,onMessage)`, `close()`。使用 `REDIS_URL`
  创建普通客户端和 subscriber；`ACCOUNT_SUMMARY_REDIS=false` 时返回 null
  adapter。不要复用 BullMQ/Throttler 的内部 client，避免关闭顺序互相影响。

- [x] **Step 4: 接入双层缓存**

  将 `AccountSummaryCache`
  改为注入 adapter。读取先查本地成功条目，再查 Redis；解析失败删除 Redis 键并回源；数据库成功后写 Redis 和本地。失效先删本地、删除 Redis 键并发布
  `utils-plane:account-summary:invalidate`
  消息；subscriber 回调只删本地。保留 2 秒 TTL、1000 条 LRU 和 5 秒清理。模块销毁时先停止新操作、等待进行中的 Redis 操作（最多 1 秒）再关闭连接。

- [x] **Step 5: 运行缓存与账户回归测试**

  运行
  `bun --cwd apps/api test src/common/cache src/modules/account/account.service.test.ts`，确认旧的本地缓存、in-flight、失效时序测试仍通过，新 Redis 测试通过。

### Task 3: 任务状态轮询与前端分块

**Files:**

- Modify: `apps/web/src/hooks/api/use-task-progress.ts`
- Modify: `apps/web/src/hooks/api/use-task-group-progress.ts`
- Test: `apps/web/src/hooks/api/__tests__/use-task-progress.test.ts`
- Test: `apps/web/src/hooks/api/__tests__/use-task-group-progress.test.ts` or existing hook test
  file
- Modify: `apps/api/src/modules/tasks/tasks.controller.test.ts` only if the lightweight contract
  needs an assertion

- [x] **Step 1: 写单任务批量端点和退避测试**

  mock `api.GET`，断言单任务请求调用 `/tasks/status` 并传递单个 ID，不再调用
  `/tasks/{id}/status`；断言 completed/failed 停止轮询，pending 的间隔按 1/2/3/5 秒推进。

- [x] **Step 2: 写超过 100 个 ID 的分块测试**

  为任务组 hook 传入 205 个 ID，断言每一轮生成 3 个请求，每个 query 字符串最多 100 个 UUID，响应合并后保持原输入顺序；任一块失败时 query 报错。

- [x] **Step 3: 运行 Web hook 测试确认失败**

  运行
  `bun --cwd apps/web test -- src/hooks/api/__tests__/use-task-progress.test.ts src/hooks/api/__tests__/use-task-group-progress.test.ts`，确认旧端点和单请求假设触发失败。

- [x] **Step 4: 实现统一轻量轮询**

  单任务 hook 调用批量接口并从数组中取对应 ID，使用 `dataUpdateCount` 计算
  `Math.min(interval * [1,2,3,5][index], 5000)`；任务组 hook 把 ID 按 100 分块并用 `Promise.all`
  请求，按输入 ID 映射结果，保持现有终态回调去重。

- [x] **Step 5: 运行 Web hook 与全量 Web 测试**

  先重跑新增 hook 测试，再运行 `bun run test:web`。

### Task 4: 文件名 trigram 索引

**Files:**

- Modify: `packages/db/src/schema/files.ts`
- Create: generated migration under `packages/db/drizzle/`
- Modify: `apps/api/src/scripts/verify-performance.ts` if it owns schema checks
- Test: `packages/db/src/file-search-schema.test.ts`
- Test: `apps/api/src/modules/files/files.service.test.ts`

- [x] **Step 1: 写 schema 断言**

  断言 files schema 导出文件名 trigram 索引定义；服务测试保留 `%term%`
  搜索语义，不把查询计划硬编码到单元测试。

- [x] **Step 2: 运行数据库测试确认失败**

  运行 `bun test packages/db/src/file-search-schema.test.ts`，预期索引断言失败。

- [x] **Step 3: 增加扩展和 GIN 索引定义**

  在 Drizzle schema 增加 filename GIN trigram 索引，并用迁移 SQL 执行
  `CREATE EXTENSION IF NOT EXISTS pg_trgm` 与
  `CREATE INDEX ... USING gin (filename gin_trgm_ops)`。迁移重复执行必须安全，索引名固定为
  `files_filename_trgm_idx`。

- [x] **Step 4: 生成并检查 migration**

  在 `packages/db` 执行
  `bunx drizzle-kit generate`，检查只包含扩展和 trigram 索引变更；不要执行生产数据库迁移。

- [x] **Step 5: 运行 packages/API 数据库相关测试**

  运行 `bun run test:packages` 和
  `bun --cwd apps/api test src/modules/files/files.service.test.ts`。

### Task 5: Web 构建告警与平台输出

**Files:**

- Modify: `apps/web/src/app/[locale]/(app)/image/generate/page.tsx`
- Modify: `apps/web/next.config.mjs`
- Modify: `apps/web/src/config/cache-headers.mjs` only if runtime caching needs an explicit static
  rule
- Test: `apps/web/src/app/[locale]/(app)/image/generate/__tests__/page.test.tsx`
- Test: `apps/web/src/config/__tests__/next-config.test.ts` (create if no existing config test)

- [x] **Step 1: 写构建配置和 Hook 静态测试**

  断言生图页的 `sessionTasks` 不作为每次 render 新建的依赖值；断言 Windows 平台输出不是
  `standalone`、非 Windows 仍为 `standalone`；断言 PWA 排除逻辑只排除超过 2
  MiB 的静态 chunk，不排除页面入口和 worker。

- [x] **Step 2: 运行 Web 测试确认失败**

  运行
  `bun --cwd apps/web test -- src/app/[locale]/(app)/image/generate/__tests__/page.test.tsx src/config/__tests__/next-config.test.ts`。

- [x] **Step 3: 修复 Hook 与 Next 输出配置**

  用 `useMemo(() => sessionTasksQuery.data?.tasks ?? [], [sessionTasksQuery.data?.tasks])`
  稳定数组；把 `output` 设置为 `process.platform === 'win32' ? undefined : 'standalone'`，让 Docker
  Linux 保持原行为。

- [x] **Step 4: 配置 PWA 大 chunk 排除和运行时缓存**

  在 `workboxOptions.buildExcludes` 中按 manifest entry 的 URL 和大小过滤大于 `2 * 1024 * 1024`
  的 JS chunk，并在 `runtimeCaching` 中为 `/_next/static/chunks/`
  增加 CacheFirst、7 天过期和 20 项上限。确保 `maximumFileSizeToCacheInBytes` 不被提高来掩盖大文件。

- [x] **Step 5: 运行 Web 测试和构建**

  运行 `bun run test:web`、`bun --cwd apps/web build`，检查 Hook
  warning 消失、Windows 构建不再出现 standalone symlink EPERM，并记录路由体积和 PWA 清单变化。

### Task 6: 集成验证、文档和交付

**Files:**

- Modify: `PROJECT_SPECS.md`
- Modify: `docs/performance-audit-2026-09-09.md`
- Modify: `.env.example` if new upload/cache switches are introduced
- Modify: `docs/build-verification.md`

- [x] **Step 1: 更新配置和风险边界文档**

  记录 `UPLOAD_TEMP_DIR`、`ACCOUNT_SUMMARY_REDIS` 等实际配置，说明 Windows 普通输出与 Linux
  standalone 的差异，明确 staging 压测仍是发布前必要步骤。

- [x] **Step 2: 运行完整验证**

  依次运行
  `bun run test:packages`、`bun run test:api`、`bun run test:web`、`bun --cwd apps/api build`、`bun --cwd packages/api-client build`、`bun --cwd apps/web build`、`bun run format:check`、`git diff --check`。

- [x] **Step 3: 核对 OpenAPI/client 和 migration 状态**

  本轮若未改变 HTTP schema，不重新生成 OpenAPI；确认 `packages/db/drizzle` 迁移与 schema 一致，检查
  `git status --short` 没有 `.env.local`、日志、截图或构建产物。

- [x] **Step 4: 创建中文提交**

  在验证成功且 Git 写权限恢复后，按模块创建中文提交，例如
  `perf(api): 降低上传与摘要缓存的扩展性风险`；不要推送远程分支。
