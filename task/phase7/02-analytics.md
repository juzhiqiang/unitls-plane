# 02 - Vercel Analytics + Web Vitals

> 依赖：Phase 3
> 预估：0.5h
> 可并行：与 01/03

## 目标

集成 Vercel Analytics 追踪页面访问，监控 Web Vitals。

## 步骤

### 2.1 安装

```bash
cd apps/web
bun add @vercel/analytics @vercel/speed-insights
```

### 2.2 集成 Analytics

`src/app/layout.tsx`:

```tsx
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {/* ... */}
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
```

### 2.3 自定义事件追踪

`src/lib/analytics.ts`:

```typescript
import { track } from '@vercel/analytics';

export const analytics = {
  toolUsed: (tool: 'image' | 'pdf' | 'font', action: string) => {
    track('tool_used', { tool, action });
  },
  fileProcessed: (
    type: string,
    size: number,
    location: 'client' | 'server'
  ) => {
    track('file_processed', { type, size, location });
  },
  signedUp: (method: 'email' | 'google' | 'github') => {
    track('signed_up', { method });
  },
};
```

在关键操作处调用：

- 工具使用：`analytics.toolUsed('image', 'compress')`
- 文件处理完成：`analytics.fileProcessed(...)`
- 注册：`analytics.signedUp(...)`

### 2.4 Web Vitals 阈值

确认以下指标达标：

- LCP < 2.5s
- FID < 100ms
- CLS < 0.1
- INP < 200ms
- TTFB < 800ms

如有指标不达标，记录到 Phase 7 / 03-performance 跟进。

### 2.5 GDPR 合规（可选）

如果服务欧洲用户，添加 Cookie 同意 banner：

```tsx
<Analytics mode={hasConsent ? 'auto' : 'production'} />
```

## 验收标准

- [ ] Vercel Dashboard 看到 Analytics 数据
- [ ] Speed Insights 显示 Web Vitals
- [ ] 自定义事件被正确追踪
- [ ] 无 console 错误
