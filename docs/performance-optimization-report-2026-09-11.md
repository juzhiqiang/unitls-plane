# 性能优化报告（2026-09-11）

## 结论

本轮性能优化代码已完成，相关测试、构建、lint 和格式检查均已通过，可以合并回
`main`。这里的“完成”指本轮约定的代码与工程验证范围已经闭环；不等同于已经完成生产容量验收。真实 staging/生产环境仍需补充并发上传、任务轮询、Redis 跨实例失效和 RSS/P95 指标验证。

## 优化范围

### 1. 上传链路

- Multer 改为写入受控临时目录，避免请求阶段长期持有完整上传 `Buffer`。
- MinIO 上传改为 `Readable` 流，传递文件大小、MIME 和请求中止信号。
- 校验失败、对象存储失败、数据库失败、客户端断开等路径统一清理临时文件。
- 保留上传并发、文件数量、字段数量和字段大小限制，避免异常请求放大磁盘和内存使用。

### 2. 账号摘要缓存

- 增加 API 进程内 2 秒 LRU/in-flight 缓存，最多保留 1000 条并定期清理。
- 增加可选 Redis 共享缓存和失效广播，多实例部署可以共享摘要结果和失效事件。
- Redis 读取、写入、解析或发布失败时回退到本地缓存和数据库，不阻断核心业务。
- 文件、任务、账号删除等成功提交路径会主动失效；旧的异步请求不能覆盖更新后的缓存。

### 3. 任务轮询与列表查询

- 单任务状态查询复用批量状态接口。
- 任务组按最多 100 个 ID 分块请求，保持输入顺序，并按 `1/2/3/5`
  秒退避；完成、失败和后台状态停止无效轮询。
- 文件、回收站和任务列表已接入 cursor 分页和 `includeTotal=false`，跳过深层 offset 与不必要的
  `COUNT(*)`。
- 前端私有 React Query key 纳入 `userId`，账号切换不会复用旧账号数据；任务类别筛选交给服务端处理。

### 4. 数据库搜索

- 增加 `pg_trgm` 扩展和 `files_filename_trgm_idx` GIN 索引。
- 文件名搜索继续保持 `%term%` 包含匹配语义，迁移脚本使用幂等 SQL。

### 5. Web 构建与缓存

- Windows 本地构建使用普通 `.next` 输出，规避本机 standalone traced files 的 symlink 权限问题。
- Linux/Docker 发布继续使用 `standalone` 输出。
- 超过 2 MiB 的普通静态 JS chunk 不进入 PWA
  precache，工具页访问后通过运行时 CacheFirst 策略缓存，避免抬高全局预缓存上限。
- 修复生图页不稳定依赖和轮询 hook 回归问题，并补充对应配置与行为测试。

## 本地性能基准

基准脚本：`apps/api/src/scripts/benchmark-list-pagination.ts`。脚本只允许连接本机 PostgreSQL，使用 10 万行合成临时表，预热后每种查询采样 30 次；事务结束自动删除临时表，不读取或灌入业务数据。

| 查询         |      P50 |      P95 |
| ------------ | -------: | -------: |
| offset 90000 | 10.20 ms | 12.98 ms |
| cursor       |  0.78 ms |  1.85 ms |
| 单独 COUNT   | 10.23 ms | 11.38 ms |

两种分页查询均返回相同的 21 条 ID。`EXPLAIN`
显示 offset 查询扫描 90021 行，cursor 查询扫描 21 行。在这个合成场景中，cursor 的 P50 约为 offset 的 1/13，P95 约为 1/7；这是数据库本地客户端往返时间，不是 HTTP 延迟，也不是生产 SLA。真实多用户 UUID 数据、并发负载和网络开销仍需 staging 验证。

## 验证结果

以下结果均为 2026-09-11 在当前优化分支重新执行的结果：

| 检查项                                | 结果                        |
| ------------------------------------- | --------------------------- |
| `bun run test:packages`               | 99 pass，0 fail             |
| `bun run test:api`                    | 558 pass，2 skip，0 fail    |
| `bun run test:web`                    | 573 pass，0 fail            |
| `bun --cwd apps/api build`            | 通过                        |
| `bun --cwd packages/api-client build` | 通过                        |
| `bun --cwd apps/web build`            | 通过                        |
| `bun --cwd apps/api lint`             | 0 error，307 条既有 warning |
| `bun run format:check:changed`        | 67 个变更文件格式通过       |
| `git diff --check`                    | 通过                        |

Web 构建仍报告 webpack runtime circular
dependency，这是现有构建提示，不影响本次构建退出码。Windows 本地构建验证的是普通输出；发布验收仍必须在 Linux/Docker 环境检查 standalone 产物完整性。

## 尚未完成的生产验收

以下项目不是本轮代码合并的阻塞项，但不能用本地单元测试替代：

1. staging 环境 10/50/100 并发上传、断开连接、任务轮询压力和错误率测试。
2. 多 API 实例之间的 Redis 摘要失效广播、重连和 Redis 故障回退验证。
3. 真实上传大小与 worker 并发下的 RSS、heap、external memory、GC 暂停和 OOM 监控。
4. 接近生产数据量的 PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)`、搜索和 cursor P95。
5. Linux/Docker standalone 构建包、Service Worker 和离线预缓存清单验收。
6. 真实浏览器大 PDF、批量图片处理的 FPS 和内存曲线。
7. `pg_trgm` migration 尚未在生产数据库执行，发布时需要按数据库变更流程执行并观察索引创建影响。

## 交付判断

本轮约定的上传、缓存、轮询、分页、文件名搜索和 Web 构建优化均已实现并通过本地验证；因此可以合并回
`main`。后续应把上述 staging/生产指标纳入发布验收，而不是将本地结果表述为线上性能承诺。
