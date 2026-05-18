# 01 - PDF 合并 Processor

> 依赖：Phase 2 完成
> 预估：2h
> 可并行：与 02/03/05 同时执行

## 目标

实现服务端 PDF 合并功能，作为 pdf-queue 的 Processor 之一。

## 步骤

### 1.1 安装依赖

```bash
cd apps/api
bun add pdf-lib
```

### 1.2 创建 PdfService

`apps/api/src/modules/tasks/services/pdf.service.ts`:

```typescript
import { PDFDocument } from 'pdf-lib';

@Injectable()
export class PdfService {
  async merge(inputs: Buffer[]): Promise<Buffer> {
    const merged = await PDFDocument.create();

    for (const input of inputs) {
      const doc = await PDFDocument.load(input);
      const copiedPages = await merged.copyPages(doc, doc.getPageIndices());
      copiedPages.forEach(page => merged.addPage(page));
    }

    return Buffer.from(await merged.save());
  }
}
```

### 1.3 扩展 PdfProcessor

`apps/api/src/modules/tasks/processors/pdf.processor.ts`:

```typescript
@Processor('pdf-queue', { concurrency: 2 })
export class PdfProcessor extends WorkerHost {
  async process(job: Job<{ taskId: string }>): Promise<unknown> {
    const task = await this.tasksService.getById(job.data.taskId);

    switch (task.type) {
      case 'pdf_merge':
        return this.handleMerge(task, job);
      case 'pdf_split':
        return this.handleSplit(task, job);
      default:
        throw new Error(`Unknown pdf task type: ${task.type}`);
    }
  }

  private async handleMerge(task: Task, job: Job): Promise<unknown> {
    await this.tasksService.markProcessing(task.id);

    // 1. 下载所有输入文件
    const inputs: Buffer[] = [];
    for (let i = 0; i < task.input_file_ids.length; i++) {
      const file = await this.filesService.getById(task.input_file_ids[i]);
      const buffer = await this.filesService.download(file.storage_key);
      inputs.push(buffer);
      await job.updateProgress(
        Math.floor(((i + 1) / task.input_file_ids.length) * 40)
      );
    }

    // 2. 合并
    const merged = await this.pdfService.merge(inputs);
    await job.updateProgress(80);

    // 3. 上传
    const outputFile = await this.filesService.upload(
      merged,
      {
        filename: task.input_config.outputFilename ?? 'merged.pdf',
        mimeType: 'application/pdf',
        size: merged.length,
      },
      task.user_id
    );
    await job.updateProgress(95);

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await job.updateProgress(100);

    return { outputFileId: outputFile.id };
  }
}
```

### 1.4 排序支持

如果 `input_config.order` 提供，按指定顺序合并：

```typescript
const orderedIds = task.input_config.order ?? task.input_file_ids;
```

### 1.5 校验

- 所有输入必须是 PDF（mime_type === 'application/pdf'）
- 总页数限制（避免内存溢出）：例如 ≤ 500 页
- 单文件 ≤ 50MB

## 验收标准

- [ ] 合并 3 个 PDF 后页数 = 三者之和
- [ ] 按 input_config.order 指定顺序合并
- [ ] 非 PDF 输入 → 抛错（INVALID_FILE_TYPE）
- [ ] 进度上报正确
