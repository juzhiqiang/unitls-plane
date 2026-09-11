# 性能与发布风险加固设计

## 背景

当前性能优化已经完成 cursor 列表、账号查询缓存、任务状态批量接口、图片解码缓存和 PDF 缩略图窗口化，但审计仍发现四类风险：上传正文在 Multer 中整块驻留内存、多实例账号摘要缓存不共享、部分轮询和搜索路径仍可放大请求或扫描，以及 Windows
standalone 构建和 Web 大依赖存在发布噪声。此次设计在保持现有 API 兼容和匿名任务流程的前提下，收敛这些风险。

## 目标

1. 上传正文落到受控临时文件，并以可中止的流上传对象存储，避免合法大文件同时占用多个大 `Buffer`。
2. 账号摘要在多 API 实例间共享短 TTL 结果，并在写入后广播失效；Redis 不可用时保留进程内缓存的降级能力。
3. 单任务轮询复用批量轻量状态接口并采用退避；任务状态接口继续保留匿名兼容和现有限流。
4. 为文件名包含搜索增加 PostgreSQL trigram 索引，保持现有包含匹配语义。
5. 修复 Web
   Hook 依赖告警、明确大 chunk 的 PWA 缓存策略，并让 Windows 本地构建不再尝试生成依赖 symlink 的 standalone 目录；Linux/Docker 构建继续生成 standalone。
6. 为新增行为提供回归测试、迁移验证和构建验收记录。

## 非目标

- 本次不改动任务状态接口的公开访问协议，不引入新的客户端任务 token。
- 本次不把所有上传改造成预签名直传；临时文件流式方案保持现有 `/files/upload` 和响应格式。
- 本次不改变任务、文件列表的排序、cursor 格式或 page/limit 兼容行为。
- 本次不把 PWA 预缓存上限盲目提高；超过首屏缓存预算的工具 chunk 只在访问工具页后按运行时策略缓存。
- 真实生产并发、RSS、GC、浏览器 FPS 仍需要在 staging/发布环境执行，本地单元测试不能替代这些验收。

## 设计

### 1. 上传临时文件与流式对象存储

`FileInterceptor`
使用项目临时根目录下的磁盘存储。临时目录由文件模块负责初始化，文件名使用随机值，不采用客户端文件名；Multer 解析完成后，控制器把临时路径、大小和 MIME 元数据传给
`FilesService`。服务先完成额度、类型和大小校验，再调用 `MinioService.uploadStream`，由
`createReadStream` 将正文传给 S3 `PutObjectCommand`，同时传递 `ContentLength` 和 abort signal。

临时文件必须覆盖以下生命周期：上传成功并完成文件记录事务后删除；校验失败、对象上传失败、数据库失败、客户端断开和异常退出路径均在
`finally` 中删除。现有 cleanup
obligation 仍负责对象存储补偿，不把临时文件清理责任混入数据库事务。为兼容单元测试和内部调用，`FilesService.upload`
暂时接受 `Buffer` 与临时文件描述两种输入，但控制器生产路径只传临时文件。

### 2. Redis 共享账号摘要缓存

`AccountSummaryCache`
保留本地 Map 作为快速命中和同实例 in-flight 合并层；Redis 作为跨实例共享层，键包含版本前缀和用户 ID，值使用 JSON 序列化，TTL 保持 2 秒。读取顺序为本地成功值、Redis 值、数据库；数据库成功后同时回填 Redis 和本地缓存。

每个实例使用独立 Redis subscriber 监听失效频道。`invalidate(userId)`
先清理本地条目，再发布用户失效事件；收到其他实例事件时只清理本地条目，避免回环发布。Redis 连接或序列化失败只记录受控 warning 并回退本地缓存/数据库，不影响账号接口可用性。模块销毁时释放定时器、普通连接和 subscriber 连接。

### 3. 任务状态轮询

`useTaskProgress` 改用现有 `GET /tasks/status?ids=`，保持返回给调用方的 `TaskStatusDto`
形状不变。轮询间隔采用 1、2、3、5 秒上限 5 秒，终态停止，后台标签页继续暂停。`useTaskGroupProgress`
对超过 100 个任务分块请求，避免超过 API 合约；同一轮请求使用
`Promise.all`，任一块失败时整体进入 React Query 错误状态。

服务端继续限制每个 IP/用户的请求数。状态查询只选择轻量字段；不为本次改动加入任务状态缓存，避免进度延迟和 Redis 热点。

### 4. 文件名搜索索引

启用 PostgreSQL `pg_trgm` 扩展，为 `files.filename` 增加 GIN trigram 索引。现有
`user_id`、软删除和排序条件保持不变，查询仍使用 `%keyword%`
包含匹配。迁移必须可重复执行，并在验证脚本中确认扩展和索引存在。低基数/短关键词的查询计划不强制断言使用 GIN，以免 PostgreSQL 版本和统计信息导致脆弱测试。

### 5. Web 构建与依赖边界

生图页面把 `sessionTasks`
包装为稳定的 memo 输入，消除 Hook 依赖警告。PWA 配置增加明确的构建排除函数：超过首屏预算的静态 chunk 不进入 precache，但保留普通浏览器 HTTP 缓存和工具页访问后的运行时缓存。不要通过提高全局 precache 上限掩盖大 chunk。

Next 配置根据构建平台选择输出：Windows 本地构建使用普通 `.next` 输出，Linux/Docker 继续使用
`standalone`。构建日志和发布验证文档明确该差异，避免把 Windows
symlink 权限错误带入发布包判断。重依赖拆分以现有动态 import 边界为基础，只调整能由构建输出或测试证明的页面，不做无依据的全局重构。

## 错误与降级

- 临时目录不可写：上传在进入业务事务前返回明确服务错误，不留下数据库或对象记录。
- 流上传中断：销毁读取流、删除临时文件、保留现有对象补偿记录，并返回原始上传错误。
- Redis 不可用：账号摘要继续走本地缓存和数据库；健康检查/日志暴露 Redis 异常，但不把可选缓存故障升级为业务故障。
- Redis 返回损坏数据：丢弃该键并重新读取数据库，不把解析异常传播给用户。
- 超过 100 个任务状态 ID：前端分块，后端仍拒绝直接超限请求。
- Windows 构建不生成 standalone：发布脚本必须在 Linux/Docker 环境执行 standalone 验收。

## 测试与验收

- API：临时文件成功/失败/断开清理、流上传
  `ContentLength`/abort、Redis 命中/回退/跨实例失效、任务状态单任务退避和批量分块、搜索迁移检查。
- Web：Hook 依赖回归、单任务状态接口改为批量接口、100+ 任务分块、PWA 配置和 Windows 输出模式静态检查。
- 数据库：迁移生成并执行，验证 `pg_trgm` 扩展和文件名索引存在。
- 构建：API、api-client、Web build；Web 记录各路由 First Load JS、循环 chunk 和 precache 清单变化。
- 交付前：运行 packages/API/Web 全量测试、lint、format
  check、`git diff --check`；staging 另执行并发上传和任务轮询压测，记录 RSS、P95、Redis 和 PostgreSQL 指标。

## 回滚

- 上传可通过环境开关回退到内存存储，仅用于短期故障排查；临时目录清理和流接口保留向后兼容。
- Redis 共享缓存通过环境开关关闭，自动回到进程内缓存。
- 数据库索引和扩展迁移只增加对象，不修改业务数据；必要时可单独删除 trigram 索引。
- Web standalone 输出由构建平台决定，不改变 Linux/Docker 产物格式。
