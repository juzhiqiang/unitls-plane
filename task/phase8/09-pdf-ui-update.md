# 09 - PDF 工具 UI 更新 + 国际化 + 预览组件

> 依赖：01-08 全部完成
> 预估：2h
> 可并行：无（最后统一执行）

## 目标

1. 更新 PDF 首页工具列表，添加所有新工具入口
2. 添加中英文国际化翻译
3. 创建通用结果预览组件

## 步骤

### 9.1 更新 PDF 首页

`apps/web/src/app/[locale]/(app)/pdf/page.tsx`:

```typescript
import {
  Merge, Scissors, Image as ImageIcon, FileText, ImagePlus,
  RotateCw, Droplets, Lock, Minimize2, FileEdit, ArrowUpDown,
} from 'lucide-react';

const tools = [
  { key: 'merge', icon: Merge, href: '/pdf/merge' },
  { key: 'split', icon: Scissors, href: '/pdf/split' },
  { key: 'toImage', icon: ImageIcon, href: '/pdf/to-image' },
  { key: 'toText', icon: FileText, href: '/pdf/to-text' },
  { key: 'fromImage', icon: ImagePlus, href: '/pdf/from-image' },
  { key: 'rotate', icon: RotateCw, href: '/pdf/rotate' },
  { key: 'watermark', icon: Droplets, href: '/pdf/watermark' },
  { key: 'encrypt', icon: Lock, href: '/pdf/encrypt' },
  { key: 'compress', icon: Minimize2, href: '/pdf/compress' },
  { key: 'metadata', icon: FileEdit, href: '/pdf/metadata' },
  { key: 'rearrange', icon: ArrowUpDown, href: '/pdf/rearrange' },
] as const;
```

### 9.2 中文翻译

`apps/web/messages/zh.json` 的 `PdfTool` section 新增：

```json
"tools": {
  "toText": {
    "title": "PDF 转文本",
    "description": "将 PDF 转换为 Markdown 或纯文本格式"
  },
  "fromImage": {
    "title": "图片转 PDF",
    "description": "将多张图片合并为一个 PDF 文件"
  },
  "rotate": {
    "title": "旋转页面",
    "description": "旋转 PDF 中的指定页面"
  },
  "watermark": {
    "title": "添加水印",
    "description": "为 PDF 添加文字水印"
  },
  "encrypt": {
    "title": "加密 PDF",
    "description": "为 PDF 设置打开密码和权限"
  },
  "compress": {
    "title": "压缩 PDF",
    "description": "减小 PDF 文件大小"
  },
  "metadata": {
    "title": "编辑元数据",
    "description": "修改 PDF 标题、作者等信息"
  },
  "rearrange": {
    "title": "页面重排",
    "description": "拖拽调整页面顺序或删除页面"
  }
}
```

每个工具页面的详细翻译 key（以 toText 为例）：

```json
"toText": {
  "title": "PDF 转文本",
  "description": "将 PDF 页面转换为 Markdown 或纯文本，支持页面选择",
  "format": "输出格式",
  "formatMd": "Markdown",
  "formatTxt": "纯文本",
  "pageBreak": "页面分隔",
  "pageBreakHr": "分隔线 (---)",
  "pageBreakNewline": "空行",
  "pageBreakNone": "无",
  "allPages": "全部页面",
  "selectedPages": "选择页面",
  "selectPages": "点击选择要转换的页面",
  "start": "开始转换",
  "processing": "转换中...",
  "preview": "预览",
  "source": "源码",
  "pages": "页",
  "changeFile": "更换文件"
}
```

### 9.3 英文翻译

`apps/web/messages/en.json` 同步添加对应英文翻译。

### 9.4 结果 PDF 预览组件

新建 `apps/web/src/components/tools/result-pdf-preview.tsx`:

用于旋转、水印、压缩、加密等输出 PDF 的结果预览。

```tsx
'use client';

import { useEffect, useState } from 'react';
import { loadPdf, renderPdfPage } from '@/lib/processing/pdf-client';

interface ResultPdfPreviewProps {
  file: File | Blob;
  maxPages?: number;  // 最多预览几页，默认 3
}

export function ResultPdfPreview({ file, maxPages = 3 }: ResultPdfPreviewProps) {
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      const pdf = await loadPdf(file);
      if (cancelled) return;
      setPageCount(pdf.numPages);

      const pages = Math.min(pdf.numPages, maxPages);
      const thumbs: string[] = [];

      for (let i = 1; i <= pages; i++) {
        if (cancelled) return;
        const canvas = await renderPdfPage(pdf, i, 0.3);
        thumbs.push(canvas.toDataURL());
      }

      if (!cancelled) setThumbnails(thumbs);
    }

    render();
    return () => { cancelled = true; };
  }, [file, maxPages]);

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-mono text-muted-foreground">
        结果预览（共 {pageCount} 页{pageCount > maxPages ? `，显示前 ${maxPages} 页` : ''}）
      </p>
      <div className="flex gap-3">
        {thumbnails.map((src, i) => (
          <img
            key={i}
            src={src}
            alt={`Page ${i + 1}`}
            className="border border-border rounded-sm h-32 object-contain"
          />
        ))}
      </div>
    </div>
  );
}
```

### 9.5 各工具页面集成预览

在旋转、水印、压缩、元数据、重排等页面的结果区域，使用 `ResultPdfPreview` 显示处理结果的前几页缩略图。

## 验收标准

- [ ] PDF 首页展示全部 11 个工具入口
- [ ] 中英文翻译完整，切换语言正常
- [ ] `ResultPdfPreview` 在各工具页面正确显示
- [ ] `MarkdownPreview` 在 PDF→Text 页面正确显示
- [ ] 所有新路由可访问，无 404
