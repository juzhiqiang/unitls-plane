# 更新日志

## 2026-09-14

### AI 生图

- 生图模型选择改为「模型为主」：参数面板的下拉直接显示真实模型名（如 gpt-image-2、KMage V2），来源/网关名不再展示给用户；对应端点由 `GET /tasks/image-generate/providers` 更名为 `GET /tasks/image-generate/models`，任务提交字段由 `inputConfig.providerId` 改为 `inputConfig.model`。
- `AI_IMAGE_PROVIDERS` 配置结构升级（不兼容旧格式，启动即报错并附升级指引）：每个来源声明 `models` 数组，同一模型可配在多个来源（网关）下。
- 同一模型多来源时自动容错路由：同一会话沿用上次实际使用的来源（出图效果稳定），新会话随机挑选（分摊网关压力）；可重试失败（超时、5xx、限流）自动切换下一个同模型来源，内容拒绝与确定性错误不换。
- 产物 EXIF 隐式标识补充实际出图来源（`source=`），并新增 `tasks.output_meta` 列记录实际来源与模型（需先执行数据库迁移，组合镜像内迁移先于应用启动）。
- 旧单来源变量 `AI_IMAGE_*` 回退与历史排队任务兼容：未升级配置的部署零改动；升级已配置 `AI_IMAGE_PROVIDERS` 的环境须把顶层 `model`/`capabilities`/`sizes` 挪进 `models[]` 后重建 api 容器。

## 2026-09-12

### 发布

- 发布
  `v0.8.0`：以 2026-09-11 性能优化与修复内容为主的速度与稳定性版本；根包、Web、API 与所有共享包统一升级到
  `0.8.0`，页面更新日志中英文 `PublicSite.changelog` 已新增对应用户侧条目。

## 2026-09-11

### 性能优化

- 上传正文改为受控临时目录落盘并流式写入 MinIO，覆盖校验失败、存储失败、事务失败和客户端中断后的临时文件清理。
- 账号摘要增加本地 LRU/in-flight 缓存和可选 Redis 共享缓存，支持跨实例失效广播，并在 Redis 不可用时自动回退。
- 文件、回收站和任务列表接入 cursor 分页；cursor 请求可跳过深层 offset 和总数统计，任务类别筛选改为服务端处理。
- 任务状态轮询复用批量接口，任务组按 100 个 ID 分块并采用退避策略，完成或失败后停止轮询。
- 文件名包含搜索增加 `pg_trgm` GIN 索引，同时保留原有 `%term%` 搜索语义。
- Web
  Windows 本地构建切换为普通输出，Linux/Docker 发布保留 standalone；大静态 chunk 改为访问后运行时缓存，不进入 PWA
  precache。

### 修复与稳定性

- 按账号隔离前端私有 React Query 缓存，避免切换账号后复用旧数据。
- 修复 cursor 翻页重复推进、旧 scope 回调串页、筛选条件未生效和删除后选择状态残留等页面行为。
- 补充上传临时文件生命周期、Redis 缓存、任务轮询、数据库索引和 Next 构建配置回归测试。
- 同步任务查询的 Zod、DTO、OpenAPI 和 typed client 契约。

### 验证

- packages：99 项通过。
- API：558 项通过、2 项跳过、0 项失败。
- Web：573 项通过。
- API、api-client、Web 生产构建通过；API lint 无 error，保留项目既有 warning。
- 本地 cursor 合成基准：P50 `0.78 ms`、P95 `1.85 ms`；offset 90000 为 P50 `10.20 ms`、P95
  `12.98 ms`。

### 发布注意

- 本地基准不代表生产 SLA；并发上传、RSS/P95、Redis 跨实例和 Linux/Docker
  standalone 仍需 staging/生产验收。
- `pg_trgm` migration 需要按发布流程在目标数据库执行，未在本地替代生产迁移。
