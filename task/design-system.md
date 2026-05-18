# Utils-Plane 设计规范

> 所有 UI 开发任务（Phase 3-6）必须遵循此文档 + 使用 **frontend-design** skill 完成实现。

---

## 一、设计哲学

**未来感 · 暗黑 · 极简**

- **空间留白**：信息呼吸感优先于密度堆叠。Padding ≥ 32px，Section 间距 ≥ 96px
- **拒绝 AI 通货审美**：禁止使用以下"AI 默认风"
  - ❌ 蓝紫渐变背景 (`from-blue-500 to-purple-600`)
  - ❌ 圆角卡片 + 阴影堆叠
  - ❌ Emoji 装饰
  - ❌ 居中对齐 + 渐变文字标题
  - ❌ "Powered by AI" 视觉语言
  - ❌ 通用 stock 插图
- **追求方向**：低对比、单色、机能感、Swiss 风、Terminal 美学、grid system

---

## 二、色彩系统（双模式）

### 暗色模式（默认）

```css
--background: oklch(0.12 0.005 240); /* 近黑、微冷 */
--foreground: oklch(0.92 0.005 240); /* 微暖白 */
--muted: oklch(0.18 0.005 240); /* 次级背景 */
--muted-foreground: oklch(0.55 0.005 240); /* 次级文字 */
--border: oklch(0.22 0.005 240); /* 极细边框 */
--accent: oklch(0.78 0.18 145); /* 矩阵绿（强调） */
--destructive: oklch(0.65 0.22 25); /* 警示橙红 */
--card: oklch(0.14 0.005 240);
--ring: oklch(0.78 0.18 145 / 0.4);
```

### 亮色模式

```css
--background: oklch(0.98 0.002 240); /* 接近纸白 */
--foreground: oklch(0.15 0.005 240);
--muted: oklch(0.94 0.002 240);
--muted-foreground: oklch(0.45 0.005 240);
--border: oklch(0.88 0.005 240);
--accent: oklch(0.55 0.18 145); /* 暗矩阵绿 */
--destructive: oklch(0.55 0.22 25);
--card: oklch(1 0 0);
--ring: oklch(0.55 0.18 145 / 0.4);
```

**强调色仅用于**：CTA 按钮、关键状态、活跃链接、进度条。**禁止用于装饰**。

---

## 三、字体

```css
--font-sans: 'Geist', 'Inter', system-ui, sans-serif;
--font-mono: 'Geist Mono', 'JetBrains Mono', monospace;
--font-display: 'Geist', sans-serif; /* 大标题统一用 sans，避免衬线感 */
```

**字号阶梯（紧凑、克制）**：

- Display: 56-72px（落地页 hero）
- H1: 32-40px
- H2: 24-28px
- H3: 18-20px
- Body: 14-15px
- Caption: 12-13px

**字重**：仅使用 400 / 500 / 600。**禁止 700+ 加粗**。

**字距**：大标题 `tracking-tight`，正文默认，全大写文本 `tracking-wider`。

---

## 四、布局

### 网格

- 12 列 grid（桌面），max-width: 1280px
- 容器水平 padding：sm 24px / md 48px / lg 64px

### 留白

- Hero 区高度：≥ 80vh，垂直居中或顶部对齐
- Section 间距：96-160px
- 组件内 padding：24-40px
- 不要把所有内容塞满屏幕

### 对齐

- 左对齐为主（"出版物"感）。**禁止居中堆叠所有内容**
- 标签、表单元素：网格对齐
- 大量使用 baseline grid

---

## 五、视觉语言

### 边框

- 1px 极细线条，颜色 `border`
- **禁止用粗描边或阴影做分隔**
- 卡片靠 1px 边框区分，无 box-shadow

### 圆角

- 默认 6px（`rounded-md`）
- 按钮 4px
- 大区域允许 8-12px
- **禁止超大圆角**（`rounded-2xl/3xl`）

### 动效

- 过渡 ≤ 200ms，缓动 `cubic-bezier(0.2, 0.0, 0, 1)`
- Hover：颜色微变（不要 scale）
- Loading：单色渐隐 skeleton，**禁止 spinning circle**
- 任务进度：水平细线条 progress bar，2px 高

### 装饰元素（点缀使用）

- 等宽字体的角标/编号：`01 / 04`、`[SYS]`、`/ status`
- 1px 线条勾画的图标（Lucide stroke 1.5）
- 极细的 grid 背景纹理（< 5% opacity）
- 选中态：左侧 2px accent 色竖线
- 数据视觉化：mono 字体显示数字

### 拒绝项（严禁出现）

- ❌ Glassmorphism / Blur 背景
- ❌ Neumorphism
- ❌ 浮夸渐变
- ❌ 大阴影
- ❌ 大量 emoji
- ❌ 全 brand-color 填充按钮（除主 CTA）
- ❌ 卡片悬浮抬升效果

---

## 六、组件风格

### 按钮

```
Primary:   bg-foreground text-background, 无圆角或 4px, 字号 13-14px
Secondary: bg-transparent border-1 border-border
Ghost:     bg-transparent hover:bg-muted
全部按钮：高度 36-40px，padding-x 16-24px
```

### 输入框

```
1px border, bg-transparent, focus 时 border 变 accent
不要 box-shadow
placeholder 用 muted-foreground
```

### 卡片

```
1px border, bg-card, 圆角 6-8px
内 padding 24-32px
标题区底部 1px 分隔线
```

### 表格

```
完全去边框（除水平 1px 分隔行）
表头大写 + tracking-wider + 字号 11-12px
单元格 padding-y 12-16px
hover 行变 muted 背景
```

### 导航

```
侧边栏：1px 右边框，宽 240px
活跃项：左侧 2px accent 竖线 + 文字变 foreground（无背景填充）
非活跃：muted-foreground
```

---

## 七、日夜切换实现

### 技术

- `next-themes` 已在 Phase 3 引入
- `attribute="class"`、`defaultTheme="system"`、`enableSystem`
- CSS 变量切换无闪烁

### 切换组件

- 顶部右侧三态切换：Sun / Moon / System
- 用 `lucide-react` 1px 描边图标
- 切换瞬时生效（`disableTransitionOnChange`）

### 设计要点

- 两个主题不是简单反色，而是**两套独立调色**
  - 暗：冷色调、低对比、矩阵绿点缀
  - 亮：纸质感、温和、灰阶为主
- 强调色在两个模式下的 lightness 不同（保证对比度 AA）
- 图标、图表在两个模式都要测试

---

## 八、参考视觉

- **Vercel** — 留白、字体、克制
- **Linear** — 暗黑、流畅、键盘驱动
- **Arc Browser** — 极简 chrome、布局
- **Raycast** — 工具感、mono 字体使用
- **t3.gg** — 实用主义、不浮夸
- **Stripe Docs** — 排版、信息密度

---

## 九、在任务中如何使用

每个 UI 任务执行时：

1. **必须调用 `frontend-design` skill**：
   - 任务开始前 `Skill` 工具调用 `frontend-design`
   - 让 skill 生成高质量的视觉方案

2. **遵守本文档约束**：
   - 把本文档作为输入传给 skill
   - 拒绝 skill 输出中违反约束的方案，要求重做

3. **双主题验证**：
   - 每个页面在暗/亮两个主题下都要可读、有质感
   - 截图对比，确认强调色 / 边框 / 文字均工作

4. **拒绝 AI 通货检查清单**：
   - 没有渐变蓝紫
   - 没有大圆角阴影卡片
   - 没有居中堆叠的"hero"模板
   - 没有 emoji 装饰
   - 没有 spinning loader
