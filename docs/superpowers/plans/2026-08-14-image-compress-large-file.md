# 图片压缩超大文件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许图片压缩页接收最大 250
MB 的文件进行浏览器本地处理，同时继续按当前账号套餐限制服务端上传。

**Architecture:**
在图片压缩页辅助模块集中计算本地入口上限、会话对应的服务端额度和推荐处理模式。页面根据选中文件实时禁用不合法的服务端模式，并在执行前再次校验；共享上传控件负责将容量标签和
`file-too-large` 错误本地化。

**Tech Stack:** Next.js 14、React 18、TypeScript、next-intl、react-dropzone、Vitest、Testing Library

---

### Task 1: 图片压缩额度与推荐模式

**Files:**

- Modify: `apps/web/src/app/[locale]/(app)/image/compress/image-compress-utils.ts`
- Test: `apps/web/src/app/[locale]/(app)/image/compress/__tests__/page.test.ts`

- [ ] **Step 1: 写入失败测试**

为辅助函数添加以下断言：

```typescript
expect(IMAGE_COMPRESSION_LOCAL_MAX_FILE_SIZE).toBe(250 * 1024 * 1024);
expect(getImageCompressionServerMaxFileSize(null)).toBe(10 * 1024 * 1024);
expect(
  getImageCompressionServerMaxFileSize({
    user: { id: 'user-1', plan: 'pro', role: 'user' },
  })
).toBe(100 * 1024 * 1024);
expect(
  hasImageCompressionServerOversizeFile(
    [new File([new Uint8Array(51 * 1024 * 1024)], 'large.png')],
    50 * 1024 * 1024
  )
).toBe(true);
expect(
  getImageCompressionRecommendation(
    [new File([new Uint8Array(51 * 1024 * 1024)], 'large.png')],
    50 * 1024 * 1024
  )
).toBe('local');
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `bun --cwd apps/web test -- "src/app/[locale]/(app)/image/compress/__tests__/page.test.ts"`

Expected: FAIL，原因是新常量和辅助函数尚未导出。

- [ ] **Step 3: 实现最小额度辅助函数**

在 `image-compress-utils.ts` 中从 `@utils-plane/utils` 导入
`getLimit`，定义可选的会话用户结构，并实现：

```typescript
export const IMAGE_COMPRESSION_LOCAL_MAX_FILE_SIZE = 250 * 1024 * 1024;

export function getImageCompressionServerMaxFileSize(session: CompressionSession): number {
  const user = session?.user;
  return getLimit(
    user ? { userId: user.id, plan: user.plan, role: user.role } : undefined,
    'upload.maxFileSize'
  );
}

export function hasImageCompressionServerOversizeFile(
  files: readonly File[],
  serverMaxFileSize: number
): boolean {
  return files.some(file => file.size > serverMaxFileSize);
}
```

推荐模式先检查服务端额度，未超额时继续调用现有 `shouldProcessLocally` 规则。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `bun --cwd apps/web test -- "src/app/[locale]/(app)/image/compress/__tests__/page.test.ts"`

Expected: PASS。

### Task 2: 服务端模式禁用态

**Files:**

- Modify: `apps/web/src/components/tools/mode-toggle.tsx`
- Create: `apps/web/src/components/tools/__tests__/mode-toggle.test.tsx`

- [ ] **Step 1: 写入失败组件测试**

渲染 `ModeToggle`，传入 `serverDisabled` 和 `serverDisabledReason`，断言：

```typescript
expect(screen.getByRole('button', { name: 'Local' })).toBeEnabled();
expect(screen.getByRole('button', { name: 'Server' })).toBeDisabled();
expect(screen.getByText('Server files are limited to 50 MB.')).toBeInTheDocument();
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `bun --cwd apps/web test -- src/components/tools/__tests__/mode-toggle.test.tsx`

Expected: FAIL，原因是组件尚无服务端独立禁用属性。

- [ ] **Step 3: 实现服务端独立禁用**

在 `ModeToggleProps` 中加入：

```typescript
serverDisabled?: boolean;
serverDisabledReason?: string;
```

仅当按钮为 `server` 时合并 `serverDisabled`，保留 `disabled` 对两个按钮的处理；在分段控件下方显示
`serverDisabledReason`。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `bun --cwd apps/web test -- src/components/tools/__tests__/mode-toggle.test.tsx`

Expected: PASS。

### Task 3: 上传容量本地化与页面接线

**Files:**

- Modify: `apps/web/src/components/tools/file-dropzone.tsx`
- Modify: `apps/web/src/components/tools/__tests__/file-dropzone.test.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/image/compress/page.tsx`
- Modify: `apps/web/messages/zh.json`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: 写入上传错误失败测试**

分别使用中英文 messages 渲染 `FileDropzone`，投递超过 `maxSize` 的文件，断言显示：

```text
large.png: File must be 1 KB or smaller
large.png: 文件不能超过 1 KB
```

并断言页面不再出现 `File is larger than 1024 bytes`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `bun --cwd apps/web test -- src/components/tools/__tests__/file-dropzone.test.tsx`

Expected: FAIL，当前组件直接显示 react-dropzone 的原始英文错误。

- [ ] **Step 3: 实现本地化容量标签和错误**

在 `ToolsShared` 中同时增加：

```json
"dropzoneMaxSize": "最大 {size}",
"dropzoneFileTooLarge": "文件不能超过 {size}"
```

英文对应为 `"{size} max"` 和 `"File must be {size} or smaller"`。`FileDropzone` 将 `formatMaxSize`
的纯容量结果交给消息模板，并将错误码 `file-too-large` 映射到本地化文案。

- [ ] **Step 4: 将额度行为接入图片压缩页**

页面使用 `IMAGE_COMPRESSION_LOCAL_MAX_FILE_SIZE` 作为 `FileDropzone.maxSize`；从会话计算
`serverMaxFileSize`，并基于全部已选文件计算 `serverDisabled` 与推荐模式。超额时通过 `useEffect`
将现有服务端模式切回本地，向 `ModeToggle` 传入当前额度原因，并在 `handleProcess`
的服务端分支前再次阻止超额上传。

同步更新 `ImageCompress.dropzoneHint`：

```text
支持 JPG / PNG / WebP / AVIF，本地处理单文件最高 250 MB
JPG, PNG, WebP, or AVIF — local processing up to 250 MB per file
```

- [ ] **Step 5: 运行聚焦测试并确认 GREEN**

Run:
`bun --cwd apps/web test -- "src/app/[locale]/(app)/image/compress/__tests__/page.test.ts" src/components/tools/__tests__/mode-toggle.test.tsx src/components/tools/__tests__/file-dropzone.test.tsx`

Expected: PASS。

### Task 4: 完整验证与提交

**Files:**

- Verify: all changed files

- [ ] **Step 1: 运行 Web 全量测试**

Run: `bun run test:web`

Expected: 54 个或更多测试文件全部通过，0 failures。

- [ ] **Step 2: 运行变更文件格式检查**

Run: `bun run format:check:changed`

Expected: exit 0。

- [ ] **Step 3: 运行生产构建**

Run: `bun run --cwd apps/web build`

Expected: Next.js 编译、类型检查和静态页面生成完成，exit 0；Windows
standalone 符号链接可能继续输出已知 `EPERM` 警告。

- [ ] **Step 4: 核对差异并提交**

```bash
git diff --check
git status --short
git add apps/web/src/app/[locale]/(app)/image/compress/image-compress-utils.ts apps/web/src/app/[locale]/(app)/image/compress/__tests__/page.test.ts apps/web/src/app/[locale]/(app)/image/compress/page.tsx apps/web/src/components/tools/mode-toggle.tsx apps/web/src/components/tools/__tests__/mode-toggle.test.tsx apps/web/src/components/tools/file-dropzone.tsx apps/web/src/components/tools/__tests__/file-dropzone.test.tsx apps/web/messages/zh.json apps/web/messages/en.json
git commit -m "fix(web): 支持超大图片本地压缩"
```
