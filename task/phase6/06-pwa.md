# 06 - PWA 配置

> 依赖：Phase 3
> 预估：2h
> 可并行：所有任务

> **🎨 UI 设计要求**：PWA 图标和 manifest 配色**必须**与 [`task/design-system.md`](../design-system.md) 一致：
>
> - `theme_color`: 暗模式 background 色 (`oklch(0.12 0.005 240)` → hex 约 `#0a0a0c`)
> - `background_color`: 同上
> - 图标设计调用 `frontend-design` skill — 极简单色 logo，禁止使用渐变和拟物效果
> - 安装提示卡片：1px 边框、左对齐、无圆角阴影

## 目标

将应用配置为 PWA，支持离线访问、安装到桌面。

## 步骤

### 6.1 安装 PWA 插件

```bash
cd apps/web
bun add -d @ducanh2912/next-pwa
```

### 6.2 配置 next.config.ts

```typescript
import withPWA from '@ducanh2912/next-pwa';

const config: NextConfig = {
  // ...
};

export default withPWA({
  dest: 'public',
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === 'development',
  workboxOptions: {
    disableDevLogs: true,
  },
})(config);
```

### 6.3 创建 Manifest

`apps/web/public/manifest.json`:

```json
{
  "name": "Utils-Plane",
  "short_name": "UtilsPlane",
  "description": "未来感工具平台",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0c",
  "theme_color": "#0a0a0c",
  "orientation": "any",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ],
  "shortcuts": [
    {
      "name": "Image",
      "url": "/image/compress",
      "icons": [{ "src": "/icons/image-96.png", "sizes": "96x96" }]
    },
    {
      "name": "PDF",
      "url": "/pdf/merge",
      "icons": [{ "src": "/icons/pdf-96.png", "sizes": "96x96" }]
    }
  ]
}
```

> 颜色来自 design-system.md 暗模式 background。如需根据主题切换，可在客户端注入 `<meta name="theme-color" content="...">`。

### 6.4 生成图标

使用 https://realfavicongenerator.net/ 或 ImageMagick 生成：

- 192x192、512x512（必需）
- 16x16、32x32（favicon）
- apple-touch-icon (180x180)
- 含 maskable 版本

放入 `apps/web/public/icons/`。

### 6.5 添加 manifest meta

`src/app/layout.tsx`:

```tsx
export const metadata: Metadata = {
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Utils-Plane',
  },
};
```

### 6.6 离线 fallback 页

`src/app/_offline/page.tsx`:

```tsx
export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card>
        <CardHeader>
          <CardTitle>你已离线</CardTitle>
        </CardHeader>
        <CardContent>
          <p>请检查网络连接后重试。</p>
          <p className="text-sm text-muted-foreground mt-2">
            部分工具（如本地图片压缩）仍可使用。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

### 6.7 安装提示

`src/components/pwa/install-prompt.tsx`:

```tsx
'use client';
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!show) return null;

  return (
    <Card className="fixed bottom-4 right-4 max-w-sm">
      <CardContent className="pt-6 flex gap-4 items-center">
        <p className="text-sm">安装到桌面，离线也能用</p>
        <Button onClick={() => deferredPrompt.prompt()}>安装</Button>
        <Button variant="ghost" onClick={() => setShow(false)}>
          ×
        </Button>
      </CardContent>
    </Card>
  );
}
```

## 验收标准

- [ ] Chrome DevTools → Application → Manifest 显示完整
- [ ] Lighthouse PWA 评分 > 90
- [ ] 安装到桌面 / 移动端主屏正常
- [ ] 离线时显示 fallback 页
- [ ] 客户端工具（< 5MB 图片压缩）离线可用
