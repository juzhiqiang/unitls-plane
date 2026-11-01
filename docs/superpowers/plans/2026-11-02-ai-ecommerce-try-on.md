# AI 电商试衣 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
增加独立的 AI 电商试衣模块，支持商品/服饰参考、人像和姿势组合，并复用现有生图服务与共享额度。

**Architecture:** 新增 `image_try_on`
异步任务类型、试衣图库只读 API 和独立 Web 页面。处理器复用现有图像生成服务；每日额度按
`image_generate` 与 `image_try_on` 合并统计，历史仍可按任务类型区分。

**Tech Stack:** Next.js 14、NestJS 11、Drizzle
ORM、Zod、class-validator、BullMQ、现有 OpenAI 兼容图像生成服务、MinIO。

**Spec:** `docs/superpowers/specs/2026-11-02-ai-ecommerce-try-on-design.md`

## Global Constraints

- 严格 TypeScript；API DTO 使用 `class-validator` 与 Swagger 注释；共享校验放
  `packages/validators`。
- Web 文案同时维护 `apps/web/messages/zh.json` 和 `apps/web/messages/en.json`。
- 数据库 schema 变更生成 Drizzle migration，并更新对应类型导出。
- API 修改后重新导出 OpenAPI 并更新/生成 `packages/api-client`。
- 测试镜像 `src` 目录结构，放在对应模块的 `test/` 目录；Web E2E 用例放在 `apps/web/e2e/`。
- 每个完成的代码/配置/文档变更，在必要验证通过后使用中文提交；本计划阶段不实现代码。
- 图库素材必须先核实再分发；不得因代码许可证推定素材许可证。

## Review Focus

- 未登录/无额度用户不能创建试衣任务；共享额度的并发提交不能超额。由 Task 2 覆盖。
- 真实商品参考不得被灵感服饰覆盖，且上送参考图最多 4 张。由 Task 1、Task 3 覆盖。
- 任务输入文件归属校验必须阻止访问其他用户的人像或商品图。由 Task 1 覆盖。
- 任务失败不扣额度；重试和普通生图按当前策略计数。由 Task 2 覆盖。
- 空图库/API 失败和双语环境下页面仍可上传商品图/人像并生成。由 Task 4 覆盖。

---

### Task 1: 试衣任务契约与处理器

**Files:**

- Modify: `packages/validators/src/tasks.ts`
- Create: `packages/validators/src/image-try-on.ts`
- Modify: `packages/validators/src/index.ts`
- Modify: `packages/db/src/schema/tasks.ts`
- Create: `packages/db/src/migrations/<generated image_try_on enum migration>`
- Modify: `apps/api/src/modules/tasks/dto/tasks.dto.ts`
- Modify: `apps/api/src/modules/tasks/task-queue.ts`
- Modify: `apps/api/src/modules/tasks/processors/ai-image.processor.ts`
- Test: `packages/validators/test/image-try-on.test.ts`
- Test: `apps/api/test/modules/tasks/processors/ai-image.processor.test.ts`

**Interfaces:**

- Produces: `imageTryOnTaskConfigSchema` validating `mode`, ordered reference roles, prompt
  additions, output size/quality and existing model selection fields. Modes are `product` and
  `inspiration`; reference roles are `person`, `garment`, `pose`, `style`.
- Maximum input references: 4. `product` requires a `garment` role marked as uploaded product image;
  `inspiration` requires a curated garment reference. `person` accepts uploaded or curated model.
  `pose` and `style` are optional.

- [ ] Write validator tests for valid product/inspiration requests, required garment role, duplicate
      roles, invalid file/role count, and prompt length.
- [ ] Run `bun test packages/validators/test/image-try-on.test.ts`; confirm the new contract tests
      fail.
- [ ] Add the task type and schema; add the processor dispatch branch that invokes the existing
      `ImageGenerationService` with an explicit server-composed prompt and role-ordered references.
- [ ] Verify uploaded file ownership using the existing task-creation validation path; use curated
      library asset IDs only for library roles.
- [ ] Run `bun test packages/validators/test/image-try-on.test.ts` and
      `bun --cwd apps/api test ./test/modules/tasks/processors/ai-image.processor.test.ts`; confirm
      PASS.
- [ ] Generate and apply the Drizzle enum migration; verify a fresh migration sequence succeeds in
      the configured test DB.
- [ ] Commit as `feat(试衣): 增加试衣任务契约与处理流程`.

### Task 2: 共享生图额度与任务分类

**Files:**

- Modify: `apps/api/src/modules/tasks/daily-task-quota.ts`
- Modify: `apps/api/src/modules/tasks/tasks.service.ts`
- Modify: `packages/validators/src/tasks.ts`
- Modify: task category mapping and task type labels in Web/API
- Test: `apps/api/test/modules/tasks/daily-task-quota.test.ts`
- Test: `apps/api/test/modules/tasks/tasks.service.test.ts`

**Interfaces:**

- Produces: one canonical set of quota-counted task types containing `image_generate` and
  `image_try_on`; the quota helper accepts a readonly list of types and excludes failed tasks using
  existing behavior.
- Task list filtering retains `image_try_on` as a distinct type while category filtering includes it
  under `image`.

- [ ] Add tests proving ordinary generation plus try-on counts share one limit, failed tasks are
      excluded, and type/category filters distinguish try-on.
- [ ] Run the two focused API tests and verify the new expectations fail.
- [ ] Update daily counting and transactional quota checks to use the shared type set without
      changing the public quota response shape.
- [ ] Verify concurrent submissions still pass through the existing transactional quota guard.
- [ ] Run
      `bun --cwd apps/api test ./test/modules/tasks/daily-task-quota.test.ts ./test/modules/tasks/tasks.service.test.ts`;
      confirm PASS.
- [ ] Commit as `feat(试衣): 合并生图与试衣额度统计`.

### Task 3: 三类参考图库 API 与数据

**Files:**

- Create: `packages/db/src/schema/ai-try-on-references.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/migrations/<generated ai_try_on_references migration>`
- Create: `packages/validators/src/ai-try-on-references.ts`
- Modify: `packages/validators/src/index.ts`
- Create: `apps/api/src/modules/tasks/services/ai-try-on-references.service.ts`
- Modify: `apps/api/src/modules/tasks/tasks.controller.ts`
- Modify: `apps/api/src/modules/tasks/tasks-core.module.ts`
- Create: `apps/api/src/scripts/seed-ai-try-on-references.ts`
- Test: `apps/api/test/modules/tasks/services/ai-try-on-references.service.test.ts`

**Interfaces:**

- Produces: `GET /tasks/ai-try-on/references?kind=person|pose|garment` returning localized title,
  thumbnail/object key, kind, tags, source and license summary; only enabled, license-reviewed
  entries are returned.
- Seed data must contain provenance and license fields; do not seed third-party media unless
  redistribution terms are explicitly approved.

- [ ] Add tests for kind/language filtering, disabled items, and exclusion of items missing required
      license metadata.
- [ ] Run focused service tests and verify they fail before implementation.
- [ ] Add Drizzle schema, validators, service, controller route, seed command, and migration with
      existing module/DB patterns.
- [ ] Export OpenAPI and update/verify generated API client types.
- [ ] Run
      `bun --cwd apps/api test ./test/modules/tasks/services/ai-try-on-references.service.test.ts`;
      confirm PASS.
- [ ] Commit as `feat(试衣): 增加授权参考图库接口`.

### Task 4: 独立试衣页面与双语支持

**Files:**

- Create: `apps/web/src/app/[locale]/(app)/image/try-on/page.tsx`
- Create: `apps/web/src/components/tools/ai-try-on/` components and hooks
- Modify: `apps/web/src/lib/tools/tool-metadata.ts`
- Modify: `apps/web/src/lib/api/` task/gallery hooks following existing conventions
- Modify: `apps/web/messages/zh.json`
- Modify: `apps/web/messages/en.json`
- Modify: task list type labels and image task navigation
- Test: `apps/web/test/components/tools/ai-try-on/`

**Interfaces:**

- Produces: standalone `/image/try-on` entry with segmented mode selection, person upload/library
  selection, product upload or inspiration garment gallery, optional pose selection, prompt
  preview/edit, quota display, asynchronous result and retry states.
- New task creation sends type `image_try_on` with role-bound file IDs and schema-valid config; file
  uploads use existing upload APIs.

- [ ] Add component tests for both modes, required fields, disabled generate state, four-reference
      ceiling, and quota exhaustion.
- [ ] Run focused Web tests and verify the new expectations fail.
- [ ] Implement the independent flow with responsive layout and empty/error/loading states; preserve
      existing upload and image comparison patterns.
- [ ] Add Chinese and English text, metadata, navigation and task labels.
- [ ] Run `bun --cwd apps/web test -- <focused test path>`; confirm PASS and verify no untranslated
      keys.
- [ ] Commit as `feat(试衣): 添加电商试衣工作台`.

### Task 5: End-to-end verification and documentation

**Files:**

- Modify: `PROJECT_SPECS.md`
- Modify: API OpenAPI export and `packages/api-client` generated files
- Create/Modify: `apps/web/e2e/ai-try-on.spec.ts`
- Test: focused validators/API/Web suites and release-relevant build checks

- [ ] Add E2E coverage for login, both modes, upload, library selection, task submission, result
      display, and shared quota feedback using mocked generation provider.
- [ ] Run `bun test packages/validators/test/image-try-on.test.ts`, focused API tests, focused Web
      tests, and `bun run test`.
- [ ] Run API build/OpenAPI export, Web build, `bun run format:check`, and update `PROJECT_SPECS.md`
      task types, quota behavior, gallery API, route and limitations.
- [ ] Confirm test fixtures use only owned or explicitly licensed assets; complete a manual SKU
      fidelity check before enabling real product mode for general users.
- [ ] Commit as `docs(试衣): 更新试衣模块项目规范`.

## Execution Notes

- This plan does not include implementation in the current review step.
- Build and manual acceptance use a configured AI image provider; automated tests mock the provider.
- This is a multi-module change with schema, quota and user-facing behavior, so execute in
  dependency order and do not expose the feature until Tasks 1-4 and migration verification pass.
