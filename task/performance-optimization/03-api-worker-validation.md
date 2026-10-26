# C：API 与 Worker 拆分执行记录

对应 [实施计划](./03-api-worker.md)，更新日期：2026-10-27。

## 实现状态

- 工作分支：`codex/perf-api-worker`，起点：`a582ca1`。
- 主实现提交：`7ca896c`（拆分 API 与任务 Worker 进程）。
- 已实现角色拆分、Swagger 开关、无会话凭据认证快路径、API-only OpenAPI 导出、Compose
  readiness 门控与离线三进程监督。
- Worker 可通过 `WORKER_API_READY_URL`
  检查 API 状态，失去 readiness 后走 Nest/BullMQ 的标准关闭流程。
- 收尾核对发现 API Dockerfile 默认角色与兼容契约冲突，现已改为 `all`；Compose 和离线脚本仍显式指定
  `api`、`worker`。
- 没有修改 Files 实现、认证缓存策略、数据库 schema、队列名称、任务并发默认值或运行时依赖。

## 已执行验证

主实现阶段已执行：

- 根目录 lint、build 均通过；API lint 为 0 错误、327 条既有警告，Web 构建存在循环 chunk 警告。
- production 且 Swagger 关闭时 OpenAPI 导出成功，生成的 OpenAPI 与 API client schema 未变化。
- 实际启动 `api`、`worker`、默认 `all`：API 单独运行不消费任务，Worker 无 HTTP 监听，Worker 与 `all`
  均完成真实图片转换。
- Swagger 在生产默认关闭、显式开启和开发默认开启三种情况下分别返回 404、200、200。
- Compose 隔离环境完成 migration、模型同步、preset seed，并在 API
  healthy 后启动 Worker/Web；图片转换成功，停止 API 后 Worker 退出。
- 离线容器三进程启动、readiness、图片转换与停止通过；脚本故障夹具分别覆盖 API、Worker、Web 退出后的兄弟进程清理与退出码保留。
- Linux Node Worker 在 SIGTERM 后等待受控在途清理任务完成，没有触发 SIGKILL。

2026-10-27 兼容性修正验证：

- 先修改镜像默认角色断言，观察到预期失败（9 通过、1 失败）；修正 Dockerfile 后定向测试为 10 通过、0 失败。
- `bun run test`（`apps/api`）：758 通过、2 跳过、0 失败，共 69 个文件、760 个测试。跳过项为 Windows 下既有的外部符号链接测试。
- 修改测试文件的 Prettier 检查与 `git diff --check` 通过。

本地原始日志位于工作树
`log/`，不提交 Git。部署联调使用已有 Linux 镜像挂载当前编译产物和启动脚本，未重新构建发布镜像，因此不代表新镜像构建验收。

## 尚未完成的验收

- 未采集同条件 D0/改动后 API
  P50/P95、RSS、事件循环延迟、队列吞吐和失败率；不能声称达到 20% 改善或已证明没有性能劣化。
- 尚未完成五类队列的完整真实负载联调；图片任务和受控清理任务的成功不能替代 PDF、Font、AI 的完整验收。
- 尚未验证最长 PDF/AI 任务的退出耗时。Compose 当前宽限期为 60 秒，而 AI 请求超时示例为 180 秒；上线前需按实际最长任务调整并验证宽限期。
- 文档已说明 API/Worker 两个进程的数据库池上限合计为 40；目标部署的 PostgreSQL `max_connections`
  和 Redis 实际连接容量仍需结合副本数核验。
- 完整故障回滚演练与新发布镜像构建验收尚未完成；默认 `all` 的实际任务消费已验证。

分支保留供后续验收与集成，尚未合并或推送。以上未完成项不得在合并检查清单中标记为通过。
