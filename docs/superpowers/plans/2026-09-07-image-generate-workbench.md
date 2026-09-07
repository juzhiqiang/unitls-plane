# AI 生图工作台布局改版 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/image/generate` 从 ToolPageShell 单列表单改为「左侧参数面板 + 右主区(模板墙/进度/大图+缩略切换)」的工作台布局,配色沿用全站设计 token。

**Architecture:** 页面内自建布局(不新建通用 Shell 之外的东西,本计划新建 2 个专用组件):`ImageGenerateWorkbench`(纯布局骨架,双插槽)与 `ImageGenerateTemplateWall`(空态模板卡片墙,复用 presets 接口与 options.tsx 的 PresetCard)。page.tsx 保留全部状态编排与提交逻辑,仅移除 ToolPageShell/步骤条/信任条,新增 `selectedIndex` 驱动大图切换。

**Tech Stack:** Next.js 14 App Router、React 18、Tailwind CSS 4、next-intl、vitest + @testing-library/react。

**规格:** `docs/superpowers/specs/2026-09-07-image-generate-workbench-design.md`

---

## 文件总览

| 操作 | 文件 |
| --- | --- |
| 修改 | `apps/web/messages/zh.json`、`apps/web/messages/en.json` |
| 修改 | `apps/web/src/components/tools/image-generate-options.tsx`(导出 PresetCard、去 details 折叠) |
| 新建 | `apps/web/src/components/tools/image-generate-template-wall.tsx` |
| 新建 | `apps/web/src/components/tools/image-generate-workbench.tsx` |
| 重写 | `apps/web/src/app/[locale]/(app)/image/generate/page.tsx` |
| 新建 | `apps/web/src/components/tools/__tests__/image-generate-template-wall.test.tsx` |
| 新建 | `apps/web/src/components/tools/__tests__/image-generate-workbench.test.tsx` |
| 修改 | `apps/web/src/app/[locale]/(app)/image/generate/__tests__/page.test.tsx` |

运行单个测试的命令统一为(在 `apps/web` 目录下):

```bash
bunx vitest run <测试文件路径>
```

---

### Task 1: 新增 i18n 文案键

**Files:**
- Modify: `apps/web/messages/zh.json`(ImageGenerate 段,约 880-941 行)
- Modify: `apps/web/messages/en.json`(ImageGenerate 段,约 880-941 行)

先只加键不删键:删 `paramsSummary` 要等 Task 3 组件同步、删 `recoveryHint`/`resultTitle` 要等 Task 5,避免中间态缺键。

- [ ] **Step 1: zh.json 的 `ImageGenerate` 对象内、`"quotaRemaining"` 一行之前插入新键**

```json
    "templateWallTitle": "灵感模板",
    "templateWallEmpty": "在左侧输入提示词开始创作。",
    "thumbnailLabel": "结果缩略图",
    "selectResult": "查看第 {index} 张",
```

- [ ] **Step 2: en.json 的 `ImageGenerate` 对象内、`"quotaRemaining"` 一行之前插入新键**

```json
    "templateWallTitle": "Idea templates",
    "templateWallEmpty": "Describe your prompt on the left to start creating.",
    "thumbnailLabel": "Result thumbnails",
    "selectResult": "View image {index}",
```

- [ ] **Step 3: 校验 JSON 合法**

```bash
node -e "JSON.parse(require('fs').readFileSync('apps/web/messages/zh.json','utf8')); JSON.parse(require('fs').readFileSync('apps/web/messages/en.json','utf8')); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 4: 提交**

```bash
git add apps/web/messages/zh.json apps/web/messages/en.json
git commit -m "feat(ai-image): 新增工作台布局所需文案键"
```

---

### Task 2: 导出 PresetCard 并新建 TemplateWall 组件

**Files:**
- Modify: `apps/web/src/components/tools/image-generate-options.tsx:194-231`(PresetCard)
- Create: `apps/web/src/components/tools/image-generate-template-wall.tsx`
- Test: `apps/web/src/components/tools/__tests__/image-generate-template-wall.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/components/tools/__tests__/image-generate-template-wall.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import { ImageGenerateTemplateWall } from '../image-generate-template-wall';

const PRESETS = [
  {
    id: 'preset-1',
    title: 'Guided science picture book',
    prompt: 'Create a high-finish guided science picture book illustration.',
    imageStorageKey: 'science-picture-book.jpg',
    sortOrder: 0,
  },
  {
    id: 'preset-2',
    title: 'Mind map & knowledge graph',
    prompt: 'Generate a mind-map infographic, educational-poster style.',
    sortOrder: 1,
  },
];

function renderWall(presets = PRESETS, disabled = false) {
  const onPick = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ImageGenerateTemplateWall
        presets={presets}
        disabled={disabled}
        onPick={onPick}
      />
    </NextIntlClientProvider>
  );
  return onPick;
}

describe('ImageGenerateTemplateWall', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_S3_PUBLIC_URL', 'http://minio.test:9000');
  });

  it('renders the wall title and one button card per preset', () => {
    renderWall();

    expect(screen.getByText('Idea templates')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Guided science picture book/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Mind map & knowledge graph/ })
    ).toBeInTheDocument();
  });

  it('fills the prompt through onPick when a card is clicked', () => {
    const onPick = renderWall();

    fireEvent.click(
      screen.getByRole('button', { name: /Guided science picture book/ })
    );

    expect(onPick).toHaveBeenCalledWith(PRESETS[0]!.prompt);
  });

  it('renders the MinIO example image for presets that ship one', () => {
    renderWall();

    const alt = en.ImageGenerate.presetExampleAlt.replace(
      '{title}',
      PRESETS[0]!.title
    );
    expect(screen.getByAltText(alt)).toHaveAttribute(
      'src',
      'http://minio.test:9000/presets/science-picture-book.jpg'
    );
  });

  it('degrades to a plain hint when no presets are available', () => {
    renderWall([]);

    expect(screen.getByText('Describe your prompt on the left to start creating.')).toBeInTheDocument();
    expect(screen.queryByText('Idea templates')).not.toBeInTheDocument();
  });

  it('disables every card while busy', () => {
    renderWall(PRESETS, true);

    expect(
      screen.getByRole('button', { name: /Guided science picture book/ })
    ).toBeDisabled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd apps/web && bunx vitest run src/components/tools/__tests__/image-generate-template-wall.test.tsx
```

Expected: FAIL — `Cannot find module '../image-generate-template-wall'`

- [ ] **Step 3: 修改 image-generate-options.tsx —— 把 PresetCard 从 `<li>` 包裹改为可导出的纯卡片组件**

将 `image-generate-options.tsx` 中 `PresetCard`(原 194-231 行)整体替换为:

```tsx
/**
 * 单个模板卡片。示例图独立成组件是为了让 onError 的 failed state 落在卡片内:
 * 一张图挂了只影响这张卡,不会连带别的模板退化成纯文本。
 * 弹窗与空态模板墙共用,调用方自己决定列表结构(<li> 包裹)。
 */
export function PresetCard({
  preset,
  onPick,
  disabled = false,
}: {
  preset: ImageGeneratePresetDto;
  onPick: (prompt: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('ImageGenerate');
  const [failed, setFailed] = useState(false);
  const url = presetImageUrl(preset.imageStorageKey);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(preset.prompt)}
      className="flex w-full flex-col gap-1 rounded-md border border-border p-3 text-left transition-colors hover:border-foreground hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
    >
      {url && !failed ? (
        // 示例图让用户一眼看到这套模板的成品长什么样;图存 MinIO presets 匿名只读桶,
        // 拉不到就退化成纯文本卡片而不是留个碎图占位。
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={t('presetExampleAlt', { title: preset.title })}
          loading="lazy"
          onError={() => setFailed(true)}
          className="aspect-[4/3] w-full rounded-sm border border-border object-cover"
        />
      ) : null}
      <span className="text-sm font-medium">{preset.title}</span>
      <span className="line-clamp-3 text-xs text-muted-foreground">
        {preset.prompt}
      </span>
    </button>
  );
}
```

同时把 `ImageGeneratePromptField` 弹窗里对 PresetCard 的调用处(原 `<PresetCard key={preset.id} ... />`)改为:

```tsx
<li key={preset.id}>
  <PresetCard
    preset={preset}
    onPick={prompt => {
      onChange({ ...value, prompt });
      setPresetOpen(false);
    }}
  />
</li>
```

- [ ] **Step 4: 新建 `apps/web/src/components/tools/image-generate-template-wall.tsx`**

```tsx
'use client';

import { useTranslations } from 'next-intl';
import type { ImageGeneratePresetDto } from '@/hooks/api/types';
import { PresetCard } from './image-generate-options';

interface ImageGenerateTemplateWallProps {
  presets: ImageGeneratePresetDto[];
  disabled?: boolean;
  onPick: (prompt: string) => void;
}

/**
 * 工作台空态的灵感模板卡片墙(复用 GET /tasks/image-generate/presets)。
 * presets 为空或接口失败时退化为一句引导文案:空弹窗/空墙都比不上明确说「去左边输入」。
 */
export function ImageGenerateTemplateWall({
  presets,
  disabled = false,
  onPick,
}: ImageGenerateTemplateWallProps) {
  const t = useTranslations('ImageGenerate');

  if (presets.length === 0) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">{t('templateWallEmpty')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {t('templateWallTitle')}
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {presets.map(preset => (
          <li key={preset.id}>
            <PresetCard preset={preset} onPick={onPick} disabled={disabled} />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd apps/web && bunx vitest run src/components/tools/__tests__/image-generate-template-wall.test.tsx
```

Expected: PASS(5 个用例)

- [ ] **Step 6: 回归弹窗相关旧测试**

```bash
cd apps/web && bunx vitest run "src/app/[locale]/(app)/image/generate/__tests__/page.test.tsx" -t "preset"
```

Expected: PASS(3 个 dialog/preset 用例不变)

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/components/tools/image-generate-options.tsx apps/web/src/components/tools/image-generate-template-wall.tsx apps/web/src/components/tools/__tests__/image-generate-template-wall.test.tsx
git commit -m "feat(ai-image): 新增空态灵感模板卡片墙组件并导出 PresetCard"
```

---

### Task 3: 参数区去折叠、提示词宽度适配左面板

**Files:**
- Modify: `apps/web/src/components/tools/image-generate-options.tsx`(ImageGenerateParamsFields 与 ImageGeneratePromptField)
- Modify: `apps/web/messages/zh.json`、`apps/web/messages/en.json`(删 `paramsSummary`)

- [ ] **Step 1: 运行生图页全量旧测试确认基线全绿**

```bash
cd apps/web && bunx vitest run "src/app/[locale]/(app)/image/generate/__tests__/page.test.tsx"
```

Expected: PASS(改动前基线;若有环境性失败先停下来排查)

- [ ] **Step 2: 替换 ImageGenerateParamsFields —— 去掉 details 折叠**

将 `ImageGenerateParamsFields`(原 318-392 行)整体替换为:

```tsx
export function ImageGenerateParamsFields({
  value,
  onChange,
  disabled = false,
}: ImageGenerateFieldProps) {
  const t = useTranslations('ImageGenerate');

  // 工作台左面板空间有限,参数组直接平铺展开;尺寸/数量影响真实计费,本就不该折叠。
  return (
    <div className="space-y-5">
      <RadioRow
        name="image-generate-size"
        legend={t('sizeLabel')}
        selected={value.size}
        disabled={disabled}
        options={SIZES.map(size => ({
          value: size,
          label: t(`sizes.${size}`),
        }))}
        onSelect={size => onChange({ ...value, size })}
      />

      <RadioRow
        name="image-generate-quality"
        legend={t('qualityLabel')}
        selected={value.quality}
        disabled={disabled}
        options={QUALITIES.map(quality => ({
          value: quality,
          label: t(`qualities.${quality}`),
        }))}
        onSelect={quality => onChange({ ...value, quality })}
      />

      <RadioRow
        name="image-generate-style"
        legend={t('styleLabel')}
        selected={value.style ?? 'none'}
        disabled={disabled}
        options={[
          { value: 'none' as const, label: t('styles.none') },
          ...STYLES.map(style => ({
            value: style,
            label: t(`styles.${style}`),
          })),
        ]}
        onSelect={style =>
          onChange({
            ...value,
            style:
              style === 'none' ? undefined : (style as ImageGenerateStyle),
          })
        }
      />

      <RadioRow
        name="image-generate-count"
        legend={t('countLabel')}
        selected={value.count}
        disabled={disabled}
        options={COUNTS.map(count => ({
          value: count,
          label: String(count),
        }))}
        onSelect={count => onChange({ ...value, count })}
      />
    </div>
  );
}
```

- [ ] **Step 3: 适配 ImageGeneratePromptField 的宽度 —— 面板已限宽,去掉 max-w-2xl**

`ImageGeneratePromptField` 中 textarea 的 className 改为(去掉 `max-w-2xl`):

```tsx
        className="min-h-40 w-full rounded-md border bg-background p-3 text-sm leading-relaxed disabled:cursor-not-allowed disabled:opacity-60"
```

字数计数的 `<p>`(id 为 `PROMPT_COUNTER_ID`)className 改为(去掉 `max-w-2xl`):

```tsx
        className="text-right font-mono text-xs tabular-nums text-muted-foreground"
```

同时删除 textarea 上方注释里「限宽到 max-w-2xl…」那两行(该理由已失效),换成:

```tsx
      {/* 宽度交给左面板约束,这里不再自限 max-w-2xl。 */}
```

- [ ] **Step 4: 删除两个 messages 文件里的 `paramsSummary` 键**

zh.json 删除行:

```json
    "paramsSummary": "更多参数",
```

en.json 删除行:

```json
    "paramsSummary": "More options",
```

- [ ] **Step 5: 运行生图页全量测试确认无回归**

```bash
cd apps/web && bunx vitest run "src/app/[locale]/(app)/image/generate/__tests__/page.test.tsx"
```

Expected: PASS(没有任何旧测试依赖 details/summary)

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/tools/image-generate-options.tsx apps/web/messages/zh.json apps/web/messages/en.json
git commit -m "refactor(ai-image): 参数组去折叠平铺并适配左面板宽度"
```

---

### Task 4: 新建 Workbench 布局骨架组件

**Files:**
- Create: `apps/web/src/components/tools/image-generate-workbench.tsx`
- Test: `apps/web/src/components/tools/__tests__/image-generate-workbench.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/components/tools/__tests__/image-generate-workbench.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageGenerateWorkbench } from '../image-generate-workbench';

describe('ImageGenerateWorkbench', () => {
  it('renders the title, the panel slot and the main slot', () => {
    render(
      <ImageGenerateWorkbench
        title="AI image generation"
        panel={<p>panel content</p>}
        panelFooter={<button type="button">Generate</button>}
      >
        <p>main content</p>
      </ImageGenerateWorkbench>
    );

    expect(
      screen.getByRole('heading', { name: 'AI image generation' })
    ).toBeInTheDocument();
    expect(screen.getByText('panel content')).toBeInTheDocument();
    expect(screen.getByText('main content')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Generate' })
    ).toBeInTheDocument();
  });

  it('keeps the panel footer outside the scrollable panel area', () => {
    const { container } = render(
      <ImageGenerateWorkbench
        title="AI image generation"
        panel={<p>panel content</p>}
        panelFooter={<button type="button">Generate</button>}
      >
        <p>main content</p>
      </ImageGenerateWorkbench>
    );

    // 可滚动区(overflow-y-auto)与底部固定区必须是兄弟节点,按钮才不会跟着参数一起滚走。
    const scrollable = container.querySelector('.lg\\:overflow-y-auto');
    expect(scrollable).not.toBeNull();
    expect(scrollable!.textContent).toContain('panel content');
    expect(scrollable!.textContent).not.toContain('Generate');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd apps/web && bunx vitest run src/components/tools/__tests__/image-generate-workbench.test.tsx
```

Expected: FAIL — `Cannot find module '../image-generate-workbench'`

- [ ] **Step 3: 新建 `apps/web/src/components/tools/image-generate-workbench.tsx`**

```tsx
import type { ReactNode } from 'react';

interface ImageGenerateWorkbenchProps {
  title: string;
  /** 左面板主体:参数字段。lg 及以上固定 360px 宽,超高时面板内部滚动。 */
  panel: ReactNode;
  /** 左面板底部固定区:额度行与生成按钮,不随参数滚动。 */
  panelFooter: ReactNode;
  /** 右主区:页面按 空态/生成中/结果 三态传入。 */
  children: ReactNode;
}

/**
 * AI 生图工作台布局骨架(参考设计稿 4a9731b8 的左参数/右预览结构)。
 *
 * 只服务生图页,不做通用抽象:lg 以下右主区在上、参数面板在下自然堆叠;
 * lg 及以上左面板 sticky + 内部滚动,生成按钮吸面板底部。
 */
export function ImageGenerateWorkbench({
  title,
  panel,
  panelFooter,
  children,
}: ImageGenerateWorkbenchProps) {
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <h1 className="text-xl font-medium tracking-tight">{title}</h1>
      <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-4 self-start rounded-md border border-border p-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)]">
          <div className="min-h-0 flex-1 space-y-5 lg:overflow-y-auto lg:pr-1">
            {panel}
          </div>
          <div className="shrink-0 space-y-3">{panelFooter}</div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd apps/web && bunx vitest run src/components/tools/__tests__/image-generate-workbench.test.tsx
```

Expected: PASS(2 个用例)

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/tools/image-generate-workbench.tsx apps/web/src/components/tools/__tests__/image-generate-workbench.test.tsx
git commit -m "feat(ai-image): 新增工作台布局骨架组件"
```

---

### Task 5: 重写 page.tsx 为工作台布局并适配测试

**Files:**
- Rewrite: `apps/web/src/app/[locale]/(app)/image/generate/page.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/image/generate/__tests__/page.test.tsx`
- Modify: `apps/web/messages/zh.json`、`apps/web/messages/en.json`(删 `recoveryHint`、`resultTitle`)

- [ ] **Step 1: 先改测试(红 → 绿的“红”半程)**

`page.test.tsx` 做以下修改:

(a) **删除**这 3 个用例(对应被移除的步骤条/信任条/双列网格):

- `hides the upload step for text-to-image and shows it for image-to-image`
- `describes recovery neutrally instead of announcing a failure`
- `lays multiple results out in two columns`

(b) **替换** `keeps every preview URL alive while multiple tasks complete` 为下面的缩略切换用例(URL 存活断言保留):

```tsx
  it('switches the main preview through the thumbnail strip without revoking urls', async () => {
    mocks.groupProgress.mockReturnValue({
      items: [
        {
          taskId: 't1',
          status: 'completed',
          progress: 100,
          outputFileId: 'f1',
        },
        {
          taskId: 't2',
          status: 'completed',
          progress: 100,
          outputFileId: 'f2',
        },
      ],
      completedCount: 2,
      failedCount: 0,
      settled: true,
      query: { isError: false },
    });
    let counter = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => `blob:preview-${(counter += 1)}`),
      configurable: true,
      writable: true,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['img'], { type: 'image/png' })),
      })
    );

    renderPage();

    await act(async () => {
      await mocks.onItemCompleted('t1', 'f1');
    });
    await act(async () => {
      await mocks.onItemCompleted('t2', 'f2');
    });

    // 默认大图是第一张;第一张的 URL 必须在第二张完成后仍然存活。
    expect(await screen.findByAltText('Image 1')).toHaveAttribute(
      'src',
      'blob:preview-1'
    );
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    // 缩略条切换到第二张,大图随 selectedIndex 变化。
    fireEvent.click(screen.getByRole('button', { name: 'View image 2' }));
    expect(await screen.findByAltText('Image 2')).toHaveAttribute(
      'src',
      'blob:preview-2'
    );
    expect(screen.queryByAltText('Image 1')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });
```

(c) **新增**空态模板墙用例(放在 `fills the prompt field when a preset template is chosen from the dialog` 之前):

```tsx
  it('shows the template wall in the empty state and fills the prompt on pick', () => {
    renderPage();

    expect(screen.getByText('Idea templates')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /Guided science picture book/ })
    );
    expect(screen.getByLabelText('Prompt')).toHaveValue(PRESETS[0]!.prompt);
  });
```

- [ ] **Step 2: 运行测试确认新用例失败**

```bash
cd apps/web && bunx vitest run "src/app/[locale]/(app)/image/generate/__tests__/page.test.tsx"
```

Expected: FAIL — 新用例找不到 `Idea templates`(页面还是旧布局),其余被删用例消失。

- [ ] **Step 3: 整体重写 page.tsx**

用下面的完整内容替换 `apps/web/src/app/[locale]/(app)/image/generate/page.tsx`(提交逻辑与 hooks 链路与旧版一致,仅渲染层重构;原有行内注释全部保留或迁移):

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  useCreateTask,
  useImageGeneratePresets,
  useImageGenerateProviders,
  useImageGenerateQuota,
} from '@/hooks/api/use-tasks';
import { useUploadFile } from '@/hooks/api/use-files';
import { useTaskGroupProgress } from '@/hooks/api/use-task-group-progress';
import { useTaskOutputPreviews } from '@/hooks/api/use-task-output';
import { useRequireLogin } from '@/hooks/use-require-login';
import {
  ImageGenerateModeField,
  ImageGenerateParamsFields,
  ImageGeneratePromptField,
  ImageGenerateProviderField,
  type ImageGenerateDraft,
} from '@/components/tools/image-generate-options';
import { ImageGenerateCompare } from '@/components/tools/image-generate-compare';
import { ImageGenerateTemplateWall } from '@/components/tools/image-generate-template-wall';
import { ImageGenerateWorkbench } from '@/components/tools/image-generate-workbench';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { useObjectUrl } from '@/hooks/use-object-url';
import { getImageUploadMaxFileSize } from '@/lib/tools/image-limits';

const TOOL_HREF = '/image/generate';

const REFERENCE_ACCEPT = {
  'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.avif'],
};

const ERROR_MESSAGE_KEY: Record<string, string> = {
  AI_IMAGE_DAILY_LIMIT_EXCEEDED: 'quotaExceeded',
  AI_IMAGE_CONTENT_REJECTED: 'contentRejected',
  AI_IMAGE_NOT_CONFIGURED: 'notConfigured',
  AI_IMAGE_PROVIDER_UNAVAILABLE: 'providerUnavailable',
};

const INITIAL_DRAFT: ImageGenerateDraft = {
  mode: 'text_to_image',
  prompt: '',
  size: '1024x1024',
  quality: 'high',
  count: 1,
};

/** 失败提示统一走一个通道:key 是文案,code 只有服务端错误才有。 */
interface Failure {
  key: string;
  code?: string;
}

function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'AI_IMAGE_GENERATION_FAILED';
}

export default function ImageGeneratePage() {
  const t = useTranslations('ImageGenerate');
  const tShared = useTranslations('ToolsShared');
  const { session, requireLogin } = useRequireLogin();
  const createTask = useCreateTask();
  const quota = useImageGenerateQuota();
  const providersQuery = useImageGenerateProviders();
  const presetsQuery = useImageGeneratePresets();
  const uploadFile = useUploadFile();

  const [draft, setDraft] = useState<ImageGenerateDraft>(INITIAL_DRAFT);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  // 提交那一刻用到的参考图,单独存一份:用户在看结果时换图不该悄悄改掉对比的「前」。
  const [comparedFile, setComparedFile] = useState<File | null>(null);
  const [taskIds, setTaskIds] = useState<string[]>([]);
  // 结果态下大图展示第几张;新一轮生成时在 reset 里归零。
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // 产物取回(状态 completed 之后还要再下载一次 blob)收在 hook 里,页面只读 previews/pending。
  const output = useTaskOutputPreviews();

  // 来源列表拉取失败或还没回来时按「单来源」渲染:选择器不出现,providerId 不下发,
  // 服务端仍会用配置里的第一个来源,页面不会因为这个附加接口而不可用。
  const providers = providersQuery.data ?? [];
  const selectedProvider =
    providers.find(item => item.id === draft.providerId) ?? providers[0];
  // 没拿到来源信息时不预先禁掉图生图:真正的能力校验在服务端。
  const editSupported =
    !selectedProvider || selectedProvider.capabilities.includes('edit');

  const sourceUrl = useObjectUrl(sourceFile);
  const comparedUrl = useObjectUrl(comparedFile);
  const maxFileSize = getImageUploadMaxFileSize(session);

  // 切回文生图时丢掉参考图:留着它会让「模式=文生图 却带着 inputFileIds」这种
  // schema 会直接拒的组合有机会被提交。
  const changeDraft = (next: ImageGenerateDraft) => {
    if (next.mode !== 'image_to_image') {
      setSourceFile(null);
      setComparedFile(null);
    }
    setDraft(next);
  };

  const { items, settled, query } = useTaskGroupProgress(taskIds, {
    onItemCompleted: output.load,
  });

  // useTaskGroupProgress 的 queryFn 用 Promise.all 并发取 N 个状态,任一任务永久失败
  // (例如 taskId 返回 404)会让整个 query 进 error、settled 永不为 true、其余回调永不
  // 触发。必须消费 query.isError,否则永久失败会表现为「进度条转到底也不结束」。
  const groupErrored =
    taskIds.length > 0 && !settled && Boolean(query?.isError);
  const inFlight = taskIds.length > 0 && !settled && !groupErrored;

  const reset = () => {
    setTaskIds([]);
    setFailure(null);
    setSelectedIndex(0);
    output.reset();
  };

  const submit = async () => {
    if (requireLogin(TOOL_HREF)) return;
    const needsReference = draft.mode === 'image_to_image';
    if (needsReference && !sourceFile) {
      setFailure({ key: 'sourceRequired' });
      return;
    }

    reset();
    setSubmitting(true);

    // 参考图只上传一次,N 个任务共用同一个 fileId:同一张图重复上传既费额度也费带宽。
    let inputFileIds: string[] = [];
    if (needsReference && sourceFile) {
      try {
        // upload 走 multipart,OpenAPI 里 201 没有 JSON content schema,openapi-fetch
        // 把返回类型推成 undefined,这里先转 unknown 再断言,与 use-files 里
        // `data as unknown as FileListResponse` 同一处理方式。
        const uploaded = (await uploadFile.mutateAsync(
          sourceFile
        )) as unknown as {
          id: string;
        };
        inputFileIds = [uploaded.id];
        setComparedFile(sourceFile);
      } catch {
        setFailure({ key: 'uploadFailed' });
        setSubmitting(false);
        return;
      }
    } else {
      setComparedFile(null);
    }

    const created: string[] = [];
    let failureCode: string | null = null;

    // 串行(而非 Promise.all)创建:createTask 只是入队(廉价 insert),真正生成在
    // worker 并发跑,N 张只多几次入队往返。串行才能让配额判定确定——每次都看到前一次扣减
    // 后的计数,第一个 AI_IMAGE_DAILY_LIMIT_EXCEEDED 能干净地 break。Promise.all 无法
    // break 且会与配额记账竞态,切勿"优化"成并发。
    for (let index = 0; index < draft.count; index += 1) {
      try {
        const task = await createTask.mutateAsync({
          type: 'image_generate',
          inputFileIds,
          inputConfig: {
            mode: draft.mode,
            prompt: draft.prompt.trim(),
            size: draft.size,
            quality: draft.quality,
            ...(draft.style ? { style: draft.style } : {}),
            ...(draft.providerId ? { providerId: draft.providerId } : {}),
          },
        });
        created.push(task.id);
      } catch (error) {
        // 部分超额不整批回滚:已建出的任务继续跑,剩下的报错。
        failureCode = errorCodeOf(error);
        break;
      }
    }

    setTaskIds(created);
    setFailure(
      failureCode
        ? { key: ERROR_MESSAGE_KEY[failureCode] ?? 'failed', code: failureCode }
        : null
    );
    setSubmitting(false);
  };

  const needsReference = draft.mode === 'image_to_image';
  const referenceMissing = needsReference && !sourceFile;

  // 任务 settled 只说明服务端出图了,页面还要再下载一次 blob 才有东西可看。缺 entry
  // 视为 loading:onItemCompleted 与 items 更新同一轮,少了这个兜底会漏出一帧空窗,
  // 表现就是按钮先恢复、结果区空着、图片随后突然出现。
  const fetchingResults =
    taskIds.length > 0 &&
    items.some(
      item =>
        item.status === 'completed' &&
        (output.previews[item.taskId]?.state ?? 'loading') === 'loading'
    );
  const busy = submitting || inFlight || fetchingResults;

  const averageProgress =
    items.length > 0
      ? items.reduce((sum, item) => sum + (item.progress ?? 0), 0) /
        items.length
      : 0;

  // 大图位:已完成的任务里按 selectedIndex 取,越界时夹回最后一张。
  const completedItems = items.filter(item => item.status === 'completed');
  const activeIndex = Math.min(
    selectedIndex,
    Math.max(completedItems.length - 1, 0)
  );
  const activeItem = completedItems[activeIndex];
  const activeUrl = activeItem
    ? output.previews[activeItem.taskId]?.url
    : undefined;
  // 图生图给滑动对比:参考图和结果分处页面两端时,看不出到底改了什么。
  const showCompare = Boolean(comparedUrl && activeUrl);

  // 右主区空态:还没提交过、也没有失败提示,才把版面交给模板墙。
  const showWall = !submitting && taskIds.length === 0 && !failure;

  const pickPreset = (prompt: string) => {
    changeDraft({ ...draft, prompt });
    // 填完把焦点交回输入框,用户可以立刻继续改写模板。
    document.getElementById('image-generate-prompt')?.focus();
  };

  return (
    <ImageGenerateWorkbench
      title={t('title')}
      panel={
        <>
          {/* 左面板顺序:模式 →(图生图)参考图 → 提示词 → 参数组 → 来源(多来源时)。 */}
          <ImageGenerateModeField
            value={draft}
            onChange={changeDraft}
            disabled={busy}
            editSupported={editSupported}
          />

          {needsReference && (
            <div className="space-y-3">
              <p className="text-sm font-medium">{t('sourceLabel')}</p>
              <FileDropzone
                accept={REFERENCE_ACCEPT}
                maxSize={maxFileSize}
                density="compact"
                disabled={busy}
                hint={t('sourceHint')}
                onDrop={files => {
                  const [next] = files;
                  if (next) setSourceFile(next);
                }}
              />
              {sourceUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sourceUrl}
                  alt={t('sourcePreviewAlt')}
                  className="max-h-48 w-auto rounded-md border border-border"
                />
              )}
            </div>
          )}

          <ImageGeneratePromptField
            value={draft}
            onChange={changeDraft}
            disabled={busy}
            presets={presetsQuery.data ?? []}
          />

          <ImageGenerateParamsFields
            value={draft}
            onChange={changeDraft}
            disabled={busy}
          />

          <ImageGenerateProviderField
            value={draft}
            onChange={changeDraft}
            disabled={busy}
            providers={providers}
          />
        </>
      }
      panelFooter={
        <>
          {/* 已登录才展示当日额度:free = 0,匿名走登录跳转,没必要显示一行 0。 */}
          {session && quota.data && (
            <p className="font-mono text-xs tabular-nums text-muted-foreground">
              {t('quotaRemaining', {
                remaining: String(quota.data.remaining),
                limit: String(quota.data.limit),
              })}
            </p>
          )}

          {/* 主操作吸面板底部:参数区怎么滚,按钮始终在手边。 */}
          <button
            type="button"
            className="h-10 w-full rounded-md bg-foreground font-mono text-sm text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={draft.prompt.trim().length === 0 || referenceMissing || busy}
            onClick={submit}
          >
            {busy ? t('generating') : t('submit')}
          </button>
        </>
      }
    >
      {showWall ? (
        <ImageGenerateTemplateWall
          presets={presetsQuery.data ?? []}
          disabled={busy}
          onPick={pickPreset}
        />
      ) : (
        <div className="space-y-5">
          {/* 生成中:进度条;取回图片的空窗也不能让进度条先消失。 */}
          {(inFlight || fetchingResults) && (
            <ProcessingProgress
              progress={averageProgress}
              stage={inFlight ? 'generating' : undefined}
              label={!inFlight && fetchingResults ? t('resultFetching') : undefined}
            />
          )}

          {failure && (
            <FailureRecoveryPanel
              message={t(failure.key)}
              errorCode={failure.code}
              onRetry={submit}
            />
          )}

          {groupErrored && (
            <FailureRecoveryPanel message={t('failed')} onRetry={submit} />
          )}

          {activeItem && (
            <section className="space-y-3">
              <div className="flex min-h-64 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/20 p-2">
                {!activeUrl ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex h-64 w-full items-center justify-center"
                  >
                    <span className="animate-pulse font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      {t('resultFetching')}
                    </span>
                  </div>
                ) : showCompare ? (
                  <div className="w-full">
                    <ImageGenerateCompare
                      beforeUrl={comparedUrl!}
                      afterUrl={activeUrl}
                      title={t('compareTitle')}
                    />
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={activeUrl}
                    alt={t('resultMeta', { index: activeIndex + 1 })}
                    className="max-h-[32rem] w-auto rounded-md"
                  />
                )}
              </div>

              {activeUrl && (
                <a
                  href={activeUrl}
                  download={`ai-image-${activeIndex + 1}.png`}
                  className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm hover:bg-muted/40"
                >
                  {tShared('download')}
                </a>
              )}

              {/* 多张结果才有缩略条:单张大图不需要「切换到自己」。 */}
              {completedItems.length > 1 && (
                <div
                  role="group"
                  aria-label={t('thumbnailLabel')}
                  className="flex flex-wrap gap-2"
                >
                  {completedItems.map((item, index) => {
                    const thumbUrl = output.previews[item.taskId]?.url;
                    return (
                      <button
                        key={item.taskId}
                        type="button"
                        aria-label={t('selectResult', { index: index + 1 })}
                        aria-pressed={index === activeIndex}
                        disabled={busy || !thumbUrl}
                        onClick={() => setSelectedIndex(index)}
                        className={`overflow-hidden rounded-md border p-0.5 ${
                          index === activeIndex
                            ? 'border-foreground'
                            : 'border-transparent hover:border-border'
                        }`}
                      >
                        {thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumbUrl}
                            alt=""
                            className="h-16 w-16 rounded-sm object-cover"
                          />
                        ) : (
                          <span className="block h-16 w-16 animate-pulse rounded-sm bg-muted" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* 逐项异常:生成失败的任务、取回失败的任务。取回失败给「重试取回」,
              不是重新生成 —— 图已经出好了,再走一遍生成会白扣一次配额。 */}
          {items.map(item => {
            if (item.status === 'failed') {
              return (
                <FailureRecoveryPanel
                  key={item.taskId}
                  message={
                    t(ERROR_MESSAGE_KEY[item.errorCode ?? ''] ?? 'failed')
                  }
                  errorCode={item.errorCode}
                  onRetry={submit}
                />
              );
            }
            if (
              item.status === 'completed' &&
              output.previews[item.taskId]?.state === 'error'
            ) {
              return (
                <FailureRecoveryPanel
                  key={item.taskId}
                  message={t('resultFetchFailed')}
                  onRetry={() =>
                    void output.load(item.taskId, item.outputFileId ?? '')
                  }
                />
              );
            }
            return null;
          })}
        </div>
      )}
    </ImageGenerateWorkbench>
  );
}
```

- [ ] **Step 4: 删除两个 messages 文件里已无使用的键**

zh.json 删除:

```json
    "recoveryHint": "可随时重试，失败的生成不占用当日额度。",
    "resultTitle": "生成结果",
```

en.json 删除:

```json
    "recoveryHint": "Retry anytime — failed generations do not use up your daily quota.",
    "resultTitle": "Results",
```

删除前先确认无其他引用(其他工具页的 `resultTitle` 是各自命名空间的同名键,不受影响):

```bash
grep -rn "recoveryHint\|resultTitle" "apps/web/src/app/[locale]/(app)/image/generate"
```

Expected: 仅命中 page.tsx 中已被本次重写移除的引用(重写后应无输出)。

- [ ] **Step 5: 运行生图页全量测试**

```bash
cd apps/web && bunx vitest run "src/app/[locale]/(app)/image/generate/__tests__/page.test.tsx"
```

Expected: PASS(删 3 个旧用例后,其余包括 `stays busy…`、`retries fetching…`、`compares the reference…` 全部通过;若 `stays busy` 失败,检查大图占位与 ProcessingProgress 的 label 是否都渲染了 `resultFetching` 文案)

- [ ] **Step 6: 运行组件测试确认无回归**

```bash
cd apps/web && bunx vitest run src/components/tools/__tests__/image-generate-template-wall.test.tsx src/components/tools/__tests__/image-generate-workbench.test.tsx "src/components/tools/__tests__/tool-experience.test.tsx"
```

Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add "apps/web/src/app/[locale]/(app)/image/generate/page.tsx" "apps/web/src/app/[locale]/(app)/image/generate/__tests__/page.test.tsx" apps/web/messages/zh.json apps/web/messages/en.json
git commit -m "feat(ai-image): 生图页改版为左参数右预览的工作台布局"
```

---

### Task 6: 全量验证与文档核对

**Files:**
- 只读核对:`README.md`、`PROJECT_SPECS.md`(预期无需改动:功能与接口无变化,仅页面布局)

- [ ] **Step 1: 运行 web 全量测试**

```bash
bun --cwd apps/web test
```

Expected: 全部 PASS

- [ ] **Step 2: lint**

```bash
cd apps/web && bun run lint
```

Expected: 0 error(若脚本名不同,先 `cat apps/web/package.json` 确认 lint script)

- [ ] **Step 3: 核对文档是否有布局性描述需要更新**

```bash
grep -n "image/generate" PROJECT_SPECS.md README.md | head -20
```

预期:现有描述是能力层面(服务端任务、需登录、配额),不涉及布局,无需修改;若发现明确的单列布局描述则顺手更新该行。

- [ ] **Step 4: 手工冒烟(可选但推荐)**

启动 `bun run services:up` + `bun run dev`,登录后访问 http://localhost:3000/zh/image/generate :
1. 空态右主区出现模板墙,点卡片提示词填入并聚焦;
2. 生成 2 张,完成后大图 + 缩略条,点第二张缩略切换;
3. 图生图出图后预览位是滑动对比;
4. 左面板参数多时内部滚动,生成按钮不滚走;
5. 窗口缩到 lg 以下,布局纵向堆叠。

- [ ] **Step 5: 如有文档改动则提交**

```bash
git add -A
git commit -m "docs(ai-image): 同步工作台布局改版说明"
```

(无文档改动则跳过)
