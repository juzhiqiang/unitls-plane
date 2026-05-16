# 02 - PDF 拆分 Processor

> 依赖：Phase 2 完成
> 预估：2h
> 可并行：与 01/03/05 同时执行

## 目标

实现 PDF 拆分功能：按页范围、按指定页码、每 N 页一份。

## 步骤

### 2.1 扩展 PdfService

`apps/api/src/modules/tasks/services/pdf.service.ts`:
```typescript
async split(input: Buffer, opts: SplitOptions): Promise<Buffer[]> {
  const src = await PDFDocument.load(input);
  const totalPages = src.getPageCount();

  const ranges = this.parseRanges(opts, totalPages);
  const outputs: Buffer[] = [];

  for (const range of ranges) {
    const target = await PDFDocument.create();
    const pages = await target.copyPages(src, range);
    pages.forEach(p => target.addPage(p));
    outputs.push(Buffer.from(await target.save()));
  }

  return outputs;
}

private parseRanges(opts: SplitOptions, total: number): number[][] {
  // mode: 'ranges' — opts.ranges = [[0,4], [5,9]]
  // mode: 'pages' — opts.pages = [0, 2, 5]
  // mode: 'every' — opts.every = 5 → 每 5 页一份
  switch (opts.mode) {
    case 'ranges':
      return opts.ranges!.map(([start, end]) =>
        Array.from({ length: end - start + 1 }, (_, i) => start + i),
      );
    case 'pages':
      return opts.pages!.map(p => [p]);
    case 'every': {
      const result: number[][] = [];
      for (let i = 0; i < total; i += opts.every!) {
        result.push(Array.from(
          { length: Math.min(opts.every!, total - i) },
          (_, j) => i + j,
        ));
      }
      return result;
    }
  }
}

export interface SplitOptions {
  mode: 'ranges' | 'pages' | 'every';
  ranges?: [number, number][];   // [[start, end], ...]，inclusive，0-based
  pages?: number[];               // 单页提取
  every?: number;                 // 每 N 页一份
}
```

### 2.2 扩展 PdfProcessor

```typescript
private async handleSplit(task: Task, job: Job): Promise<unknown> {
  await this.tasksService.markProcessing(task.id);

  // 1. 下载
  const inputFile = await this.filesService.getById(task.input_file_ids[0]);
  const inputBuffer = await this.filesService.download(inputFile.storage_key);
  await job.updateProgress(20);

  // 2. 拆分
  const outputs = await this.pdfService.split(inputBuffer, task.input_config);
  await job.updateProgress(60);

  // 3. 打包成 ZIP（多文件输出）
  let outputBuffer: Buffer;
  let outputName: string;
  let outputMime: string;

  if (outputs.length === 1) {
    outputBuffer = outputs[0];
    outputName = `split-${inputFile.filename}`;
    outputMime = 'application/pdf';
  } else {
    const archive = archiver('zip');
    outputs.forEach((buf, i) => {
      archive.append(buf, { name: `part-${i + 1}.pdf` });
    });
    outputBuffer = await streamToBuffer(archive);
    outputName = `split-${inputFile.filename}.zip`;
    outputMime = 'application/zip';
  }
  await job.updateProgress(85);

  // 4. 上传
  const outputFile = await this.filesService.upload(outputBuffer, {
    filename: outputName,
    mimeType: outputMime,
    size: outputBuffer.length,
  }, task.user_id);

  await this.tasksService.markCompleted(task.id, outputFile.id);
  await job.updateProgress(100);

  return { outputFileId: outputFile.id };
}
```

### 2.3 安装 archiver

```bash
bun add archiver
bun add -d @types/archiver
```

### 2.4 校验

- 输入必须是 PDF
- ranges/pages 必须在 [0, totalPages) 范围内
- every 必须 > 0

## 验收标准

- [ ] mode='ranges' 提取页范围正常
- [ ] mode='pages' 单页提取后合并为 1 个 PDF
- [ ] mode='every' 每 N 页拆分为多个 PDF
- [ ] 多 PDF 输出打包成 ZIP
- [ ] 越界范围 → 抛错
