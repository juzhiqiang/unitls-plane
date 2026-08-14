# 图片压缩套餐额度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让图片压缩的本地与服务端处理共同遵守账号套餐单文件额度，并使显式 Pro
Preview 账号获得顶额会员权益。

**Architecture:** 共享权益层负责所有计划的额度事实，图片压缩页只把当前会话映射到
`upload.maxFileSize`。上传控件在选择阶段执行动态限制并本地化错误，页面在处理前做一次防御校验。

**Tech Stack:** TypeScript、Bun Test、Next.js 14、React
18、next-intl、react-dropzone、Vitest、Testing Library

---

### Task 1: Pro Preview 顶额共享权益

**Files:**

- Modify: `packages/utils/src/entitlements.ts`
- Test: `packages/utils/src/entitlements.test.ts`
- Create: `apps/web/src/lib/entitlement-session.ts`
- Modify: `apps/web/src/app/[locale]/(app)/image/animation/page.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/image/stitch/page.tsx`
- Modify: `apps/web/src/lib/processing/image-animation-client.ts`
- Modify: `apps/web/src/lib/processing/image-stitch-client.ts`
- Test: `apps/web/src/lib/processing/__tests__/image-animation-client.test.ts`
- Test: `apps/web/src/lib/processing/__tests__/image-stitch-client.test.ts`

- [ ] **Step 1: 写入失败测试**

导入 `isPlanAtLeast` 和 `LimitKey`，断言 `pro_preview` 达到 `private` 等级，并遍历全部限制键比较：

```typescript
expect(isPlanAtLeast('pro_preview', 'private')).toBe(true);

for (const limit of limitKeys) {
  expect(getLimit({ userId: 'preview', plan: 'pro_preview' }, limit)).toBe(
    getLimit({ userId: 'private', plan: 'private' }, limit)
  );
}
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `bun test packages/utils/src/entitlements.test.ts`

Expected: FAIL，当前 `pro_preview` 等级和各限制仍低于 `private`。

- [ ] **Step 3: 实现最小共享权益修改**

将 `PLAN_RANK.pro_preview` 设为与 `private` 相同，并将 `LIMITS` 中每个 `pro_preview` 值改为对应的
`private` 值；保留 `resolveEntitlementPlan` 返回 `pro_preview`。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `bun test packages/utils/src/entitlements.test.ts`

Expected: PASS。

- [ ] **Step 5: 验证浏览器端消费者读取真实计划**

先为 GIF/APNG 和长图拼接添加显式 `pro_preview`
会话的顶额断言并确认失败。随后新增共享会话映射工具，将 `id`、`plan`、`role` 转为
`EntitlementUser`，替换两个客户端原先仅判断登录状态的逻辑。

Run:
`bun --cwd apps/web test -- src/lib/processing/__tests__/image-animation-client.test.ts src/lib/processing/__tests__/image-stitch-client.test.ts`

Expected: 两个测试文件全部通过。

- [ ] **Step 6: 封住本地工具的会话加载与套餐变化窗口**

先为 GIF/APNG 和长图拼接页面添加会话 pending 断言，确认上传和处理入口在会话加载时禁用。随后为
`stitchImages`
添加失败测试，要求文件数或单文件大小超过当前权益时在图片解码前拒绝；实现输入校验后重新运行两个处理测试文件。

### Task 2: 图片压缩动态套餐额度

**Files:**

- Modify: `apps/web/src/app/[locale]/(app)/image/compress/image-compress-utils.ts`
- Modify: `apps/web/src/app/[locale]/(app)/image/compress/page.tsx`
- Test: `apps/web/src/app/[locale]/(app)/image/compress/__tests__/page.test.ts`

- [ ] **Step 1: 写入失败测试**

为 `getImageCompressionMaxFileSize(session)` 断言以下结果：游客 10 MB、普通登录 50 MB、Pro Preview
250 MB、Pro 100 MB、Team 150 MB、Private 250 MB。读取页面源码并断言：

```typescript
expect(source).toContain('maxSize={maxFileSize}');
expect(source).not.toContain('maxSize={50 * 1024 * 1024}');
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `bun --cwd apps/web test -- "src/app/[locale]/(app)/image/compress/__tests__/page.test.ts"`

Expected: FAIL，页面仍固定 50 MB，辅助函数仍使用旧接口。

- [ ] **Step 3: 实现动态共同额度**

辅助模块把会话用户映射到共享 `getLimit`，只导出 `getImageCompressionMaxFileSize`。页面使用返回值作为
`FileDropzone.maxSize`，保留现有推荐模式；`handleProcess`
在本地和服务端分支之前检查全部文件是否超过当前额度，超额时显示本地化错误并终止。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `bun --cwd apps/web test -- "src/app/[locale]/(app)/image/compress/__tests__/page.test.ts"`

Expected: PASS。

- [ ] **Step 5: 防止会话加载窗口误用游客额度**

先断言页面定义
`controlsDisabled = processing || sessionLoading`，并将它传给上传、压缩选项、变换选项、模式切换和开始按钮；同时断言
`handleProcess` 在 `sessionLoading` 时直接返回。确认测试失败后实现该保护并重新运行本页测试。

### Task 3: 上传容量本地化

**Files:**

- Modify: `apps/web/src/components/tools/file-dropzone.tsx`
- Modify: `apps/web/src/components/tools/__tests__/file-dropzone.test.tsx`
- Modify: `apps/web/messages/zh.json`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: 运行已有失败测试确认 RED**

Run: `bun --cwd apps/web test -- src/components/tools/__tests__/file-dropzone.test.tsx`

Expected: FAIL，当前显示 `File is larger than 1024 bytes`。

- [ ] **Step 2: 添加中英文消息并实现映射**

在 `ToolsShared` 中增加：

```json
"dropzoneMaxSize": "最大 {size}",
"dropzoneFileTooLarge": "文件不能超过 {size}"
```

英文对应为 `"{size} max"` 和 `"File must be {size} or smaller"`。`FileDropzone`
将格式化容量交给消息模板，并按错误码 `file-too-large` 替换原始错误。

图片压缩的 `dropzoneHint` 改为只显示支持格式；增加处理前防御校验使用的 `fileTooLargeForPlan`
中英文消息。

- [ ] **Step 3: 运行测试确认 GREEN**

Run: `bun --cwd apps/web test -- src/components/tools/__tests__/file-dropzone.test.tsx`

Expected: PASS。

### Task 4: 历史文件按当前套餐重新校验

**Files:**

- Modify: `apps/api/src/modules/tasks/tasks.service.ts`
- Test: `apps/api/src/modules/tasks/tasks.service.test.ts`

- [ ] **Step 1: 写入失败测试并确认 RED**

模拟普通登录账号持有一个 51 MB 的历史文件，创建 `compress` 任务应返回 50
MB 超限错误，并且不插入任务、不写 outbox、不入队。

Run: `bun test apps/api/src/modules/tasks/tasks.service.test.ts`

- [ ] **Step 2: 在事务内实现当前套餐校验并确认 GREEN**

将完整的 `id`、`plan`、`role` 保留到文件访问检查，从 `FilesService.getById` 返回的数据库记录读取
`originalSize`，对 `compress` 使用当前 `upload.maxFileSize`。超限时抛出带 `FILE_TOO_LARGE` 错误码的
`BadRequestException`。

Run: `bun test apps/api/src/modules/tasks/tasks.service.test.ts`

Expected: PASS。

### Task 5: 文档与完整验证

**Files:**

- Modify: `README.md`
- Modify: `PROJECT_SPECS.md`

- [ ] **Step 1: 同步项目事实**

在文件策略中记录单文件额度：游客 10 MB、普通登录 50 MB、Pro 100 MB、Team 150 MB、Private 250
MB；显式 Pro Preview 与 Private 共享顶额权益，本地工具若声明套餐限制则与服务端使用同一额度。

- [ ] **Step 2: 运行完整验证**

```bash
bun run test:packages
bun run test:api
bun run test:web
bun run format:check:changed
bun run --cwd apps/web build
bun run test:e2e -- public-beta-smoke.spec.ts
git diff --check
```

Expected: 所有命令 exit 0；Windows standalone 符号链接可能继续输出已知 `EPERM`
警告，但构建退出码必须为 0。

- [ ] **Step 3: 创建中文提交**

```bash
git add packages/utils/src/entitlements.ts packages/utils/src/entitlements.test.ts apps/web/src/lib/entitlement-session.ts apps/web/src/app/[locale]/(app)/image/animation/page.tsx apps/web/src/app/[locale]/(app)/image/stitch/page.tsx apps/web/src/lib/processing/image-animation-client.ts apps/web/src/lib/processing/image-stitch-client.ts apps/web/src/lib/processing/__tests__/image-animation-client.test.ts apps/web/src/lib/processing/__tests__/image-stitch-client.test.ts apps/web/src/app/[locale]/(app)/image/compress/image-compress-utils.ts apps/web/src/app/[locale]/(app)/image/compress/__tests__/page.test.ts apps/web/src/app/[locale]/(app)/image/compress/page.tsx apps/web/src/components/tools/file-dropzone.tsx apps/web/src/components/tools/__tests__/file-dropzone.test.tsx apps/web/messages/zh.json apps/web/messages/en.json apps/api/src/modules/tasks/tasks.service.ts apps/api/src/modules/tasks/tasks.service.test.ts README.md PROJECT_SPECS.md docs/superpowers/specs/2026-08-14-image-compress-large-file-design.md docs/superpowers/plans/2026-08-14-image-compress-large-file.md
git commit -m "fix: 按套餐限制文件处理额度"
```
