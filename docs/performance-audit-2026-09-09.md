# Utils-Plane 性能巡检报告（2026-09-09）

## 结论摘要

当前代码已经具备不少性能基础设施：React
Query 有默认缓存，图片转换/水印/拼接/动画支持 Worker，PDF 预览限制并发，文件列表使用服务端缩略图，BullMQ 按任务类型拆分队列，数据库连接池上限为 20。

仍有几处在数据量或并发上升后会明显放大的风险，建议按以下顺序处理：

1. **P0：公开任务状态接口可被无限调用。** `GET /tasks/:id/status` 标记为 `@Public()` 且
   `@SkipThrottle()`，每次仍会经过全局会话校验并查询数据库；前端默认每秒轮询。该组合容易成为低成本的数据库压力入口。
2. **P1：上传、下载和缩略图链路全部整块缓冲。** Multer 将上传文件放入内存，MinIO 下载返回完整
   `Buffer`，缩略图还会再次读取并解码原图；私有计划单文件上限为 250
   MB，多个并发任务时内存峰值不可控。
3. **P1：任务组轮询的请求数按任务数线性增长。** 一个 React Query 仍会在每个周期执行
   `Promise.all(taskIds.map(...))`，批量任务会产生 N 个状态请求；同时账号摘要在有活动任务时每 5 秒执行 6 个聚合/列表查询。
4. **P1：文件/任务列表索引与查询条件不完全匹配。** 当前主要索引以 `(user_id, created_at)`
   为主，回收站按 `deleted_at`
   排序会额外排序，任务按状态/类型筛选也只能先按用户扫描再过滤。数据量较大时分页越深越慢。
5. **P1：前端重页面和大 chunk。** 生产构建显示多个页面首屏 JS 超过 200 kB，`pdf/metadata` 达到 355
   kB；构建还报告一个约 3 MB 的客户端 chunk（未被 PWA 预缓存）以及 ONNX Runtime 的 critical
   dependency 警告。
6. **P2：浏览器端大文件处理仍有重复解码和大 DOM。**
   拼图会先解码一次获取尺寸、再解码一次进行渲染；PDF 预览按页创建 canvas，结果预览会把全部缩略图保存在内存中，超大 PDF/图片批处理时会增加主线程和内存压力。

以上是代码与本地构建结果驱动的风险判断，不等同于线上压测结论。当前数据库只有 141 个文件、85 个任务，无法代表生产规模。

## 检查范围与方法

- 阅读 `apps/web`、`apps/api`、`packages/db`、`packages/auth` 的运行时代码、配置和数据库 schema。
- 检查 React Query 轮询、文件上传/下载、PDF/图片处理、BullMQ 并发、缓存头和数据库索引。
- 执行 `bun --cwd apps/web build`，记录 Next.js 路由体积和构建警告。
- 执行 PostgreSQL `EXPLAIN (COSTS OFF)` 检查代表性文件/任务列表查询的索引使用情况。
- 执行 `bun --cwd apps/api build`；该命令在当前依赖安装状态下因 `ajv/dist/compile/codegen`
  缺失失败，详见“验证限制”。

## 详细发现

### 1. 公开状态轮询缺少有效的请求保护（P0）

证据：

- `apps/api/src/modules/tasks/tasks.controller.ts:203-205` 将状态接口标记为 `@Public()` 和
  `@SkipThrottle()`。
- `apps/api/src/common/guards/auth.guard.ts:23-47` 对 `@Public()` 接口仍先构造 headers、调用
  `verifySession()`，只有会话为空时才放行。
- `apps/api/src/modules/tasks/tasks.service.ts:131` 每次状态查询都会执行一次任务表查询。
- `apps/web/src/hooks/api/use-task-progress.ts:31-36` 的默认轮询间隔为 1000
  ms；任务组 hook 会对每个 taskId 发起独立请求（`use-task-group-progress.ts:42-46`）。

影响：未登录客户端也能绕过节流持续触发数据库查询；登录客户端每次轮询还可能触发 Better
Auth 的会话查询。任务 ID 可枚举或被批量提交时，数据库 QPS 会随攻击请求线性增加。

建议（待确认后实施）：

- 为状态查询增加短 TTL 的 Redis/进程级缓存，或改为带 task token 的受保护状态接口。
- 不要用全局 `@SkipThrottle()` 作为长期方案；至少按 IP、任务 token 和响应状态设置独立限流。
- 对公开接口显式跳过会话校验（使用项目已有的 skip-session 机制）前，先确认不会改变现有访问边界。
- 前端采用批量状态接口或服务端推送，降低 N 个请求/秒的放大效应。

### 2. 文件链路的整块 Buffer 会造成内存峰值（P1）

证据：

- `apps/api/src/modules/files/files.controller.ts:41-68` 的 `FileInterceptor` 只设置
  `fileSize`，未配置磁盘/流式存储；Multer 默认把上传内容保存在内存中的 `file.buffer`。
- `MAX_UPLOAD_TRANSPORT_SIZE` 取私有计划的 `upload.maxFileSize`，当前上限为 250
  MB（`packages/utils/src/entitlements.ts:69-76`）。
- `apps/api/src/modules/files/minio.service.ts:67-78` 读取 `GetObject` 的全部 body 后
  `Buffer.concat`。
- `apps/api/src/modules/files/files.service.ts:264-265`
  的缩略图路径先完整下载原图，再交给 Sharp 解码；控制器只通过 32 MB 阈值拒绝更大的缩略图源。
- 多个图片/PDF processor 也以 `Buffer` 读取输入并在内存中生成输出。

影响：一次 250 MB 上传至少会同时存在 HTTP/Multer Buffer、MinIO SDK
Buffer 和处理库中间对象；图片解码后的像素内存通常还会远大于文件大小。两个 image worker、两个 PDF
worker 并发时，峰值可能迅速超过容器内存，触发 GC 抖动或 OOM。

建议：

- 上传改为流式落盘或直接上传对象存储，API 只保留元数据；对需要处理的任务再按需流式读取。
- 下载/压缩/缩略图尽量使用 Node stream 和 Sharp pipeline，避免 `Buffer.concat`。
- 为每个队列增加按输入大小的并发/内存预算，而不是只按任务数设置 concurrency。
- 线上监控 RSS、heapUsed、外部内存、GC 暂停和 OOM 重启次数。

### 3. 轮询与账号摘要会放大数据库请求（P1）

证据：

- `apps/web/src/hooks/api/use-task-group-progress.ts:42-46` 每轮对所有任务执行
  `Promise.all`，请求数为任务数 N。
- `apps/web/src/hooks/api/use-account.ts:52-54` 活动任务存在时每 5 秒刷新账号摘要。
- `apps/api/src/modules/account/account.repository.ts` 的 `getSummary`
  同时执行活动任务数、失败任务数、文件数、文件大小求和及最近任务/文件 6 组查询。
- `apps/web/src/hooks/api/use-tasks.ts:57-64` 和 `use-tasks.ts:229-241`
  还分别对任务列表、会话任务列表进行周期刷新。

影响：批量生成或批量转换时，浏览器标签页数量 × 轮询频率 × 任务数会直接转化为 API/DB QPS；账号摘要的
`count`/`sum` 在大表上也会持续消耗连接池。React Query 的缓存只能合并相同 query
key，不能合并 N 个不同任务 ID 的 HTTP 请求。

建议：

- 增加 `GET /tasks/status?ids=...` 批量接口，或让服务端返回同一用户的活动任务快照。
- 轮询采用指数退避/动态间隔（例如前几秒 1 秒，随后 3/5 秒），并设置每个页面的最大轮询时长。
- 账号摘要拆分静态数据与活动计数；活动计数改为任务状态变更时写入的计数器或 Redis，而不是每次
  `count`。
- 对 `activeTaskCount=0` 的摘要保持较长 `staleTime`，避免页面切换后立即重复请求。

### 4. 数据库索引与分页策略在大数据量下会退化（P1）

当前 schema 主要索引：

- `files_user_created_idx(user_id, created_at)`、`files_expires_idx(expires_at)`。
- `tasks_user_created_idx(user_id, created_at)`、`tasks_status_idx(status)`、`tasks_session_idx(user_id, session_id)`。

代码证据：

- 文件列表和任务列表使用
  `limit + offset`（`apps/api/src/modules/files/files.service.ts:307-312`、`apps/api/src/modules/tasks/tasks.service.ts:340-355`）。
- 回收站按 `deleted_at DESC` 排序（`apps/api/src/modules/files/files.service.ts:421-423`），但没有以
  `(user_id, deleted_at)` 为前缀的索引。
- 任务按 `user_id + status/type` 筛选后再按 `created_at` 排序，现有索引无法覆盖全部条件。

本地 PostgreSQL `EXPLAIN`（当前数据量很小）观察到：

- 普通文件列表可以使用 `files_user_created_idx`，但 `deleted_at/purge_started_at` 作为过滤条件。
- 回收站查询使用 `files_user_created_idx` 后还要执行 `Sort Key: deleted_at DESC`。
- 任务状态/类型查询使用用户创建时间索引后再过滤 status/type。

建议：

- 根据线上真实过滤比例增加部分/复合索引，例如活动文件
  `(user_id, created_at DESC) WHERE deleted_at IS NULL AND purge_started_at IS NULL`、回收站
  `(user_id, deleted_at DESC) WHERE deleted_at IS NOT NULL AND purge_started_at IS NULL`，任务按常用 status/type 组合评估索引。
- 文件和任务列表逐步改为基于 `(created_at, id)` 的 keyset/cursor 分页，避免深页 offset 扫描。
- 用 `EXPLAIN (ANALYZE, BUFFERS)`
  在接近生产数据量的 staging 数据上验证索引，而不是仅凭索引名称判断。

### 5. 前端首屏包体和构建告警（P1）

`bun --cwd apps/web build` 输出的代表性结果：

| 路由                 | First Load JS |
| -------------------- | ------------: |
| `/image/compress`    |        259 kB |
| `/image/watermark`   |        261 kB |
| `/pdf/from-document` |        278 kB |
| `/pdf/to-text`       |        275 kB |
| `/pdf/metadata`      |        355 kB |
| `/image/animation`   |        214 kB |
| `/image/generate`    |        215 kB |
| 所有页面共享         |       90.1 kB |

构建还报告：

- ONNX Runtime bundle 出现
  `Critical dependency: require function is used in a way in which dependencies cannot be statically extracted`。
- 一个约 3 MB 的客户端 chunk 未被 PWA 预缓存。
- Webpack 报告两个 circular dependency with runtime。
- `image/generate/page.tsx` 有 React Hook 依赖警告。

当前已有 `three`、`pdfjs-dist`、ONNX Runtime、`pdf-lib`
等按需导入或页面级使用，但仍有进一步拆分空间。`pdf/metadata/page.tsx:5` 直接导入
`pdf-lib`，对应页面体积最高；PDF/字体/动画等重模块应确保不进入公共 layout 或无关工具页。

建议：

- 对 `pdf-lib`、`pdfjs-dist`、字体解析和 ONNX Runtime 做 bundle
  analyzer 分析，确认模块是否被共享 chunk 意外提升。
- 为重工具增加动态导入边界和可见区域触发加载；避免仅为首屏表单加载解析器。
- 处理 circular chunk 与 React Hook 警告后重新比较各路由 First Load JS。
- 为大于 2 MB 的 chunk 明确设置 PWA 缓存策略：首屏不预缓存，工具页访问后再缓存，并观察离线包体上限。

### 6. 浏览器端重复解码与大 PDF DOM（P2）

证据：

- `apps/web/src/lib/processing/image-stitch-client.ts:157` 对所有源图执行一次
  `Promise.all(sources.map(decodeImage))`；前面的尺寸探测流程还会再次解码同一批文件。
- `apps/web/src/components/tools/pdf-preview.tsx:78` 按 `pageCount` 创建全部 canvas。
- `apps/web/src/components/tools/pdf-result-preview.tsx:145`
  虽然缩略图渲染并发限制为 3，但最终仍把所有页缩略图放进状态并渲染到 DOM。

影响：几十张大图或数百页 PDF 时，解码、canvas 位图和 React 节点会同时驻留；Worker 只缓解绘制线程阻塞，不能消除内存占用。

建议：

- 尺寸探测结果与解码对象建立生命周期缓存，避免同一批文件重复 decode。
- 对 PDF 页缩略图使用窗口化/虚拟列表，只渲染可视区域附近页面；离开窗口的 canvas 主动释放。
- 对超大 PDF 增加页数、像素和总内存预算，并在 UI 中提前提示。

## 已有的正向措施

- React Query 默认
  `staleTime=30s`、`gcTime=5min`，且关闭窗口聚焦重复刷新（`apps/web/src/components/providers/query-client-options.ts`）。
- 图片 Worker 复用单例并在失败时回退主线程，避免 Worker 故障变成用户失败（`apps/web/src/lib/processing/image-worker-client.ts`）。
- 文件列表使用 320 px
  WebP 缩略图、懒加载和 24 小时私有缓存（`thumbnail.util.ts`、`file-thumbnail.tsx`）。
- PDF 预览和结果缩略图渲染均有限制并发，且在替换文档时销毁 PDF 对象。
- BullMQ 已按 CPU/远程 I/O 类型拆分队列；CPU 图像/PDF 队列并发为 2，AI 远程队列并发为 8。
- 账户导出使用游标分页和临时 spool，避免一次性把全部导出数据放入内存。

## 建议的实施顺序与验收指标

### 第一阶段：先降低可被放大的压力

1. 为状态接口增加限流/缓存/批量查询方案，并确认公开访问边界。
2. 在 staging 做 10/50/100 个并发上传与处理任务，记录 API
   RSS、Redis 队列延迟、PostgreSQL 连接池占用。
3. 给轮询和账号摘要加请求计数、P95 延迟和错误率指标。

### 第二阶段：优化存储与数据库

1. 用接近生产规模的数据跑 `EXPLAIN (ANALYZE, BUFFERS)`。
2. 评估复合/部分索引与 cursor 分页，比较 P95 查询时延和扫描行数。
3. 设计流式上传/下载迁移，设置单请求和单 worker 的内存预算。

### 第三阶段：前端包体与大文档体验

1. 运行 `ANALYZE=true bun --cwd apps/web build` 保存 bundle analyzer 报告。
2. 将重依赖拆到工具页/交互触发边界，目标是普通工具页 First Load JS < 200 kB，重工具页 < 250 kB。
3. 对 100/300 页 PDF 和 40 张大图做浏览器内存、长任务和滚动 FPS 验收。

建议持续观测的目标：

- 状态接口 P95 < 150 ms，单用户活动任务轮询 API QPS 可预测且不随任务数线性增长。
- 列表查询 `rows removed by filter` 明显低于返回行数的数量级，深页仍保持稳定延迟。
- API 容器 RSS 在最大合法上传 + 配置并发下保持在内存限制的 70% 以下。
- 普通落地页 LCP < 2.5 s；工具页首屏不加载未使用的解析器。

## 验证限制与复现记录

- `bun --cwd apps/web build`：退出码 0，完成 88 个静态页面生成；同时出现上述 chunk、ONNX
  Runtime、循环依赖和 Hook 警告。Windows standalone 输出阶段还出现 symlink `EPERM`
  警告，未改变路由体积输出。
- `bun --cwd apps/api build`：退出码 1，Nest CLI 启动阶段找不到
  `ajv/dist/compile/codegen`。这是当前依赖安装/解析环境问题，尚未据此判断 API 源码编译性能。
- 本地 PostgreSQL 当前仅有 141 个 files、85 个 tasks、1 个 user；`EXPLAIN`
  结果只用于确认查询形状和排序/过滤路径，不能作为生产基准。
- 本报告只新增文档，不修改业务代码、schema、配置或依赖。
