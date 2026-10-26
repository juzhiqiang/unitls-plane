# 性能优化并行实施计划（2026-10）

> 本文是三人并行开发的总控文档。任务事实以当前代码为准，历史数据见
> [性能巡检报告（2026-09-09）](../../docs/performance-audit-2026-09-09.md) 和
> [性能优化报告（2026-09-11）](../../docs/performance-optimization-report-2026-09-11.md)。

## 一、目标与范围

本轮优化的核心原则是：**先降低会被并发和文件大小放大的成本，再处理首屏细节**。

| 优先级 | 维度              | 现状                                                 | 修改方向                                         | 预期收益                               | 风险 / 边界                                  | 负责人 |
| ------ | ----------------- | ---------------------------------------------------- | ------------------------------------------------ | -------------------------------------- | -------------------------------------------- | ------ |
| P0     | 文件 IO / 内存    | 250 MB 文件上传仍整文件进内存，下载返回完整 `Buffer` | Node multipart 上传、流式 `downloadToFile()`     | 内存峰值不再随文件大小线性翻倍         | Bun 保留 Buffer fallback；需真实大文件验收   | B      |
| P0     | 运行时隔离        | API 与 5 类任务 Processor 同进程，理论峰值约 15 并发 | 拆分 `api` / `worker` / `all` 进程角色           | 任务高负载不再抢占 API，支持独立扩缩容 | 部署顺序、数据库连接池和优雅退出必须同步处理 | C      |
| P0     | 缓存 / CPU        | 每次缩略图请求都下载原图并执行 Sharp                 | 持久化缩略图、304、进程内 single-flight          | 二次请求不再产生原图 IO 和 Sharp 解码  | 不新增队列和数据库列；访问控制不能放宽       | B      |
| P1     | PWA 安装流量      | 预缓存 225 项约 70.8 MB，其中 ONNX 约 61.68 MB       | 构建配置排除 `/onnx/**`                          | 首次安装体积大幅下降                   | 不能删除本机资产或手改 `sw.js`               | A      |
| P1     | 前端首包 / 执行   | 最重路由 247–279 kB First Load JS                    | Markdown、JSZip、图片压缩库按需加载              | 重点路由 JS 下降 15% 以上              | 不得引入 SSR/CLS 回归                        | A      |
| P2     | 认证快路径        | 公开接口无凭据也执行 `verifySession()`               | 无会话凭据时直接放行，有凭据仍完整校验           | 公开接口减少会话查询                   | 只处理完全无凭据；不能误伤可选用户接口       | C      |
| P2     | 空闲渲染          | Hero Three.js 滚出视口后 RAF 仍运行                  | `IntersectionObserver` + `visibilitychange` 暂停 | 降低首页离屏 CPU/GPU 开销              | 恢复时只能存在一个 RAF，卸载要释放资源       | A      |
| 不排期 | 数据库分页 / 索引 | 10 万行 offset p95 10.20 ms、cursor p95 1.85 ms      | 本轮不改                                         | 避免低收益高风险改动                   | 当前不是瓶颈，新增索引另立任务               | —      |

### 不在本轮范围

- 不新增数据库索引，不改分页策略。当前 10 万行基准中数据库不是瓶颈。
- 不重构 `heic-to`。该 chunk 已懒加载，且没有进入 PWA 预缓存。
- 不改文件大小额度、套餐、限流和计费规则。
- 不做语言包按页面拆分。该项风险较高，另立任务。
- 不改变任何用户可见的产品行为。

## 二、现状基线（2026-10-26 复测）

| 维度               | 实测/代码事实                                                                                                                    | 说明                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| PWA 预缓存         | `sw.js` 225 项，约 70.8 MB；ONNX WASM 61.68 MB                                                                                   | `apps/web/public/onnx/` 已被 `.gitignore` 忽略，属于本机/构建机资产；当前源码从 MinIO 加载 ORT 运行时 |
| 共享 First Load JS | 90.2 kB                                                                                                                          | 本地生产构建结果                                                                                      |
| 最重路由           | `/pdf/from-document` 279 kB、`/pdf/to-text` 275 kB、`/image/watermark` 268 kB、`/image/compress` 266 kB、`/image/convert` 247 kB | 本地生产构建结果，均为 First Load JS                                                                  |
| API 进程模型       | API 与 Image/PDF/Font/AI Image/Cleanup 处理器同进程                                                                              | `docker-compose.prod.yml` 的 API 容器直接执行 `node apps/api/dist/main.js`                            |
| Worker 并发默认值  | Image 2、PDF 2、Font 2、AI 8、Cleanup 1                                                                                          | 理论上限合计约 15，实际取决于队列和任务类型                                                           |
| 文件上限           | 最高套餐 250 MB                                                                                                                  | 见 `packages/utils/src/entitlements.ts`                                                               |
| MinIO 上传         | `uploadStream()` 在 Bun 下把整个流收进 `Buffer[]` 再 `Buffer.concat()`                                                           | 代码注释说明是 Bun SDK 流式 PUT 死锁的规避方案                                                        |
| MinIO 下载         | `download()` 返回完整 `Buffer`                                                                                                   | 大文件会整体驻留内存                                                                                  |
| 缩略图             | 每次请求重新下载原图并执行 Sharp，不持久化                                                                                       | Controller 设置 ETag，但未处理 `If-None-Match`                                                        |
| 公开接口认证       | `AuthGuard` 在判断 `@Public()` 前调用 `verifySession()`                                                                          | `verifySession()` 显式关闭 cookie cache                                                               |
| Swagger            | 生产环境也无条件初始化                                                                                                           | 只有 `openapi.json` 写入受 `NODE_ENV` 控制                                                            |
| Hero 动画          | 仅处理 `visibilitychange`，没有 `IntersectionObserver`                                                                           | 滚出视口后 RAF 仍继续                                                                                 |
| 数据库分页         | 10 万行：offset p95 10.20 ms、cursor p95 1.85 ms、COUNT p95 11.38 ms                                                             | 2026-09-11 本地合成数据基准，不是生产 SLA                                                             |

> 上述 PWA 和路由体积是本地构建结果。D0 必须在目标构建机重新采集一次，并记录命令、环境变量和日期，否则后续无法判断收益归属。

## 三、三人分工

| 角色              | 负责范围                                            | 分支                       | 任务文件                                     | 预估     |
| ----------------- | --------------------------------------------------- | -------------------------- | -------------------------------------------- | -------- |
| A：Web 首屏与 PWA | PWA 预缓存、路由按需加载、Three.js 可见性           | `codex/perf-web-pwa`       | [01-web-pwa.md](./01-web-pwa.md)             | 1.5–2 天 |
| B：文件与存储     | MinIO 流式上传、下载落盘、缩略图持久化与 304        | `codex/perf-files-storage` | [02-files-storage.md](./02-files-storage.md) | 3–4 天   |
| C：API 运行时     | API/Worker 拆进程、Swagger 开关、公开接口认证快路径 | `codex/perf-api-worker`    | [03-api-worker.md](./03-api-worker.md)       | 4–6 天   |

三人可以同时开工，代码写入集合基本不相交。编码前唯一的硬前置是
**D0 冻结接口**；部署时 API 必须先完成 migration、模型同步、preset
seed 并通过 readiness，Worker 才能启动；发布时再由一人统一升版本/写日志。

## 四、依赖与合并顺序

### 4.1 依赖关系

| 依赖                                                          | 类型       | 说明                                                    | 处理方式                                                                          |
| ------------------------------------------------------------- | ---------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| B 的 `MinioService.downloadToFile()` → C 的 Worker 大文件下载 | 软依赖     | C 可以先沿用现有 `download()`，B 合并后再切换           | D0 冻结签名，C 按接口编码                                                         |
| B 的 `.env.example` 改动 → C 的 `.env.example` 改动           | 文本冲突   | 两人都会新增环境变量                                    | 各加独立小节，C 最后合并并解决冲突                                                |
| C 的 `AuthGuard` 改动 → B 的缩略图可选用户                    | 行为耦合   | 缩略图/下载同时使用 `@Public()` 和可选 `@CurrentUser()` | 只允许“无会话凭据时跳过”，不得整路由跳过                                          |
| API migration/模型同步/preset seed/readiness → Worker 启动    | 部署硬依赖 | Worker 不执行 schema/seed，必须等 API 可服务后再消费    | Compose 用 `service_healthy`；`start-all.sh` 轮询 `/health/ready` 后再启动 Worker |
| A/B/C 全部合并 → 版本号与更新日志                             | 硬依赖     | 三批必须一起发布                                        | 由发布负责人统一处理                                                              |

### 4.2 合并顺序

推荐顺序：**A → B → C**。

- A 完全独立，风险最低，先合并可以先验证 PWA 和包体收益。
- B 为 C 提供 `downloadToFile()` 和稳定的 MinIO 行为。
- C 改动启动链路和部署方式，最后合并便于集中做集成验证。

如果 C 提前完成，也可以先合并。C 不直接依赖 B 的代码；B 合并后按 Processor 逐点评估，只把后续处理确实支持文件路径的调用从
`download()` 改为 `downloadToFile()`，Buffer 处理链继续保留。**不要为了等待而让任何人空转。**

### 4.3 每日节奏

| 时间     | 动作                                                       |
| -------- | ---------------------------------------------------------- |
| 每天开始 | `git fetch`，在各自分支 rebase 最新 `main`                 |
| 每天结束 | 跑本批测试，更新任务文件中的进度和实测数据                 |
| 合并前   | 由本人跑测试、构建、lint、格式检查，并在 PR 中贴结果       |
| 合并后   | 下一位 rebase 后再合并，避免把三个分支的格式化差异混在一起 |

### 4.4 并行冲突矩阵

| 组合      | 是否可并行     | 原因                                                  | 必须遵守的边界                                      |
| --------- | -------------- | ----------------------------------------------------- | --------------------------------------------------- |
| A × B     | 是             | 前端构建配置与 API 文件存储不相交                     | A 不改 API，B 不改 Web                              |
| A × C     | 是             | 前端组件与 API 启动链路不相交                         | A 不改 Swagger、Docker 和认证                       |
| B × C     | 是，局部软冲突 | `.env.example` 都会新增变量；C 会消费 B 的 MinIO 接口 | 各加独立小节；C 不修改 `files/**`；B 不新增队列任务 |
| A × B × C | 是             | 文件所有权已拆开                                      | D0 先冻结接口；合并顺序建议 A → B → C               |

结论：**可以三批同时开发，不需要互相等待。** 必须串行的只有 D0 接口冻结、部署时 API
readiness 先于 Worker、以及三批合并后的统一发布收口。

## 五、D0 接口契约（必须先冻结）

D0 不需要写实现，但必须把下面三组接口写进各任务文件，避免三人各写一套。

### 5.1 MinIO 接口

```ts
// apps/api/src/modules/files/minio.service.ts
uploadStream(
  key: string,
  source: Readable,
  size: number,
  mimeType: string,
  signal?: AbortSignal
): Promise<void>;

// B 新增，C 的 Worker 使用
downloadToFile(
  key: string,
  destPath: string,
  signal?: AbortSignal
): Promise<void>;

type MinioUploadMode = 'auto' | 'multipart' | 'buffer';
// 环境变量：MINIO_UPLOAD_MODE，默认 auto
```

约束：

- `uploadStream()` 的现有签名不变，调用方不需要改。
- `auto` 模式下，Node 使用 multipart，Bun 使用现有 Buffer 方案。
- `downloadToFile()` 失败时必须删除不完整的临时文件。

### 5.2 进程角色

```ts
type ProcessRole = 'all' | 'api' | 'worker';
// 环境变量：PROCESS_ROLE，默认 all
// 环境变量：SWAGGER_ENABLED=true|false
// 默认：production=false，其他环境=true
```

约束：

- `all` 保持当前行为：一个进程同时提供 HTTP 和处理任务。
- `api` 只提供 HTTP、Swagger、BullBoard，不注册处理器。
- `worker` 只创建应用上下文，不监听端口，不注册 HTTP 中间件和全局 Guard。

### 5.3 缩略图对象与缓存

| 项目     | 约定                                               |
| -------- | -------------------------------------------------- |
| 对象键   | `thumbnails/<fileId>/<THUMBNAIL_VERSION>-320.webp` |
| ETag     | `"thumb-<fileId>-320-<THUMBNAIL_VERSION>"`         |
| 条件请求 | `If-None-Match` 命中时返回 `304`，不生成缩略图     |
| 缓存头   | 沿用 `private, max-age=86400`                      |
| 版本号   | `THUMBNAIL_VERSION` 常量，Sharp 参数变化时递增     |

本批**不新增数据库列**。确定性对象键足以避免重复生成，也避免 migration 与其他任务冲突。

## 六、文件所有权

| 路径                                                               | 所有者     | 其他人类规则                                           |
| ------------------------------------------------------------------ | ---------- | ------------------------------------------------------ |
| `apps/web/next.config.mjs`                                         | A          | B/C 不改                                               |
| `apps/web/test/pwa/**`                                             | A          | B/C 不改                                               |
| `apps/web/src/components/tools/markdown-preview.tsx`               | A          | 只做动态加载改造                                       |
| `apps/web/src/components/tools/result-download-action.tsx`         | A          | 只转发 `ZipDownloadButton`，不直接导入 JSZip，本批不改 |
| `apps/web/src/components/tools/zip-download-button.tsx`            | A          | 只做 JSZip 动态加载                                    |
| `apps/web/src/lib/processing/image-client.ts`                      | A          | 拆出轻量策略函数                                       |
| `apps/web/src/components/effects/hero-workbench-scene.tsx`         | A          | 只加可见性控制                                         |
| `apps/api/src/modules/files/**`                                    | B          | C 只读，不改实现                                       |
| `apps/api/test/modules/files/**`                                   | B          | C 不改                                                 |
| `apps/api/package.json`、`bun.lock`                                | B          | 仅为 multipart 依赖修改，C 不新增依赖                  |
| `apps/api/src/main.ts`                                             | C          | A/B 不改                                               |
| `apps/api/src/app.module.ts`                                       | C          | A/B 不改                                               |
| `apps/api/src/modules/tasks/**`                                    | C          | B 不新增队列任务或 Processor                           |
| `apps/api/src/modules/health/**`                                   | C          | 只为 readiness/Worker 拆分调整                         |
| `apps/api/src/scripts/export-openapi.ts`                           | C          | 保持导出成功                                           |
| `apps/api/test/common/guards/**`、`apps/api/test/modules/tasks/**` | C          | B 不改                                                 |
| `apps/api/src/common/guards/auth.guard.ts`                         | C          | B 不改                                                 |
| `docker-compose.prod.yml`                                          | C          | A/B 不改                                               |
| `Dockerfile`、`docker/start-all.sh`                                | C          | A/B 不改                                               |
| `PROJECT_SPECS.md`                                                 | C          | 只在进程模型变化时更新                                 |
| `docs/docker-offline-deployment.md`                                | C          | 只在部署方式变化时更新                                 |
| `.env.example`                                                     | B + C      | 各加独立小节，C 最后合并                               |
| `CHANGELOG.md`、`apps/web/messages/*.json`                         | 发布负责人 | 任何开发人员都不改                                     |

> `apps/web/public/sw.js` 是构建产物，不在 Git 中，**任何人不允许手改**。PWA 改动只改
> `next.config.mjs` 和测试。

## 七、统一验收指标

| 指标                    | 基线                     | 目标                              | 测量方式                            |
| ----------------------- | ------------------------ | --------------------------------- | ----------------------------------- |
| PWA 预缓存 ONNX 条目    | 6 条，约 61.68 MB        | 0 条                              | 构建后检查 `sw.js`                  |
| 首次安装总预缓存        | 约 70.8 MB               | 不包含 `/onnx/**`                 | 构建后统计 precache 体积            |
| 共享 First Load JS      | 90.2 kB                  | 不增长                            | Next 构建输出                       |
| 重点路由 JS             | 279/275/268/266/247 kB   | 导入重库的路由下降 15% 以上       | 构建前后对比                        |
| API P95（任务高负载时） | 待 D0 采集               | 拆分后不劣化，目标下降 20%        | 压测脚本 + 日志                     |
| 250 MB 上传内存峰值     | 待 D0 采集               | 不随文件大小线性翻倍              | `PERFORMANCE_MEMORY_LOG` + 进程 RSS |
| 缩略图二次请求          | 每次执行 Sharp           | 0 次 Sharp，304 生效              | 单元测试 + 日志                     |
| 公开接口认证            | 每次都 `verifySession()` | 无凭据时 0 次                     | 单元测试 + mock 调用计数            |
| Swagger                 | production 也无条件开启  | production 默认关闭，显式开启可用 | `/docs` 200/404 测试                |
| 进程角色                | 只有 all                 | all 兼容；api/worker 可独立启动   | 启动冒烟 + 端口/队列消费检查        |
| Hero 离屏渲染           | RAF 持续运行             | 离屏 RAF 停止                     | 浏览器 Performance 面板             |

D0 采集结果必须写回本文件，作为合并时的对照。没有基线的优化不能宣称“提升”。

## 八、注意事项

### 8.1 通用

1. 每个人只改自己所有权内的文件。需要改别人的文件时，先在群里说明并由所有者修改。
2. 不要顺手格式化整个文件。提交前只对本次改动跑 Prettier，避免制造无意义 diff。
3. 每批必须能独立运行、独立回滚，不允许“必须三批一起才能启动”。
4. 本批不新增数据库列、不新增索引、不改 migration。
5. 不改变任何公开 API 的响应结构；如需新增字段，必须同时更新 OpenAPI 和 `packages/api-client`。
6. 新增测试放在对应子项的 `test/` 目录，并镜像 `src/` 结构。
7. 提交信息使用中文；每个可独立验证的改动单独提交。
8. 开发分支每天 rebase `main`；禁止把三个分支互相 merge 后再合并回主干。
9. 不把本机 `artifacts/`、`log/`、`.playwright-mcp/`、`public/onnx/` 提交进 Git。
10. 不在本批修改版本号和更新日志。版本号由发布负责人统一处理。

### 8.2 A：Web 与 PWA

1. `apps/web/public/onnx/` 是 `.gitignore` 忽略的本地资产，不要提交任何 `.wasm` 文件。
2. 不要通过删除本地目录来“修复”预缓存。必须在构建配置里按路径排除，保证换构建机也不会回归。
3. 动态 import 必须保持 SSR 安全。必要时使用 `next/dynamic` 的
   `ssr: false`，并保留占位高度避免 CLS。
4. Markdown 预览的动态加载不能破坏打印和高亮，改完要实际打开 `/pdf/from-document` 和
   `/pdf/to-text`。
5. `shouldProcessLocally()` 只是文件大小判断，应拆到轻量模块；不要让只做判断的页面拖入压缩库。
6. Three.js 暂停要同时处理 `IntersectionObserver` 和
   `visibilitychange`，恢复时只能存在一个 RAF 循环。
7. 组件卸载必须取消 RAF、断开 observer、释放 Three.js 资源，避免重复挂载后泄漏。
8. 不修改缓存头、CSP、Service Worker 的运行时缓存策略，除非任务文件明确要求。

### 8.3 B：文件与存储

1. 保留 Bun 的 Buffer fallback。Bun 下流式 PUT 会死锁，不能为了“统一实现”直接删掉。
2. Node 的 multipart 上传必须设置分块大小、并发队列和超时；失败时调用 abort，避免留下未完成的分片。
3. `downloadToFile()` 必须使用流式写入；任何异常、中止或长度不符都要删除半成品文件。
4. 缩略图采用确定性对象键，**不要新增队列任务**。`tasks.module.ts` 归 C 所有，避免冲突。
5. 缩略图生成要加进程内 single-flight，避免同一个文件被并发请求重复解码；多实例重复一次可以接受。
6. `If-None-Match` 必须在下载原图之前判断，否则 304 仍然会产生完整 IO 和 Sharp 开销。
7. ETag 必须包含 `THUMBNAIL_VERSION`。以后调整尺寸、质量或格式时必须递增，否则客户端会一直用旧图。
8. 缩略图访问控制必须与 `download` 完全一致，不能因为改成持久化而放宽匿名访问。
9. 软删除文件的缩略图清理不属于本批；但要在代码注释或任务文件中记录后续清理方案。
10. 单元测试不能证明内存收益。必须用真实 250 MB 文件跑一次并记录 RSS 曲线。

### 8.4 C：API 与 Worker

1. `PROCESS_ROLE` 默认必须是 `all`，保证旧部署不配置也能启动。
2. Worker 使用 `NestFactory.createApplicationContext()`，不要调用
   `listen()`，不要注册 CORS、全局过滤器、Swagger 和 BullBoard。
3. 处理器只放在 Worker 模块；API 模块只保留队列注册、服务和 Controller。禁止两个进程都注册同一批 Worker。
4. `CleanupScheduler` 只放在 Worker。现有 repeatable job 使用固定
   `jobId`，多个副本会去重，但仍应只让一个角色注册。
5. 优雅退出必须等待在途任务结束。Docker 的 `stop_grace_period`
   不小于 60 秒，关闭时先停止接收新任务。
6. migration、模型同步、preset seed 只在 API 服务启动时执行；Worker 不允许重复执行。
7. `docker-compose.prod.yml` 新增 Worker 服务时不要暴露端口，复用同一镜像，并配置 `depends_on`
   健康检查。
8. 离线单容器仍由 `docker/start-all.sh`
   启动。必须同时验证“compose 三服务”和“单容器 api+worker+web”两种模式。
9. Worker 没有 HTTP 服务，健康检查不能用 `/health`。使用进程存活、队列心跳或 BullMQ 指标。
10. 认证快路径只在**完全没有会话凭据**时跳过。缩略图、下载等 `@Public()`
    且使用可选用户的接口，带 cookie 时仍必须校验。
11. Swagger 关闭后，`bun run openapi:export` 必须仍能生成文档；导出脚本要显式启用 Swagger。
12. Worker 并发继续走 `*_WORKER_CONCURRENCY`，不要在本批改默认值；先保持现状，再按压测结果调整。
13. 更新 `PROJECT_SPECS.md` 的进程模型和部署事实，并同步离线部署文档。
14. 回滚方式必须写清楚：设置 `PROCESS_ROLE=all`
    并移除 Worker 服务即可恢复单进程模式，不涉及数据库回滚。

### 8.5 发布收口

1. 三批全部合并后，由**一个人**统一升版本，避免四人各改一次版本号。
2. 需要同时修改 8 个 `package.json`、`packages/utils/src/release.ts` 和对应测试。
3. 只把用户可感知的改动写入 `CHANGELOG.md` 和
   `apps/web/messages/{zh,en}.json`；纯构建、端口、测试、Worker 拆分本身不写入。
4. 若本批只有性能修复和体验改进，按 patch 处理；若同时引入新能力，按 minor 处理。
5. 打包前停掉占用 3000 端口的 Web dev server，设置 `NEXT_PUBLIC_SUPPORT_EMAIL`，执行
   `bun run release:verify`。
6. 发布后记录真实环境的首装体积、路由 JS、API P95、上传 RSS 和缩略图命中率。

## 九、排期

| 时间 | A                       | B                                 | C                                      | 里程碑                                     |
| ---- | ----------------------- | --------------------------------- | -------------------------------------- | ------------------------------------------ |
| D0   | 采集前端基线            | 采集上传/缩略图基线               | 采集 API P95/RSS 基线                  | 三份基线 + 接口冻结                        |
| D1–2 | PWA、按需加载、Three.js | MinIO multipart、`downloadToFile` | Worker 骨架、模块拆分                  | A 可合并，B/C 主体推进                     |
| D3–4 | 回归、构建对比          | 缩略图持久化、304、single-flight  | Compose、离线启动、Swagger、认证快路径 | B 可合并                                   |
| D5–6 | 配合回归                | 250 MB 实测                       | 集成 B 的接口、压测、优雅退出          | C 可合并                                   |
| D7   | —                       | —                                 | —                                      | 三批集成验证                               |
| D8   | —                       | —                                 | —                                      | 统一升版本、写日志、`release:verify`、打包 |

## 十、合并检查清单

每个 PR 合并前必须逐项确认：

- [ ] 只修改了文件所有权表内的文件。
- [ ] 新增/修改测试通过，且没有跳过或删除既有断言。
- [ ] `bun run format:check:changed` 通过。
- [ ] 对应子项构建和 lint 通过。
- [ ] 没有提交 `.env.local`、日志、截图、模型文件、`sw.js` 构建产物。
- [ ] PR 描述包含改动前后的实测数据。
- [ ] 回滚方式已写明。
- [ ] 文档已同步（涉及架构或部署时）。
- [ ] 提交信息为中文，且每个提交可独立说明。

## 十一、子任务

- [A：Web 首屏与 PWA 优化](./01-web-pwa.md)
- [B：文件与存储优化](./02-files-storage.md)
- [C：API 与 Worker 拆分](./03-api-worker.md)
