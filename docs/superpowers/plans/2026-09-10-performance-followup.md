# 摘要缓存与页面游标分页实施计划

> 执行方式：原计划使用 subagent-driven-development 分工与独立审查，但子代理工具实际返回 unsupported，改为本地实施与自审，独立审查未执行。使用 test-driven-development 增加回归。用户已确认设计并要求执行；本轮在当前目录的独立分支实施，不推送或更改部署环境。

## 执行记录

- 任务 1、2 的实现已落地。缓存新增测试最初因模块不存在而失败；写后失效、页面 cursor 请求和第一页删除选择清理均有断言失败后转绿记录，不将模块缺失失败冒充完整行为测试失败。
- API 510 / Web 553 / packages 96 项通过，API/Web
  lint 无错误；API、client 构建通过，Web 构建退出码 0 但 standalone
  EPERM 仍未解决。OpenAPI/client 重新生成无契约变化。
- 增加本地临时表基准脚本并验证 10 万行深页查询，详细数据与限制见性能审计顶部。大文件内存与浏览器性能验收未执行。
- 下面保留执行前清单，未执行的独立审查不得标记完成。

**目标：** 完成已批准的有界摘要缓存、写后失效与三个页面的游标分页。

**架构：**
独立 Nest 缓存模块共享按用户缓存；提交后的写路径负责失效。前端共享分页 hook 与控件，沿用现有 cursor
API。

**技术栈：** NestJS、Drizzle、Bun test、Next.js、React Query、Vitest。

## 任务 1：后端缓存与写后失效

- [ ] 新增
      `apps/api/src/common/cache/account-summary-cache.service.ts`、对应模块与测试；AccountService 委托缓存读取。
- [ ] 先测试 1000 条容量、2 秒 TTL、5 秒清理、同用户合并、失败重试、失效后旧 Promise 不回填与关闭定时器，运行 Bun
      test 确认失败，再实现。
- [ ] 修改 account/files/tasks 模块注入缓存；在 files.service.ts、tasks.service.ts、task-job-state.repository.ts 的成功提交后失效。核对处理器和清理路径；批量部分成功必须失效。
- [ ] 更新真实服务路径测试，确认事务完成之前不失效、提交之后失效；运行 API 全量测试与构建。
- [ ] 独立检查设计覆盖与代码质量，修复发现的问题。

## 任务 2：前端页面游标接入

- [ ] 新增 `apps/web/src/hooks/use-cursor-pagination.ts`
      及测试。状态包含 scope、cursor 历史与当前索引，初始 cursor 为空字符串，scope 改变立即重置。测试下一页、上一页、首页、末页和重复推进。
- [ ] 新增
      `apps/web/src/components/ui/CursorPagination.tsx`，提供首页、上一页、第 N 页、下一页，加载禁用，错误允许退回。同步中英文
      `Pagination` 文案。
- [ ] 修改
      `apps/web/src/app/[locale]/(app)/files/page.tsx`、`files/trash/page.tsx`、`tasks/page.tsx`，请求明确使用
      `cursor`、`includeTotal: false`，移除 totalPages；保持每页 12/12/20 条。
- [ ] 页面测试先验证请求与按钮行为失败，再实现；覆盖筛选重置、选择清理、删除/恢复/清空回首页、错误重试及任务轮询不重置页码。
- [ ] 运行 Web 测试与 lint/build，审查实际页面调用而不只检查 hook。

## 任务 3：验证与交付

- [ ] 运行 `bun run test:api`、`bun run test:web`、`bun run test:packages`；API/Web build 与 lint。
- [ ] 运行 `bun --cwd apps/api run openapi:export`，检查 API client 漂移；未改接口时生成结果应不变。
- [ ] 核对可用本地性能验证环境；只允许隔离的合成数据。若缺少可安全运行的基准环境，记录大表/大文件压测未执行，不冒充验收完成。
- [ ] 更新 `PROJECT_SPECS.md` 与性能审计顶部，明确已完成代码和剩余性能/发布验收，保留历史记录。
- [ ] 格式检查、`git diff --check`、独立审查后创建中文 Git 提交，保留工作分支，不推送。
