# 01 - Next.js + Tailwind + shadcn 初始化

> 依赖：Phase 1
> 预估：2h
> 阻塞：Phase 3 所有后续任务

> **🎨 UI 设计要求**：本任务初始化 UI 技术栈，必须按 [`task/design-system.md`](../design-system.md) 配置 Tailwind 主题（CSS 变量、字体、色板、双主题）。后续 UI 任务统一使用 `frontend-design` skill 生成视觉方案。

## 目标

在 `apps/web` 创建 Next.js 15 项目，集成 Tailwind CSS 4 + shadcn/ui。

## 步骤

### 1.1 创建 Next.js 项目

```bash
cd apps/web
bun create next-app . --typescript --tailwind --app --src-dir --import-alias "@/*" --no-eslint
```

注意：选项需配合 monorepo（不要让它创建新的 git repo）。

### 1.2 更新 package.json

```json
{
  "name": "@utils-plane/web",
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  }
}
```

### 1.3 配置 Tailwind CSS 4

`apps/web/src/app/globals.css`:
```css
@import "tailwindcss";

@theme {
  --color-background: hsl(0 0% 100%);
  --color-foreground: hsl(0 0% 3.9%);
  /* ... 完整 design tokens */
}

@layer base {
  :root { /* ... */ }
  .dark { /* ... */ }
}
```

### 1.4 初始化 shadcn/ui

```bash
bunx shadcn@latest init
```

选项：
- Style: New York
- Base color: Slate
- CSS variables: yes

生成 `components.json`：
```json
{
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui"
  }
}
```

### 1.5 安装常用组件

```bash
bunx shadcn@latest add button input label card dialog dropdown-menu \
  toast sonner avatar separator tabs sheet skeleton form select
```

### 1.6 配置 next.config.ts

```typescript
import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: [
    '@utils-plane/db',
    '@utils-plane/validators',
    '@utils-plane/api-client',
    '@utils-plane/utils',
  ],
  experimental: {
    typedRoutes: true,
  },
};

export default config;
```

### 1.7 验证启动

```bash
bun dev
# 访问 http://localhost:3000
```

## 验收标准

- [ ] `bun dev` 启动成功
- [ ] Tailwind class 生效
- [ ] shadcn Button 组件可用
- [ ] TypeScript 严格模式无报错
- [ ] Turbopack 启用
