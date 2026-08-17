# 证件照页面预览功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给证件照生成页(`/image/id-photo`)补上「上传原图预览」和「生成结果预览」两处预览。

**Architecture:** 抽一个 `useObjectUrl` hook 统一管理 object URL 的创建/revoke(两处复用、可独立测试),在 `id-photo/page.tsx` 内联使用:上传后用 `useObjectUrl(file)` 渲染原图 `<img>`;任务完成后把 `useObjectUrl(resultFile)` 的 `<img>` 传入 `ResultPanel` 已有的 `preview` 插槽。不改动通用 `FileDropzone`。

**Tech Stack:** Next.js 14 App Router、React 18、Vitest + @testing-library/react(jsdom)、next-intl。

**关联设计:** [docs/superpowers/specs/2026-08-17-id-photo-preview-design.md](../specs/2026-08-17-id-photo-preview-design.md)

---

## 文件结构

| 文件 | 责任 |
| --- | --- |
| `apps/web/src/hooks/use-object-url.ts`(新建) | 为 `File/Blob` 创建 object URL,依赖变化/卸载时自动 revoke |
| `apps/web/src/hooks/__tests__/use-object-url.test.tsx`(新建) | hook 单元测试:null、创建、变化 revoke、卸载 revoke |
| `apps/web/messages/zh.json`、`en.json`(修改) | `ImageIdPhoto` 段新增 `previewAlt` 文案 |
| `apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`(修改) | 引入 hook,渲染上传预览与结果预览 `<img>` |
| `apps/web/src/app/[locale]/(app)/image/id-photo/__tests__/page.test.tsx`(新建) | 页面集成测试:上传后预览图出现、生成完成后成品图出现 |

> jsdom 未实现 `URL.createObjectURL`,凡用到该 API 的测试文件须在 `beforeEach` 里 `Object.defineProperty(URL, 'createObjectURL', …)` stub,详见对应任务。

---

### Task 1: useObjectUrl hook

**Files:**
- Create: `apps/web/src/hooks/use-object-url.ts`
- Test: `apps/web/src/hooks/__tests__/use-object-url.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/hooks/__tests__/use-object-url.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useObjectUrl } from '../use-object-url';

describe('useObjectUrl', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:test-url');
    revokeObjectURL = vi.fn();
    // jsdom 未实现 URL.createObjectURL,统一 stub
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when no file is provided', () => {
    const { result } = renderHook(() => useObjectUrl(null));
    expect(result.current).toBeNull();
  });

  it('creates an object URL for the given file', () => {
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    const { result } = renderHook(() => useObjectUrl(file));
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(result.current).toBe('blob:test-url');
  });

  it('revokes the previous URL when the file changes', () => {
    const fileA = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const fileB = new File(['b'], 'b.jpg', { type: 'image/jpeg' });
    createObjectURL
      .mockReturnValueOnce('blob:url-a')
      .mockReturnValueOnce('blob:url-b');
    const { rerender } = renderHook(({ f }) => useObjectUrl(f), {
      initialProps: { f: fileA },
    });
    expect(revokeObjectURL).not.toHaveBeenCalled();
    rerender({ f: fileB });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:url-a');
    expect(createObjectURL).toHaveBeenCalledWith(fileB);
  });

  it('revokes the URL on unmount', () => {
    const file = new File(['c'], 'c.jpg', { type: 'image/jpeg' });
    const { unmount } = renderHook(() => useObjectUrl(file));
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `bun --cwd apps/web test src/hooks/__tests__/use-object-url.test.tsx`
Expected: FAIL —— `Failed to resolve import "…/use-object-url"`(模块不存在)。

- [ ] **Step 3: 写最小实现**

创建 `apps/web/src/hooks/use-object-url.ts`:

```ts
import { useEffect, useState } from 'react';

/**
 * 为 File/Blob 创建 object URL,并在依赖变化或组件卸载时自动 revoke,
 * 避免内存泄漏。传入 null 时返回 null。
 */
export function useObjectUrl(file: File | Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return url;
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `bun --cwd apps/web test src/hooks/__tests__/use-object-url.test.tsx`
Expected: PASS(4 条)。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/hooks/use-object-url.ts apps/web/src/hooks/__tests__/use-object-url.test.tsx
git commit -m "feat(web): 添加 useObjectUrl hook 管理 object URL 生命周期"
```

---

### Task 2: i18n 新增 previewAlt 文案

**Files:**
- Modify: `apps/web/messages/zh.json`(`ImageIdPhoto` 段)
- Modify: `apps/web/messages/en.json`(`ImageIdPhoto` 段)

- [ ] **Step 1: 中文文案**

在 `apps/web/messages/zh.json` 的 `ImageIdPhoto` 段(`resultSize` 之后、`presets` 之前)新增 `previewAlt`。

精确替换:

```
old:
    "resultTitle": "证件照已生成",
    "resultSize": "大小",
    "presets": {

new:
    "resultTitle": "证件照已生成",
    "resultSize": "大小",
    "previewAlt": "证件照预览",
    "presets": {
```

- [ ] **Step 2: 英文文案**

在 `apps/web/messages/en.json` 的 `ImageIdPhoto` 段同样位置新增:

```
old:
    "resultTitle": "ID photo generated",
    "resultSize": "Size",
    "presets": {

new:
    "resultTitle": "ID photo generated",
    "resultSize": "Size",
    "previewAlt": "ID photo preview",
    "presets": {
```

- [ ] **Step 3: 校验 JSON 合法**

Run: `bun --cwd apps/web test src/app/[locale]/(app)/__tests__/catalog-pages.test.tsx`
Expected: PASS(确保文案改动未破坏现有用例;若该用例不覆盖此处,仅确认无语法错误即可,JSON 解析失败会报错)。

- [ ] **Step 4: 提交**

```bash
git add apps/web/messages/zh.json apps/web/messages/en.json
git commit -m "feat(web): 添加证件照预览 alt 文案"
```

---

### Task 3: 上传原图预览 + 集成测试

**Files:**
- Create: `apps/web/src/app/[locale]/(app)/image/id-photo/__tests__/page.test.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/app/[locale]/(app)/image/id-photo/__tests__/page.test.tsx`:

```tsx
import React from 'react';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../../messages/en.json';
import IdPhotoPage from '../page';

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useUploadFile: vi.fn(),
  useCreateTask: vi.fn(),
  useTaskProgress: vi.fn(),
  onCompleted: vi.fn(),
  onFailed: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => React.createElement('a', { href, ...props }, children),
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => mocks.useSession() },
}));

vi.mock('@/hooks/api/use-files', () => ({
  useUploadFile: () => mocks.useUploadFile(),
}));

vi.mock('@/hooks/api/use-tasks', () => ({
  useCreateTask: () => mocks.useCreateTask(),
}));

vi.mock('@/hooks/api/use-task-progress', () => ({
  useTaskProgress: (
    _taskId: string | null,
    options?: {
      onCompleted?: (id: string) => void;
      onFailed?: (e: { code: string; message: string }) => void;
    }
  ) => {
    mocks.onCompleted.mockImplementation(options?.onCompleted ?? (() => {}));
    mocks.onFailed.mockImplementation(options?.onFailed ?? (() => {}));
    return mocks.useTaskProgress();
  },
}));

// jsdom 未实现 URL.createObjectURL
beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:preview-url'),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
});

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <IdPhotoPage />
    </NextIntlClientProvider>
  );
}

function makeFile() {
  return new File(['pixel-data'], 'photo.jpg', { type: 'image/jpeg' });
}

describe('IdPhotoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({ data: null, isPending: false });
    mocks.useUploadFile.mockReturnValue({ mutateAsync: vi.fn() });
    mocks.useCreateTask.mockReturnValue({ mutateAsync: vi.fn() });
    mocks.useTaskProgress.mockReturnValue({ data: undefined });
  });

  it('renders an uploaded image preview after a file is dropped', () => {
    const { container } = renderPage();
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    const img = screen.getByAltText('ID photo preview');
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('src')).toBe('blob:preview-url');
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `bun --cwd apps/web test "src/app/[locale]/(app)/image/id-photo/__tests__/page.test.tsx"`
Expected: FAIL —— 找不到 alt 为 "ID photo preview" 的 `<img>`(`screen.getByAltText` 抛 Unable to find)。

- [ ] **Step 3: 修改 page.tsx 接入上传预览**

3a. 在 import 区追加 hook 导入。

精确替换:

```
old:
import { useTaskProgress } from '@/hooks/api/use-task-progress';

new:
import { useTaskProgress } from '@/hooks/api/use-task-progress';
import { useObjectUrl } from '@/hooks/use-object-url';
```

3b. 在 state 声明之后增加 `sourceUrl`。

精确替换:

```
old:
  const [error, setError] = useState<string | null>(null);

  const taskQuery = useTaskProgress(taskId, {

new:
  const [error, setError] = useState<string | null>(null);

  const sourceUrl = useObjectUrl(file);

  const taskQuery = useTaskProgress(taskId, {
```

3c. 在 `file` 区块顶部插入上传预览 `<img>`。

精确替换:

```
old:
      {file && (
        <div className="space-y-6">
          <div className="text-xs font-mono text-muted-foreground">
            {t('selected', {
              filename: file.name,
              size: formatBytes(file.size, tUnits, locale),
            })}
          </div>

new:
      {file && (
        <div className="space-y-6">
          {sourceUrl && (
            <img
              src={sourceUrl}
              alt={t('previewAlt')}
              className="mx-auto max-h-64 w-auto object-contain rounded-md border border-border"
            />
          )}

          <div className="text-xs font-mono text-muted-foreground">
            {t('selected', {
              filename: file.name,
              size: formatBytes(file.size, tUnits, locale),
            })}
          </div>
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `bun --cwd apps/web test "src/app/[locale]/(app)/image/id-photo/__tests__/page.test.tsx"`
Expected: PASS(1 条)。

- [ ] **Step 5: 提交**

```bash
git add "apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx" "apps/web/src/app/[locale]/(app)/image/id-photo/__tests__/page.test.tsx"
git commit -m "feat(web): 证件照页添加上传原图预览"
```

---

### Task 4: 生成结果预览 + 集成测试

**Files:**
- Modify: `apps/web/src/app/[locale]/(app)/image/id-photo/__tests__/page.test.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`

- [ ] **Step 1: 追加失败测试**

在 `page.test.tsx` 的 `describe('IdPhotoPage', …)` 内,第一个 `it(...)` 之后追加第二个用例:

```tsx
  it('renders the generated id photo preview after the task completes', async () => {
    mocks.useSession.mockReturnValue({
      data: { user: { name: 'Tester', email: 't@example.com' } },
      isPending: false,
    });
    const uploadMutate = vi.fn().mockResolvedValue({ id: 'input-file-1' });
    const taskMutate = vi.fn().mockResolvedValue({ id: 'task-1' });
    mocks.useUploadFile.mockReturnValue({ mutateAsync: uploadMutate });
    mocks.useCreateTask.mockReturnValue({ mutateAsync: taskMutate });

    const fetchMock = vi.fn().mockResolvedValue({
      blob: () =>
        Promise.resolve(new Blob(['result'], { type: 'image/jpeg' })),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderPage();

    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate ID photo' }));

    await waitFor(() => {
      expect(taskMutate).toHaveBeenCalled();
    });

    await act(async () => {
      await mocks.onCompleted('output-file-1');
    });

    // 完成后上传预览 + 结果预览都使用同一 alt,应至少有两张
    const previews = screen.getAllByAltText('ID photo preview');
    expect(previews.length).toBeGreaterThanOrEqual(2);
    expect(fetchMock).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `bun --cwd apps/web test "src/app/[locale]/(app)/image/id-photo/__tests__/page.test.tsx"`
Expected: FAIL —— 新用例失败:结果预览 `<img>` 未出现(只有上传预览一张,`getAllByAltText` 数量不足,或 `ResultPanel` 未渲染 preview)。

- [ ] **Step 3: 修改 page.tsx 接入结果预览**

3a. 在 `sourceUrl` 下方追加 `resultUrl`。

精确替换:

```
old:
  const sourceUrl = useObjectUrl(file);

  const taskQuery = useTaskProgress(taskId, {

new:
  const sourceUrl = useObjectUrl(file);
  const resultUrl = useObjectUrl(resultFile);

  const taskQuery = useTaskProgress(taskId, {
```

3b. 给 `ResultPanel` 传入 `preview` 插槽。

精确替换:

```
old:
      {resultFile && (
        <ResultPanel
          title={t('resultTitle')}
          description={resultFile.name}
          meta={[
            {
              label: t('resultSize'),
              value: formatBytes(resultFile.size, tUnits, locale),
            },
          ]}
          action={<DownloadButton file={resultFile} />}
        />
      )}

new:
      {resultFile && (
        <ResultPanel
          title={t('resultTitle')}
          description={resultFile.name}
          preview={
            resultUrl ? (
              <img
                src={resultUrl}
                alt={t('previewAlt')}
                className="mx-auto max-h-80 w-auto object-contain rounded-md border border-border"
              />
            ) : null
          }
          meta={[
            {
              label: t('resultSize'),
              value: formatBytes(resultFile.size, tUnits, locale),
            },
          ]}
          action={<DownloadButton file={resultFile} />}
        />
      )}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `bun --cwd apps/web test "src/app/[locale]/(app)/image/id-photo/__tests__/page.test.tsx"`
Expected: PASS(2 条)。

- [ ] **Step 5: 提交**

```bash
git add "apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx" "apps/web/src/app/[locale]/(app)/image/id-photo/__tests__/page.test.tsx"
git commit -m "feat(web): 证件照页添加生成结果预览"
```

---

### Task 5: 全量回归与手动核对

**Files:** 无(仅验证)

- [ ] **Step 1: 跑全量测试**

Run: `bun --cwd apps/web test`
Expected: 全部 PASS,无回归。

- [ ] **Step 2: 手动核对(可选但建议)**

确保 `apps/api` 与依赖服务在跑,启动 `bun run dev`,访问 `http://localhost:3000/zh/image/id-photo`:

1. 登录后上传一张正面照 → 立即看到原图缩略(上方)。
2. 选规格/背景色 → 点「生成证件照」→ 完成后在结果区直接看到成品图,无需下载。
3. 重新上传另一张图 → 旧 object URL 被 revoke(无内存泄漏,DevTools 无法直接观测,仅确认新预览正常切换)。

- [ ] **Step 3: 无新改动,跳过提交**

本任务无代码改动;若 Step 2 发现问题,回到对应 Task 修复并按其 commit 规范提交。

---

## Self-Review

**Spec coverage:**
- 上传原图预览 → Task 3 ✓
- 生成结果预览 → Task 4 ✓
- object URL 生命周期(useEffect 创建/revoke)→ Task 1 hook + 测试 ✓
- i18n alt 文案(zh/en)→ Task 2 ✓
- 测试断言(file 存在→img、resultFile 存在→img)→ Task 3 Step 1 / Task 4 Step 1 ✓
- 非目标(背景色实时对比、裁剪交互)→ 不涉及 ✓

**Placeholder scan:** 无 TBD/TODO;每个代码步骤含完整代码;每个 Edit 含精确 old/new;测试命令含预期输出。

**Type consistency:** `useObjectUrl(file: File | Blob | null): string | null` 在 Task 1 定义,Task 3/4 以 `useObjectUrl(file)` / `useObjectUrl(resultFile)` 调用,签名一致;`previewAlt` key 在 Task 2 定义、Task 3/4 以 `t('previewAlt')` 使用,一致;mock 的 `useTaskProgress(taskId, options)` 签名与 `use-task-progress.ts` 一致。
