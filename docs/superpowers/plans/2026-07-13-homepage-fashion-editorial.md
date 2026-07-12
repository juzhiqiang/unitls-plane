# 首页时尚编辑风重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将营销首页重构为统一的时尚编辑风页面，并把 Three.js 场景从赛博处理面板改为克制的材质雕塑。

**Architecture:** 保留现有营销页路由、工具元数据和国际化结构，将页面拆为品牌首屏、编辑目录、处理叙事和结尾 CTA 四个区块。Three.js 生命周期继续封装在现有场景组件，模型文件只暴露材质片配置和受限动画时钟，页面文案与视觉样式分别由消息文件和首页专用 CSS 管理。

**Tech Stack:** Next.js 14 App Router、React 18、next-intl、Tailwind CSS 4、Three.js、Vitest。

---

## 文件结构

- 修改 `apps/web/messages/zh.json`：新的中文品牌文案与元数据。
- 修改 `apps/web/messages/en.json`：与中文结构一致的英文文案。
- 修改 `apps/web/src/app/[locale]/(marketing)/page.tsx`：四段编辑式首页结构。
- 修改 `apps/web/src/app/[locale]/(marketing)/layout.tsx`：营销页专用导航与页脚质感。
- 修改 `apps/web/src/components/tools/homepage-quick-tools.tsx`：从产品卡片改为编辑目录。
- 修改 `apps/web/src/components/effects/hero-workbench-scene-model.ts`：材质片配置和动画约束。
- 修改 `apps/web/src/components/effects/hero-workbench-scene.tsx`：玻璃、金属、纸张材质场景和静态回退。
- 修改 `apps/web/src/app/globals.css`：首页专用颜色、字体、版式和动效。
- 修改现有首页、场景和工具测试：固定新文案、结构与动画行为。

### Task 1: 固定品牌文案与首页结构

**Files:**
- Modify: `apps/web/src/app/[locale]/(marketing)/__tests__/marketing-copy.test.ts`
- Create: `apps/web/src/app/[locale]/(marketing)/__tests__/marketing-structure.test.ts`

- [ ] **Step 1: 写入失败的品牌文案测试**

```typescript
expect(zh.Marketing.hero.eyebrow).toBe('UTILS PLANE / 数字编辑部');
expect(zh.Marketing.hero.titleLine1).toBe('让文件');
expect(zh.Marketing.hero.titleLine2).toBe('更有形');
expect(zh.Marketing.tools.heading).toBe('四种方式，重新整理文件');
expect(en.Marketing.hero.titleLine1).toBe('Shape');
expect(en.Marketing.hero.titleLine2).toBe('Every File');
```

- [ ] **Step 2: 写入失败的页面结构测试**

```typescript
expect(source).toContain('homepage-editorial-hero');
expect(source).toContain('homepage-editorial-index');
expect(source).toContain('homepage-editorial-methods');
expect(source).toContain('homepage-editorial-closing');
expect(source).not.toContain('scanlines');
expect(source).not.toContain('PointerSpotlight');
```

- [ ] **Step 3: 运行测试确认按预期失败**

Run: `bun run test -- src/app/[locale]/\(marketing\)/__tests__/marketing-copy.test.ts src/app/[locale]/\(marketing\)/__tests__/marketing-structure.test.ts`

Expected: 新文案和新 class 尚不存在，测试失败。

### Task 2: 实现文案和编辑式页面骨架

**Files:**
- Modify: `apps/web/messages/zh.json`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/src/app/[locale]/(marketing)/page.tsx`
- Modify: `apps/web/src/components/tools/homepage-quick-tools.tsx`

- [ ] **Step 1: 更新中英文文案**

中文主标题使用“让文件 / 更有形”，副文案明确本地与服务端处理边界；英文使用“Shape / Every File”。工具、方法和结尾区块保持同一键结构。

- [ ] **Step 2: 重排首页 JSX**

页面只保留以下四个顶级 section class：

```tsx
<section className="homepage-editorial-hero">...</section>
<section className="homepage-editorial-index">...</section>
<section className="homepage-editorial-methods">...</section>
<section className="homepage-editorial-closing">...</section>
```

移除扫描线、极光、网格背景、PointerSpotlight 和首屏独立 Trust Strip 卡片，把处理承诺改为首屏底部内联文本。

- [ ] **Step 3: 将快速工具改为目录列表**

```tsx
<ol className="homepage-tool-index">
  {tools.map((tool, index) => (
    <li key={tool.key}>
      <Link href={tool.href} className="homepage-tool-index-item">
        <span>{String(index + 1).padStart(2, '0')}</span>
        <span>{t(tool.titleKey)}</span>
        <span>{t(tool.descriptionKey)}</span>
        <ArrowUpRight aria-hidden />
      </Link>
    </li>
  ))}
</ol>
```

- [ ] **Step 4: 运行首页测试确认通过**

Run: `bun run test -- src/app/[locale]/\(marketing\)/__tests__/marketing-copy.test.ts src/app/[locale]/\(marketing\)/__tests__/marketing-structure.test.ts src/lib/tools/homepage-tools.test.ts`

Expected: 所有首页文案、结构和工具入口测试通过。

### Task 3: 固定 Three.js 材质场景行为

**Files:**
- Modify: `apps/web/src/components/effects/__tests__/hero-workbench-scene-model.test.ts`
- Modify: `apps/web/src/components/effects/__tests__/hero-workbench-scene-runtime.test.ts`

- [ ] **Step 1: 写入失败的材质配置测试**

```typescript
const layers = createWorkbenchLayerConfigs();
expect(layers).toHaveLength(5);
expect(layers.map(layer => layer.material)).toEqual([
  'glass',
  'paper',
  'metal',
  'glass',
  'paper',
]);
expect(heroWorkbenchMetrics.maxPointerRotation).toBeLessThanOrEqual(0.12);
```

- [ ] **Step 2: 固定运行时回退与隐藏页暂停**

```typescript
expect(source).toContain("document.addEventListener('visibilitychange'");
expect(source).toContain("document.visibilityState !== 'visible'");
expect(source).toContain('hero-material-poster');
expect(source).not.toContain('buildDataBeams');
expect(source).not.toContain('buildParticleField');
```

- [ ] **Step 3: 运行测试确认按预期失败**

Run: `bun run test -- src/components/effects/__tests__/hero-workbench-scene-model.test.ts src/components/effects/__tests__/hero-workbench-scene-runtime.test.ts`

Expected: 旧场景仍有 7 个文件标签、数据光束和粒子场，测试失败。

### Task 4: 实现材质雕塑 Three.js 场景

**Files:**
- Modify: `apps/web/src/components/effects/hero-workbench-scene-model.ts`
- Modify: `apps/web/src/components/effects/hero-workbench-scene.tsx`

- [ ] **Step 1: 精简模型配置**

`WorkbenchLayerConfig` 增加 `material: 'glass' | 'paper' | 'metal'`，配置数量改为 5；增加 `maxPointerRotation: 0.12` 和 `maxFrameDelta: 0.05`。

- [ ] **Step 2: 替换场景构成**

场景只保留：中央玻璃扭转环、五片材质薄片、柔和灯光和地面阴影。删除终端纹理、文件标签、轨道线、数据光束、粒子和 HUD 底栏。

- [ ] **Step 3: 实现静态材质海报**

组件 DOM 永久保留 `.hero-material-poster`，WebGL 成功后降低其透明度，初始化失败或移动端时直接显示该回退。

- [ ] **Step 4: 约束动画**

使用时钟增量更新旋转，指针目标角度 clamp 到 `maxPointerRotation`；页面隐藏时不继续请求帧，恢复时重置时钟；低动态偏好只渲染一次。

- [ ] **Step 5: 运行场景测试确认通过**

Run: `bun run test -- src/components/effects/__tests__/hero-workbench-scene-model.test.ts src/components/effects/__tests__/hero-workbench-scene-runtime.test.ts`

Expected: 场景模型和运行时保护测试全部通过。

### Task 5: 建立首页专用视觉系统

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/[locale]/(marketing)/layout.tsx`

- [ ] **Step 1: 增加首页 token**

```css
.homepage-editorial {
  --editorial-ink: #f1f0ea;
  --editorial-ground: #0a0a0a;
  --editorial-muted: #9a9992;
  --editorial-paper: #e9e6dd;
  --editorial-acid: #d7ff3f;
  --editorial-serif: 'Iowan Old Style', Baskerville, 'Times New Roman',
    'Songti SC', STSong, SimSun, serif;
}
```

- [ ] **Step 2: 删除旧首页特效样式**

删除 `.hero-title-effect`、`.hero-title-line`、`.homepage-apple-band`、`.workflow-stat-panel`、`.homepage-final-cta-band` 和 `.homepage-cta-core`，避免两套视觉系统并存。

- [ ] **Step 3: 实现编辑版式响应式规则**

桌面首屏使用 12 栏网格，Three.js 跨右侧 7 栏；目录和方法区使用细线与分栏。移动端保持单列，主标题固定断点字号，长中文不溢出。

- [ ] **Step 4: 调整营销页导航与页脚**

导航和页脚去除 `bg-card` 卡片感，使用透明黑背景、细线和首页同款小型标签层级；不改变登录态逻辑。

### Task 6: 全量验证与视觉验收

**Files:**
- Verify only; screenshots output to `artifacts/screenshots/`

- [ ] **Step 1: 运行 Web 全量测试**

Run: `bun run test`

Expected: 43 个以上测试文件全部通过，无失败。

- [ ] **Step 2: 运行生产构建**

Run: `bun run build`

Expected: Next.js 编译、类型检查和静态页面生成成功；Windows standalone 符号链接警告可单独记录。

- [ ] **Step 3: 启动本地服务**

Run: `bun run dev`

Expected: 首页可通过 `http://localhost:3000/zh` 访问。

- [ ] **Step 4: 生成多视口截图**

输出：

- `artifacts/screenshots/home-fashion-editorial-1440.png`
- `artifacts/screenshots/home-fashion-editorial-1024.png`
- `artifacts/screenshots/home-fashion-editorial-mobile.png`

- [ ] **Step 5: 检查画布像素和交互**

确认 Three.js 画布非空、恢复页面后无高速旋转、移动端显示静态材质海报、CTA 与四个工具目录链接可点击、页面无文字重叠。
