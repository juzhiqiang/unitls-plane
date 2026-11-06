# 长任务体验与提交幂等性实施计划

> 执行方式：在当前隔离工作区内使用 executing-plans 与测试驱动流程逐项实施，最后独立审查。

**目标：** 安全重试提交，保留长任务回执并允许刷新后继续查询和下载。

**架构：**
PostgreSQL 幂等回执与任务/outbox 同事务提交；Web 共享提交层管理稳定 key，应用布局展示按身份隔离的恢复区。

**技术栈：** TypeScript、NestJS、Drizzle、PostgreSQL、Next.js、React Query。

**设计：** `docs/superpowers/specs/2026-11-06-task-experience-design.md`

## 全局约束

- 兼容无幂等 header 的旧客户端；本地工具不引入上传。
- 幂等与浏览器恢复窗口 24 小时，中英文文案同步，不保存敏感输入。
- 测试位于各项目 test/；文档位于 docs/；中文提交。

## 审查重点

- 响应丢失后的重放必须绕过再次扣额度，且不能产生第二个 outbox。
- 相同参数的主动连续生图必须是不同任务。
- 账户切换与匿名身份不能串回执、缓存或下载结果。
- 删除任务后重放不得重建，过期记录必须有清理路径。
- 网络故障和下载失败不能伪装成服务端失败。

## Task 1: 服务端幂等与回执

接口：`TasksService.create(input, user?, submission?)`；`getSubmission(key, user?, clientId?)`。新增任务提交帮助模块与 DB
schema，修改 controller、cleanup processor、OpenAPI。

- [x] 添加回归测试，先观察失败：规范化比较、并发、冲突、scope、额度、墓碑与过期。
- [x] 实现事务内幂等记录、header 校验与回执查询，清理过期记录。
- [x] generate/migrate；真实数据库隔离测试通过；API 测试与构建通过。
- [x] 中文提交。

## Task 2: 安全提交与恢复记录

接口：Web 提交协调器管理稳定 key 与 transport 重试；任务记录只含 scope/key/fingerprint/id/type/time。修改 useCreateTask/useRetryTask/useUploadFile。

- [x] 回归测试先失败：并发复用、网络重试、连续生图、刷新、不同用户与存储异常。
- [x] 实现协调器与有界持久记录，接入共享 hooks。
- [x] Web 定向测试与类型检查通过，中文提交。

## Task 3: 长任务等待与全局恢复区

接口：`waitForTask(taskId, {signal, timeoutMs, onProgress})`；应用布局加载任务恢复组件，使用回执与状态查询。

- [x] 回归测试先失败：timeout/abort、瞬时断线、完成回调去重、刷新后查询/下载与失败重试。
- [x] 实现有限轮询与真实状态展示，任务只在确认失败时作为失败；图片流程传递 signal 并复用已建任务。
- [x] 同步中英文文案和架构文档，Web 定向测试通过，中文提交。

## Task 4: 全量验证与独立审查

- [x] 全仓测试、构建/类型、lint、格式检查；确认 OpenAPI 与客户端同步。
- [x] 独立代码审查；必要修复添加失败回归测试后验证。
- [x] 记录结果并中文提交，保留当前分支供用户后续集成。

## 执行与验证记录

- 服务端提交：`2bc5ec6`；前端恢复与安全重试：`ff38d3a`；独立审查修复见本计划最后一次提交。
- 新增真实 PostgreSQL 隔离集成验证先复现 8 次并发创建 8 个任务，再验证收敛为 1 个任务、1 条 outbox。覆盖规范化参数、冲突、匿名/账户隔离、额度重放、失败事务、注销、墓碑和过期清理。
- 使用 `bunx drizzle-kit generate` 生成 `0024_great_the_professor.sql`。通过独立数据库中的
  `bunx drizzle-kit migrate` 执行全迁移链并完成集成验证，测试结束删除独立库。
- 本机现有库执行 migrate 时遇到旧迁移冲突：`ai_try_on_reference_visibility`
  枚举已存在，迁移记录与结构不一致。未更改历史记录，也未宣称现有库已升级；新版本运行前需在目标环境完成迁移。
- 最终 packages 262、API 875、Web 824，共 1961 项通过；API 两项 Windows 符号链接用例沿用原有跳过。
- `bun run build`
  9 个任务通过，Web 生产构建包含 lint 与应用类型验证；全仓 lint 和增量格式检查通过。API
  lint 仍有既有 warning，Web 构建有既有 Browserslist/分块循环依赖 warning。
- 额外运行裸 `tsc --noEmit` 时，仓库原有 test/e2e 类型错误仍存在（如 messages 数组类型、Playwright
  reducedMotion 和 jsdom 声明）；新增 src 文件未报错。生产构建通过不等同于全 test/e2e 类型检查通过。
- OpenAPI 重新导出，typed client 同步生成。
- 手工浏览器检查 390×844、1440×1000：折叠/展开与处理中展示无横向溢出，截图保存在忽略目录
  `artifacts/screenshots/`。临时 3010 来源未被既有 API
  CORS 允许，真实断线提示已检查；处理中画面使用浏览器临时状态 fixture，仅作为布局核对，不作为端到端后端证据。

## 独立审查处理

四项 Important 均已添加回归并修复：

1. 页面卸载后禁止自动重试沿用过时账户，保留原账户未确认回执。
2. 后台找回请求不能将已确认回执降级，保证下一次主动同参数生成使用新 key。
3. 14 个产物工具页对接
   `retryDownload`，失败面板区分下载重试和新任务；未确认提交/停止等待引导查询原任务。证件照页面实际交互测试验证重试下载不会再次上传或创建任务。
4. 结果下载优先解析服务端 Content-Disposition，CORS 暴露该 header，保留中文名、Markdown/CAD/AVIF 等扩展名。

审查提到的共享失败面板英文恢复文案同步接入中英文 messages。上传协议的持久幂等、供应商执行协议、原有公开 UUID 状态接口和超出 24 小时/100 条的浏览器恢复仍按设计边界处理。

## 实施选择与限制

- 浏览器 SHA-256 显式依赖锁文件已有的
  `@noble/hashes@2.2.0`，UUID 使用 getRandomValues 回退，兼容现有 HTTP 部署；这是根据部署事实确定的实现选择。
- 停止等待或隐藏提示不取消服务端任务；刷新恢复回执和产物，不恢复未上传文件或工具表单。
- 本轮保留在 `codex/task-experience-idempotency`，未自动合并或推送，前轮文件删除生命周期成果保留。
