# 05 - 字体转换 Processor

> 依赖：Phase 2 完成
> 预估：3h
> 可并行：与 01/02/03 同时执行

## 目标

实现服务端字体格式转换：TTF/OTF/WOFF/WOFF2 互转。

## 步骤

### 5.1 安装依赖

```bash
cd apps/api
bun add fonteditor-core wawoff2
```

### 5.2 创建 FontService

`apps/api/src/modules/tasks/services/font.service.ts`:
```typescript
import { Font } from 'fonteditor-core';
import wawoff2 from 'wawoff2';

@Injectable()
export class FontService {
  async convert(input: Buffer, opts: FontConvertOptions): Promise<Buffer> {
    const fromType = this.detectType(input);
    const toType = opts.toFormat;

    // WOFF2 需要特殊处理（wawoff2 解压）
    let workingBuffer = input;
    if (fromType === 'woff2') {
      const decompressed = await wawoff2.decompress(input);
      workingBuffer = Buffer.from(decompressed);
    }

    // 使用 fonteditor-core 解析
    const font = Font.create(workingBuffer, {
      type: fromType === 'woff2' ? 'ttf' : fromType,
      hinting: true,
    });

    // 子集化（可选）
    if (opts.subsetText) {
      font.optimize({
        subset: this.charsToCodes(opts.subsetText),
      });
    }

    // 输出
    if (toType === 'woff2') {
      const ttfBuffer = font.write({ type: 'ttf', hinting: true });
      const woff2 = await wawoff2.compress(ttfBuffer);
      return Buffer.from(woff2);
    } else {
      return Buffer.from(font.write({ type: toType, hinting: true }));
    }
  }

  private detectType(buffer: Buffer): 'ttf' | 'otf' | 'woff' | 'woff2' {
    const head = buffer.toString('hex', 0, 4);
    if (head === '00010000' || head === '74727565') return 'ttf';
    if (head === '4f54544f') return 'otf';
    if (head === '774f4646') return 'woff';
    if (head === '774f4632') return 'woff2';
    throw new BadRequestException({
      code: 'INVALID_FONT',
      message: 'Unsupported font format',
    });
  }

  private charsToCodes(text: string): number[] {
    return [...new Set([...text].map(c => c.codePointAt(0)!))];
  }
}

export interface FontConvertOptions {
  toFormat: 'ttf' | 'otf' | 'woff' | 'woff2';
  subsetText?: string;
}
```

### 5.3 实现 FontProcessor

`apps/api/src/modules/tasks/processors/font.processor.ts`:
```typescript
@Processor('font-queue', { concurrency: 2 })
export class FontProcessor extends WorkerHost {
  async process(job: Job<{ taskId: string }>): Promise<unknown> {
    const task = await this.tasksService.getById(job.data.taskId);
    await this.tasksService.markProcessing(task.id);

    const inputFile = await this.filesService.getById(task.input_file_ids[0]);
    const inputBuffer = await this.filesService.download(inputFile.storage_key);
    await job.updateProgress(20);

    const output = await this.fontService.convert(inputBuffer, task.input_config);
    await job.updateProgress(80);

    const ext = task.input_config.toFormat;
    const baseName = inputFile.filename.replace(/\.[^.]+$/, '');
    const outputFile = await this.filesService.upload(output, {
      filename: `${baseName}.${ext}`,
      mimeType: `font/${ext}`,
      size: output.length,
    }, task.user_id);

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await job.updateProgress(100);

    return { outputFileId: outputFile.id };
  }
}
```

### 5.4 字体元信息提取

提供 `getFontInfo` 方法（供前端预览使用）：
```typescript
async getFontInfo(input: Buffer): Promise<FontInfo> {
  const font = Font.create(input, { type: this.detectType(input) });
  const data = font.get();
  return {
    fontFamily: data.name.fontFamily,
    fontSubfamily: data.name.fontSubFamily,
    fullName: data.name.fullName,
    glyphCount: data.glyf.length,
    unitsPerEm: data.head.unitsPerEm,
  };
}
```

暴露 API：`GET /fonts/:fileId/info`。

## 验收标准

- [ ] TTF → WOFF2 转换成功，文件变小
- [ ] WOFF2 → TTF 转换成功
- [ ] OTF → WOFF 正常
- [ ] 子集化后 glyph 数量减少
- [ ] 字体元信息接口返回正确数据
- [ ] 非字体文件 → INVALID_FONT 错误
