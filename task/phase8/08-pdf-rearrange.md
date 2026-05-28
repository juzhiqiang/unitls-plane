# 08 - PDF 页面重排 / 删除

> 依赖：00-pdf-schema-update
> 预估：2.5h
> 可并行：与 01/02/03/04/05/06/07 同时执行

## 目标

可视化拖拽重排 PDF 页面顺序，支持删除指定页面。

## 技术方案

使用 `pdf-lib`：创建新文档 → 按用户指定顺序 `copyPages` → 缺失的页码即为删除。

也可用 `mupdf` 的 `doc.rearrangePages(pages: number[])`，更高效。

## 步骤

### 8.1 扩展 PdfService

`apps/api/src/modules/tasks/services/pdf.service.ts`:

```typescript
export interface RearrangeOptions {
  pageOrder: number[];  // 0-based，新的页面顺序。例如 [2,0,1] 表示第3页放第1，第1页放第2，第2页放第3
                        // 不在数组中的页码将被删除
}

async rearrange(input: Buffer, opts: RearrangeOptions): Promise<Buffer> {
  const src = await PDFDocument.load(input);
  const totalPages = src.getPageCount();

  // 校验
  for (const idx of opts.pageOrder) {
    if (idx < 0 || idx >= totalPages) {
      throw new BadRequestException(`Invalid page index ${idx}, total pages: ${totalPages}`);
    }
  }

  if (opts.pageOrder.length === 0) {
    throw new BadRequestException('Page order must not be empty');
  }

  const target = await PDFDocument.create();
  const copiedPages = await target.copyPages(src, opts.pageOrder);
  copiedPages.forEach((page) => target.addPage(page));

  return Buffer.from(await target.save());
}
```

### 8.2 扩展 PdfProcessor

```typescript
case 'pdf_rearrange':
  return await this.handleRearrange(task, job);
```

```typescript
private async handleRearrange(task: any, job: Job): Promise<unknown> {
  const fileId = task.inputFileIds?.[0];
  if (!fileId) throw new Error('No input file specified');

  const inputFile = await this.filesService.getById(fileId);
  if (inputFile.mimeType !== 'application/pdf') {
    throw new Error(`INVALID_FILE_TYPE`);
  }

  const inputBuffer = await this.filesService.download(inputFile.storageKey);
  await this.reportProgress(task.id, job, 20);

  const config = task.inputConfig as RearrangeOptions;
  const result = await this.pdfService.rearrange(inputBuffer, config);
  await this.reportProgress(task.id, job, 80);

  const outputFile = await this.filesService.upload(
    result,
    { filename: `rearranged-${inputFile.filename}`, mimeType: 'application/pdf', size: result.length },
    task.userId ?? undefined,
  );

  await this.tasksService.markCompleted(task.id, outputFile.id);
  await this.reportProgress(task.id, job, 100);
  return { outputFileId: outputFile.id };
}
```

### 8.3 前端页面

`apps/web/src/app/[locale]/(app)/pdf/rearrange/page.tsx`:

> **🎨 UI 设计要求**：
> 1. 拖拽手柄使用 1px 线条图标，拖拽中显示 ghost 轮廓（不要 scale）
> 2. 缩略图网格：1px 边框、轻微 muted 背景
> 3. 删除按钮在缩略图右上角，hover 时显示

1. **文件上传** — FileDropzone
2. **页面缩略图网格** — 使用 `@dnd-kit/sortable` 实现拖拽排序
   - 复用 `PdfPageCard` 组件或基于其改造
   - 每个缩略图右上角带删除按钮（×），hover 显示
   - 页码标签显示当前顺序
3. **操作按钮**：
   - 「全选/反选」— 批量操作辅助
   - 「删除选中」— 批量删除
   - 「反转顺序」— 快捷操作
4. **处理** — 提交 `pageOrder` 数组
5. **下载**

### 8.4 拖拽排序实现

```tsx
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';

// pageOrder state: number[] — 当前排列顺序
const [pageOrder, setPageOrder] = useState<number[]>([]);

// 上传后初始化
useEffect(() => {
  if (pageCount > 0) {
    setPageOrder(Array.from({ length: pageCount }, (_, i) => i));
  }
}, [pageCount]);

// 拖拽结束
function handleDragEnd(event) {
  const { active, over } = event;
  if (active.id !== over?.id) {
    setPageOrder((prev) => {
      const oldIndex = prev.indexOf(Number(active.id));
      const newIndex = prev.indexOf(Number(over!.id));
      return arrayMove(prev, oldIndex, newIndex);
    });
  }
}

// 删除页面
function deletePage(pageIdx: number) {
  setPageOrder((prev) => prev.filter((p) => p !== pageIdx));
}
```

## 验收标准

- [ ] 拖拽排序后 PDF 页面顺序正确
- [ ] 删除页面后输出 PDF 不包含已删除页
- [ ] 「反转顺序」正确
- [ ] 批量删除正常
- [ ] 至少保留 1 页（空 pageOrder 禁止提交）
