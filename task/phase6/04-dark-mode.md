# 04 - 暗色模式完善

> 依赖：Phase 3
> 预估：1.5h
> 可并行：所有任务

## 目标

完整实现暗色模式：主题切换、持久化、跟随系统、所有组件适配。

## 步骤

### 4.1 next-themes 配置（已在 Phase 3 引入）

`src/components/providers/theme-provider.tsx`:
```tsx
'use client';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
```

### 4.2 主题切换按钮

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
        <Button variant="ghost" size="icon">
          <Sun className="h-5 w-5 dark:hidden" />
          <Moon className="h-5 w-5 hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>
          <Sun className="mr-2 h-4 w-4" /> 浅色
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>
          <Moon className="mr-2 h-4 w-4" /> 深色
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          <Monitor className="mr-2 h-4 w-4" /> 跟随系统
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### 4.3 CSS 变量完整定义

`src/app/globals.css`:
```css
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    /* ... 全部 shadcn 变量 */
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    /* ... 深色版全部变量 */
  }
}
```

### 4.4 修复 hydration mismatch

`src/app/layout.tsx`:
```tsx
<html lang="zh-CN" suppressHydrationWarning>
  <body>
    <ThemeProvider>{children}</ThemeProvider>
  </body>
</html>
```

### 4.5 审计所有组件

检查清单：
- [ ] 所有自定义组件使用 CSS 变量（`bg-background`、`text-foreground` 等）
- [ ] 图片在深色模式下不刺眼（必要时添加 `dark:opacity-90`）
- [ ] PDF 预览 canvas 背景适配
- [ ] 字体预览组件适配
- [ ] 拖拽区域 hover 状态适配

### 4.6 系统模式检测

确保 `defaultTheme="system"` 时正确检测 `prefers-color-scheme`。

## 验收标准

- [ ] 切换主题瞬时生效，无闪烁
- [ ] 刷新页面后主题保持
- [ ] 系统模式正确跟随
- [ ] 所有页面在深色模式下可读
- [ ] 无 hydration 警告
