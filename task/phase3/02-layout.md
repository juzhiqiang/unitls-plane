# 02 - 主布局（侧边栏 + 响应式）

> 依赖：01-nextjs-init
> 预估：2.5h
> 可并行：与 03/05 同时执行

> **🎨 UI 设计要求**：本任务为 UI 开发，**必须**：
> 1. 先读 [`task/design-system.md`](../design-system.md)（未来感 / 暗黑极简 / 日夜切换）
> 2. 调用 `frontend-design` skill 产出视觉方案
> 3. 侧边栏遵循"活跃项左侧 2px accent 竖线 + 无背景填充"
> 4. 拒绝 AI 通货：无圆角阴影、无渐变、无 emoji

## 目标

实现 (app) 路由组的主布局：左侧导航 + 顶部用户菜单 + 主内容区。

## 步骤

### 2.1 创建路由组

```
src/app/
├── (marketing)/         # 落地页布局
│   ├── layout.tsx
│   └── page.tsx
├── (app)/               # 应用布局
│   ├── layout.tsx       # ← 本任务
│   ├── image/
│   │   └── page.tsx
│   ├── pdf/
│   │   └── page.tsx
│   ├── font/
│   │   └── page.tsx
│   └── dashboard/
│       └── page.tsx
└── layout.tsx           # 根布局
```

### 2.2 实现 (app)/layout.tsx

```tsx
import { AppSidebar } from '@/components/layout/app-sidebar';
import { AppHeader } from '@/components/layout/app-header';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

### 2.3 实现 AppSidebar

`src/components/layout/app-sidebar.tsx`:
- 使用 shadcn `<Sidebar>` 组件
- 导航项：图片工具、PDF 工具、字体工具、我的文件、任务历史
- 当前路由高亮（usePathname）
- 移动端：自动转为 sheet 抽屉

### 2.4 实现 AppHeader

`src/components/layout/app-header.tsx`:
- 左侧：SidebarTrigger（移动端切换）+ 面包屑
- 右侧：主题切换、用户头像 dropdown（资料、登出）
- 未登录时显示"登录"按钮

### 2.5 安装 sidebar 组件

```bash
bunx shadcn@latest add sidebar breadcrumb
```

### 2.6 响应式断点

- 桌面 (lg+)：侧边栏固定展开
- 平板 (md)：侧边栏图标模式
- 移动 (sm-)：侧边栏隐藏，sheet 形式打开

### 2.7 暗色模式预留

引入 `next-themes`：
```bash
bun add next-themes
```

在根 layout.tsx 包裹 `<ThemeProvider>`，AppHeader 提供切换按钮（功能在 Phase 6 完善）。

## 验收标准

- [ ] 桌面端侧边栏正常显示，能切换路由
- [ ] 移动端能打开/关闭侧边栏
- [ ] 当前路由项高亮
- [ ] 暗色模式切换工作（占位实现也可）
- [ ] 无 hydration mismatch warning
