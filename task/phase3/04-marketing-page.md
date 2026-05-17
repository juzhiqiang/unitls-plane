# 04 - 落地页（SEO）

> 依赖：02-layout
> 预估：2h

> **🎨 UI 设计要求**：落地页是品牌核心展示，**必须**：
> 1. 先读 [`task/design-system.md`](../design-system.md)
> 2. 调用 `frontend-design` skill 产出落地页方案
> 3. Hero 区高度 ≥ 80vh，**左对齐 + 大留白**，禁止居中堆叠的通货模板
> 4. 使用 Display 字号（56-72px）+ tracking-tight
> 5. 装饰元素：等宽字体编号、1px 线条 grid 背景纹理（< 5% opacity）
> 6. 功能展示用 1px 边框卡片排版，**禁止渐变填充**
> 7. 双主题（亮：纸感、暗：矩阵感）独立设计，不是简单反色

## 目标

创建营销落地页，展示工具能力、引导注册，SEO 友好。

## 步骤

### 4.1 创建 (marketing) 布局

`src/app/(marketing)/layout.tsx`:
- 顶部导航：Logo + 工具入口 + "登录/注册"按钮
- 底部 footer：版权、链接

### 4.2 实现首页

`src/app/(marketing)/page.tsx`:

模块：
1. **Hero**: 标题、副标题、CTA 按钮（"开始使用"→ /image）
2. **功能展示**: 三栏（图片/PDF/字体），每栏带图标 + 简介
3. **特点**: 客户端处理 / 隐私保护 / 高性能 / 免费使用
4. **CTA**: 底部再次引导注册

### 4.3 SEO Metadata

`src/app/(marketing)/page.tsx`:
```typescript
export const metadata: Metadata = {
  title: 'Utils-Plane - 免费在线工具平台',
  description: '图片压缩、PDF 处理、字体转换，一站式工具平台',
  openGraph: { ... },
  twitter: { ... },
};
```

### 4.4 添加 sitemap & robots

`src/app/sitemap.ts`:
```typescript
import { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://utils-plane.com', priority: 1 },
    { url: 'https://utils-plane.com/image', priority: 0.8 },
    { url: 'https://utils-plane.com/pdf', priority: 0.8 },
    { url: 'https://utils-plane.com/font', priority: 0.8 },
  ];
}
```

`src/app/robots.ts`:
```typescript
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/dashboard'] },
    sitemap: 'https://utils-plane.com/sitemap.xml',
  };
}
```

### 4.5 性能优化

- 所有图片使用 Next.js `<Image>` 组件
- 关键组件用 Server Components
- Hero CTA 按钮使用 `prefetch={true}`

## 验收标准

- [ ] 首页加载 < 2s（LCP）
- [ ] Lighthouse SEO 评分 > 90
- [ ] meta tags 完整
- [ ] sitemap.xml 可访问
- [ ] 移动端响应式正常
