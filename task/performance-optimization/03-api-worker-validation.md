# C：API 与 Worker 拆分执行记录

对应 [实施计划](./03-api-worker.md)，更新日期：2026-10-27。

## 实现与验收范围

- 工作分支 `codex/perf-api-worker`，起点 `a582ca1`；主实现 `7ca896c`，默认 `all` 兼容性修正
  `37a11e5`。
- 已实现角色拆分、Swagger 开关、无会话凭据认证快路径、API-only OpenAPI 导出、Compose
  readiness 门控与离线三进程监督。本次补齐本地性能对照、五队列、长任务、回滚、连接容量和 API
  Dockerfile 新镜像验收。
- 未修改 Files 实现、认证缓存策略、数据库 schema、队列名称、任务并发默认值或运行时依赖。
- 分支未合并或推送，尚未创建 PR；未执行发布打包。以下结果只覆盖本地隔离环境。

## 同条件性能对照

正式证据为工作树下
`log/validation/runs/verified-40rps/benchmark.json`，同目录包含 manifest、冻结脚本、逐请求响应、原始进程采样与退出状态。早期闭环压测和未完成轮次不作为结论依据。

### 方法

- D0 使用 `a582ca1` 源码重新编译，挂载其 `dist`；改动后直接使用本次 API
  Dockerfile 新镜像内的编译产物。两侧使用同一镜像依赖、同一机器，按 D0、拆分、拆分、D0（ABBA）运行。
- Docker 29.8.2，可用 24 CPU、约 15.2 GiB。D0 限制 2 CPU / 2048 MiB；拆分后 API 0.5 CPU / 512
  MiB，Worker 1.5 CPU / 1536 MiB，总资源上限相同。
- 每轮空闲、高负载各 24 秒，每秒固定发出 40 个 `/health/ready`
  请求，每窗口实际 960 个请求，10 秒请求超时。延迟分位数只统计成功响应，错误单列。
- 高负载保持 2 Image、2 PDF、2 Font、8
  AI 生产循环，保留生产队列的 1000ms 初始延迟、重试、退避和保留参数。压测直接投递数据库/队列，避免 HTTP 限流与每日额度；功能验收另走实际登录、上传和任务 API。
- 负载为 2400×1800 PNG 转 WebP、18 页 PDF 以 150 DPI 转 PNG ZIP、Arial
  TTF 转 WOFF2、AI 图片生成。AI 使用本地 HTTP 提供者延迟 1200ms 后返回真实 PNG，经过生产 Processor、HTTP、图片解析与存储路径，未调用付费外部模型。
- 吞吐只统计窗口内完成任务，排空完成数另列；检查 BullMQ 终态与尝试次数。Redis
  MULTI 每 100ms 同时采集四队列 active 数；每 10ms 记录事件循环调度延迟原始样本，进程采样异步落盘。

### HTTP、内存与事件循环

| 场景             | 成功 P50 ms | 成功 P95 ms | HTTP 错误 / 960     | API RSS 采样 P95 MiB | Worker RSS 采样 P95 MiB | 循环延迟 P95 / 最大 ms |
| ---------------- | ----------: | ----------: | ------------------- | -------------------: | ----------------------: | ---------------------: |
| D0 第一次空闲    |        7.64 |       10.03 | 0                   |               203.64 |                       — |            3.97 / 8.01 |
| D0 第一次高负载  |     3277.05 |     6460.90 | 4 个 503            |               566.38 |                       — |       121.87 / 6072.46 |
| 拆分第一次空闲   |        8.06 |       12.12 | 0                   |               180.48 |                  166.46 |           4.67 / 90.34 |
| 拆分第一次高负载 |        8.03 |       12.46 | 0                   |               185.06 |                  509.42 |           4.53 / 91.00 |
| 拆分第二次空闲   |        7.85 |       14.05 | 0                   |               182.05 |                  167.63 |           4.44 / 83.40 |
| 拆分第二次高负载 |        7.78 |       11.57 | 0                   |               183.58 |                  517.18 |           4.43 / 89.92 |
| D0 第二次空闲    |        7.79 |       10.02 | 0                   |               203.31 |                       — |            4.36 / 7.28 |
| D0 第二次高负载  |     3191.01 |     6487.90 | 14 个 503、2 个超时 |               536.18 |                       — |       120.26 / 5991.53 |

该受限本地场景的高负载 P95 降低约 99.8%，达到 API 隔离目标。空闲 P95 从约 10ms 增至 12–14ms，不能宣称所有场景均改善。

拆分增加总进程内存。高负载两进程各自 RSS 采样 P95 之和约 694–701 MiB，对照单进程约 536–566
MiB；不能把独立分位数之和当成整体内存 P95。D0 的 RSS 采样最大缺口为 6365 / 6141ms，拆分为 1084 /
1001ms，分位数不代表准确的整窗口峰值。调度延迟也不是 CPU 使用率或完整事件循环利用率。

### 队列吞吐与失败

| 高负载窗口 | Image / 秒 | PDF / 秒 | Font / 秒 | AI / 秒 | 排空后完成总数 | 排队 P95 ms | 同时达到 2/2/2/8 的采样数 |
| ---------- | ---------: | -------: | --------: | ------: | -------------: | ----------: | ------------------------: |
| D0 第一次  |     0.1667 |   0.1667 |    0.1667 |  0.6667 |             42 |        4884 |                       102 |
| 拆分第一次 |     0.2500 |   0.1667 |    0.2500 |  0.9583 |             53 |        4166 |                       100 |
| 拆分第二次 |     0.2500 |   0.1667 |    0.2500 |  0.6667 |             46 |        4885 |                        87 |
| D0 第二次  |     0.1667 |   0.1667 |    0.1667 |  0.6667 |             42 |        3120 |                       123 |

四轮任务最终失败均为 0、重试均为 0。排队时间包含 1000ms 初始延迟及排空阶段完成的任务，不能当成纯调度开销。PDF 吞吐未提高，AI 有轮次波动；结论为 API 隔离有效。

## 五类队列实际处理

结果 `log/validation/five-queues.json`，日志
`final-functional.log`。API-only 启动后五队列均无消费者；启动 Worker 后每队列恰有 1 个消费者。

| 队列    | 实际处理与产物验证                                       | 含等待和校验耗时 |
| ------- | -------------------------------------------------------- | ---------------: |
| Image   | 登录上传 PNG、提交任务，下载并解码 2400×1800 WebP        |           1491ms |
| PDF     | 18 页 PDF 转 ZIP，解压并逐张解码全部 18 个 PNG，核对页名 |           3090ms |
| Font    | Arial TTF 转 WOFF2，反解压回 TTF 并解析出字形            |           5634ms |
| AI      | 任务 API、本地 HTTP 提供者、产物上传，下载并解码 PNG     |           2425ms |
| Cleanup | 创建实际 MinIO 孤儿对象，清理任务完成后确认对象返回 404  |                — |

四类业务任务均检查数据库与 BullMQ 最终完成、1 次尝试；Cleanup 最终完成。两个既有周期任务保持不重复注册。这里验证 AI 集成路径，不代表外部生成质量或供应商可用性。

## 长任务、停机与修正

- Compose API/Worker 的 `TASK_STOP_GRACE_PERIOD` 默认调整为
  `15m`；直接运行 API、Worker、离线容器的示例同步使用 `--init --stop-timeout 900`，Web 保持 60 秒。
- 早期 180 秒请求超时场景使用延迟 175 秒的实际 HTTP 请求，SIGTERM 后等待约 176.1 秒正常退出。
- 最终样本为 18 页 PDF 以 600
  DPI 渲染，同时调用延迟 595 秒的本地 AI 提供者，总请求超时设为单来源最大配置值 600 秒；断言两个指定任务均 active 后才发送 SIGTERM，核对终态、1 次尝试、无 OOM 和非 137 退出，并读取实际输出。
- 最终长样本通过：SIGTERM 后等待 **596012ms** 正常退出，退出码 **143**、无 OOM、无强杀。PDF 于提交后
  **16716ms**
  完成，AI 实际 HTTP 请求 595015ms、只调用 1 次，两个指定任务在发送信号时均 active、最终均完成。AI
  PNG 元数据与全部 18 页 600 DPI PNG 头及尺寸读取成功。正式结果为
  `log/validation/runs/streaming-595s-shutdown/long-shutdown.json`，日志
  `streaming-max-shutdown.log`；共享根目录结果会被后续样本覆盖。
- 首次 595 秒静默提供者样本在约 308 秒出现
  `fetch failed`，Worker 正常退出 143，任务留在延迟重试队列，不能计为成功。镜像 Node
  v22.23.4 内置 Undici 的 headers/body 空闲超时默认均为 300000ms，独立于应用的 AbortSignal 总超时。原日志未保留底层 cause，不能排除其他网络中断。失败日志、队列与退出状态保留为
  `failed-595s-*`。重跑提供者先返回响应头，再每 30 秒发送合法 JSON 空白，最后返回图片 JSON，以验证接近总超时的在途任务；该样本不证明静默上游可等待 600 秒。
- 高负载联调还发现 Redis 重连时遗留阻塞 `BZPOPMIN` 会使 BullMQ 标准 `close()`
  一直等待。现使用 ioredis 已有 `blockingTimeout: 30_000`
  处理离线阻塞命令，未自定义关闭流程或修改任务执行超时。真实 ioredis 命令测试已观察到修正前挂起、修正后正常返回；正式压测退出未使用调试器干预。

600 秒是单来源请求的应用配置上限；连接、响应头及响应体空闲超时可能提前结束请求。PDF 无统一最大执行时间，多来源顺序回退也可能耗时更长。上述为具体长任务样本，15 分钟不是任意任务的绝对保证，实际部署仍按最长工作流调整。

## 认证、容量与回滚

公开 `/tasks/:id/status`
每场景 24 次请求，有效会话来自实际登录。验证钩子统计函数调用，隔离 PostgreSQL `pg_stat_statements`
只统计会话查询，未统计全部业务 SQL。

| 凭据              | D0 verifySession / 会话 SQL | 拆分后 verifySession / 会话 SQL | D0 P95 ms | 拆分后 P95 ms |
| ----------------- | --------------------------: | ------------------------------: | --------: | ------------: |
| 无凭据            |                      24 / 0 |                           0 / 0 |      3.77 |          3.43 |
| 普通 theme cookie |                      24 / 0 |                           0 / 0 |      2.96 |          4.04 |
| 有效会话 cookie   |                     24 / 24 |                         24 / 24 |      7.84 |         12.76 |

快路径减少无凭据函数调用；D0 无凭据时本来也没有会话 SQL，不能宣称数据库查询减少。24 次小样本存在抖动，有效会话 P95 本次更慢，不作为认证性能提升依据。分片 cookie、Authorization、续期转发等由单元测试覆盖。进程启动到 readiness 的单次观测 D0
3520ms、API-only 4490ms，未包含 migration/模型同步/seed，不能当成冷启动优化结论。

- 容量：PostgreSQL
  `max_connections=100`、保留 3、实际连接 7；单 API + 单 Worker 应用池上限合计 40，验收客户端另 5，低于可用 97。Redis
  `maxclients=10000`，实际 41 个客户端，其中 5 个阻塞连接。只适用于本地 1 API + 1
  Worker，新增副本及其他应用须重算预算。
- 回滚：API-only 下图片任务保持等待，停止 API 后以镜像默认 `all`
  启动，原任务完成，恰有 1 个图片消费者；迁移记录 22 → 22，无数据库回滚，周期任务不重复。
- 故障：开启依赖检测的 Worker 在 API 丢失 readiness 后退出；API 未恢复时重启 Worker 退出 1、无消费者。结果见
  `rollback.json`、`final-rollback.log`、`capacity.json`、`auth.json`。

## 构建与自动验证

- 使用真实 `apps/api/Dockerfile` 完成新镜像构建，标签 `perf-api-worker:validation`，ID
  `sha256:23fa1635fb71ad6e13ccef708e75f348a9e6e429ef371e88869694b8baecd459`。正式对照和本次验收使用该镜像。
- API build 通过；API 全套测试
  **759 通过、2 跳过、0 失败**，70 文件、761 测试。跳过项为 Windows 已有的外部符号链接测试。并行重负载时曾有两项启动子进程的 4 秒看门狗超时，空闲复跑全套通过，未放宽超时。
- API lint 为 0 错误、327 条既有警告。production 且 Swagger 关闭时 OpenAPI 导出成功，OpenAPI 和 API
  client schema 无变化。导出提供满足 production 校验的本地虚拟 SMTP 配置，不发送邮件。
- 主实现阶段根目录 lint/build、Swagger 三种开关、Compose
  migration/模型同步/seed/readiness、离线三进程启动/停止和故障传播已验证。该部分使用既有组合镜像挂载产物；本次未新建组合/离线发布镜像，不能写为新组合镜像验收。
- `bun run format:check:changed`、脚本语法检查、`git diff --check`
  通过；Compose 配置解析确认 API/Worker 为 15 分钟、Web 为 1 分钟。日志均在忽略目录 `log/`。

## 复现步骤（Windows PowerShell）

在工作树根目录执行，需要项目依赖、Docker Desktop、Node、Bun、Git OpenSSL 和可读取的 Arial TTF。端口
`53101/53109/55439/62203/59009` 必须空闲。工具创建前缀 `perf-api-worker-acceptance-`
的独立容器和专用网络，不与另一轮验收并行运行。

```powershell
$env:VALIDATION_ARTIFACTS = Join-Path (Get-Location).Path 'log/validation'
New-Item -ItemType Directory -Path $env:VALIDATION_ARTIFACTS -Force | Out-Null
$env:VALIDATION_IMAGE = 'perf-api-worker:validation'
docker build -f apps/api/Dockerfile -t $env:VALIDATION_IMAGE .
bun --cwd apps/api run build

$baselineSource = Join-Path $env:VALIDATION_ARTIFACTS 'baseline-source'
$baselineArchive = Join-Path $env:VALIDATION_ARTIFACTS 'baseline-source.tar'
git archive --format=tar --output=$baselineArchive a582ca1 apps/api/src apps/api/tsconfig.json apps/api/tsconfig.build.json tsconfig.json
New-Item -ItemType Directory -Path $baselineSource | Out-Null
tar -xf $baselineArchive -C $baselineSource
New-Item -ItemType Junction -Path (Join-Path $baselineSource 'node_modules') -Target (Join-Path (Get-Location).Path 'node_modules') | Out-Null
New-Item -ItemType Junction -Path (Join-Path $baselineSource 'apps/api/node_modules') -Target (Join-Path (Get-Location).Path 'apps/api/node_modules') | Out-Null
Push-Location (Join-Path $baselineSource 'apps/api')
bun node_modules/@nestjs/cli/bin/nest.js build --path tsconfig.build.json
Pop-Location

node scripts/performance/api-worker-acceptance.cjs setup
node scripts/performance/api-worker-acceptance.cjs functional
$env:VALIDATION_RUN_ID = 'comparison'
$env:VALIDATION_WINDOW_MS = '24000'
$env:VALIDATION_HTTP_RPS = '40'
$env:VALIDATION_ORDER = 'baseline,split,split,baseline'
node scripts/performance/api-worker-acceptance.cjs benchmark
node scripts/performance/api-worker-acceptance.cjs rollback
node scripts/performance/api-worker-acceptance.cjs capacity
node scripts/performance/api-worker-acceptance.cjs auth
$env:VALIDATION_RUN_ID = 'streaming-595s-shutdown'
$env:VALIDATION_AI_DELAY_MS = '595000'
node scripts/performance/api-worker-acceptance.cjs shutdown
node scripts/performance/api-worker-acceptance.cjs cleanup
```

已有 `baseline-source` 时复用已核对的源码和目录联接，避免重复创建。基线使用 Nest
CLI 构建；直接用根 TypeScript 版本的 `tsc` 会导致配置不一致。脚本默认记录目录
`log/api-worker-acceptance`，本次显式覆盖为
`log/validation`；基准 manifest 保存镜像 ID、脚本/字体/入口哈希和运行参数，冻结脚本保留实际测量版本。后续功能断言修改不追溯改变正式证据。

`runtime.env`、`auth-secret`、`inputs.json` 含隔离验收凭据，不提交或对外分享。认证密钥由
`openssl rand -base64 32`
生成。cleanup 只移除本工具标签和前缀匹配的容器及专用网络，不操作项目既有服务。

## 仍需目标环境决定的事项

- 本地短窗口、固定资源与单一 readiness 路由不能代表生产 SLA、全部业务端点或长时间稳定性，应在目标机器结合真实任务、外部 AI 提供者和副本数再次观察。
- migration、模型同步、preset
  seed、Swagger 初始化及 OpenAPI 生成的独立阶段耗时/RSS 对照未单独测量，本报告不宣称完成这些扩展基线或证明启动性能提升。
- 静默 AI 上游可能先触发 HTTP 空闲超时；本批没有改变 AI 网络客户端。目标环境的数据库/Redis 容量、新组合镜像发布、PR 发布与集成仍需实际部署时核验。本文件可作为后续 PR 的验收附件。

## 独立复核收尾

只读复核确认 Redis 阻塞命令配置及真实 ioredis 回归测试合理。验收脚本已将 PDF、AI、容器停止三个并行 Promise 统一接收，并为长任务加入每轮 manifest、冻结脚本、成功/失败结果归档，防止早期拒绝遗漏或旧共享成功结果混用。

595 秒重跑的实际脚本在运行期间、后续错误处理与归档修正之前冻结，manifest 明确标注
`captureTiming`；修正后脚本的短请求停机样本也通过：PDF 提交后 17254ms 完成、SIGTERM 后等待 13786ms、退出 143，两任务均完成，结果独立保存在
`runs/harness-final-smoke/`。缺失镜像的受控失败另验证了 `failure.json`
归档、旧共享成功文件清除、先前长样本仍保留。正式 40RPS 对照无需重跑，其冻结脚本与原始结果保持不变。

已清理本次独占的验收容器、匿名数据卷与网络，项目既有依赖服务保留。日志与冻结证据保存在工作树
`log/validation/`，不提交 Git。
