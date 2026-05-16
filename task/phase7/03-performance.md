# 03 - 性能优化

> 依赖：Phase 6 完成
> 预估：2h
> 可并行：与 01/02

## 目标

优化首屏加载、运行时性能、Bundle 体积。

## 步骤

### 3.1 Bundle 分析

```bash
cd apps/web
bun add -d @next/bundle-analyzer
```

`next.config.ts`:
```typescript
import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default withBundleAnalyzer(...)
```

```bash
ANALYZE=true bun run build
```

### 3.2 代码分割

#### 重依赖动态导入

```typescript
// pdfjs-dist 仅在 PDF 工具页面用
const PdfPreview = dynamic(() => import('@/components/tools/pdf-preview'), {
  ssr: false,
  loading: () => <Skeleton className="h-96" />,
});

// opentype.js 仅在字体工具页面用
const FontPreview = dynamic(() => import('@/components/tools/font-preview'), {
  ssr: false,
});

// browser-image-compression 仅在图片工具用
// 已是按需导入，无需特殊处理
```

#### 路由级分割

确保 Next.js App Router 自动按路由分割（默认行为）。

### 3.3 图片优化

#### 落地页图片

所有 `<img>` 替换为 `<Image>`：
```tsx
<Image src="/hero.png" alt="Hero" width={1200} height={600} priority />
```

#### 用户上传图片预览

使用 `URL.createObjectURL` + 显式 width/height 避免 CLS。

### 3.4 字体优化

#### Next.js next/font

```tsx
import { Inter } from 'next/font/google';
const inter = Inter({ subsets: ['latin'], display: 'swap' });

export default function RootLayout({ children }) {
  return <html className={inter.className}>...</html>;
}
```

避免 FOIT（Flash of Invisible Text）。

### 3.5 第三方脚本优化

使用 `next/script`：
```tsx
import Script from 'next/script';

<Script src="..." strategy="lazyOnload" />
```

### 3.6 React Query 缓存策略

`src/components/providers/query-provider.tsx`:
```typescript
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
    },
  },
});
```

### 3.7 数据库查询优化

审计后端 query：
- N+1 问题：使用 Drizzle 的 `with` 预加载
- 添加必要索引（已在 Phase 1 / 03-db 设计）
- 大数据集分页（默认 limit 20）

### 3.8 CDN + Cache Headers

`apps/web/next.config.ts`:
```typescript
async headers() {
  return [
    {
      source: '/icons/:path*',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
      ],
    },
  ];
}
```

`apps/api` 文件下载通过 MinIO 签名 URL 直接返回（生产环境建议在 MinIO 前加 CDN，如 Cloudflare）。

### 3.9 后端性能

- 启用 gzip/brotli 压缩
- 数据库连接池配置：`max: 10`
- BullMQ Processor concurrency 根据 CPU 调整

### 3.10 监控验证

部署后用 PageSpeed Insights / WebPageTest 测试：
- 首页 LCP < 2.5s
- 工具页 TTI < 3s
- Lighthouse Performance > 90

## 验收标准

- [ ] First Load JS < 200KB（落地页）
- [ ] 工具页按需加载（pdfjs 仅 PDF 页加载）
- [ ] LCP < 2.5s
- [ ] CLS < 0.1
- [ ] Lighthouse Performance > 90
- [ ] 字体无 FOIT
