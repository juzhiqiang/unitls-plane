# 04 - PDF 加水印

> 依赖：00-pdf-schema-update
> 预估：3h
> 可并行：与 01/02/03/05/06/07/08 同时执行

## 目标

为 PDF 所有页面添加文字水印（半透明、倾斜），支持自定义文字、字号、颜色、透明度、位置。

## 技术方案

使用 `pdf-lib` 的 `page.drawText()` 在每页绘制半透明文字。

## 步骤

### 4.1 扩展 PdfService

`apps/api/src/modules/tasks/services/pdf.service.ts`:

```typescript
import { rgb, StandardFonts } from 'pdf-lib';

export interface WatermarkOptions {
  text: string;
  fontSize?: number;        // 默认 48
  opacity?: number;         // 0-1，默认 0.15
  color?: { r: number; g: number; b: number };  // 默认灰色
  rotation?: number;        // 度数，默认 -45（对角线）
  position?: 'center' | 'diagonal' | 'tile';  // 默认 diagonal
  pages?: number[];         // 0-based，默认全部
}

async watermark(input: Buffer, opts: WatermarkOptions): Promise<Buffer> {
  const doc = await PDFDocument.load(input);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const totalPages = doc.getPageCount();
  const pages = opts.pages ?? Array.from({ length: totalPages }, (_, i) => i);

  const fontSize = opts.fontSize ?? 48;
  const opacity = opts.opacity ?? 0.15;
  const color = opts.color ?? { r: 0.5, g: 0.5, b: 0.5 };
  const rotation = opts.rotation ?? -45;

  for (const idx of pages) {
    if (idx < 0 || idx >= totalPages) continue;
    const page = doc.getPage(idx);
    const { width, height } = page.getSize();

    if (opts.position === 'tile') {
      // 平铺水印
      const textWidth = font.widthOfTextAtSize(opts.text, fontSize);
      const stepX = textWidth + 100;
      const stepY = fontSize * 3;
      for (let y = 0; y < height; y += stepY) {
        for (let x = -width; x < width * 2; x += stepX) {
          page.drawText(opts.text, {
            x, y, size: fontSize,
            font, opacity,
            color: rgb(color.r, color.g, color.b),
            rotate: degrees(rotation),
          });
        }
      }
    } else {
      // center / diagonal — 单个水印居中
      const textWidth = font.widthOfTextAtSize(opts.text, fontSize);
      const x = (width - textWidth) / 2;
      const y = height / 2;
      page.drawText(opts.text, {
        x, y, size: fontSize,
        font, opacity,
        color: rgb(color.r, color.g, color.b),
        rotate: degrees(rotation),
      });
    }
  }

  return Buffer.from(await doc.save());
}
```

### 4.2 扩展 PdfProcessor

```typescript
case 'pdf_watermark':
  return await this.handleWatermark(task, job);
```

```typescript
private async handleWatermark(task: any, job: Job): Promise<unknown> {
  const fileId = task.inputFileIds?.[0];
  if (!fileId) throw new Error('No input file specified');

  const inputFile = await this.filesService.getById(fileId);
  if (inputFile.mimeType !== 'application/pdf') {
    throw new Error(`INVALID_FILE_TYPE`);
  }

  const inputBuffer = await this.filesService.download(inputFile.storageKey);
  await this.reportProgress(task.id, job, 20);

  const config = task.inputConfig as WatermarkOptions;
  if (!config.text || config.text.trim().length === 0) {
    throw new Error('Watermark text is required');
  }

  const result = await this.pdfService.watermark(inputBuffer, config);
  await this.reportProgress(task.id, job, 85);

  const outputFile = await this.filesService.upload(
    result,
    { filename: `watermarked-${inputFile.filename}`, mimeType: 'application/pdf', size: result.length },
    task.userId ?? undefined,
  );

  await this.tasksService.markCompleted(task.id, outputFile.id);
  await this.reportProgress(task.id, job, 100);
  return { outputFileId: outputFile.id };
}
```

### 4.3 前端页面

`apps/web/src/app/[locale]/(app)/pdf/watermark/page.tsx`:

1. **文件上传** — FileDropzone
2. **PDF 第一页预览** — 显示首页缩略图，叠加 CSS 模拟的水印效果（实时预览）
3. **配置项**：
   - 水印文字（input）
   - 字号（number input，48-120）
   - 透明度（range slider，0.05-0.5）
   - 颜色（预设几个颜色按钮：灰/红/蓝）
   - 位置模式（居中 / 对角线 / 平铺）
4. **CSS 预览** — 在缩略图上用 `::after` 伪元素模拟水印效果
5. **处理 + 下载**

## 验收标准

- [ ] 水印文字正确渲染在所有页面
- [ ] 透明度参数生效
- [ ] 对角线旋转正确
- [ ] 平铺模式覆盖整页
- [ ] 前端预览与实际输出一致
