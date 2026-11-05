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

- [ ] 添加回归测试，先观察失败：规范化比较、并发、冲突、scope、额度、墓碑与过期。
- [ ] 实现事务内幂等记录、header 校验与回执查询，清理过期记录。
- [ ] generate/migrate；真实数据库隔离测试通过；API 测试与构建通过。
- [ ] 中文提交。

## Task 2: 安全提交与恢复记录

接口：Web 提交协调器管理稳定 key 与 transport 重试；任务记录只含 scope/key/fingerprint/id/type/time。修改 useCreateTask/useRetryTask/useUploadFile。

- [ ] 回归测试先失败：并发复用、网络重试、连续生图、刷新、不同用户与存储异常。
- [ ] 实现协调器与有界持久记录，接入共享 hooks。
- [ ] Web 定向测试与类型检查通过，中文提交。

## Task 3: 长任务等待与全局恢复区

接口：`waitForTask(taskId, {signal, timeoutMs, onProgress})`；应用布局加载任务恢复组件，使用回执与状态查询。

- [ ] 回归测试先失败：timeout/abort、瞬时断线、完成回调去重、刷新后查询/下载与失败重试。
- [ ] 实现有限轮询与真实状态展示，任务只在确认失败时作为失败；图片流程传递 signal 并复用已建任务。
- [ ] 同步中英文文案和架构文档，Web 定向测试通过，中文提交。

## Task 4: 全量验证与独立审查

- [ ] 全仓测试、构建/类型、lint、格式检查；确认 OpenAPI 与客户端同步。
- [ ] 独立代码审查；必要修复添加失败回归测试后验证。
- [ ] 记录结果并中文提交，保留当前分支供用户后续集成。
