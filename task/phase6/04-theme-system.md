# 04 - 主题系统（日夜切换）

> 依赖：Phase 3
> 预估：2h
> 可并行：所有任务

> **🎨 UI 设计要求**：本任务**实现** [`task/design-system.md`](../design-system.md) 第二、七章定义的双主题系统。两套主题**不是简单反色**，而是独立调色：
>
> - **暗模式**：冷色、低对比、矩阵绿 accent（默认）
> - **亮模式**：纸感、温和、灰阶为主
>
> 在执行本任务前必须先读完整 design-system.md。

## 目标

完整实现双主题系统：CSS 变量切换、持久化、跟随系统、三态切换、所有组件适配。

## 步骤

### 4.1 next-themes 配置（Phase 3 已引入）

`src/components/providers/theme-provider.tsx`:

```tsx
'use client';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark" // 默认暗（design-system 第二章）
      enableSystem
      disableTransitionOnChange // 切换无闪烁
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
```

### 4.2 三态切换按钮

`src/components/layout/theme-toggle.tsx`:

```tsx
'use client';
import { useTheme } from 'next-themes';
import { Moon, Sun, Monitor } from 'lucide-react';

export function ThemeToggle() {
  const { setTheme, theme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-none">
          {/* lucide stroke 1.5，符合 design-system */}
          <Sun className="h-4 w-4 dark:hidden" strokeWidth={1.5} />
          <Moon className="h-4 w-4 hidden dark:block" strokeWidth={1.5} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-md border">
        <DropdownMenuItem onClick={() => setTheme('light')}>
          <Sun className="mr-2 h-4 w-4" strokeWidth={1.5} /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>
          <Moon className="mr-2 h-4 w-4" strokeWidth={1.5} /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          <Monitor className="mr-2 h-4 w-4" strokeWidth={1.5} /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### 4.3 CSS 变量（按 design-system.md 第二章）

`src/app/globals.css`:

```css
@layer base {
  :root {
    /* 亮模式 - 纸感 */
    --background: 0.98 0.002 240;
    --foreground: 0.15 0.005 240;
    --muted: 0.94 0.002 240;
    --muted-foreground: 0.45 0.005 240;
    --border: 0.88 0.005 240;
    --accent: 0.55 0.18 145;
    --destructive: 0.55 0.22 25;
    --card: 1 0 0;
    --ring: 0.55 0.18 145;
  }

  .dark {
    /* 暗模式 - 冷色 */
    --background: 0.12 0.005 240;
    --foreground: 0.92 0.005 240;
    --muted: 0.18 0.005 240;
    --muted-foreground: 0.55 0.005 240;
    --border: 0.22 0.005 240;
    --accent: 0.78 0.18 145;
    --destructive: 0.65 0.22 25;
    --card: 0.14 0.005 240;
    --ring: 0.78 0.18 145;
  }

  * {
    border-color: oklch(var(--border));
  }

  body {
    background-color: oklch(var(--background));
    color: oklch(var(--foreground));
    font-feature-settings: 'ss01', 'cv11'; /* Geist 高级字体特性 */
  }
}
```

### 4.4 字体加载（Geist）

`src/app/layout.tsx`:

```tsx
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

export default function RootLayout({ children }) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="font-sans antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
```

```bash
bun add geist
```

### 4.5 修复 hydration mismatch

确保 `<html suppressHydrationWarning>`，next-themes 会在客户端瞬时注入 class。

### 4.6 组件审计清单

调用 `frontend-design` skill 复核以下组件在双主题下的表现：

- [ ] 所有组件使用 CSS 变量（不要硬编码颜色）
- [ ] 强调色仅用于 CTA、活跃状态、关键数据 — **不用于装饰**
- [ ] 1px 边框在两个主题下都可见且不刺眼
- [ ] Mono 字体的数字/标签在两个主题下都清晰
- [ ] 图片在暗模式下添加 `dark:opacity-90` 防刺眼
- [ ] PDF/字体预览的 canvas 背景适配主题
- [ ] 进度条、状态徽章双主题对比度 ≥ AA

### 4.7 主题感知图片（可选）

如果有 logo/illustration 需要双主题版本：

```tsx
<picture>
  <source srcSet="/logo-dark.svg" media="(prefers-color-scheme: dark)" />
  <img src="/logo-light.svg" alt="Logo" />
</picture>
```

## 验收标准

- [ ] 三态切换瞬时生效，无闪烁
- [ ] 刷新页面后主题保持
- [ ] System 模式正确跟随 prefers-color-scheme
- [ ] 暗模式 ≠ 简单反色，是独立设计语言
- [ ] 所有页面双主题下均通过"拒绝 AI 通货"检查清单
- [ ] 无 hydration 警告
