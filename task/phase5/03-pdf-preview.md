# 03 - PDF 预览组件

> 依赖：Phase 3 完成
> 预估：2h
> 可并行：与 01/02/05 同时执行

## 目标

实现前端 PDF 预览组件，使用 pdfjs-dist 渲染缩略图，供合并/拆分 UI 使用。

## 步骤

### 3.1 安装依赖

```bash
cd apps/web
bun add pdfjs-dist
```

### 3.2 配置 PDF.js worker

`src/lib/processing/pdf-client.ts`:
```typescript
import * as pdfjsLib from 'pdfjs-dist';

// 使用 Next.js 静态文件托管 worker
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

export async function loadPdf(file: File | Blob): Promise<pdfjsLib.PDFDocumentProxy> {
  const arrayBuffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
}

export async function renderPdfPage(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  scale: number = 1,
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}
```

### 3.3 复制 worker 文件

`postinstall.sh` 或 `package.json` script：
```json
{
  "scripts": {
    "postinstall": "cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/"
  }
}
```

### 3.4 创建 PdfPreview 组件

`src/components/tools/pdf-preview.tsx`:
```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { loadPdf, renderPdfPage } from '@/lib/processing/pdf-client';

export function PdfPreview({ file, scale = 0.5 }: { file: File; scale?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      const pdf = await loadPdf(file);
      if (cancelled) return;
      setPageCount(pdf.numPages);

      if (!containerRef.current) return;
      containerRef.current.innerHTML = '';

      for (let i = 1; i <= pdf.numPages; i++) {
        if (cancelled) return;
        const canvas = await renderPdfPage(pdf, i, scale);
        canvas.className = 'border rounded shadow-sm';
        containerRef.current?.appendChild(canvas);
      }
    }

    render();
    return () => { cancelled = true; };
  }, [file, scale]);

  return (
    <div>
      <p className="text-sm text-muted-foreground">共 {pageCount} 页</p>
      <div ref={containerRef} className="grid grid-cols-3 gap-4 mt-4" />
    </div>
  );
}
```

### 3.5 创建可拖拽页面组件（供拆分 UI 使用）

`src/components/tools/pdf-page-card.tsx`:
- 单页缩略图 + 页码标签
- 支持选中（checkbox）
- 支持拖拽排序（使用 dnd-kit）

```bash
bun add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

### 3.6 性能优化

- 大 PDF（> 50 页）使用虚拟滚动
- 渲染队列：每次最多并发 3 个页面
- 离开页面时取消 pending render

## 验收标准

- [ ] 上传 PDF 后能看到所有页缩略图
- [ ] 100 页 PDF 渲染不卡顿
- [ ] worker 文件正确加载（不阻塞主线程）
- [ ] 组件卸载时清理资源
