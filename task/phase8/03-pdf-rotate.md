# 03 - PDF 页面旋转

> 依赖：00-pdf-schema-update
> 预估：2h
> 可并行：与 01/02/04/05/06/07/08 同时执行

## 目标

实现 PDF 页面旋转：选择指定页面，旋转 90°/180°/270°。

## 技术方案

使用 `pdf-lib` 的 `page.setRotation(degrees(angle))`。

## 步骤

### 3.1 扩展 PdfService

`apps/api/src/modules/tasks/services/pdf.service.ts`:

```typescript
import { degrees } from 'pdf-lib';

export interface RotateOptions {
  pages: number[];          // 0-based 页码
  angle: 90 | 180 | 270;   // 旋转角度（顺时针）
}

async rotate(input: Buffer, opts: RotateOptions): Promise<Buffer> {
  const doc = await PDFDocument.load(input);
  const totalPages = doc.getPageCount();

  for (const idx of opts.pages) {
    if (idx < 0 || idx >= totalPages) {
      throw new BadRequestException(`Invalid page index ${idx}, total pages: ${totalPages}`);
    }
    const page = doc.getPage(idx);
    const currentRotation = page.getRotation().angle;
    page.setRotation(degrees((currentRotation + opts.angle) % 360));
  }

  return Buffer.from(await doc.save());
}
```

### 3.2 扩展 PdfProcessor

```typescript
case 'pdf_rotate':
  return await this.handleRotate(task, job);
```

```typescript
private async handleRotate(task: any, job: Job): Promise<unknown> {
  const fileId = task.inputFileIds?.[0];
  if (!fileId) throw new Error('No input file specified');

  const inputFile = await this.filesService.getById(fileId);
  if (inputFile.mimeType !== 'application/pdf') {
    throw new Error(`INVALID_FILE_TYPE: File ${inputFile.filename} is not a PDF`);
  }

  const inputBuffer = await this.filesService.download(inputFile.storageKey);
  await this.reportProgress(task.id, job, 20);

  const config = task.inputConfig as RotateOptions;
  const result = await this.pdfService.rotate(inputBuffer, config);
  await this.reportProgress(task.id, job, 80);

  const outputFile = await this.filesService.upload(
    result,
    { filename: `rotated-${inputFile.filename}`, mimeType: 'application/pdf', size: result.length },
    task.userId ?? undefined,
  );

  await this.tasksService.markCompleted(task.id, outputFile.id);
  await this.reportProgress(task.id, job, 100);
  return { outputFileId: outputFile.id };
}
```

### 3.3 前端页面

`apps/web/src/app/[locale]/(app)/pdf/rotate/page.tsx`:

1. **文件上传** — FileDropzone，仅 PDF
2. **PDF 预览** — 页面缩略图网格（复用 PageThumb），可多选
3. **旋转角度选择** — 90° / 180° / 270° 按钮组
4. **预览提示** — 选中的缩略图上叠加旋转角度指示器（CSS transform）
5. **处理 + 下载**
6. **结果预览** — 完成后用 pdfjs-dist 渲染第一页缩略图确认旋转效果

## 验收标准

- [ ] 选中页面旋转 90° 后输出正确
- [ ] 累加旋转（已有旋转的页面再次旋转）
- [ ] 多选页面批量旋转
- [ ] 预览指示器正确显示
