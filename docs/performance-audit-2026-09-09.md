# Utils-Plane 性能巡检报告（2026-09-09）

## 当前收尾状态（2026-09-10，第三批）

以下是当前状态；后面的初始审计、第一批、第二批及历史收尾记录保留当时事实，不代表仍然未修复，也不能替代本轮验收。

- 文件、回收站、任务页面已实际接入 cursor 和
  `includeTotal=false`，不再依赖 COUNT 和深层 offset，提供首页、上一页、下一页与当前页号。筛选或账号变化重置游标；删除、恢复、清空成功后回首页，翻页清理选择，错误展示重试。任务类别筛选保持既有的当前页客户端筛选，未扩展为服务端类别查询。
- 摘要缓存提取到独立 Nest 模块，成功结果 TTL
  2 秒，容量 1000 条（含 pending），LRU 淘汰、每 5 秒主动清理及生命周期释放。文件和任务成功提交后失效，包含 Worker 产物、进度、丢失任务失败、清理和批量部分成功路径；条目身份校验防止旧请求回填。
- 本轮测试：API **510** 项、Web **553** 项、packages **96**
  项通过。覆盖缓存过期/容量/合并/旧请求、文件提交后失效及批量部分成功、游标导航/筛选/账号重置、删除选择清理、恢复/清空回首页及错误重试。
- API 构建与 API/Web lint 退出码 0，API
  lint 保留 283 条警告，Web 保留既有 Hook 警告；OpenAPI 与 client 重新生成后无契约差异，client 构建通过。Web 构建退出码 0，但仍出现 Windows
  standalone traced files symlink `EPERM`，**不能认定 standalone 发布包完整可用**。循环 chunk、PWA 3
  MB chunk 不预缓存也仍存在。
- 本轮没有修改上传内存缓冲架构，没有完成真实大文件 RSS/GC、300 页浏览器 FPS 或生产并发验收。账号缓存仍是单进程；跨实例不共享失效，2 秒 TTL 不等于界面最多延迟 2 秒。
- 子代理工具返回 unsupported，独立审查未执行；已本地核对提交时机、模块依赖、缓存竞态及页面调用，不将自审冒充独立审查。

### 本地合成数据基准

复现：在 `apps/api` 执行
`bun src/scripts/benchmark-list-pagination.ts`。脚本仅允许 localhost/127.0.0.1，创建连接私有临时表，事务结束自动删除，不读取/灌入业务数据、不运行迁移。临时表 10 万行，单用户，128 字符 payload，时间/id 复合索引，跳过 9 万行后取 21 条，预热后每种查询 30 次采样。

| 查询         | P50      | P95      |
| ------------ | -------- | -------- |
| offset 90000 | 10.20 ms | 12.98 ms |
| cursor       | 0.78 ms  | 1.85 ms  |
| 单独 COUNT   | 10.23 ms | 11.38 ms |

两种分页查询已断言返回相同 21 条 ID；EXPLAIN 显示 offset 扫描 90021 行，cursor 扫描 21 行。耗时包含本地客户端往返，不是 HTTP 延迟。COUNT 单独测量，不将三个 P95 简单相加。合成数据使用 bigint
ID 与简化列，不代表真实多用户 UUID 业务表、并发负载或生产 SLA。

首次试跑因 postgres.js 按 timestamp 参数类型转换导致时间偏移、游标返回 0 行，数据已弃用；脚本改为保留微秒文本并显式
`text::timestamp`，加相同行断言后才记录上述结果。该修改只针对本次基准脚本。

## 历史收尾结果（2026-09-10，第一批补充）

以下为当时的实施记录；最新事实以顶部第三批状态为准。

- 按锁文件执行 `bun install --frozen-lockfile` 补齐本地缺失依赖，未修改 bun.lock。Nest
  API 构建现已通过，ajv 缺项不再阻塞。
- 拼图尺寸探测与绘制在同一 Worker 流程执行，主线程回退复用同一实现。64
  MiB 解码缓存内的图片仅解码一次；超预算图逐张探测和重解绘制。失败释放位图，预算不包括单图解码瞬时峰值和输出画布。
- PdfResultPreview 采用 3–6 列、5 行滚动窗口，最多挂载 15–30 个缩略图。离窗清零画布，缩略图并发最多 3；新文档销毁旧 PDF 并拒绝迟到结果。页码导航和缩略图选页继续可用。
- Multer 前新增每进程上传并发限制（默认 2），超限返回 503，成功/异常/取消归还容量；限制 multipart 文件数、字段数及字段大小。上传仍是内存缓冲。
- `.env.example` 新增 `UPLOAD_MAX_CONCURRENT`、`PERFORMANCE_MEMORY_LOG` 和四类
  `*_WORKER_CONCURRENCY`；范围 1–32，队列默认并发不变。可选日志记录 RSS/heap/external，无文件名/正文；不是集群级内存配额。
- 最新验证：API **490** 项、Web **541** 项测试通过；Web/API
  build 和 lint 均退出码 0，保留 1/271 条既有 lint 警告。300 页窗口、40 张超预算图片逐张释放、缓存错误清理和上传容量归还均有回归测试；OpenAPI/client 已重新生成。
- 构建结果：PDF 元数据页 180 kB、字体页 182
  kB。未做生产 RSS/GC/P95 压测及真实 300 页浏览器 FPS 验收。旧的未引用 PdfPreview 和拆分/重排工具页不属于本次结果窗口改造范围。
- 剩余：Windows standalone symlink
  EPERM、ONNX/循环 chunk/PWA 大 chunk 告警；旧页码 UI 和 COUNT 成本仍存在。
- Git 写入权限已恢复，本轮与上一轮已验证修改一并提交。

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

## 第一批实施结果（2026-09-10）

以上为初始审计记录；用户批准后已实施以下优化：

| 项目          | 实施结果                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| 任务组轮询    | 每轮 N 个请求改为 1 个批量请求；实际完成轮次驱动 1/2/3/5 秒退避，终态停止、后台暂停                   |
| 状态接口保护  | UUID 校验、100 个去重 ID 上限、每用户/IP 每接口 120 次/分钟；缺失项返回 not_found                     |
| 文件/任务列表 | 保留 page/limit 和 total，增加 nextCursor；时间与 UUID 稳定排序，保留微秒精度，游标绑定用户及筛选条件 |
| 数据库索引    | 活动文件/回收站部分索引，任务用户/时间/ID 及状态、类型复合索引；0018 迁移已在本地应用                 |
| 文件传输      | 普通下载以 pipeline 传输对象流，响应断开及源异常释放流；缩略图流输入、32 MiB 实际读取限制             |
| PDF 元数据页  | pdf-lib 交互加载，First Load JS 从审计时 355 kB 降为约 180 kB（约 49%）                               |
| 字体页        | opentype.js 交互加载，本轮拆分前 247 kB，拆分后 182 kB（约 26%）                                      |

### 验证证据

- 共享包 96 项、API 489 项、Web
  537 项测试通过；新增覆盖缺失任务、退避及重置、分页微秒精度、非法游标、源流异常、客户端断开、缩略图输入字节上限。
- 本地游标遍历 120 个活动文件、69 个用户任务，无重复/遗漏；回收站为 0 条，空列表路径通过。读取现有 MinIO 对象 661927 字节，与数据库 originalSize 一致。
- 自然查询计划：小表仍会选择顺序扫描加排序；回收站使用 files_trash_list_idx。仅在核对事务内关闭顺序扫描时，活动文件命中 files_active_list_idx，任务状态查询命中 tasks_user_status_created_idx（Bitmap
  Scan）。不将这些结果作为大数据量性能基准。
- Web 生产构建完成；API 生产源码 `tsc -p tsconfig.build.json --noEmit` 通过。Web/API
  lint 无错误，分别保留 1/271 条既有警告。
- 已重新导出 OpenAPI 并生成 typed
  client。复现本地迁移、EXPLAIN、分页遍历及对象流检查：在 apps/api 运行
  `bun src/scripts/verify-performance.ts`。脚本限定本地数据库，应用待执行迁移后做只读验证。
- 详细本地输出位于 `log/performance-*.log`（不提交）。

### 剩余限制

- `nest build` 仍因现有依赖安装缺少 `ajv/dist/compile/codegen`
  而失败；未改依赖锁文件。直接包含测试文件的全库 tsc 仍有既有测试类型错误，不能宣称全库类型检查通过。
- Web 仍有 ONNX Runtime 动态依赖、循环 chunk、约 3 MB chunk 不预缓存和 Windows standalone symlink
  EPERM 警告；ONNX critical dependency 文本告警已按模块和消息精确过滤。
- 游标 API 已就绪，现有页码 UI 未切换；默认仍计算 total，使用 `includeTotal=false`
  时跳过 COUNT。未做生产压测、P95/RSS 实测或大表基准。
- Sharp 不是恒定内存解码器；Multer 上传缓冲、并发内存预算/观测配置未在本批扩展，需结合真实部署容量另行配置。
- Git 暂存实际返回
  `.git/index.lock: Permission denied`；当前会话不允许提权，修改尚未提交。权限恢复后需创建中文 Git 提交。

## 第二批实施结果（2026-09-10）

在第一批列表、传输和前端资源优化的基础上，本批继续控制 `COUNT(*)`
和账号摘要的重复聚合，并处理已确认的构建告警。

| 项目            | 实施结果                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cursor 列表计数 | `/files`、`/files/trash`、`/tasks` 新增 `includeTotal`。缺省保持旧行为；cursor 请求默认可关闭总数查询，响应 `total` 为 `null`，避免大表上的 `COUNT(*)`。非法值统一返回 400。 |
| 账号摘要缓存    | API 进程内按用户缓存 2 秒；并发请求共享 in-flight Promise，查询失败不污染缓存。账号删除开始和完成时清理对应用户缓存。                                                        |
| 前端查询契约    | 文件和任务 hooks 增加 `cursor`、`includeTotal` 及 nullable `total` 类型；只有使用 cursor 时才默认关闭总数，页码调用保持兼容。                                                |
| ONNX 构建告警   | 仅在 webpack 配置中精确过滤 `onnxruntime-web` 的 critical dependency 文本，循环 chunk、PWA 大 chunk 和既有 Hook 告警继续保留。                                               |

### 第二批验证

- API 测试：501 项通过；packages 测试：96 项通过；Web 测试：545 项通过。
- API `nest build` 退出码 0，API lint 退出码 0（保留项目既有 warning）。
- Web `next build` 退出码 0；ONNX critical
  dependency 告警经精确过滤后不再输出（不是底层依赖修复）。Windows standalone
  trace 因本机 symlink 权限输出 `EPERM`，standalone 发布包完整性尚未验证。
- OpenAPI 与 `packages/api-client/src/schema.ts`
  已重新生成，三组列表接口的 query/nullable 响应保持一致。

### 剩余限制

- 现有页面仍以 page/limit 为主，cursor API 已提供但未强制迁移全部 UI。
- 账号摘要缓存是单进程内存缓存，多实例部署需要共享缓存或按实例接受短暂不一致。
- 未进行生产规模压测，`COUNT(*)`、RSS、P95 和深分页收益仍需 staging 数据验证。
