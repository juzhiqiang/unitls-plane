# 01 - PDF → Markdown / 纯文本

> 依赖：00-pdf-schema-update
> 预估：3h
> 可并行：与 02-08 同时执行

> **🎨 UI 设计要求**：
> 1. 先读 [`task/design-system.md`](../design-system.md)
> 2. 调用 `frontend-design` skill 产出方案
> 3. 输出格式切换：tab 设计，下方 1px underline 标识当前 tab
> 4. Markdown 预览：使用 react-markdown，暗色代码块背景
> 5. 源码/预览切换：右上角小标签按钮

## 目标

实现 PDF 转 Markdown 和纯文本功能。完整配置：页面选择 + 输出格式 (.md/.txt) + 页面分隔符。包含生成结果的 Markdown 渲染预览。

## 技术方案

**mupdf StructuredText → HTML → turndown 转 Markdown**

- `page.toStructuredText()` 提取结构化文本
- `StructuredText.asHTML(pageIndex)` 得到带语义结构的 HTML
- `turndown` 将 HTML 转为 Markdown（保留标题 / 加粗 / 斜体 / 列表）
- `StructuredText.asText()` 直接输出纯文本

## 步骤

### 1.1 安装依赖

```bash
cd apps/api
bun add turndown
bun add -d @types/turndown

cd apps/web
bun add react-markdown
```

### 1.2 扩展 PdfService

`apps/api/src/modules/tasks/services/pdf.service.ts`:

```typescript
import * as mupdf from 'mupdf';
import TurndownService from 'turndown';

export interface ToTextOptions {
  format: 'markdown' | 'text';
  pages?: number[];        // 0-based，默认全部
  pageBreak?: 'hr' | 'newline' | 'none';  // 页面分隔符
}

async toText(input: Buffer, opts: ToTextOptions): Promise<string> {
  const doc = mupdf.Document.openDocument(input, 'application/pdf');
  const totalPages = doc.countPages();
  const pageIndices = opts.pages ?? Array.from({ length: totalPages }, (_, i) => i);

  // 校验
  for (const idx of pageIndices) {
    if (idx < 0 || idx >= totalPages) {
      throw new BadRequestException(`Invalid page index ${idx}, total pages: ${totalPages}`);
    }
  }

  const parts: string[] = [];

  if (opts.format === 'markdown') {
    const turndown = new TurndownService({ headingStyle: 'atx' });
    for (const idx of pageIndices) {
      const page = doc.loadPage(idx);
      const stext = page.toStructuredText();
      const html = stext.asHTML(idx);
      parts.push(turndown.turndown(html));
    }
  } else {
    for (const idx of pageIndices) {
      const page = doc.loadPage(idx);
      const stext = page.toStructuredText();
      parts.push(stext.asText());
    }
  }

  const separator = opts.pageBreak === 'hr' ? '\n\n---\n\n'
    : opts.pageBreak === 'newline' ? '\n\n'
    : '';

  return parts.join(separator);
}
```

### 1.3 扩展 PdfProcessor

`apps/api/src/modules/tasks/processors/pdf.processor.ts`:

```typescript
case 'pdf_to_text':
  return await this.handleToText(task, job);
```

```typescript
private async handleToText(task: any, job: Job): Promise<unknown> {
  const fileId = task.inputFileIds?.[0];
  if (!fileId) throw new Error('No input file specified');

  const inputFile = await this.filesService.getById(fileId);
  if (inputFile.mimeType !== 'application/pdf') {
    throw new Error(`INVALID_FILE_TYPE: File ${inputFile.filename} is not a PDF`);
  }

  const inputBuffer = await this.filesService.download(inputFile.storageKey);
  await this.reportProgress(task.id, job, 10);

  const config = task.inputConfig as {
    format?: 'markdown' | 'text';
    pages?: number[];
    pageBreak?: 'hr' | 'newline' | 'none';
  };

  const result = await this.pdfService.toText(inputBuffer, {
    format: config.format ?? 'markdown',
    pages: config.pages,
    pageBreak: config.pageBreak ?? 'hr',
  });
  await this.reportProgress(task.id, job, 80);

  const ext = config.format === 'text' ? 'txt' : 'md';
  const mime = 'text/plain';
  const baseName = inputFile.filename.replace(/\.pdf$/i, '');
  const outputBuffer = Buffer.from(result, 'utf-8');

  const outputFile = await this.filesService.upload(
    outputBuffer,
    {
      filename: `${baseName}.${ext}`,
      mimeType: mime,
      size: outputBuffer.length,
    },
    task.userId ?? undefined,
  );
  await this.reportProgress(task.id, job, 95);

  await this.tasksService.markCompleted(task.id, outputFile.id);
  await this.reportProgress(task.id, job, 100);

  return { outputFileId: outputFile.id };
}
```

### 1.4 前端页面

`apps/web/src/app/[locale]/(app)/pdf/to-text/page.tsx`:

参考 `to-image/page.tsx` 模式：

1. **文件上传** — `FileDropzone`，仅接受 PDF
2. **PDF 预览** — 复用 `PageThumb` 组件，支持「全部页面 / 选择页面」切换
3. **配置项**：
   - **输出格式**：Markdown / 纯文本（按钮切换，类似 PNG/JPEG）
   - **页面分隔符**：`---` / 空行 / 无（按钮组）
4. **处理** — 调用 API 创建 `pdf_to_text` 任务，显示进度
5. **结果预览** — 转换完成后，fetch 结果文件文本内容：
   - Markdown 格式：用 `react-markdown` 渲染预览 + 源码标签切换
   - 纯文本：`<pre>` 显示
6. **下载按钮** — 下载 .md 或 .txt

### 1.5 结果预览组件

新建 `apps/web/src/components/tools/markdown-preview.tsx`:

```tsx
'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';

interface MarkdownPreviewProps {
  content: string;
  format: 'markdown' | 'text';
}

export function MarkdownPreview({ content, format }: MarkdownPreviewProps) {
  const [showSource, setShowSource] = useState(false);

  if (format === 'text') {
    return (
      <pre className="text-xs font-mono bg-muted/20 border border-border p-4 rounded-md overflow-auto max-h-[600px] whitespace-pre-wrap">
        {content}
      </pre>
    );
  }

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="flex justify-end border-b border-border px-3 py-1.5">
        <button
          type="button"
          onClick={() => setShowSource(!showSource)}
          className={cn(
            'text-[10px] font-mono uppercase tracking-wider transition-colors',
            showSource ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {showSource ? '预览' : '源码'}
        </button>
      </div>
      <div className="p-4 overflow-auto max-h-[600px]">
        {showSource ? (
          <pre className="text-xs font-mono whitespace-pre-wrap">{content}</pre>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
```

## 验收标准

- [ ] Markdown 输出保留标题层级、加粗、斜体、列表
- [ ] 纯文本输出正确提取所有文字内容
- [ ] 页面选择功能正常（全部 / 自选）
- [ ] 页面分隔符选项生效
- [ ] 前端 Markdown 渲染预览正确显示
- [ ] 源码/预览切换正常
- [ ] 进度条正确更新
- [ ] 下载 .md / .txt 文件正常
