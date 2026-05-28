# 07 - PDF 元数据编辑

> 依赖：00-pdf-schema-update
> 预估：1.5h
> 可并行：与 01/02/03/04/05/06/08 同时执行

## 目标

查看和编辑 PDF 元数据：标题、作者、主题、关键词、创建者。

## 技术方案

使用 `pdf-lib` 的 `doc.getTitle()` / `doc.setTitle()` 等方法。

## 步骤

### 7.1 扩展 PdfService

`apps/api/src/modules/tasks/services/pdf.service.ts`:

```typescript
export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
}

async getMetadata(input: Buffer): Promise<PdfMetadata> {
  const doc = await PDFDocument.load(input);
  return {
    title: doc.getTitle() ?? undefined,
    author: doc.getAuthor() ?? undefined,
    subject: doc.getSubject() ?? undefined,
    keywords: doc.getKeywords()?.split(',').map(k => k.trim()).filter(Boolean),
    creator: doc.getCreator() ?? undefined,
    producer: doc.getProducer() ?? undefined,
  };
}

async editMetadata(input: Buffer, meta: PdfMetadata): Promise<Buffer> {
  const doc = await PDFDocument.load(input);

  if (meta.title !== undefined) doc.setTitle(meta.title);
  if (meta.author !== undefined) doc.setAuthor(meta.author);
  if (meta.subject !== undefined) doc.setSubject(meta.subject);
  if (meta.keywords !== undefined) doc.setKeywords(meta.keywords);
  if (meta.creator !== undefined) doc.setCreator(meta.creator);
  if (meta.producer !== undefined) doc.setProducer(meta.producer);

  return Buffer.from(await doc.save());
}
```

### 7.2 扩展 PdfProcessor

```typescript
case 'pdf_metadata':
  return await this.handleMetadata(task, job);
```

```typescript
private async handleMetadata(task: any, job: Job): Promise<unknown> {
  const fileId = task.inputFileIds?.[0];
  if (!fileId) throw new Error('No input file specified');

  const inputFile = await this.filesService.getById(fileId);
  if (inputFile.mimeType !== 'application/pdf') {
    throw new Error(`INVALID_FILE_TYPE`);
  }

  const inputBuffer = await this.filesService.download(inputFile.storageKey);
  await this.reportProgress(task.id, job, 20);

  const config = task.inputConfig as PdfMetadata;
  const result = await this.pdfService.editMetadata(inputBuffer, config);
  await this.reportProgress(task.id, job, 80);

  const outputFile = await this.filesService.upload(
    result,
    { filename: inputFile.filename, mimeType: 'application/pdf', size: result.length },
    task.userId ?? undefined,
  );

  await this.tasksService.markCompleted(task.id, outputFile.id);
  await this.reportProgress(task.id, job, 100);
  return { outputFileId: outputFile.id };
}
```

### 7.3 前端页面

`apps/web/src/app/[locale]/(app)/pdf/metadata/page.tsx`:

1. **文件上传** — FileDropzone
2. **元数据表单** — 上传后自动读取现有元数据并填充表单：
   - 标题（text input）
   - 作者（text input）
   - 主题（text input）
   - 关键词（tag input 或逗号分隔）
   - 创建者（text input）
   - 生产者（text input，只读展示）
3. **处理** — 提交修改后的元数据
4. **下载**

### 7.4 元数据读取 API

需要新增一个轻量级 API 来读取 PDF 元数据（不走任务队列）：

`apps/api/src/modules/tasks/tasks.controller.ts` 新增：

```typescript
@Post('pdf/metadata')
@Public()
async getPdfMetadata(@Body() body: { fileId: string }) {
  const file = await this.filesService.getById(body.fileId);
  const buffer = await this.filesService.download(file.storageKey);
  return this.pdfService.getMetadata(buffer);
}
```

或者前端直接用 `pdf-lib` 在客户端读取元数据（更快，无需上传）：

```typescript
// 前端直接读取
import { PDFDocument } from 'pdf-lib';
const doc = await PDFDocument.load(await file.arrayBuffer());
const metadata = {
  title: doc.getTitle(),
  author: doc.getAuthor(),
  // ...
};
```

推荐**前端读取元数据 + 后端写入元数据**方案。

## 验收标准

- [ ] 上传 PDF 后自动显示现有元数据
- [ ] 修改标题、作者后输出 PDF 包含新元数据
- [ ] 空值字段不覆盖原有值
- [ ] 关键词以数组形式正确存储
