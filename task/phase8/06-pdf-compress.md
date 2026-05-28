# 06 - PDF 压缩

> 依赖：00-pdf-schema-update
> 预估：3h
> 可并行：与 01/02/03/04/05/07/08 同时执行

## 目标

压缩 PDF 文件大小。主要策略：降低内嵌图片分辨率/质量 + 清理冗余数据。

## 技术方案

使用 `mupdf` 重建 PDF：
1. 遍历每页，将页面渲染为图片（降低 DPI）再嵌入新 PDF — 适用于图片密集型 PDF
2. 或使用 `saveToBuffer` 的 `compress`、`garbage` 等选项清理冗余数据 — 适用于文本型 PDF

提供三档压缩级别：
- **轻度**：仅清理冗余（garbage collection），保留原始图片质量
- **中度**：图片质量降至 JPEG 75，DPI 降至 150
- **重度**：图片质量降至 JPEG 50，DPI 降至 100

## 步骤

### 6.1 扩展 PdfService

`apps/api/src/modules/tasks/services/pdf.service.ts`:

```typescript
export interface CompressPdfOptions {
  level: 'light' | 'medium' | 'heavy';
}

async compressPdf(input: Buffer, opts: CompressPdfOptions): Promise<Buffer> {
  const doc = mupdf.Document.openDocument(input, 'application/pdf') as mupdf.PDFDocument;

  if (opts.level === 'light') {
    // 仅清理冗余数据
    const result = doc.saveToBuffer('compress,garbage=4,linearize');
    return Buffer.from(result.asUint8Array());
  }

  // medium / heavy：重建 PDF，降低图片质量
  const dpi = opts.level === 'medium' ? 150 : 100;
  const quality = opts.level === 'medium' ? 75 : 50;
  const scale = dpi / 72;

  const newDoc = await PDFDocument.create(); // pdf-lib

  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
    );

    const jpegData = pixmap.asJPEG(quality);
    const jpgImage = await newDoc.embedJpg(Buffer.from(jpegData));

    const origBounds = page.getBounds();
    const pageWidth = origBounds[2] - origBounds[0];
    const pageHeight = origBounds[3] - origBounds[1];

    const newPage = newDoc.addPage([pageWidth, pageHeight]);
    newPage.drawImage(jpgImage, {
      x: 0, y: 0,
      width: pageWidth,
      height: pageHeight,
    });
  }

  return Buffer.from(await newDoc.save());
}
```

### 6.2 扩展 PdfProcessor

```typescript
case 'pdf_compress':
  return await this.handleCompressPdf(task, job);
```

```typescript
private async handleCompressPdf(task: any, job: Job): Promise<unknown> {
  const fileId = task.inputFileIds?.[0];
  if (!fileId) throw new Error('No input file specified');

  const inputFile = await this.filesService.getById(fileId);
  if (inputFile.mimeType !== 'application/pdf') {
    throw new Error(`INVALID_FILE_TYPE`);
  }

  const inputBuffer = await this.filesService.download(inputFile.storageKey);
  const inputSize = inputBuffer.length;
  await this.reportProgress(task.id, job, 10);

  const config = task.inputConfig as CompressPdfOptions;
  const result = await this.pdfService.compressPdf(inputBuffer, {
    level: config.level ?? 'medium',
  });
  await this.reportProgress(task.id, job, 85);

  const outputFile = await this.filesService.upload(
    result,
    { filename: `compressed-${inputFile.filename}`, mimeType: 'application/pdf', size: result.length },
    task.userId ?? undefined,
  );

  await this.tasksService.markCompleted(task.id, outputFile.id);
  await this.reportProgress(task.id, job, 100);
  return { outputFileId: outputFile.id, originalSize: inputSize, compressedSize: result.length };
}
```

### 6.3 前端页面

`apps/web/src/app/[locale]/(app)/pdf/compress/page.tsx`:

1. **文件上传** — FileDropzone
2. **压缩级别选择** — 三档按钮：轻度 / 中度 / 重度，每档带说明
3. **压缩结果** — 显示压缩前后大小对比（原始 X MB → 压缩后 Y MB，减少 Z%）
4. **处理 + 下载**

## 注意事项

- medium/heavy 模式会将文本页面也转为图片，会丢失文字可搜索性
- 应在 UI 上提示用户该副作用
- light 模式保留原始内容，仅清理冗余

## 验收标准

- [ ] light 模式：输出文件 ≤ 原始大小，文字可选
- [ ] medium 模式：明显压缩，图片质量可接受
- [ ] heavy 模式：大幅压缩
- [ ] 压缩前后大小对比正确显示
