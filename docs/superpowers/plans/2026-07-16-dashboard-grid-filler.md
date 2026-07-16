# Dashboard 快捷工具网格空单元修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:**
消除 Dashboard 桌面三列快捷工具网格最后一行的浅灰空区，同时保留现有分隔线、卡片密度和移动端布局。

**Architecture:** `ToolCatalogGrid`
在真实工具链接之后按当前工具数量追加仅用于布局的响应式填充单元。两列和三列断点分别计算填充数量，填充单元隐藏于其他断点并设置
`aria-hidden`，不进入交互或可访问性树。

**Tech Stack:** React 18、Next.js 14、Tailwind CSS 4、Vitest、Testing Library、Playwright

---

## 任务 1：补齐响应式网格填充并验证截图

**文件：**

- 修改：`apps/web/src/components/tools/__tests__/tool-experience.test.tsx`
- 修改：`apps/web/src/components/tools/tool-catalog-grid.tsx`
- 验证：`artifacts/screenshots/public-beta-dashboard-desktop.png`
- 验证：`artifacts/screenshots/public-beta-dashboard-mobile.png`

- [x] **步骤 1：编写失败测试**

在 `tool-experience.test.tsx` 的 `ToolCatalogGrid` 测试后增加：

```tsx
it('fills incomplete responsive grid rows without adding links', () => {
  const { container } = renderWithIntl(
    <ToolCatalogGrid
      groups={[
        {
          key: 'single-tool',
          titleKey: 'ToolCatalog.categories.imageOptimize',
          descriptionKey: 'ToolCatalog.categories.imageOptimizeDescription',
          tools: imageTools.slice(0, 1),
        },
      ]}
    />
  );

  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(container.querySelectorAll('[data-tool-grid-filler="two-column"]')).toHaveLength(1);
  expect(container.querySelectorAll('[data-tool-grid-filler="three-column"]')).toHaveLength(2);
  for (const filler of container.querySelectorAll('[data-tool-grid-filler]')) {
    expect(filler).toHaveAttribute('aria-hidden', 'true');
    expect(filler).toHaveClass('bg-card');
  }
});

it('adds only three-column fillers for the ten dashboard tools', () => {
  const { container } = renderWithIntl(
    <ToolCatalogGrid
      groups={[
        {
          key: 'dashboard-tools',
          titleKey: 'ToolCatalog.categories.imageOptimize',
          descriptionKey: 'ToolCatalog.categories.imageOptimizeDescription',
          tools: recommendedTools,
        },
      ]}
    />
  );

  expect(container.querySelectorAll('[data-tool-grid-filler="two-column"]')).toHaveLength(0);
  expect(container.querySelectorAll('[data-tool-grid-filler="three-column"]')).toHaveLength(2);
});
```

同步把元数据导入改为：

```typescript
import { imageTools, recommendedTools } from '@/lib/tools/tool-metadata';
```

- [x] **步骤 2：运行测试并确认正确失败**

运行：

```bash
bun --cwd apps/web test src/components/tools/__tests__/tool-experience.test.tsx
```

预期：两个新测试失败，收到的填充单元数量为 0；既有测试保持通过。

- [x] **步骤 3：实现最小响应式填充**

在 `tool-catalog-grid.tsx` 中增加：

```tsx
function ToolGridFillers({ toolCount }: { toolCount: number }) {
  const twoColumnCount = toolCount % 2;
  const threeColumnCount = (3 - (toolCount % 3)) % 3;

  return (
    <>
      {Array.from({ length: twoColumnCount }, (_, index) => (
        <div
          key={`two-column-${index}`}
          aria-hidden="true"
          data-tool-grid-filler="two-column"
          className="hidden min-h-[132px] bg-card sm:block xl:hidden"
        />
      ))}
      {Array.from({ length: threeColumnCount }, (_, index) => (
        <div
          key={`three-column-${index}`}
          aria-hidden="true"
          data-tool-grid-filler="three-column"
          className="hidden min-h-[132px] bg-card xl:block"
        />
      ))}
    </>
  );
}
```

在每组 `group.tools.map(...)` 之后追加：

```tsx
<ToolGridFillers toolCount={group.tools.length} />
```

- [x] **步骤 4：运行测试和格式检查并确认通过**

运行：

```bash
bun --cwd apps/web test src/components/tools/__tests__/tool-experience.test.tsx
bun run test:web
bun run format:check:changed
git diff --check
```

预期：聚焦测试与 Web 全量测试全部通过，格式和 diff 检查退出码为 0。

- [ ] **步骤 5：重新生成并核对截图**

运行本地 Playwright 视觉验证：

```bash
bunx playwright test --config=log/public-beta-screenshots.config.ts
```

预期：1 项视觉验证通过；Dashboard 桌面截图最后一行未占用单元使用
`bg-card`，移动端没有新增可见空白单元、横向溢出或 console 错误。

- [x] **步骤 6：提交修复**

```bash
git add apps/web/src/components/tools/tool-catalog-grid.tsx apps/web/src/components/tools/__tests__/tool-experience.test.tsx docs/superpowers/plans/2026-07-16-dashboard-grid-filler.md
git commit -m "fix(web): 修复 Dashboard 网格空单元背景"
```
