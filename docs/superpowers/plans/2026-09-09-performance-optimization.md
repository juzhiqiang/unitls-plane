# 性能优化实施计划

## 执行记录（2026-09-10）

> 后续收尾：依赖按锁文件补装后 API
> build 已通过；增加上传并发/可选内存日志及 Worker 并发配置，完成拼图有界缓存和 PDF 结果缩略图窗口化。最新测试 API
> 490 / Web 541 全通过，Web/API 构建与 lint 通过。Git 权限已恢复，执行最终提交。下文保留第一轮历史。

- Task 1：批量接口、校验、限流、typed client、缺失任务语义及按实际请求轮次退避已实现；相关测试通过。
- Task
  2：三个列表的 cursor/nextCursor、微秒精度、稳定排序、索引和 0018 迁移已实现并本地应用；EXPLAIN 与实际用户分页遍历通过。
- Task
  3：普通下载 pipeline、取消/断流清理及缩略图流输入和字节限制已实现；生命周期测试与 MinIO 真实对象读取通过。
- Task
  4：元数据页 pdf-lib 和字体解析器 opentype.js 动态加载已实现；PDF.js 现有边界已是动态加载，未重复改动。构建分别约 180/182
  kB。
- Task
  5：测试、lint、Web 构建、API 生产源码类型检查、OpenAPI 生成及本地集成核对已执行。审查中修复了退避计数副作用、非法 UUID、游标精度/作用域、Sharp 流初始化和响应头异常时的源流释放。
- 未完成项：Nest CLI 构建仍缺少 ajv 依赖；Git
  index 写入被权限拒绝，各任务尚未提交。未实施上传并发内存预算/观测配置，未做大表及部署内存压测。证据和剩余范围见性能审计文档的实施结果章节。
- 下列步骤保留作为原始计划，不将未执行的红绿顺序、独立审查或提交步骤标记为完成。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:**
降低任务轮询、数据库列表、文件 I/O 和前端重依赖造成的资源放大，同时保持现有 API 与用户流程兼容。

**Architecture:**
新增批量任务状态接口，前端任务组优先使用批量查询并动态退避；列表接口增加稳定 cursor 与匹配过滤条件的索引，同时保留 page/limit；下载和缩略图优先直接传输流，前端重解析器保持页面级动态加载。

**Tech Stack:** NestJS 11、BullMQ、Drizzle/PostgreSQL、Next.js 14、React
Query、openapi-fetch、Vitest、Drizzle migrations。

---

### Task 1: 批量任务状态与轮询退避

**Files:**

- Modify: `apps/api/src/modules/tasks/dto/tasks.dto.ts`
- Modify: `apps/api/src/modules/tasks/tasks.controller.ts`
- Modify: `apps/api/src/modules/tasks/tasks.service.ts`
- Modify: `apps/web/src/hooks/api/use-task-group-progress.ts`
- Test: `apps/api/src/modules/tasks/tasks.controller.test.ts`,
  `apps/api/src/modules/tasks/tasks.service.test.ts`,
  `apps/web/src/hooks/api/__tests__/use-task-group-progress.test.tsx`

- [ ] **Step 1:** 写失败测试，验证批量状态会去重 ID、单个不存在项返回
      `not_found`、超过 100 个 ID 返回 400；验证任务组 hook 调用一次批量接口并将轮询间隔按 1/2/3/5 秒退避。
- [ ] **Step 2:** 运行对应 API/Web 测试，确认因接口和 hook 尚不存在而失败。
- [ ] **Step 3:** 实现
      `GET /tasks/status?ids=`、服务层批量查询和前端批量 query；单任务接口保留，移除状态接口的
      `@SkipThrottle()` 以恢复 IP/用户限流。
- [ ] **Step 4:** 运行上述测试并确认通过，再运行 tasks 模块和 Web hooks 测试。
- [ ] **Step 5:** 提交 `feat: 优化任务状态批量查询与轮询`。

### Task 2: 列表查询索引与 cursor 分页

**Files:**

- Modify: `packages/db/src/schema/files.ts`
- Modify: `packages/db/src/schema/tasks.ts`
- Create: `packages/db/drizzle/<generated-migration>.sql`（使用 drizzle-kit generate 生成）
- Modify: `apps/api/src/modules/files/files.service.ts`
- Modify: `apps/api/src/modules/tasks/tasks.service.ts`
- Modify: `apps/api/src/modules/files/files.controller.ts`
- Modify: `apps/api/src/modules/tasks/tasks.controller.ts`
- Test: 对应 files/tasks service/controller 测试与 schema 测试

- [ ] **Step 1:** 写失败测试，验证 cursor 返回
      `nextCursor`、使用 cursor 时不再 offset，回收站查询声明稳定的 deletedAt/id 顺序。
- [ ] **Step 2:** 运行测试确认失败。
- [ ] **Step 3:**
      增加活动文件、回收站和常用任务筛选的部分/复合索引；实现 cursor 编解码、查询条件和响应字段，旧 page/limit 保持兼容。
- [ ] **Step 4:** 运行 `bunx drizzle-kit generate`、schema/API 测试，并用 PostgreSQL `EXPLAIN`
      检查索引命中。
- [ ] **Step 5:** 提交 `feat: 优化文件任务列表分页与索引`。

### Task 3: 文件下载与缩略图流式化

**Files:**

- Modify: `apps/api/src/modules/files/minio.service.ts`
- Modify: `apps/api/src/modules/files/files.service.ts`
- Modify: `apps/api/src/modules/files/files.controller.ts`
- Test: `apps/api/src/modules/files/minio.service.test.ts`,
  `apps/api/src/modules/files/files.controller.test.ts`,
  `apps/api/src/modules/files/thumbnail.util.test.ts`

- [ ] **Step 1:**
      写失败测试，验证下载响应使用 stream、stream 错误会销毁响应、缩略图路径不调用完整 Buffer 下载。
- [ ] **Step 2:** 运行测试确认失败。
- [ ] **Step 3:** 暴露 MinIO `downloadStream` 到文件服务；下载控制器使用 `pipeline`/streaming
      response；缩略图使用 Sharp 可接受的流路径，保留 32 MB 缩略图源限制与 headers。
- [ ] **Step 4:** 运行 files 模块全量测试，并用小对象通过 MinIO 集成路径验证响应内容。
- [ ] **Step 5:** 提交 `feat: 降低文件下载与缩略图内存占用`。

### Task 4: 前端重依赖动态边界

**Files:**

- Modify: `apps/web/src/app/[locale]/(app)/pdf/metadata/page.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/pdf/to-text/page.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/font/page.tsx`
- Modify: 相关 preview/processing 模块（仅在 bundle analyzer 证明被提前加载时调整）
- Test: 页面模块测试与 `apps/web/src/__tests__` 相关测试

- [ ] **Step 1:** 添加模块边界测试，验证首屏模块不静态导入 `pdf-lib`、字体解析器或 PDF.js。
- [ ] **Step 2:** 运行测试确认失败。
- [ ] **Step 3:** 将仅在文件选择/预览后使用的重模块改为 `import()`，保留 SSR 安全和现有错误处理。
- [ ] **Step 4:** 运行 Web 测试、lint 和 `bun --cwd apps/web build`，记录 First Load
      JS 与 chunk 警告变化。
- [ ] **Step 5:** 提交 `perf: 拆分工具页重依赖加载`。

### Task 5: 集成验证与交付

**Files:**

- Modify: `docs/performance-audit-2026-09-09.md`（补充实际优化结果）
- Modify: `PROJECT_SPECS.md`（仅当 API cursor/批量状态契约需要记录时）

- [ ] **Step 1:** 运行 package、API、Web 测试，Web/API lint 和 Web build。
- [ ] **Step 2:** 对迁移后的文件/任务查询运行 `EXPLAIN (ANALYZE, BUFFERS)`，保存关键扫描/排序结论。
- [ ] **Step 3:** 检查 `git diff --check`、工作区变更和 API/OpenAPI 类型一致性。
- [ ] **Step 4:** 请求代码审查，修复 Critical/Important 问题。
- [ ] **Step 5:** 提交 `chore: 完成性能优化验证记录`。
