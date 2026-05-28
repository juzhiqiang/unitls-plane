# 02 - 图片 → PDF

> 依赖：00-pdf-schema-update
> 预估：2h
> 可并行：与 01/03/04/05/06/07/08 同时执行

## 目标

将多张图片合并为一个 PDF 文件，支持拖拽排序、页面尺寸配置。

## 技术方案

使用 `pdf-lib` 的 `embedPng()` / `embedJpg()` 将图片嵌入 PDF 页面。

## 步骤

### 2.1 扩展 PdfService

`apps/api/src/modules/tasks/services/pdf.service.ts`:

```typescript
export interface ImageToPdfOptions {
  pageSize: 'original' | 'a4' | 'letter';
  fit: 'fit' | 'fill' | 'stretch';
  margin?: number; // px, 默认 0
}

async imagesToPdf(
  images: { buffer: Buffer; mimeType: string }[],
  opts: ImageToPdfOptions,
): Promise<Buffer> {
  const doc = await PDFDocument.create();

  for (const img of images) {
    let embedded;
    if (img.mimeType === 'image/png') {
      embedded = await doc.embedPng(img.buffer);
    } else {
      embedded = await doc.embedJpg(img.buffer);
    }

    const imgWidth = embedded.width;
    const imgHeight = embedded.height;

    let pageWidth: number;
    let pageHeight: number;

    if (opts.pageSize === 'a4') {
      pageWidth = 595.28;
      pageHeight = 841.89;
    } else if (opts.pageSize === 'letter') {
      pageWidth = 612;
      pageHeight = 792;
    } else {
      pageWidth = imgWidth;
      pageHeight = imgHeight;
    }

    const page = doc.addPage([pageWidth, pageHeight]);
    const margin = opts.margin ?? 0;
    const availW = pageWidth - margin * 2;
    const availH = pageHeight - margin * 2;

    let drawW: number, drawH: number, drawX: number, drawY: number;

    if (opts.fit === 'stretch') {
      drawW = availW;
      drawH = availH;
    } else if (opts.fit === 'fill') {
      const scale = Math.max(availW / imgWidth, availH / imgHeight);
      drawW = imgWidth * scale;
      drawH = imgHeight * scale;
    } else {
      // fit
      const scale = Math.min(availW / imgWidth, availH / imgHeight);
      drawW = imgWidth * scale;
      drawH = imgHeight * scale;
    }

    drawX = margin + (availW - drawW) / 2;
    drawY = margin + (availH - drawH) / 2;

    page.drawImage(embedded, { x: drawX, y: drawY, width: drawW, height: drawH });
  }

  return Buffer.from(await doc.save());
}
```

### 2.2 扩展 PdfProcessor

```typescript
case 'image_to_pdf':
  return await this.handleImageToPdf(task, job);
```

```typescript
private async handleImageToPdf(task: any, job: Job): Promise<unknown> {
  const fileIds = task.inputFileIds;
  if (!fileIds || fileIds.length === 0) throw new Error('No input files specified');

  const config = task.inputConfig as ImageToPdfOptions;
  const images: { buffer: Buffer; mimeType: string }[] = [];

  for (let i = 0; i < fileIds.length; i++) {
    const file = await this.filesService.getById(fileIds[i]);
    if (!file.mimeType.startsWith('image/')) {
      throw new Error(`INVALID_FILE_TYPE: File ${file.filename} is not an image`);
    }
    const buffer = await this.filesService.download(file.storageKey);
    images.push({ buffer, mimeType: file.mimeType });
    await this.reportProgress(task.id, job, Math.floor(((i + 1) / fileIds.length) * 40));
  }

  const pdfBuffer = await this.pdfService.imagesToPdf(images, {
    pageSize: config.pageSize ?? 'original',
    fit: config.fit ?? 'fit',
    margin: config.margin,
  });
  await this.reportProgress(task.id, job, 85);

  const outputFile = await this.filesService.upload(
    pdfBuffer,
    { filename: 'images.pdf', mimeType: 'application/pdf', size: pdfBuffer.length },
    task.userId ?? undefined,
  );

  await this.tasksService.markCompleted(task.id, outputFile.id);
  await this.reportProgress(task.id, job, 100);
  return { outputFileId: outputFile.id };
}
```

### 2.3 前端页面

`apps/web/src/app/[locale]/(app)/pdf/from-image/page.tsx`:

1. **多图上传** — FileDropzone，accept images（PNG/JPEG/WebP）
2. **拖拽排序** — 复用 SortableFileList 或类似的 dnd-kit 排序列表
3. **配置项**：
   - 页面尺寸：原图尺寸 / A4 / Letter（按钮组）
   - 图片适应方式：适应 / 填充 / 拉伸（按钮组）
4. **处理** — 上传所有图片 → 创建 `image_to_pdf` 任务
5. **下载** — 下载 PDF 结果

## 验收标准

- [ ] 上传 3 张图片，生成 3 页 PDF
- [ ] 拖拽排序影响 PDF 页面顺序
- [ ] A4 页面尺寸 + fit 模式正确居中
- [ ] PNG 和 JPEG 均可嵌入
- [ ] 非图片文件 → 错误提示
